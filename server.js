require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const db      = require('./database');

const app  = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'LorgenAdmin2025';

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
app.use('/uploads', express.static('uploads', { fallthrough: true }));
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
function getActiveTournament() {
  return db.prepare(
    `SELECT * FROM tournaments WHERE status IN ('active','upcoming') ORDER BY date ASC LIMIT 1`
  ).get();
}

function buildScoreboard(tournament) {
  const teams     = db.prepare('SELECT * FROM teams WHERE tournament_id=?').all(tournament.id);
  const holes     = db.prepare('SELECT * FROM holes WHERE tournament_id=? ORDER BY hole_number').all(tournament.id);
  const rawAwards = db.prepare(
    `SELECT a.*, t.team_name, t.player1, t.player2
     FROM awards a LEFT JOIN teams t ON t.id=a.team_id
     WHERE a.tournament_id=?`
  ).all(tournament.id);

  const allScoreRows = teams.length
    ? db.prepare(`SELECT * FROM scores WHERE team_id IN (${teams.map(() => '?').join(',')})`).all(...teams.map(t => t.id))
    : [];

  const awards = rawAwards.map(a => ({
    id: a.id, tournament_id: a.tournament_id, award_type: a.award_type,
    team_id: a.team_id, player_name: a.player_name || null,
    hole_number: a.hole_number, detail: a.detail,
    team_name: a.team_name || null, player1: a.player1 || null, player2: a.player2 || null
  }));

  const scoreboard = teams.map(team => {
    const teamScores = allScoreRows.filter(s => s.team_id === team.id);
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

  return { tournament, scoreboard, holes, awards };
}

// ════════════════════════════════════════════════════════════════════════════
//  PUBLIC API
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/tournament', (req, res) => {
  try {
    const t = getActiveTournament();
    if (!t) return res.json({ tournament: null, holes: [] });
    const holes = db.prepare('SELECT * FROM holes WHERE tournament_id=? ORDER BY hole_number').all(t.id);
    res.json({ tournament: t, holes });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/scoreboard', (req, res) => {
  try {
    let t = db.prepare(`SELECT * FROM tournaments WHERE status='active' ORDER BY date DESC LIMIT 1`).get();
    if (!t) t = db.prepare(`SELECT * FROM tournaments WHERE status='completed' ORDER BY date DESC LIMIT 1`).get();
    if (!t) return res.json({ scoreboard: [], holes: [], awards: [], tournament: null });
    res.json(buildScoreboard(t));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/legacy', (req, res) => {
  try {
    const legacy = db.prepare('SELECT * FROM legacy ORDER BY year DESC').all();
    res.json({ legacy });
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

// GitHub OAuth not supported without Supabase
app.get('/api/auth/github-url', (req, res) => {
  res.status(501).json({ error: 'GitHub-innlogging er ikke konfigurert på denne serveren' });
});

app.post('/api/auth/team-login', (req, res) => {
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ error: 'PIN er påkrevd' });
  try {
    const t = getActiveTournament();
    if (!t) return res.status(404).json({ error: 'Ingen aktiv turnering' });
    const team = db.prepare('SELECT * FROM teams WHERE tournament_id=? AND pin_code=? LIMIT 1').get(t.id, pin);
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

app.get('/api/auth/status', (req, res) => {
  if (req.session.isAdmin) {
    return res.json({ type: 'admin' });
  }
  if (req.session.teamId) {
    const team = db.prepare('SELECT id,team_name,player1,player2 FROM teams WHERE id=?').get(req.session.teamId);
    return res.json({ type: 'team', team });
  }
  res.json({ type: 'none' });
});

// ════════════════════════════════════════════════════════════════════════════
//  TEAM (authenticated)
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/team/scorecard', requireTeam, (req, res) => {
  try {
    const team   = db.prepare('SELECT * FROM teams WHERE id=?').get(req.session.teamId);
    const holes  = db.prepare('SELECT * FROM holes WHERE tournament_id=? ORDER BY hole_number').all(req.session.tournamentId);
    const scores = db.prepare('SELECT * FROM scores WHERE team_id=?').all(req.session.teamId);
    const claims = db.prepare('SELECT * FROM award_claims WHERE tournament_id=? AND team_id=?').all(req.session.tournamentId, req.session.teamId);
    res.json({ team, holes, scores, claims });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/team/submit-score', requireTeam, (req, res) => {
  const { hole_number, score } = req.body;
  if (!hole_number || score === undefined || score === null)
    return res.status(400).json({ error: 'Hull og poeng er påkrevd' });
  const scoreNum = parseInt(score);
  if (isNaN(scoreNum) || scoreNum < 1 || scoreNum > 20)
    return res.status(400).json({ error: 'Poengsum må være mellom 1 og 20' });
  try {
    const hole = db.prepare('SELECT * FROM holes WHERE tournament_id=? AND hole_number=?')
      .get(req.session.tournamentId, hole_number);
    if (!hole) return res.status(404).json({ error: 'Hull ikke funnet' });
    if (hole.requires_photo) {
      const existing = db.prepare('SELECT photo_path FROM scores WHERE team_id=? AND hole_number=?')
        .get(req.session.teamId, hole_number);
      if (!existing?.photo_path)
        return res.status(400).json({ error: 'Bilde må lastes opp før du kan registrere poeng på dette hullet' });
    }
    const existing = db.prepare('SELECT id FROM scores WHERE team_id=? AND hole_number=?')
      .get(req.session.teamId, hole_number);
    if (existing) {
      db.prepare('UPDATE scores SET score=?, submitted_at=CURRENT_TIMESTAMP WHERE id=?').run(scoreNum, existing.id);
    } else {
      db.prepare('INSERT INTO scores (team_id, hole_number, score) VALUES (?,?,?)').run(req.session.teamId, hole_number, scoreNum);
    }
    broadcast('score_updated', { tournament_id: req.session.tournamentId });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/team/upload-photo/:hole', requireTeam, (req, res) => {
  const holeNum = parseInt(req.params.hole);
  const tid = req.session.tournamentId;
  try {
    const hole = db.prepare('SELECT * FROM holes WHERE tournament_id=? AND hole_number=?').get(tid, holeNum);
    if (!hole) return res.status(404).json({ error: 'Hull ikke funnet' });
    const uploadDir = hole.requires_photo ? `./uploads/t${tid}/h${holeNum}` : './uploads';
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    const dynamicUpload = multer({
      storage: multer.diskStorage({
        destination: uploadDir,
        filename: (req, file, cb) => cb(null, `hole-${Date.now()}-${Math.round(Math.random()*1e6)}${path.extname(file.originalname)}`)
      }),
      limits: { fileSize: 15 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) return cb(null, true);
        cb(new Error('Kun bilder er tillatt'));
      }
    }).single('photo');
    dynamicUpload(req, res, err => {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: 'Ingen fil lastet opp' });
      const photoPath = hole.requires_photo
        ? `/uploads/t${tid}/h${holeNum}/${req.file.filename}`
        : `/uploads/${req.file.filename}`;
      const existing = db.prepare('SELECT id FROM scores WHERE team_id=? AND hole_number=?').get(req.session.teamId, holeNum);
      if (existing) {
        db.prepare('UPDATE scores SET photo_path=? WHERE id=?').run(photoPath, existing.id);
      } else {
        db.prepare('INSERT INTO scores (team_id, hole_number, score, photo_path) VALUES (?,?,0,?)').run(req.session.teamId, holeNum, photoPath);
      }
      res.json({ success: true, photo_path: photoPath });
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
//  ADMIN
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/admin/tournaments', requireAdmin, (req, res) => {
  try {
    const tournaments = db.prepare('SELECT * FROM tournaments ORDER BY year DESC').all();
    res.json({ tournaments });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/tournament', requireAdmin, (req, res) => {
  const { year, name, date, course, description, gameday_info } = req.body;
  if (!year || !name || !date) return res.status(400).json({ error: 'År, navn og dato er påkrevd' });
  try {
    const result = db.prepare(
      'INSERT INTO tournaments (year, name, date, course, description, gameday_info) VALUES (?,?,?,?,?,?)'
    ).run(year, name, date, course||'', description||'', gameday_info||'');
    const tid = result.lastInsertRowid;
    const insertHole = db.prepare('INSERT INTO holes (tournament_id, hole_number, par, requires_photo) VALUES (?,?,4,0)');
    const insertAllHoles = db.transaction(() => {
      for (let i = 1; i <= 18; i++) insertHole.run(tid, i);
    });
    insertAllHoles();
    res.json({ success: true, id: tid });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/tournament/:id', requireAdmin, (req, res) => {
  const { year, name, date, course, description, gameday_info, status } = req.body;
  try {
    db.prepare(
      'UPDATE tournaments SET year=?, name=?, date=?, course=?, description=?, gameday_info=?, status=? WHERE id=?'
    ).run(year, name, date, course||'', description||'', gameday_info||'', status, req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/tournament/:id/gameday', requireAdmin, (req, res) => {
  const { gameday_info } = req.body;
  try {
    db.prepare('UPDATE tournaments SET gameday_info=? WHERE id=?').run(gameday_info||'', req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/tournament/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  try {
    const teams = db.prepare('SELECT id FROM teams WHERE tournament_id=?').all(id);
    if (teams.length) {
      const deleteScores = db.transaction(() => {
        for (const t of teams) db.prepare('DELETE FROM scores WHERE team_id=?').run(t.id);
      });
      deleteScores();
    }
    db.prepare('DELETE FROM teams WHERE tournament_id=?').run(id);
    db.prepare('DELETE FROM holes WHERE tournament_id=?').run(id);
    db.prepare('DELETE FROM awards WHERE tournament_id=?').run(id);
    db.prepare('DELETE FROM gallery_photos WHERE tournament_id=?').run(id);
    db.prepare('DELETE FROM tournaments WHERE id=?').run(id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/tournament/:id/teams', requireAdmin, (req, res) => {
  try {
    const teams = db.prepare('SELECT * FROM teams WHERE tournament_id=?').all(req.params.id);
    res.json({ teams });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/team', requireAdmin, (req, res) => {
  const { tournament_id, team_name, player1, player2, pin_code } = req.body;
  if (!tournament_id || !team_name || !player1 || !player2 || !pin_code)
    return res.status(400).json({ error: 'Alle felt er påkrevd' });
  try {
    const existing = db.prepare('SELECT id FROM teams WHERE tournament_id=? AND pin_code=?').get(tournament_id, pin_code);
    if (existing) return res.status(400).json({ error: 'PIN allerede i bruk i denne turneringen' });
    const result = db.prepare(
      'INSERT INTO teams (tournament_id, team_name, player1, player2, pin_code) VALUES (?,?,?,?,?)'
    ).run(tournament_id, team_name, player1, player2, pin_code);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/team/:id', requireAdmin, (req, res) => {
  const { team_name, player1, player2, pin_code } = req.body;
  try {
    db.prepare('UPDATE teams SET team_name=?, player1=?, player2=?, pin_code=? WHERE id=?')
      .run(team_name, player1, player2, pin_code, req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/team/:id', requireAdmin, (req, res) => {
  try {
    db.prepare('DELETE FROM scores WHERE team_id=?').run(req.params.id);
    db.prepare('DELETE FROM teams WHERE id=?').run(req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/tournament/:id/holes', requireAdmin, (req, res) => {
  try {
    const holes = db.prepare('SELECT * FROM holes WHERE tournament_id=? ORDER BY hole_number').all(req.params.id);
    res.json({ holes });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/tournament/:id/holes', requireAdmin, (req, res) => {
  const { holes } = req.body;
  const tid = req.params.id;
  try {
    const update = db.prepare(
      'UPDATE holes SET par=?, requires_photo=?, is_longest_drive=?, is_closest_to_pin=? WHERE tournament_id=? AND hole_number=?'
    );
    const updateAll = db.transaction(() => {
      for (const h of holes) {
        update.run(h.par, h.requires_photo ? 1 : 0, h.is_longest_drive ? 1 : 0, h.is_closest_to_pin ? 1 : 0, tid, h.hole_number);
        if (h.requires_photo) {
          const dir = `./uploads/t${tid}/h${h.hole_number}`;
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        }
      }
    });
    updateAll();
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/tournament/:id/scores', requireAdmin, (req, res) => {
  try {
    const teams = db.prepare('SELECT id,team_name,player1,player2 FROM teams WHERE tournament_id=?').all(req.params.id);
    if (!teams.length) return res.json({ scores: [] });
    const teamIds = teams.map(t => t.id);
    const scores = db.prepare(`SELECT * FROM scores WHERE team_id IN (${teamIds.map(() => '?').join(',')})`)
      .all(...teamIds);
    const holes = db.prepare('SELECT hole_number,par FROM holes WHERE tournament_id=?').all(req.params.id);
    const holesMap = {};
    holes.forEach(h => holesMap[h.hole_number] = h.par);
    const teamsMap = {};
    teams.forEach(t => teamsMap[t.id] = t);
    const flat = scores.map(s => ({
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

app.put('/api/admin/score/:id', requireAdmin, (req, res) => {
  try {
    db.prepare('UPDATE scores SET score=? WHERE id=?').run(req.body.score, req.params.id);
    broadcast('score_updated', {});
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/score/:id', requireAdmin, (req, res) => {
  try {
    db.prepare('DELETE FROM scores WHERE id=?').run(req.params.id);
    broadcast('score_updated', {});
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Player-uploaded photos (from scores)
app.get('/api/admin/tournament/:id/photos', requireAdmin, (req, res) => {
  try {
    const teams = db.prepare('SELECT id,team_name,player1,player2 FROM teams WHERE tournament_id=?').all(req.params.id);
    if (!teams.length) return res.json({ photos: [] });
    const teamIds = teams.map(t => t.id);
    const scores = db.prepare(
      `SELECT * FROM scores WHERE team_id IN (${teamIds.map(() => '?').join(',')})
       AND photo_path IS NOT NULL AND photo_path != ''
       ORDER BY submitted_at DESC`
    ).all(...teamIds);
    const holes = db.prepare('SELECT hole_number,par,requires_photo FROM holes WHERE tournament_id=?').all(req.params.id);
    const holesMap = {};
    holes.forEach(h => holesMap[h.hole_number] = h);
    const teamsMap = {};
    teams.forEach(t => teamsMap[t.id] = t);
    const photos = scores.map(s => ({
      id: s.id, hole_number: s.hole_number, photo_path: s.photo_path, submitted_at: s.submitted_at,
      team_name:      teamsMap[s.team_id]?.team_name,
      player1:        teamsMap[s.team_id]?.player1,
      player2:        teamsMap[s.team_id]?.player2,
      par:            holesMap[s.hole_number]?.par,
      requires_photo: holesMap[s.hole_number]?.requires_photo
    }));
    res.json({ photos });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Team award claim ─────────────────────────────────────────────────────────

app.post('/api/team/claim-award', requireTeam, (req, res) => {
  const { hole_number, award_type, player_name, detail } = req.body;
  if (!hole_number || !award_type || !player_name)
    return res.status(400).json({ error: 'Hull, type og spillernavn er påkrevd' });
  if (!['longest_drive','closest_to_pin'].includes(award_type))
    return res.status(400).json({ error: 'Ugyldig utmerkelsestype' });
  try {
    const hole = db.prepare('SELECT * FROM holes WHERE tournament_id=? AND hole_number=?')
      .get(req.session.tournamentId, hole_number);
    if (!hole) return res.status(404).json({ error: 'Hull ikke funnet' });
    if (award_type === 'longest_drive' && !hole.is_longest_drive)
      return res.status(400).json({ error: 'Dette hullet har ingen Lengste Drive-konkurranse' });
    if (award_type === 'closest_to_pin' && !hole.is_closest_to_pin)
      return res.status(400).json({ error: 'Dette hullet har ingen Nærmest Flagget-konkurranse' });
    db.prepare(
      `INSERT INTO award_claims (tournament_id, team_id, hole_number, award_type, player_name, detail)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(tournament_id, team_id, hole_number, award_type)
       DO UPDATE SET player_name=excluded.player_name, detail=excluded.detail, claimed_at=CURRENT_TIMESTAMP`
    ).run(req.session.tournamentId, req.session.teamId, hole_number, award_type, player_name, detail||'');
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Public photo gallery ──────────────────────────────────────────────────────

app.get('/api/gallery', (req, res) => {
  try {
    let t = db.prepare(`SELECT * FROM tournaments WHERE status='active' ORDER BY date DESC LIMIT 1`).get();
    if (!t) t = db.prepare(`SELECT * FROM tournaments WHERE status='completed' ORDER BY date DESC LIMIT 1`).get();
    if (!t) return res.json({ photos: [], tournament: null });
    const teams = db.prepare('SELECT id,team_name FROM teams WHERE tournament_id=?').all(t.id);
    if (!teams.length) return res.json({ photos: [], tournament: t });
    const teamIds = teams.map(tm => tm.id);
    const teamsMap = {};
    teams.forEach(tm => teamsMap[tm.id] = tm);
    const photoHoles = db.prepare('SELECT hole_number FROM holes WHERE tournament_id=? AND requires_photo=1 ORDER BY hole_number').all(t.id);
    if (!photoHoles.length) return res.json({ photos: [], tournament: t });
    const holeNums = photoHoles.map(h => h.hole_number);
    const scores = db.prepare(
      `SELECT s.*, s.team_id FROM scores
       WHERE team_id IN (${teamIds.map(()=>'?').join(',')})
       AND hole_number IN (${holeNums.map(()=>'?').join(',')})
       AND photo_path IS NOT NULL AND photo_path != ''
       ORDER BY submitted_at DESC`
    ).all(...teamIds, ...holeNums);
    const photos = scores.map(s => ({
      hole_number: s.hole_number,
      photo_path: s.photo_path,
      team_name: teamsMap[s.team_id]?.team_name || '',
      submitted_at: s.submitted_at
    }));
    res.json({ photos, tournament: t });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Admin gallery (admin-uploaded photos) ────────────────────────────────────

app.get('/api/admin/tournament/:id/gallery', requireAdmin, (req, res) => {
  try {
    const photos = db.prepare(
      'SELECT * FROM gallery_photos WHERE tournament_id=? ORDER BY uploaded_at DESC'
    ).all(req.params.id);
    res.json({ photos });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/tournament/:id/gallery', requireAdmin, upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Ingen fil lastet opp' });
  try {
    const photoPath = `/uploads/${req.file.filename}`;
    const caption = req.body.caption || '';
    const result = db.prepare(
      'INSERT INTO gallery_photos (tournament_id, photo_path, caption) VALUES (?,?,?)'
    ).run(req.params.id, photoPath, caption);
    res.json({ success: true, id: result.lastInsertRowid, photo_path: photoPath });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/gallery/:id', requireAdmin, (req, res) => {
  try {
    const photo = db.prepare('SELECT photo_path FROM gallery_photos WHERE id=?').get(req.params.id);
    if (photo) {
      const filePath = path.join(__dirname, photo.photo_path.replace(/^\//, ''));
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    db.prepare('DELETE FROM gallery_photos WHERE id=?').run(req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Awards ───────────────────────────────────────────────────────────────────

app.get('/api/admin/tournament/:id/awards', requireAdmin, (req, res) => {
  try {
    const awards = db.prepare(
      `SELECT a.*, t.team_name FROM awards a LEFT JOIN teams t ON t.id=a.team_id WHERE a.tournament_id=?`
    ).all(req.params.id);
    res.json({ awards });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/tournament/:id/award-claims', requireAdmin, (req, res) => {
  try {
    const claims = db.prepare(
      `SELECT ac.*, t.team_name, t.player1, t.player2
       FROM award_claims ac LEFT JOIN teams t ON t.id=ac.team_id
       WHERE ac.tournament_id=? ORDER BY ac.claimed_at DESC`
    ).all(req.params.id);
    res.json({ claims });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/award', requireAdmin, (req, res) => {
  const { tournament_id, award_type, team_id, player_name, hole_number, detail } = req.body;
  try {
    db.prepare(
      `INSERT INTO awards (tournament_id, award_type, team_id, player_name, hole_number, detail) VALUES (?,?,?,?,?,?)
       ON CONFLICT(tournament_id, award_type, hole_number) DO UPDATE SET team_id=excluded.team_id, player_name=excluded.player_name, detail=excluded.detail`
    ).run(tournament_id, award_type, team_id||null, player_name||'', hole_number||0, detail||'');
    broadcast('award_updated', {});
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/award/:id', requireAdmin, (req, res) => {
  try {
    db.prepare('DELETE FROM awards WHERE id=?').run(req.params.id);
    broadcast('award_updated', {});
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Legacy ───────────────────────────────────────────────────────────────────

app.get('/api/admin/legacy', requireAdmin, (req, res) => {
  try {
    const legacy = db.prepare('SELECT * FROM legacy ORDER BY year DESC').all();
    res.json({ legacy });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/legacy', requireAdmin, (req, res) => {
  const { year, winner_team, player1, player2, score, score_to_par, course, notes } = req.body;
  if (!year || !winner_team || !player1 || !player2)
    return res.status(400).json({ error: 'År, lag og spillere er påkrevd' });
  try {
    const result = db.prepare(
      'INSERT INTO legacy (year, winner_team, player1, player2, score, score_to_par, course, notes) VALUES (?,?,?,?,?,?,?,?)'
    ).run(year, winner_team, player1, player2, score||'', score_to_par||'', course||'', notes||'');
    res.json({ success: true, id: result.lastInsertRowid });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/legacy/:id', requireAdmin, (req, res) => {
  const { year, winner_team, player1, player2, score, score_to_par, course, notes } = req.body;
  try {
    db.prepare(
      'UPDATE legacy SET year=?, winner_team=?, player1=?, player2=?, score=?, score_to_par=?, course=?, notes=? WHERE id=?'
    ).run(year, winner_team, player1, player2, score||'', score_to_par||'', course||'', notes||'', req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/legacy/:id/photo', requireAdmin, (req, res) => {
  const legacyId = req.params.id;
  const entry = db.prepare('SELECT id FROM legacy WHERE id=?').get(legacyId);
  if (!entry) return res.status(404).json({ error: 'Oppføring ikke funnet' });
  const dir = './uploads/legacy';
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const legacyUpload = multer({
    storage: multer.diskStorage({
      destination: dir,
      filename: (req, file, cb) => cb(null, `legacy-${legacyId}-${Date.now()}${path.extname(file.originalname)}`)
    }),
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (file.mimetype.startsWith('image/')) return cb(null, true);
      cb(new Error('Kun bilder er tillatt'));
    }
  }).single('photo');
  legacyUpload(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Ingen fil lastet opp' });
    const photoPath = `/uploads/legacy/${req.file.filename}`;
    db.prepare('UPDATE legacy SET winner_photo=? WHERE id=?').run(photoPath, legacyId);
    res.json({ success: true, winner_photo: photoPath });
  });
});

app.delete('/api/admin/legacy/:id', requireAdmin, (req, res) => {
  try {
    db.prepare('DELETE FROM legacy WHERE id=?').run(req.params.id);
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
