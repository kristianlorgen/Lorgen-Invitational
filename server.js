require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'LorgenAdmin2025';

// Ensure directories exist
['uploads', 'data'].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ── SSE live update clients ─────────────────────────────────────────────────
const sseClients = new Map();
let sseCounter = 0;

function broadcast(type, data = {}) {
  const msg = `data: ${JSON.stringify({ type, data, ts: Date.now() })}\n\n`;
  sseClients.forEach((res) => {
    try { res.write(msg); } catch (_) { /* client gone */ }
  });
}

// ── File upload ──────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: './uploads/',
  filename: (req, file, cb) => {
    cb(null, `hole-${Date.now()}-${Math.round(Math.random() * 1e6)}${path.extname(file.originalname)}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) return cb(null, true);
    cb(new Error('Images only'));
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
  req.session.teamId ? next() : res.status(401).json({ error: 'Team login required' });

const requireAdmin = (req, res, next) =>
  req.session.isAdmin ? next() : res.status(401).json({ error: 'Admin login required' });

// ── Helpers ──────────────────────────────────────────────────────────────────
function getActiveTournament() {
  return db.prepare(
    `SELECT * FROM tournaments WHERE status IN ('active','upcoming') ORDER BY date ASC LIMIT 1`
  ).get();
}

function buildScoreboard(tournament) {
  const teams = db.prepare('SELECT * FROM teams WHERE tournament_id = ?').all(tournament.id);
  const holes = db.prepare('SELECT * FROM holes WHERE tournament_id = ? ORDER BY hole_number').all(tournament.id);
  const allScores = db.prepare(`
    SELECT s.*, t.team_name, t.player1, t.player2
    FROM scores s JOIN teams t ON s.team_id = t.id
    WHERE t.tournament_id = ?`).all(tournament.id);
  const awards = db.prepare(`
    SELECT a.*, t.team_name, t.player1, t.player2
    FROM awards a LEFT JOIN teams t ON a.team_id = t.id
    WHERE a.tournament_id = ?`).all(tournament.id);

  const scoreboard = teams.map(team => {
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

  return { tournament, scoreboard, holes, awards };
}

// ════════════════════════════════════════════════════════════════════════════
//  PUBLIC API
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/tournament', (req, res) => {
  const t = getActiveTournament();
  if (!t) return res.json({ tournament: null, holes: [] });
  const holes = db.prepare('SELECT * FROM holes WHERE tournament_id = ? ORDER BY hole_number').all(t.id);
  res.json({ tournament: t, holes });
});

app.get('/api/scoreboard', (req, res) => {
  let t = db.prepare(`SELECT * FROM tournaments WHERE status = 'active' ORDER BY date DESC LIMIT 1`).get();
  if (!t) t = db.prepare(`SELECT * FROM tournaments WHERE status = 'completed' ORDER BY date DESC LIMIT 1`).get();
  if (!t) return res.json({ scoreboard: [], holes: [], awards: [], tournament: null });
  res.json(buildScoreboard(t));
});

app.get('/api/legacy', (req, res) => {
  res.json({ legacy: db.prepare('SELECT * FROM legacy ORDER BY year DESC').all() });
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

app.post('/api/auth/team-login', (req, res) => {
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ error: 'PIN required' });
  const t = getActiveTournament();
  if (!t) return res.status(404).json({ error: 'No active tournament' });
  const team = db.prepare('SELECT * FROM teams WHERE tournament_id = ? AND pin_code = ?').get(t.id, pin);
  if (!team) return res.status(401).json({ error: 'Invalid PIN' });
  req.session.teamId = team.id;
  req.session.tournamentId = t.id;
  res.json({ success: true, team: { id: team.id, team_name: team.team_name, player1: team.player1, player2: team.player2 } });
});

app.post('/api/auth/admin-login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.json({ success: true });
  }
  res.status(401).json({ error: 'Invalid password' });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/auth/status', (req, res) => {
  if (req.session.isAdmin) return res.json({ type: 'admin' });
  if (req.session.teamId) {
    const team = db.prepare('SELECT id, team_name, player1, player2 FROM teams WHERE id = ?').get(req.session.teamId);
    return res.json({ type: 'team', team });
  }
  res.json({ type: 'none' });
});

// ════════════════════════════════════════════════════════════════════════════
//  TEAM (authenticated)
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/team/scorecard', requireTeam, (req, res) => {
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.session.teamId);
  const holes = db.prepare('SELECT * FROM holes WHERE tournament_id = ? ORDER BY hole_number').all(req.session.tournamentId);
  const scores = db.prepare('SELECT * FROM scores WHERE team_id = ?').all(req.session.teamId);
  res.json({ team, holes, scores });
});

app.post('/api/team/submit-score', requireTeam, (req, res) => {
  const { hole_number, score } = req.body;
  if (!hole_number || score === undefined || score === null) {
    return res.status(400).json({ error: 'Hole and score required' });
  }
  const scoreNum = parseInt(score);
  if (isNaN(scoreNum) || scoreNum < 1 || scoreNum > 20) {
    return res.status(400).json({ error: 'Score must be between 1 and 20' });
  }
  const hole = db.prepare('SELECT * FROM holes WHERE tournament_id = ? AND hole_number = ?').get(req.session.tournamentId, hole_number);
  if (!hole) return res.status(404).json({ error: 'Hole not found' });
  if (hole.requires_photo) {
    const existing = db.prepare('SELECT * FROM scores WHERE team_id = ? AND hole_number = ?').get(req.session.teamId, hole_number);
    if (!existing || !existing.photo_path) {
      return res.status(400).json({ error: 'Photo required before entering score for this hole' });
    }
  }
  db.prepare(`
    INSERT INTO scores (team_id, hole_number, score)
    VALUES (?, ?, ?)
    ON CONFLICT(team_id, hole_number) DO UPDATE SET score = excluded.score, submitted_at = CURRENT_TIMESTAMP
  `).run(req.session.teamId, hole_number, scoreNum);
  broadcast('score_updated', { tournament_id: req.session.tournamentId });
  res.json({ success: true });
});

app.post('/api/team/upload-photo/:hole', requireTeam, upload.single('photo'), (req, res) => {
  const holeNum = parseInt(req.params.hole);
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const hole = db.prepare('SELECT * FROM holes WHERE tournament_id = ? AND hole_number = ?').get(req.session.tournamentId, holeNum);
  if (!hole) return res.status(404).json({ error: 'Hole not found' });
  const photoPath = `/uploads/${req.file.filename}`;
  db.prepare(`
    INSERT INTO scores (team_id, hole_number, score, photo_path)
    VALUES (?, ?, 0, ?)
    ON CONFLICT(team_id, hole_number) DO UPDATE SET photo_path = excluded.photo_path
  `).run(req.session.teamId, holeNum, photoPath);
  res.json({ success: true, photo_path: photoPath });
});

// ════════════════════════════════════════════════════════════════════════════
//  ADMIN
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/admin/tournaments', requireAdmin, (req, res) => {
  res.json({ tournaments: db.prepare('SELECT * FROM tournaments ORDER BY year DESC').all() });
});

app.post('/api/admin/tournament', requireAdmin, (req, res) => {
  const { year, name, date, course, description } = req.body;
  if (!year || !name || !date) return res.status(400).json({ error: 'Year, name, date required' });
  const r = db.prepare('INSERT INTO tournaments (year, name, date, course, description) VALUES (?,?,?,?,?)').run(year, name, date, course || '', description || '');
  const tid = r.lastInsertRowid;
  const ins = db.prepare('INSERT OR IGNORE INTO holes (tournament_id, hole_number, par) VALUES (?,?,4)');
  for (let i = 1; i <= 18; i++) ins.run(tid, i);
  res.json({ success: true, id: tid });
});

app.put('/api/admin/tournament/:id', requireAdmin, (req, res) => {
  const { year, name, date, course, description, status } = req.body;
  db.prepare('UPDATE tournaments SET year=?,name=?,date=?,course=?,description=?,status=? WHERE id=?').run(year, name, date, course || '', description || '', status, req.params.id);
  res.json({ success: true });
});

app.delete('/api/admin/tournament/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  const teams = db.prepare('SELECT id FROM teams WHERE tournament_id = ?').all(id);
  teams.forEach(t => db.prepare('DELETE FROM scores WHERE team_id = ?').run(t.id));
  db.prepare('DELETE FROM teams WHERE tournament_id = ?').run(id);
  db.prepare('DELETE FROM holes WHERE tournament_id = ?').run(id);
  db.prepare('DELETE FROM awards WHERE tournament_id = ?').run(id);
  db.prepare('DELETE FROM tournaments WHERE id = ?').run(id);
  res.json({ success: true });
});

app.get('/api/admin/tournament/:id/teams', requireAdmin, (req, res) => {
  res.json({ teams: db.prepare('SELECT * FROM teams WHERE tournament_id = ?').all(req.params.id) });
});

app.post('/api/admin/team', requireAdmin, (req, res) => {
  const { tournament_id, team_name, player1, player2, pin_code } = req.body;
  if (!tournament_id || !team_name || !player1 || !player2 || !pin_code) return res.status(400).json({ error: 'All fields required' });
  const exists = db.prepare('SELECT id FROM teams WHERE tournament_id = ? AND pin_code = ?').get(tournament_id, pin_code);
  if (exists) return res.status(400).json({ error: 'PIN already used in this tournament' });
  const r = db.prepare('INSERT INTO teams (tournament_id, team_name, player1, player2, pin_code) VALUES (?,?,?,?,?)').run(tournament_id, team_name, player1, player2, pin_code);
  res.json({ success: true, id: r.lastInsertRowid });
});

app.put('/api/admin/team/:id', requireAdmin, (req, res) => {
  const { team_name, player1, player2, pin_code } = req.body;
  db.prepare('UPDATE teams SET team_name=?,player1=?,player2=?,pin_code=? WHERE id=?').run(team_name, player1, player2, pin_code, req.params.id);
  res.json({ success: true });
});

app.delete('/api/admin/team/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM scores WHERE team_id = ?').run(req.params.id);
  db.prepare('DELETE FROM teams WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.get('/api/admin/tournament/:id/holes', requireAdmin, (req, res) => {
  res.json({ holes: db.prepare('SELECT * FROM holes WHERE tournament_id = ? ORDER BY hole_number').all(req.params.id) });
});

app.post('/api/admin/tournament/:id/holes', requireAdmin, (req, res) => {
  const { holes } = req.body;
  const upd = db.prepare('UPDATE holes SET par=?,requires_photo=? WHERE tournament_id=? AND hole_number=?');
  holes.forEach(h => upd.run(h.par, h.requires_photo ? 1 : 0, req.params.id, h.hole_number));
  res.json({ success: true });
});

app.get('/api/admin/tournament/:id/scores', requireAdmin, (req, res) => {
  const scores = db.prepare(`
    SELECT s.*, t.team_name, t.player1, t.player2, h.par
    FROM scores s
    JOIN teams t ON s.team_id = t.id
    JOIN holes h ON h.tournament_id = t.tournament_id AND h.hole_number = s.hole_number
    WHERE t.tournament_id = ?
    ORDER BY t.team_name, s.hole_number`).all(req.params.id);
  res.json({ scores });
});

app.put('/api/admin/score/:id', requireAdmin, (req, res) => {
  db.prepare('UPDATE scores SET score=? WHERE id=?').run(req.body.score, req.params.id);
  broadcast('score_updated', {});
  res.json({ success: true });
});

app.delete('/api/admin/score/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM scores WHERE id=?').run(req.params.id);
  broadcast('score_updated', {});
  res.json({ success: true });
});

app.get('/api/admin/tournament/:id/awards', requireAdmin, (req, res) => {
  const awards = db.prepare(`SELECT a.*,t.team_name FROM awards a LEFT JOIN teams t ON a.team_id=t.id WHERE a.tournament_id=?`).all(req.params.id);
  res.json({ awards });
});

app.post('/api/admin/award', requireAdmin, (req, res) => {
  const { tournament_id, award_type, team_id, hole_number, detail } = req.body;
  db.prepare(`
    INSERT INTO awards (tournament_id, award_type, team_id, hole_number, detail)
    VALUES (?,?,?,?,?)
    ON CONFLICT(tournament_id, award_type, hole_number)
    DO UPDATE SET team_id=excluded.team_id, detail=excluded.detail
  `).run(tournament_id, award_type, team_id || null, hole_number || 0, detail || '');
  broadcast('award_updated', {});
  res.json({ success: true });
});

app.delete('/api/admin/award/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM awards WHERE id=?').run(req.params.id);
  broadcast('award_updated', {});
  res.json({ success: true });
});

app.get('/api/admin/legacy', requireAdmin, (req, res) => {
  res.json({ legacy: db.prepare('SELECT * FROM legacy ORDER BY year DESC').all() });
});

app.post('/api/admin/legacy', requireAdmin, (req, res) => {
  const { year, winner_team, player1, player2, score, score_to_par, course, notes } = req.body;
  if (!year || !winner_team || !player1 || !player2) return res.status(400).json({ error: 'Year, team, players required' });
  const r = db.prepare(`INSERT INTO legacy (year,winner_team,player1,player2,score,score_to_par,course,notes) VALUES (?,?,?,?,?,?,?,?)`).run(year, winner_team, player1, player2, score || '', score_to_par || '', course || '', notes || '');
  res.json({ success: true, id: r.lastInsertRowid });
});

app.put('/api/admin/legacy/:id', requireAdmin, (req, res) => {
  const { year, winner_team, player1, player2, score, score_to_par, course, notes } = req.body;
  db.prepare(`UPDATE legacy SET year=?,winner_team=?,player1=?,player2=?,score=?,score_to_par=?,course=?,notes=? WHERE id=?`).run(year, winner_team, player1, player2, score || '', score_to_par || '', course || '', notes || '', req.params.id);
  res.json({ success: true });
});

app.delete('/api/admin/legacy/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM legacy WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ── Clean URL routing ────────────────────────────────────────────────────────
const pages = ['gameday', 'scoreboard', 'legacy', 'enter-score', 'admin'];
pages.forEach(p => {
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
