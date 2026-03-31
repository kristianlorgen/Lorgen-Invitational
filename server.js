require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const path = require('path');
const { supabaseAdmin } = require('./lib/supabaseClient');

if (!supabaseAdmin) {
  throw new Error('Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY');
}

const app = express();
const supabase = supabaseAdmin;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });
const PORT = Number(process.env.PORT || 3000);
const GALLERY_BUCKET = 'tournament-gallery';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

function asInt(value) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function canonicalStorageUrl(storagePath) {
  if (!storagePath) return null;
  if (/^https?:\/\//i.test(storagePath)) return storagePath;
  const { data } = supabase.storage.from(GALLERY_BUCKET).getPublicUrl(storagePath.replace(/^\/+/, ''));
  return data?.publicUrl || null;
}

function jsonError(res, code, error, status = 400, extra = {}) {
  return res.status(status).json({ success: false, code, error, ...extra });
}

async function getActiveTournament() {
  let query = supabase
    .from('tournaments')
    .select('id, name, year, course, status, date, slope_rating, description')
    .order('is_active', { ascending: false })
    .order('date', { ascending: false })
    .limit(1);

  const { data, error } = await query;
  if (error) throw error;
  if (!data?.length) return null;
  return data[0];
}

async function getTeamWithPin({ tournamentId, teamId, pin }) {
  let query = supabase
    .from('teams')
    .select('id, tournament_id, name, pin, locked')
    .eq('pin', String(pin).trim());

  if (tournamentId) query = query.eq('tournament_id', tournamentId);
  if (teamId) query = query.eq('id', teamId);

  const { data, error } = await query.limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

function resolveTeamAuthPayload(req) {
  return {
    teamId: asInt(req.query.team_id ?? req.body.team_id),
    tournamentId: asInt(req.query.tournament_id ?? req.body.tournament_id),
    pin: String(req.headers['x-team-pin'] || req.query.pin || req.body.pin || '').trim()
  };
}

async function requireTeamAuth(req, res) {
  const { teamId, tournamentId, pin } = resolveTeamAuthPayload(req);
  if (!teamId || !tournamentId || !pin) {
    jsonError(res, 'TEAM_SESSION_MISSING', 'Team session mangler', 401);
    return null;
  }

  const team = await getTeamWithPin({ tournamentId, teamId, pin });
  if (!team) {
    jsonError(res, 'TEAM_SESSION_INVALID', 'Ugyldig PIN eller lagøkt', 401);
    return null;
  }

  return team;
}

async function loadTeamPlayers(teamId) {
  const { data, error } = await supabase
    .from('team_members')
    .select('players(id, name, handicap)')
    .eq('team_id', teamId)
    .order('id', { ascending: true });

  if (error) throw error;
  return (data || []).map((row) => row.players).filter(Boolean);
}

async function loadTournamentHoles(tournamentId) {
  const { data, error } = await supabase
    .from('tournament_holes')
    .select('hole_number, par, stroke_index, requires_photo, is_longest_drive, is_closest_to_pin')
    .eq('tournament_id', tournamentId)
    .order('hole_number', { ascending: true });

  if (error) throw error;
  return data || [];
}

async function broadcastSeedIds(tournamentId, teamId) {
  const [scoresResp, awardsResp] = await Promise.all([
    supabase.from('scores').select('id').eq('tournament_id', tournamentId).order('id', { ascending: false }).limit(1),
    supabase.from('award_claims').select('id').eq('tournament_id', tournamentId).order('id', { ascending: false }).limit(1)
  ]);
  const chatResp = await supabase
    .from('chat_messages')
    .select('id')
    .eq('tournament_id', tournamentId)
    .eq('team_id', teamId)
    .order('id', { ascending: false })
    .limit(1);

  return {
    scoreId: scoresResp.data?.[0]?.id || 0,
    awardId: awardsResp.data?.[0]?.id || 0,
    chatId: chatResp.data?.[0]?.id || 0
  };
}

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/ready', (_req, res) => res.json({ status: 'ready' }));

app.get('/api/tournament', async (_req, res) => {
  try {
    const tournament = await getActiveTournament();
    return res.json({ tournament });
  } catch (error) {
    return jsonError(res, 'TOURNAMENT_LOAD_FAILED', error.message, 500);
  }
});

app.post('/api/auth/team-login', async (req, res) => {
  try {
    const pin = String(req.body?.pin || '').trim();
    if (!pin) return jsonError(res, 'PIN_REQUIRED', 'PIN mangler', 400);

    const tournament = await getActiveTournament();
    if (!tournament) return jsonError(res, 'TOURNAMENT_NOT_FOUND', 'Ingen aktiv turnering', 404);

    const team = await getTeamWithPin({ tournamentId: tournament.id, pin });
    if (!team) return jsonError(res, 'PIN_INVALID', 'Ugyldig PIN', 401);

    return res.json({ success: true, team_id: team.id, tournament_id: team.tournament_id });
  } catch (error) {
    return jsonError(res, 'TEAM_LOGIN_FAILED', error.message, 500);
  }
});

app.post('/api/auth/logout', (_req, res) => res.json({ success: true }));
app.get('/api/auth/status', (_req, res) => res.json({ type: null }));
app.get('/api/auth/github-url', (_req, res) => res.json({ success: false, error: 'Disabled in rebuilt backend' }));
app.post('/api/auth/github-token', (_req, res) => res.json({ success: false, error: 'Disabled in rebuilt backend' }));
app.post('/api/auth/admin-login', (_req, res) => res.status(501).json({ success: false, error: 'Admin auth handled separately' }));

app.get('/api/team/scorecard', async (req, res) => {
  try {
    const team = await requireTeamAuth(req, res);
    if (!team) return;

    const [tournamentResp, players, holes, scoresResp, claimsResp] = await Promise.all([
      supabase.from('tournaments').select('id, name, date, course, slope_rating, status').eq('id', team.tournament_id).single(),
      loadTeamPlayers(team.id),
      loadTournamentHoles(team.tournament_id),
      supabase
        .from('scores')
        .select('id, hole_number, score, photo_path, created_at')
        .eq('tournament_id', team.tournament_id)
        .eq('team_id', team.id),
      supabase
        .from('award_claims')
        .select('id, hole_number, award_type, player_name, detail, claimed_at')
        .eq('tournament_id', team.tournament_id)
        .eq('team_id', team.id)
    ]);

    if (tournamentResp.error) throw tournamentResp.error;
    if (scoresResp.error) throw scoresResp.error;
    if (claimsResp.error) throw claimsResp.error;

    const p1 = players[0] || {};
    const p2 = players[1] || {};

    return res.json({
      success: true,
      tournament: tournamentResp.data,
      team: {
        id: team.id,
        tournament_id: team.tournament_id,
        team_name: team.name,
        player1: p1.name || 'Spiller 1',
        player2: p2.name || 'Spiller 2',
        player1_handicap: p1.handicap ?? 0,
        player2_handicap: p2.handicap ?? 0,
        locked: Boolean(team.locked)
      },
      holes,
      scores: (scoresResp.data || []).map((row) => ({
        ...row,
        image_url: canonicalStorageUrl(row.photo_path)
      })),
      claims: claimsResp.data || [],
      hole_sponsors: []
    });
  } catch (error) {
    return jsonError(res, 'SCORECARD_LOAD_FAILED', error.message, 500);
  }
});

app.post('/api/team/submit-score', async (req, res) => {
  try {
    const team = await requireTeamAuth(req, res);
    if (!team) return;
    if (team.locked) return jsonError(res, 'SCORECARD_LOCKED', 'Resultatkort er låst', 409);

    const holeNumber = asInt(req.body?.hole_number);
    const score = asInt(req.body?.score);
    if (!holeNumber || !score || score < 1) return jsonError(res, 'INVALID_SCORE', 'Ugyldig score', 400);

    const { data: hole, error: holeError } = await supabase
      .from('tournament_holes')
      .select('hole_number, par')
      .eq('tournament_id', team.tournament_id)
      .eq('hole_number', holeNumber)
      .maybeSingle();

    if (holeError) throw holeError;
    if (!hole) return jsonError(res, 'HOLE_NOT_FOUND', 'Hull finnes ikke', 404);

    const payload = {
      tournament_id: team.tournament_id,
      team_id: team.id,
      hole_number: holeNumber,
      score,
      par: hole.par
    };

    const { data, error } = await supabase
      .from('scores')
      .upsert(payload, { onConflict: 'team_id,tournament_id,hole_number' })
      .select('id, hole_number, score, par, photo_path, created_at')
      .single();

    if (error) throw error;
    return res.json({ success: true, score: { ...data, image_url: canonicalStorageUrl(data.photo_path) } });
  } catch (error) {
    return jsonError(res, 'SCORE_SAVE_FAILED', error.message, 500);
  }
});

app.post('/api/team/claim-award', async (req, res) => {
  try {
    const team = await requireTeamAuth(req, res);
    if (!team) return;
    const holeNumber = asInt(req.body?.hole_number);
    const awardType = String(req.body?.award_type || '').trim();
    const playerName = String(req.body?.player_name || '').trim();
    const detail = String(req.body?.detail || '').trim();

    if (!holeNumber || !awardType || !playerName) {
      return jsonError(res, 'INVALID_AWARD', 'Mangler award-data', 400);
    }

    await supabase
      .from('award_claims')
      .delete()
      .eq('tournament_id', team.tournament_id)
      .eq('team_id', team.id)
      .eq('hole_number', holeNumber)
      .eq('award_type', awardType);

    const { data, error } = await supabase
      .from('award_claims')
      .insert({
        tournament_id: team.tournament_id,
        team_id: team.id,
        team_name: team.name,
        hole_number: holeNumber,
        award_type: awardType,
        player_name: playerName,
        detail
      })
      .select('id, hole_number, award_type, player_name, detail, team_name, claimed_at')
      .single();

    if (error) throw error;
    return res.json({ success: true, claim: data });
  } catch (error) {
    return jsonError(res, 'AWARD_SAVE_FAILED', error.message, 500);
  }
});

app.post('/api/team/birdie-shot', async (req, res) => {
  try {
    const team = await requireTeamAuth(req, res);
    if (!team) return;
    const note = String(req.body?.note || 'Alle spillere må ta birdie shots! 🥃').trim();

    const { data, error } = await supabase
      .from('chat_messages')
      .insert({
        tournament_id: team.tournament_id,
        team_id: team.id,
        team_name: team.name,
        message: 'BIRDIE_SHOUTOUT',
        note
      })
      .select('id, tournament_id, team_id, team_name, message, note, created_at')
      .single();

    if (error) throw error;
    return res.json({ success: true, event: data });
  } catch (error) {
    return jsonError(res, 'BIRDIE_FAILED', error.message, 500);
  }
});

app.get('/api/chat/messages', async (req, res) => {
  try {
    const team = await requireTeamAuth(req, res);
    if (!team) return;

    const { data, error } = await supabase
      .from('chat_messages')
      .select('id, tournament_id, team_id, team_name, message, note, image_path, created_at')
      .eq('tournament_id', team.tournament_id)
      .eq('team_id', team.id)
      .order('id', { ascending: true })
      .limit(200);

    if (error) throw error;

    return res.json({
      success: true,
      messages: (data || []).map((row) => ({ ...row, image_path: canonicalStorageUrl(row.image_path) }))
    });
  } catch (error) {
    return jsonError(res, 'CHAT_LOAD_FAILED', error.message, 500);
  }
});

app.post('/api/chat/send', upload.single('image'), async (req, res) => {
  try {
    const team = await requireTeamAuth(req, res);
    if (!team) return;

    const message = String(req.body?.message || '').trim();
    if (!message && !req.file) return jsonError(res, 'CHAT_EMPTY', 'Melding eller bilde kreves', 400);

    let imagePath = null;
    if (req.file) {
      const ext = path.extname(req.file.originalname || '.jpg') || '.jpg';
      const storagePath = `chat/${team.tournament_id}/${team.id}/${Date.now()}-${crypto.randomUUID()}${ext}`;
      const { error: uploadError } = await supabase.storage
        .from(GALLERY_BUCKET)
        .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype || 'image/jpeg', upsert: false });
      if (uploadError) throw uploadError;
      imagePath = storagePath;
    }

    const { data, error } = await supabase
      .from('chat_messages')
      .insert({
        tournament_id: team.tournament_id,
        team_id: team.id,
        team_name: team.name,
        message,
        image_path: imagePath
      })
      .select('id, tournament_id, team_id, team_name, message, note, image_path, created_at')
      .single();

    if (error) throw error;

    return res.json({ success: true, message: { ...data, image_path: canonicalStorageUrl(data.image_path) } });
  } catch (error) {
    return jsonError(res, 'CHAT_SEND_FAILED', error.message, 500);
  }
});

app.get('/api/scoreboard', async (_req, res) => {
  try {
    const tournament = await getActiveTournament();
    if (!tournament) return res.json({ tournament: null, holes: [], scoreboard: [], awards: [] });

    const [holesResp, teamsResp, scoresResp, awardsResp] = await Promise.all([
      supabase.from('tournament_holes').select('hole_number, par, stroke_index, requires_photo').eq('tournament_id', tournament.id).order('hole_number', { ascending: true }),
      supabase.from('teams').select('id, name, locked').eq('tournament_id', tournament.id).order('id', { ascending: true }),
      supabase.from('scores').select('team_id, hole_number, score').eq('tournament_id', tournament.id),
      supabase
        .from('award_claims')
        .select('id, award_type, hole_number, player_name, detail, team_name, claimed_at')
        .eq('tournament_id', tournament.id)
        .order('claimed_at', { ascending: false })
    ]);

    if (holesResp.error) throw holesResp.error;
    if (teamsResp.error) throw teamsResp.error;
    if (scoresResp.error) throw scoresResp.error;
    if (awardsResp.error) throw awardsResp.error;

    const holes = holesResp.data || [];
    const parByHole = new Map(holes.map((h) => [h.hole_number, Number(h.par || 0)]));

    const playersByTeam = new Map();
    const teamIds = (teamsResp.data || []).map((t) => t.id);
    if (teamIds.length) {
      const { data: memberRows, error: memberError } = await supabase
        .from('team_members')
        .select('team_id, players(name, handicap)')
        .in('team_id', teamIds)
        .order('id', { ascending: true });
      if (memberError) throw memberError;
      for (const row of memberRows || []) {
        if (!playersByTeam.has(row.team_id)) playersByTeam.set(row.team_id, []);
        if (row.players) playersByTeam.get(row.team_id).push(row.players);
      }
    }

    const scoresByTeam = new Map();
    for (const row of scoresResp.data || []) {
      if (!scoresByTeam.has(row.team_id)) scoresByTeam.set(row.team_id, []);
      scoresByTeam.get(row.team_id).push(row);
    }

    const scoreboard = (teamsResp.data || []).map((team) => {
      const teamScores = scoresByTeam.get(team.id) || [];
      const players = playersByTeam.get(team.id) || [];
      const player1 = players[0] || {};
      const player2 = players[1] || {};
      let totalScore = 0;
      let totalPar = 0;
      const holeScores = {};
      for (const row of teamScores) {
        const score = Number(row.score || 0);
        if (!score) continue;
        totalScore += score;
        totalPar += Number(parByHole.get(row.hole_number) || 0);
        holeScores[row.hole_number] = { score };
      }
      const holesCompleted = Object.keys(holeScores).length;
      const toPar = holesCompleted ? totalScore - totalPar : 0;
      return {
        team_id: team.id,
        team_name: team.name,
        player1: player1.name || 'Spiller 1',
        player2: player2.name || 'Spiller 2',
        player1_handicap: Number(player1.handicap || 0),
        player2_handicap: Number(player2.handicap || 0),
        handicap: 0,
        holes_completed: holesCompleted,
        total_score: totalScore,
        to_par: toPar,
        net_score: null,
        net_to_par: toPar,
        hole_scores: holeScores
      };
    }).sort((a, b) => {
      if (b.holes_completed !== a.holes_completed) return b.holes_completed - a.holes_completed;
      if (a.to_par !== b.to_par) return a.to_par - b.to_par;
      return a.total_score - b.total_score;
    });

    const awardBest = new Map();
    for (const a of awardsResp.data || []) {
      const key = `${a.award_type}:${a.hole_number}`;
      if (!awardBest.has(key)) awardBest.set(key, a);
    }

    return res.json({
      tournament,
      holes,
      scoreboard,
      awards: [...awardBest.values()]
    });
  } catch (error) {
    return jsonError(res, 'SCOREBOARD_FAILED', error.message, 500);
  }
});

app.get('/api/team/full-scorecard', async (req, res) => {
  try {
    const team = await requireTeamAuth(req, res);
    if (!team) return;
    const [holesResp, scoresResp] = await Promise.all([
      supabase.from('tournament_holes').select('hole_number, par').eq('tournament_id', team.tournament_id).order('hole_number', { ascending: true }),
      supabase.from('scores').select('hole_number, score').eq('tournament_id', team.tournament_id).eq('team_id', team.id)
    ]);

    if (holesResp.error) throw holesResp.error;
    if (scoresResp.error) throw scoresResp.error;

    const scoreMap = new Map((scoresResp.data || []).map((s) => [s.hole_number, s.score]));
    const card = (holesResp.data || []).map((h) => ({ hole_number: h.hole_number, par: h.par, score: scoreMap.get(h.hole_number) || null }));
    return res.json({ success: true, team_id: team.id, tournament_id: team.tournament_id, holes: card });
  } catch (error) {
    return jsonError(res, 'FULL_SCORECARD_FAILED', error.message, 500);
  }
});

app.post('/api/team/upload-photo/:holeNum', upload.single('photo'), async (req, res) => {
  try {
    const team = await requireTeamAuth(req, res);
    if (!team) return;
    if (!req.file) return jsonError(res, 'PHOTO_REQUIRED', 'Bilde mangler', 400);

    const holeNumber = asInt(req.params.holeNum);
    if (!holeNumber) return jsonError(res, 'INVALID_HOLE', 'Ugyldig hullnummer', 400);

    const ext = path.extname(req.file.originalname || '.jpg') || '.jpg';
    const storagePath = `hole-images/${team.tournament_id}/${team.id}/${holeNumber}/${Date.now()}-${crypto.randomUUID()}${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(GALLERY_BUCKET)
      .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype || 'image/jpeg', upsert: false });
    if (uploadError) throw uploadError;

    const imageUrl = canonicalStorageUrl(storagePath);

    const [scoreUpsertResp, imageInsertResp] = await Promise.all([
      supabase
        .from('scores')
        .upsert({
          tournament_id: team.tournament_id,
          team_id: team.id,
          hole_number: holeNumber,
          score: 0,
          photo_path: storagePath
        }, { onConflict: 'team_id,tournament_id,hole_number' })
        .select('id')
        .single(),
      supabase.from('hole_images').insert({ tournament_id: team.tournament_id, team_id: team.id, hole_number: holeNumber, image_url: imageUrl })
    ]);

    if (scoreUpsertResp.error) throw scoreUpsertResp.error;
    if (imageInsertResp.error) throw imageInsertResp.error;

    return res.json({ success: true, image_url: imageUrl, hole_number: holeNumber });
  } catch (error) {
    return jsonError(res, 'PHOTO_UPLOAD_FAILED', error.message, 500);
  }
});

app.get('/api/gallery', async (_req, res) => {
  try {
    const tournament = await getActiveTournament();
    if (!tournament) return res.json({ success: true, photos: [] });

    const [holeImagesResp, galleryResp] = await Promise.all([
      supabase
        .from('hole_images')
        .select('id, tournament_id, team_id, hole_number, image_url, created_at, teams(name)')
        .eq('tournament_id', tournament.id)
        .order('created_at', { ascending: false })
        .limit(250),
      supabase
        .from('tournament_gallery_images')
        .select('id, tournament_id, photo_path, uploaded_at, is_published')
        .eq('tournament_id', tournament.id)
        .eq('is_published', true)
        .order('uploaded_at', { ascending: false })
        .limit(250)
    ]);

    if (holeImagesResp.error) throw holeImagesResp.error;
    if (galleryResp.error) throw galleryResp.error;

    const photos = [
      ...(holeImagesResp.data || []).map((row) => ({
        photo_ref: `hole:${row.id}`,
        source: 'hole',
        id: row.id,
        tournament_id: row.tournament_id,
        team_id: row.team_id,
        team_name: row.teams?.name || 'Lag',
        hole_number: row.hole_number,
        image_url: canonicalStorageUrl(row.image_url),
        votes: 0,
        voted: false,
        created_at: row.created_at
      })),
      ...(galleryResp.data || []).map((row) => ({
        photo_ref: `gallery:${row.id}`,
        source: 'gallery',
        id: row.id,
        tournament_id: row.tournament_id,
        team_id: null,
        team_name: 'Arrangør',
        hole_number: null,
        image_url: canonicalStorageUrl(row.photo_path),
        votes: 0,
        voted: false,
        created_at: row.uploaded_at
      }))
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    return res.json({ success: true, photos });
  } catch (error) {
    return jsonError(res, 'GALLERY_LOAD_FAILED', error.message, 500);
  }
});

app.post('/api/gallery/vote', (_req, res) => res.json({ success: true }));
app.post('/api/team/lock-scorecard', async (req, res) => {
  try {
    const team = await requireTeamAuth(req, res);
    if (!team) return;
    const { error } = await supabase.from('teams').update({ locked: true }).eq('id', team.id);
    if (error) throw error;
    return res.json({ success: true });
  } catch (error) {
    return jsonError(res, 'SCORECARD_LOCK_FAILED', error.message, 500);
  }
});

app.get('/api/events', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');

  const tournamentId = asInt(req.query.tournament_id);
  const teamId = asInt(req.query.team_id);

  let scopeTournamentId = tournamentId;
  let scopeTeamId = teamId;
  if (tournamentId && teamId) {
    try {
      const team = await requireTeamAuth(req, res);
      if (!team) return;
      scopeTournamentId = team.tournament_id;
      scopeTeamId = team.id;
    } catch {
      return;
    }
  }

  if (!scopeTournamentId) {
    const tournament = await getActiveTournament();
    scopeTournamentId = tournament?.id || null;
  }
  if (!scopeTournamentId) {
    res.write('event: ping\ndata: {"type":"ping"}\n\n');
    return res.end();
  }

  const seeds = await broadcastSeedIds(scopeTournamentId, scopeTeamId || -1);
  let lastScoreId = seeds.scoreId;
  let lastAwardId = seeds.awardId;
  let lastChatId = seeds.chatId;

  const send = (event, payload) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  send('ping', { type: 'ping' });

  const interval = setInterval(async () => {
    try {
      const [scoreRows, awardRows, chatRows] = await Promise.all([
        supabase
          .from('scores')
          .select('id, team_id, hole_number, score, created_at')
          .eq('tournament_id', scopeTournamentId)
          .gt('id', lastScoreId)
          .order('id', { ascending: true })
          .limit(20),
        supabase
          .from('award_claims')
          .select('id, team_id, team_name, award_type, hole_number, player_name, detail, claimed_at')
          .eq('tournament_id', scopeTournamentId)
          .gt('id', lastAwardId)
          .order('id', { ascending: true })
          .limit(20),
        supabase
          .from('chat_messages')
          .select('id, tournament_id, team_id, team_name, message, note, image_path, created_at')
          .eq('tournament_id', scopeTournamentId)
          .gt('id', lastChatId)
          .order('id', { ascending: true })
          .limit(50)
      ]);

      for (const row of scoreRows.data || []) {
        lastScoreId = Math.max(lastScoreId, row.id);
        send('score_updated', { type: 'score_updated', data: row });
      }

      for (const row of awardRows.data || []) {
        lastAwardId = Math.max(lastAwardId, row.id);
        send('award_updated', { type: 'award_updated', data: row });
      }

      for (const row of chatRows.data || []) {
        lastChatId = Math.max(lastChatId, row.id);
        const payload = { ...row, image_path: canonicalStorageUrl(row.image_path) };

        if (!scopeTeamId || row.team_id === scopeTeamId) {
          send('chat_message', { type: 'chat_message', data: payload });
        }
        if (row.message === 'BIRDIE_SHOUTOUT') {
          const birdiePayload = {
            id: row.id,
            team_id: row.team_id,
            team_name: row.team_name,
            message: row.note || 'Alle spillere må ta birdie shots! 🥃',
            note: row.note,
            created_at: row.created_at
          };
          send('birdie_shout', { type: 'birdie_shout', data: birdiePayload });
          send('birdie_shot', { type: 'birdie_shot', data: birdiePayload });
        }
      }
    } catch (_error) {
      // keep stream alive; polling retries next tick
    }
  }, 2000);

  req.on('close', () => {
    clearInterval(interval);
    res.end();
  });
});

app.get('/api/legacy', (_req, res) => res.json({ success: true, entries: [] }));
app.get('/api/sponsors', (_req, res) => res.json({ success: true, sponsors: [] }));
app.get('/api/coin-back', (_req, res) => res.json({ success: true, image: null }));

app.get('/gallery', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'gallery.html')));
app.get('/scoreboard', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'scoreboard.html')));
app.get('/enter-score', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'enter-score.html')));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}

module.exports = app;
