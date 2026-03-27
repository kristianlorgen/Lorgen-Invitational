require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { supabase } = require('./lib/supabaseClient');
const { getTournamentFormat, getTeamSizeForFormat } = require('./services/tournamentFormat');

if (!supabase) {
  throw new Error('Supabase client is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.get('/health', (_, res) => res.status(200).json({ status: 'ok' }));
app.get('/ready', (_, res) => res.status(200).json({ status: 'ready' }));

function asInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_COOKIE_NAME = 'admin_auth';
const ADMIN_COOKIE_TTL_SECONDS = 60 * 60 * 12; // 12 timer
const ADMIN_SIGNING_SECRET = process.env.SESSION_SECRET || process.env.ADMIN_SIGNING_SECRET || ADMIN_PASSWORD || 'lorgen-admin';

function signAdminCookieValue(payload) {
  const hmac = crypto
    .createHmac('sha256', ADMIN_SIGNING_SECRET)
    .update(payload)
    .digest('hex');
  return `${payload}.${hmac}`;
}

function verifyAdminCookieValue(value) {
  if (!value || !value.includes('.')) return false;
  const idx = value.lastIndexOf('.');
  const payload = value.slice(0, idx);
  const sig = value.slice(idx + 1);
  const expected = crypto
    .createHmac('sha256', ADMIN_SIGNING_SECRET)
    .update(payload)
    .digest('hex');
  if (sig.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  const [issuedAtRaw] = payload.split(':');
  const issuedAt = Number.parseInt(issuedAtRaw, 10);
  if (!Number.isFinite(issuedAt)) return false;
  const ageSeconds = Math.floor(Date.now() / 1000) - issuedAt;
  return ageSeconds >= 0 && ageSeconds <= ADMIN_COOKIE_TTL_SECONDS;
}

function readCookies(req) {
  const raw = req.headers.cookie || '';
  return raw.split(';').reduce((acc, pair) => {
    const [key, ...parts] = pair.trim().split('=');
    if (!key) return acc;
    acc[key] = decodeURIComponent(parts.join('='));
    return acc;
  }, {});
}

function setAdminAuthCookie(res) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const token = signAdminCookieValue(`${issuedAt}:admin`);
  const secureFlag = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${ADMIN_COOKIE_TTL_SECONDS}; SameSite=Lax${secureFlag}`);
}

function clearAdminAuthCookie(res) {
  const secureFlag = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${ADMIN_COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secureFlag}`);
}

function isAdminAuthenticated(req) {
  const cookies = readCookies(req);
  return verifyAdminCookieValue(cookies[ADMIN_COOKIE_NAME]);
}

app.post('/api/auth/admin-login', async (req, res) => {
  try {
    const password = String(req.body?.password || '');
    if (!ADMIN_PASSWORD) {
      return res.status(500).json({ error: 'ADMIN_PASSWORD mangler i miljøvariabler.' });
    }
    if (!password || password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Ugyldig passord' });
    }
    setAdminAuthCookie(res);
    res.json({ success: true, type: 'admin' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/auth/status', (req, res) => {
  if (isAdminAuthenticated(req)) {
    return res.json({ type: 'admin' });
  }
  res.json({ type: null });
});

app.post('/api/auth/logout', (_, res) => {
  clearAdminAuthCookie(res);
  res.json({ success: true });
});

app.get('/api/auth/github-url', (_, res) => {
  res.status(501).json({ error: 'GitHub-innlogging er ikke aktivert i denne deployen.' });
});

app.post('/api/auth/github-token', (_, res) => {
  res.status(501).json({ error: 'GitHub-innlogging er ikke aktivert i denne deployen.' });
});

async function resolveTournamentId(tournamentId) {
  const parsed = asInt(tournamentId);
  if (parsed) return parsed;

  const { data, error } = await supabase
    .from('tournaments')
    .select('id')
    .in('status', ['active', 'upcoming'])
    .order('date', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data?.id || null;
}

async function getTournament(tournamentId) {
  const { data, error } = await supabase
    .from('tournaments')
    .select('*')
    .eq('id', tournamentId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function fetchTeamsWithPlayers(tournamentId) {
  const { data: teams, error: teamsError } = await supabase
    .from('teams')
    .select('id, tournament_id, name, pin, created_at')
    .eq('tournament_id', tournamentId)
    .order('id', { ascending: true });
  if (teamsError) throw teamsError;

  if (!teams.length) return [];

  const teamIds = teams.map((team) => team.id);
  const { data: members, error: membersError } = await supabase
    .from('team_members')
    .select('team_id, players (id, tournament_id, name, handicap, created_at)')
    .in('team_id', teamIds);
  if (membersError) throw membersError;

  const playersByTeamId = members.reduce((acc, row) => {
    if (!acc[row.team_id]) acc[row.team_id] = [];
    if (row.players) acc[row.team_id].push(row.players);
    return acc;
  }, {});

  return teams.map((team) => ({
    ...team,
    players: playersByTeamId[team.id] || []
  }));
}

app.get('/api/tournament', async (req, res) => {
  try {
    const tid = await resolveTournamentId(req.query.tournamentId);
    if (!tid) return res.json({ tournament: null });
    const tournament = await getTournament(tid);
    res.json({ tournament });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/tournaments', async (_, res) => {
  try {
    const { data, error } = await supabase
      .from('tournaments')
      .select('*')
      .order('year', { ascending: false });
    if (error) throw error;
    res.json({ tournaments: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function createTournamentHandler(req, res) {
  try {
    const { year, name, date, course = '', description = '', status = 'upcoming', format = 'scramble' } = req.body;
    if (!year || !name || !date) {
      return res.status(400).json({ error: 'year, name and date are required' });
    }

    const { data, error } = await supabase
      .from('tournaments')
      .insert({ year, name, date, course, description, status, format })
      .select('*')
      .single();
    if (error) throw error;

    res.status(201).json({ tournament: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

app.post('/api/admin/tournament', createTournamentHandler);
app.post('/api/admin/tournaments', createTournamentHandler);

app.put('/api/admin/tournament/:id', async (req, res) => {
  try {
    const tournamentId = asInt(req.params.id);
    if (!tournamentId) return res.status(400).json({ error: 'Invalid tournament id' });

    const updates = {};
    const allowedFields = ['year', 'name', 'date', 'course', 'description', 'status', 'format'];
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const { data, error } = await supabase
      .from('tournaments')
      .update(updates)
      .eq('id', tournamentId)
      .select('*')
      .single();
    if (error) throw error;

    res.json({ tournament: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/tournament/:id', async (req, res) => {
  try {
    const tournamentId = asInt(req.params.id);
    if (!tournamentId) return res.status(400).json({ error: 'Invalid tournament id' });

    const { error } = await supabase
      .from('tournaments')
      .delete()
      .eq('id', tournamentId);
    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/players', async (req, res) => {
  try {
    const tournamentId = await resolveTournamentId(req.query.tournamentId);
    if (!tournamentId) return res.json({ players: [] });

    const { data, error } = await supabase
      .from('players')
      .select('*')
      .eq('tournament_id', tournamentId)
      .order('name', { ascending: true });
    if (error) throw error;

    res.json({ players: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/players', async (req, res) => {
  try {
    const tournamentId = asInt(req.body.tournament_id);
    const { name, handicap = 0 } = req.body;
    if (!tournamentId || !name) return res.status(400).json({ error: 'tournament_id and name are required' });

    const { data, error } = await supabase
      .from('players')
      .insert({ tournament_id: tournamentId, name, handicap })
      .select('*')
      .single();
    if (error) throw error;

    res.status(201).json({ player: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/teams', async (req, res) => {
  try {
    const tournamentId = await resolveTournamentId(req.query.tournamentId);
    if (!tournamentId) return res.json({ teams: [] });

    const teams = await fetchTeamsWithPlayers(tournamentId);
    res.json({ teams });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/teams', async (req, res) => {
  try {
    const tournamentId = asInt(req.body.tournament_id || req.body.tournamentId);
    const name = req.body.name || req.body.team_name;
    const pin = req.body.pin || req.body.pin_code;
    if (!tournamentId || !name || !pin) {
      return res.status(400).json({ error: 'tournament_id, name and pin are required' });
    }

    const { data, error } = await supabase
      .from('teams')
      .insert({ tournament_id: tournamentId, name, pin })
      .select('*')
      .single();
    if (error) throw error;

    res.status(201).json({ team: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/teams/:id/add-player', async (req, res) => {
  try {
    const teamId = asInt(req.params.id);
    const playerId = asInt(req.body.player_id || req.body.playerId);
    if (!teamId || !playerId) return res.status(400).json({ error: 'team id and player id are required' });

    const { data: team, error: teamError } = await supabase
      .from('teams')
      .select('id, tournament_id')
      .eq('id', teamId)
      .single();
    if (teamError) throw teamError;

    const tournament = await getTournament(team.tournament_id);
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

    const { count, error: countError } = await supabase
      .from('team_members')
      .select('*', { count: 'exact', head: true })
      .eq('team_id', teamId);
    if (countError) throw countError;

    const maxPlayers = getTeamSizeForFormat(getTournamentFormat(tournament));
    if ((count || 0) >= maxPlayers) {
      return res.status(400).json({ error: 'Antall spillere passer ikke med valgt lagstørrelse' });
    }

    const { data: player, error: playerError } = await supabase
      .from('players')
      .select('id, tournament_id')
      .eq('id', playerId)
      .single();
    if (playerError) throw playerError;

    if (player.tournament_id !== team.tournament_id) {
      return res.status(400).json({ error: 'Player must belong to same tournament as team' });
    }

    const { data, error } = await supabase
      .from('team_members')
      .insert({ team_id: teamId, player_id: playerId })
      .select('*')
      .single();
    if (error) throw error;

    res.status(201).json({ membership: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/teams/:id', async (req, res) => {
  try {
    const teamId = asInt(req.params.id);
    const tournamentId = asInt(req.query.tournamentId || req.body?.tournamentId);
    if (!teamId || !tournamentId) return res.status(400).json({ error: 'team id and tournamentId are required' });

    await supabase.from('team_members').delete().eq('team_id', teamId);
    await supabase.from('scores').delete().eq('team_id', teamId);
    const { error } = await supabase.from('teams').delete().eq('id', teamId).eq('tournament_id', tournamentId);
    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/tournament/:id/teams', async (req, res) => {
  try {
    const tournamentId = asInt(req.params.id);
    if (!tournamentId) return res.status(400).json({ error: 'Invalid tournament id' });
    const teams = await fetchTeamsWithPlayers(tournamentId);

    const compat = teams.map((team) => ({
      id: team.id,
      tournament_id: team.tournament_id,
      team_name: team.name,
      pin_code: team.pin,
      players: team.players,
      player1: team.players[0]?.name || '',
      player2: team.players[1]?.name || ''
    }));

    res.json({ teams: compat });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/tournament/:id/scores', async (req, res) => {
  try {
    const tournamentId = asInt(req.params.id);
    if (!tournamentId) return res.status(400).json({ error: 'Invalid tournament id' });

    const { data: teams, error: teamError } = await supabase
      .from('teams')
      .select('id,name')
      .eq('tournament_id', tournamentId);
    if (teamError) throw teamError;

    const teamIds = teams.map((team) => team.id);
    if (!teamIds.length) return res.json({ scores: [] });

    const { data: scores, error: scoreError } = await supabase
      .from('scores')
      .select('*')
      .eq('tournament_id', tournamentId)
      .in('team_id', teamIds);
    if (scoreError) throw scoreError;

    res.json({ scores });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/team', async (req, res) => {
  try {
    const { tournament_id, team_name, pin_code, player1, player2 } = req.body;

    const teamResp = await fetch(`http://127.0.0.1:${PORT}/api/teams`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tournament_id, name: team_name, pin: pin_code })
    });
    const teamBody = await teamResp.json();
    if (!teamResp.ok) return res.status(teamResp.status).json(teamBody);

    const players = [player1, player2].filter(Boolean);
    for (const p of players) {
      const pr = await supabase.from('players').insert({ tournament_id, name: p }).select('*').single();
      if (pr.error) throw pr.error;
      const linkResp = await fetch(`http://127.0.0.1:${PORT}/api/teams/${teamBody.team.id}/add-player`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player_id: pr.data.id })
      });
      const linkBody = await linkResp.json();
      if (!linkResp.ok) return res.status(linkResp.status).json(linkBody);
    }

    res.status(201).json({ team: teamBody.team });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/team/:id', async (req, res) => {
  try {
    const teamId = asInt(req.params.id);
    const { data: team, error } = await supabase.from('teams').select('id,tournament_id').eq('id', teamId).single();
    if (error) throw error;

    const del = await supabase.from('teams').delete().eq('id', teamId).eq('tournament_id', team.tournament_id);
    if (del.error) throw del.error;

    await supabase.from('team_members').delete().eq('team_id', teamId);
    await supabase.from('scores').delete().eq('team_id', teamId);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/scoreboard', async (req, res) => {
  try {
    const tournamentId = await resolveTournamentId(req.query.tournamentId);
    if (!tournamentId) return res.json({ tournament: null, scoreboard: [] });

    const tournament = await getTournament(tournamentId);
    const teams = await fetchTeamsWithPlayers(tournamentId);
    const teamIds = teams.map((team) => team.id);

    let scores = [];
    if (teamIds.length) {
      const { data, error } = await supabase
        .from('scores')
        .select('team_id, score')
        .in('team_id', teamIds);
      if (error) throw error;
      scores = data;
    }

    const totals = teams.map((team) => {
      const teamScores = scores.filter((row) => row.team_id === team.id);
      const total = teamScores.reduce((sum, row) => sum + Number(row.score || 0), 0);
      const player1 = team.players[0]?.name || '';
      const player2 = team.players[1]?.name || '';
      const holeScores = {};
      for (const s of teamScores) holeScores[s.hole_number] = { score: s.score };
      return {
        team_id: team.id,
        team_name: team.name,
        players: team.players,
        player1,
        player2,
        total_score: total,
        holes_completed: teamScores.length,
        to_par: 0,
        hole_scores: holeScores
      };
    }).sort((a, b) => a.total_score - b.total_score);

    res.json({ tournament, holes: [], awards: [], scoreboard: totals });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.write('event: ping\\ndata: {}\\n\\n');
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Lorgen Invitational listening on ${PORT}`);
});

module.exports = app;
