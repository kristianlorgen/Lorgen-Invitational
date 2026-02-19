require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { supabase } = require('./supabase');

const app  = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'LorgenAdmin2025';
// Comma-separated list of GitHub usernames allowed to log in as admin.
// If empty, any authenticated GitHub user gets admin access.
const ADMIN_GITHUB_USERNAMES = (process.env.ADMIN_GITHUB_USERNAMES || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const SITE_URL = process.env.SITE_URL || `http://localhost:${PORT}`;

// Ensure uploads directory exists
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads', { recursive: true });

// ── SSE live-update clients ──────────────────────────────────────────────────
const sseClients = new Map();
let sseCounter = 0;

function broadcast(type, data = {}) {
  const msg = `data: ${JSON.stringify({ type, data, ts: Date.now() })}\n\n`;
  sseClients.forEach(res => { try { res.write(msg); } catch (_) {} });
}

// ── File upload (local disk) ─────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: './uploads/',
  filename: (req, file, cb) =>
    cb(null, `hole-${Date.now()}-${Math.round(Math.random() * 1e6)}${path.extname(file.originalname)}`)
});
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) return cb(null, true);
    cb(new Error('Kun bilder er tillatt'));
  }
});

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static('uploads'));
app.use(express.static('public'));
app.use(session({
  secret: process.env.SESSION_SECRET || 'lorgen-inv-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// ── Auth guards ──────────────────────────────────────────────────────────────
const requireTeam = (req, res, next) =>
  req.session.teamId ? next() : res.status(401).json({ error: 'Laginnlogging påkrevd' });

const requireAdmin = (req, res, next) =>
  req.session.isAdmin ? next() : res.status(401).json({ error: 'Admininnlogging påkrevd' });

// ── Helpers ──────────────────────────────────────────────────────────────────
async function getActiveTournament() {
  const { data } = await supabase
    .from('tournaments')
    .select('*')
    .in('status', ['active', 'upcoming'])
    .order('date', { ascending: true })
    .limit(1);
  return data?.[0] || null;
}

async function buildScoreboard(tournament) {
  const [
    { data: teams = [] },
    { data: holes  = [] },
    { data: rawAwards = [] }
  ] = await Promise.all([
    supabase.from('teams').select('*').eq('tournament_id', tournament.id),
    supabase.from('holes').select('*').eq('tournament_id', tournament.id).order('hole_number'),
    supabase.from('awards').select('*, teams(team_name,player1,player2)').eq('tournament_id', tournament.id)
  ]);

  let allScores = [];
  if (teams.length) {
    const { data } = await supabase
      .from('scores').select('*').in('team_id', teams.map(t => t.id));
    allScores = data || [];
  }

  const awards = (rawAwards || []).map(a => ({
    ...a,
    team_name: a.teams?.team_name || null,
    player1:   a.teams?.player1   || null,
    player2:   a.teams?.player2   || null,
    teams: undefined
  }));

  const scoreboard = (teams || []).map(team => {
    const teamScores = allScores.filter(s => s.team_id === team.id);
    let total = 0, par = 0, done = 0;
    const holeScores = {};
    teamScores.forEach(s => {
      const h = holes.find(h => h.hole_number === s.hole_number);
      if (h) { total += s.score; par += h.par; done++; }
      holeScores[s.hole_number] = { score: s.score, photo: s.photo_path };
    });
    return {
      team_id: team.id, team_name: team.team_name,
      player1: team.player1, player2: team.player2,
      total_score: total, total_par: par, to_par: total - par,
      holes_completed: done, hole_scores: holeScores
    };
  });

  scoreboard.sort((a, b) => {
    if (a.holes_completed === 0 && b.holes_completed === 0) return 0;
    if (a.holes_completed === 0) return 1;
    if (b.holes_completed === 0) return -1;
    return a.to_par - b.to_par;
  });

  return { tournament, scoreboard, holes: holes || [], awards };
}

// ════════════════════════════════════════════════════════════════════════════
//  PUBLIC API
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/tournament', async (req, res) => {
  try {
    const t = await getActiveTournament();
    if (!t) return res.json({ tournament: null, holes: [] });
    const { data: holes } = await supabase.from('holes').select('*')
      .eq('tournament_id', t.id).order('hole_number');
    res.json({ tournament: t, holes: holes || [] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/scoreboard', async (req, res) => {
  try {
    let { data: rows } = await supabase.from('tournaments').select('*')
      .eq('status', 'active').order('date', { ascending: false }).limit(1);
    if (!rows?.length) {
      const { data } = await supabase.from('tournaments').select('*')
        .eq('status', 'completed').order('date', { ascending: false }).limit(1);
      rows = data;
    }
    if (!rows?.length) return res.json({ scoreboard: [], holes: [], awards: [], tournament: null });
    res.json(await buildScoreboard(rows[0]));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/legacy', async (req, res) => {
  try {
    const { data } = await supabase.from('legacy').select('*').order('year', { ascending: false });
    res.json({ legacy: data || [] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const id = ++sseCounter;
  sseClients.set(id, res);
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
  const hb = setInterval(() => { try { res.write(':hb\n\n'); } catch (_) { clearInterval(hb); } }, 25000);
  req.on('close', () => { sseClients.delete(id); clearInterval(hb); });
});

// ════════════════════════════════════════════════════════════════════════════
//  AUTH
// ════════════════════════════════════════════════════════════════════════════

// Step 1: Generate Supabase GitHub OAuth URL
app.get('/api/auth/github-url', async (req, res) => {
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: {
        redirectTo: `${SITE_URL}/admin`,
        skipBrowserRedirect: true
      }
    });
    if (error) throw error;
    res.json({ url: data.url });
  } catch(e) {
    res.status(500).json({ error: 'Kunne ikke generere GitHub-innloggingslenke: ' + e.message });
  }
});

// Step 2: Frontend sends back the access_token from the URL hash after OAuth
app.post('/api/auth/github-token', async (req, res) => {
  const { access_token } = req.body;
  if (!access_token) return res.status(400).json({ error: 'Mangler access token' });
  try {
    const { data: { user }, error } = await supabase.auth.getUser(access_token);
    if (error || !user) return res.status(401).json({ error: 'Ugyldig eller utløpt token' });
    if (user.app_metadata?.provider !== 'github') {
      return res.status(403).json({ error: 'Kun GitHub-innlogging er støttet' });
    }
    const githubUsername = user.user_metadata?.user_name
      || user.user_metadata?.preferred_username
      || '';
    if (ADMIN_GITHUB_USERNAMES.length && !ADMIN_GITHUB_USERNAMES.includes(githubUsername)) {
      return res.status(403).json({
        error: `GitHub-brukeren «${githubUsername}» har ikke admintilgang`
      });
    }
    req.session.isAdmin = true;
    req.session.adminGithubUser = githubUsername;
    res.json({ success: true, username: githubUsername });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/team-login', async (req, res) => {
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ error: 'PIN er påkrevd' });
  try {
    const t = await getActiveTournament();
    if (!t) return res.status(404).json({ error: 'Ingen aktiv turnering' });
    const { data: teams } = await supabase.from('teams').select('*')
      .eq('tournament_id', t.id).eq('pin_code', pin).limit(1);
    const team = teams?.[0];
    if (!team) return res.status(401).json({ error: 'Ugyldig PIN' });
    req.session.teamId = team.id;
    req.session.tournamentId = t.id;
    res.json({
      success: true,
      team: { id: team.id, team_name: team.team_name, player1: team.player1, player2: team.player2 }
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/admin-login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.json({ success: true });
  }
  res.status(401).json({ error: 'Ugyldig passord' });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/auth/status', async (req, res) => {
  if (req.session.isAdmin) {
    return res.json({ type: 'admin', github_user: req.session.adminGithubUser || null });
  }
  if (req.session.teamId) {
    const { data: team } = await supabase.from('teams')
      .select('id,team_name,player1,player2').eq('id', req.session.teamId).single();
    return res.json({ type: 'team', team });
  }
  res.json({ type: 'none' });
});

// ════════════════════════════════════════════════════════════════════════════
//  TEAM (authenticated)
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/team/scorecard', requireTeam, async (req, res) => {
  try {
    const [{ data: team }, { data: holes }, { data: scores }] = await Promise.all([
      supabase.from('teams').select('*').eq('id', req.session.teamId).single(),
      supabase.from('holes').select('*').eq('tournament_id', req.session.tournamentId).order('hole_number'),
      supabase.from('scores').select('*').eq('team_id', req.session.teamId)
    ]);
    res.json({ team, holes: holes || [], scores: scores || [] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/team/submit-score', requireTeam, async (req, res) => {
  const { hole_number, score } = req.body;
  if (!hole_number || score === undefined || score === null) {
    return res.status(400).json({ error: 'Hull og poeng er påkrevd' });
  }
  const scoreNum = parseInt(score);
  if (isNaN(scoreNum) || scoreNum < 1 || scoreNum > 20) {
    return res.status(400).json({ error: 'Poengsum må være mellom 1 og 20' });
  }
  try {
    const { data: holes } = await supabase.from('holes').select('*')
      .eq('tournament_id', req.session.tournamentId).eq('hole_number', hole_number).limit(1);
    const hole = holes?.[0];
    if (!hole) return res.status(404).json({ error: 'Hull ikke funnet' });
    if (hole.requires_photo) {
      const { data: existing } = await supabase.from('scores').select('photo_path')
        .eq('team_id', req.session.teamId).eq('hole_number', hole_number).single();
      if (!existing?.photo_path) {
        return res.status(400).json({
          error: 'Bilde må lastes opp før du kan registrere poeng på dette hullet'
        });
      }
    }
    await supabase.from('scores').upsert(
      { team_id: req.session.teamId, hole_number, score: scoreNum },
      { onConflict: 'team_id,hole_number' }
    );
    broadcast('score_updated', { tournament_id: req.session.tournamentId });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/team/upload-photo/:hole', requireTeam, upload.single('photo'), async (req, res) => {
  const holeNum = parseInt(req.params.hole);
  if (!req.file) return res.status(400).json({ error: 'Ingen fil lastet opp' });
  try {
    const { data: holes } = await supabase.from('holes').select('*')
      .eq('tournament_id', req.session.tournamentId).eq('hole_number', holeNum).limit(1);
    if (!holes?.length) return res.status(404).json({ error: 'Hull ikke funnet' });
    const photoPath = `/uploads/${req.file.filename}`;
    await supabase.from('scores').upsert(
      { team_id: req.session.teamId, hole_number: holeNum, score: 0, photo_path: photoPath },
      { onConflict: 'team_id,hole_number' }
    );
    res.json({ success: true, photo_path: photoPath });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
//  ADMIN
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/admin/tournaments', requireAdmin, async (req, res) => {
  try {
    const { data } = await supabase.from('tournaments').select('*').order('year', { ascending: false });
    res.json({ tournaments: data || [] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/tournament', requireAdmin, async (req, res) => {
  const { year, name, date, course, description, gameday_info } = req.body;
  if (!year || !name || !date) return res.status(400).json({ error: 'År, navn og dato er påkrevd' });
  try {
    const { data, error } = await supabase.from('tournaments')
      .insert({ year, name, date, course: course||'', description: description||'', gameday_info: gameday_info||'' })
      .select();
    if (error) throw error;
    const tid = data[0].id;
    const holeInserts = Array.from({ length: 18 }, (_, i) => ({
      tournament_id: tid, hole_number: i + 1, par: 4, requires_photo: false
    }));
    await supabase.from('holes').insert(holeInserts);
    res.json({ success: true, id: tid });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/tournament/:id', requireAdmin, async (req, res) => {
  const { year, name, date, course, description, gameday_info, status } = req.body;
  try {
    await supabase.from('tournaments').update({
      year, name, date,
      course: course||'', description: description||'',
      gameday_info: gameday_info||'', status
    }).eq('id', req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/tournament/:id/gameday', requireAdmin, async (req, res) => {
  const { gameday_info } = req.body;
  try {
    await supabase.from('tournaments').update({ gameday_info: gameday_info||'' }).eq('id', req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/tournament/:id', requireAdmin, async (req, res) => {
  const id = req.params.id;
  try {
    const { data: teams } = await supabase.from('teams').select('id').eq('tournament_id', id);
    if (teams?.length) {
      await supabase.from('scores').delete().in('team_id', teams.map(t => t.id));
    }
    await Promise.all([
      supabase.from('teams').delete().eq('tournament_id', id),
      supabase.from('holes').delete().eq('tournament_id', id),
      supabase.from('awards').delete().eq('tournament_id', id)
    ]);
    await supabase.from('tournaments').delete().eq('id', id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/tournament/:id/teams', requireAdmin, async (req, res) => {
  try {
    const { data } = await supabase.from('teams').select('*').eq('tournament_id', req.params.id);
    res.json({ teams: data || [] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/team', requireAdmin, async (req, res) => {
  const { tournament_id, team_name, player1, player2, pin_code } = req.body;
  if (!tournament_id || !team_name || !player1 || !player2 || !pin_code) {
    return res.status(400).json({ error: 'Alle felt er påkrevd' });
  }
  try {
    const { data: existing } = await supabase.from('teams').select('id')
      .eq('tournament_id', tournament_id).eq('pin_code', pin_code).limit(1);
    if (existing?.length) return res.status(400).json({ error: 'PIN allerede i bruk i denne turneringen' });
    const { data, error } = await supabase.from('teams')
      .insert({ tournament_id, team_name, player1, player2, pin_code }).select();
    if (error) throw error;
    res.json({ success: true, id: data[0].id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/team/:id', requireAdmin, async (req, res) => {
  const { team_name, player1, player2, pin_code } = req.body;
  try {
    await supabase.from('teams').update({ team_name, player1, player2, pin_code }).eq('id', req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/team/:id', requireAdmin, async (req, res) => {
  try {
    await supabase.from('scores').delete().eq('team_id', req.params.id);
    await supabase.from('teams').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/tournament/:id/holes', requireAdmin, async (req, res) => {
  try {
    const { data } = await supabase.from('holes').select('*')
      .eq('tournament_id', req.params.id).order('hole_number');
    res.json({ holes: data || [] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/tournament/:id/holes', requireAdmin, async (req, res) => {
  const { holes } = req.body;
  try {
    await Promise.all(holes.map(h =>
      supabase.from('holes').update({ par: h.par, requires_photo: !!h.requires_photo })
        .eq('tournament_id', req.params.id).eq('hole_number', h.hole_number)
    ));
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/tournament/:id/scores', requireAdmin, async (req, res) => {
  try {
    const { data: teams } = await supabase.from('teams').select('id,team_name,player1,player2')
      .eq('tournament_id', req.params.id);
    if (!teams?.length) return res.json({ scores: [] });
    const teamIds = teams.map(t => t.id);
    const [{ data: scores }, { data: holes }] = await Promise.all([
      supabase.from('scores').select('*').in('team_id', teamIds),
      supabase.from('holes').select('hole_number,par').eq('tournament_id', req.params.id)
    ]);
    const holesMap = {};
    (holes || []).forEach(h => holesMap[h.hole_number] = h.par);
    const teamsMap = {};
    teams.forEach(t => teamsMap[t.id] = t);
    const flat = (scores || []).map(s => ({
      ...s,
      team_name: teamsMap[s.team_id]?.team_name,
      player1:   teamsMap[s.team_id]?.player1,
      player2:   teamsMap[s.team_id]?.player2,
      par:       holesMap[s.hole_number] || 4
    })).sort((a, b) =>
      (a.team_name || '').localeCompare(b.team_name || '') || a.hole_number - b.hole_number
    );
    res.json({ scores: flat });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/score/:id', requireAdmin, async (req, res) => {
  try {
    await supabase.from('scores').update({ score: req.body.score }).eq('id', req.params.id);
    broadcast('score_updated', {});
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/score/:id', requireAdmin, async (req, res) => {
  try {
    await supabase.from('scores').delete().eq('id', req.params.id);
    broadcast('score_updated', {});
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/tournament/:id/photos', requireAdmin, async (req, res) => {
  try {
    const { data: teams } = await supabase.from('teams').select('id,team_name,player1,player2')
      .eq('tournament_id', req.params.id);
    if (!teams?.length) return res.json({ photos: [] });
    const teamIds = teams.map(t => t.id);
    const [{ data: scores }, { data: holes }] = await Promise.all([
      supabase.from('scores').select('*').in('team_id', teamIds)
        .not('photo_path', 'is', null).neq('photo_path', '')
        .order('submitted_at', { ascending: false }),
      supabase.from('holes').select('hole_number,par,requires_photo').eq('tournament_id', req.params.id)
    ]);
    const holesMap = {};
    (holes || []).forEach(h => holesMap[h.hole_number] = h);
    const teamsMap = {};
    teams.forEach(t => teamsMap[t.id] = t);
    const photos = (scores || []).map(s => ({
      id: s.id, hole_number: s.hole_number, photo_path: s.photo_path, submitted_at: s.submitted_at,
      team_name:     teamsMap[s.team_id]?.team_name,
      player1:       teamsMap[s.team_id]?.player1,
      player2:       teamsMap[s.team_id]?.player2,
      par:           holesMap[s.hole_number]?.par,
      requires_photo: holesMap[s.hole_number]?.requires_photo
    }));
    res.json({ photos });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/tournament/:id/awards', requireAdmin, async (req, res) => {
  try {
    const { data } = await supabase.from('awards').select('*, teams(team_name)')
      .eq('tournament_id', req.params.id);
    const flat = (data || []).map(a => ({ ...a, team_name: a.teams?.team_name || null, teams: undefined }));
    res.json({ awards: flat });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/award', requireAdmin, async (req, res) => {
  const { tournament_id, award_type, team_id, hole_number, detail } = req.body;
  try {
    await supabase.from('awards').upsert(
      { tournament_id, award_type, team_id: team_id||null, hole_number: hole_number||0, detail: detail||'' },
      { onConflict: 'tournament_id,award_type,hole_number' }
    );
    broadcast('award_updated', {});
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/award/:id', requireAdmin, async (req, res) => {
  try {
    await supabase.from('awards').delete().eq('id', req.params.id);
    broadcast('award_updated', {});
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/legacy', requireAdmin, async (req, res) => {
  try {
    const { data } = await supabase.from('legacy').select('*').order('year', { ascending: false });
    res.json({ legacy: data || [] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/legacy', requireAdmin, async (req, res) => {
  const { year, winner_team, player1, player2, score, score_to_par, course, notes } = req.body;
  if (!year || !winner_team || !player1 || !player2) {
    return res.status(400).json({ error: 'År, lag og spillere er påkrevd' });
  }
  try {
    const { data, error } = await supabase.from('legacy').insert({
      year, winner_team, player1, player2,
      score: score||'', score_to_par: score_to_par||'', course: course||'', notes: notes||''
    }).select();
    if (error) throw error;
    res.json({ success: true, id: data[0].id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/legacy/:id', requireAdmin, async (req, res) => {
  const { year, winner_team, player1, player2, score, score_to_par, course, notes } = req.body;
  try {
    await supabase.from('legacy').update({
      year, winner_team, player1, player2,
      score: score||'', score_to_par: score_to_par||'', course: course||'', notes: notes||''
    }).eq('id', req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/legacy/:id', requireAdmin, async (req, res) => {
  try {
    await supabase.from('legacy').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Clean URL routing ────────────────────────────────────────────────────────
['gameday', 'scoreboard', 'legacy', 'enter-score', 'admin'].forEach(p => {
  app.get(`/${p}`, (req, res) => res.sendFile(path.join(__dirname, `public/${p}.html`)));
});

app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║   LORGEN INVITATIONAL                ║
  ║   Server running on port ${PORT}         ║
  ╚══════════════════════════════════════╝
  `);
});
