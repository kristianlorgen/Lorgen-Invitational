require('dotenv').config();
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const db      = require('./database');

const app  = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'LorgenAdmin2025';
const SESSION_SECRET = process.env.SESSION_SECRET || 'lorgen-inv-secret';
const ADMIN_COOKIE_NAME = 'admin_session';
const ADMIN_COOKIE_TTL_MS = 24 * 60 * 60 * 1000;
const storageRoot = process.env.LORGEN_STORAGE_DIR
  ? path.resolve(process.env.LORGEN_STORAGE_DIR)
  : (process.env.VERCEL ? '/tmp/lorgen-storage' : process.cwd());
const uploadsDir = path.join(storageRoot, 'uploads');
const galleryUploadsDir = path.join(uploadsDir, 'glimtskudd');
const chatUploadsDir = path.join(uploadsDir, 'chat');
const sessionsDir = path.join(storageRoot, 'data', 'sessions');
const runningOnVercel = Boolean(process.env.VERCEL);
const usingEphemeralStorage = runningOnVercel && !process.env.LORGEN_DATA_DIR;
const allowEphemeralStorage = process.env.LORGEN_ALLOW_EPHEMERAL_STORAGE === '1';
const blockEphemeralStorage = usingEphemeralStorage && !allowEphemeralStorage;
const ephemeralStorageMessage = 'Persistens er ikke konfigurert for produksjon: sett LORGEN_DATA_DIR til varig lagring (ikke /tmp), eller sett LORGEN_ALLOW_EPHEMERAL_STORAGE=1 for midlertidig testbruk.';

const allowedImageExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.heic', '.heif', '.avif']);

function isAllowedImageUpload(file = {}) {
  const mime = String(file.mimetype || '').toLowerCase();
  const ext = path.extname(String(file.originalname || '')).toLowerCase();
  const hasAllowedExt = allowedImageExtensions.has(ext);
  if (mime.startsWith('image/')) return true;
  // Mobile browsers/camera apps may label valid image files as octet-stream.
  if ((mime === 'application/octet-stream' || mime === '') && hasAllowedExt) return true;
  return false;
}

// Ensure required directories exist
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(galleryUploadsDir)) fs.mkdirSync(galleryUploadsDir, { recursive: true });
if (!fs.existsSync(chatUploadsDir)) fs.mkdirSync(chatUploadsDir, { recursive: true });
if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });

if (blockEphemeralStorage) {
  console.error(`[Lorgen] ${ephemeralStorageMessage}`);
}

// ── SSE live-update clients ──────────────────────────────────────────────────
const sseClients = new Map();
let sseCounter = 0;

function broadcast(type, data = {}) {
  const msg = `data: ${JSON.stringify({ type, data, ts: Date.now() })}\n\n`;
  sseClients.forEach(res => { try { res.write(msg); } catch (_) {} });
}

// ── File upload (local disk) ─────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) =>
    cb(null, `hole-${Date.now()}-${Math.round(Math.random() * 1e6)}${path.extname(file.originalname)}`)
});
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (isAllowedImageUpload(file)) return cb(null, true);
    cb(new Error('Kun bilder er tillatt'));
  }
});

const galleryStorage = multer.diskStorage({
  destination: galleryUploadsDir,
  filename: (req, file, cb) =>
    cb(null, `glimt-${Date.now()}-${Math.round(Math.random() * 1e6)}${path.extname(file.originalname)}`)
});
const galleryUpload = multer({
  storage: galleryStorage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (isAllowedImageUpload(file)) return cb(null, true);
    cb(new Error('Kun bilder er tillatt'));
  }
});

const chatStorage = multer.diskStorage({
  destination: chatUploadsDir,
  filename: (req, file, cb) =>
    cb(null, `chat-${Date.now()}-${Math.round(Math.random() * 1e6)}${path.extname(file.originalname)}`)
});
const chatUpload = multer({
  storage: chatStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (isAllowedImageUpload(file)) return cb(null, true);
    cb(new Error('Kun bilder er tillatt'));
  }
});

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  res.setHeader('X-Lorgen-Storage-Mode', usingEphemeralStorage ? 'ephemeral' : 'durable');
  if (blockEphemeralStorage) {
    res.setHeader('X-Lorgen-Storage-Blocked', '1');
  }
  next();
});

app.use('/api', (req, res, next) => {
  if (!blockEphemeralStorage) return next();

  const isSafeRead = req.method === 'GET' && (req.path === '/health' || req.path === '/ready');
  if (isSafeRead) return next();

  return res.status(503).json({
    error: `${ephemeralStorageMessage} Nåværende Vercel-oppsett bruker /tmp, som mister turneringsdata mellom kall.`
  });
});
app.use('/uploads', express.static(uploadsDir, { fallthrough: true }));
app.use(express.static('public', {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));
let sessionStore;
try {
  sessionStore = new FileStore({ path: sessionsDir, ttl: 86400, retries: 0, logFn: () => {} });
} catch(_) {
  sessionStore = undefined; // falls back to MemoryStore
}
app.use(session({
  ...(sessionStore ? { store: sessionStore } : {}),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

function parseCookies(req) {
  const cookieHeader = req.headers.cookie || '';
  return cookieHeader
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .reduce((acc, item) => {
      const idx = item.indexOf('=');
      if (idx < 0) return acc;
      const key = item.slice(0, idx).trim();
      const value = decodeURIComponent(item.slice(idx + 1));
      if (key) acc[key] = value;
      return acc;
    }, {});
}

function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
}

function createAdminToken() {
  const payload = Buffer.from(JSON.stringify({
    role: 'admin',
    exp: Date.now() + ADMIN_COOKIE_TTL_MS
  })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function decodeAdminToken(token) {
  if (!token) return null;
  const [payload, signature] = String(token).split('.');
  if (!payload || !signature) return null;
  if (sign(payload) !== signature) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (parsed.exp < Date.now() || parsed.role !== 'admin') return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function isAdminAuthenticated(req) {
  if (req.session?.isAdmin) return true;
  const cookies = parseCookies(req);
  return !!decodeAdminToken(cookies[ADMIN_COOKIE_NAME]);
}

// ── Auth guards ──────────────────────────────────────────────────────────────
const requireTeam = (req, res, next) =>
  req.session.teamId ? next() : res.status(401).json({ error: 'Laginnlogging påkrevd' });

const requireAdmin = (req, res, next) =>
  isAdminAuthenticated(req) ? next() : res.status(401).json({ error: 'Admininnlogging påkrevd' });

// ── Platform health checks ──────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/ready', (req, res) => {
  res.status(200).json({ status: 'ready' });
});

// ── Helpers ──────────────────────────────────────────────────────────────────
function getActiveTournament() {
  return db.prepare(
    `SELECT * FROM tournaments WHERE status IN ('active','upcoming') ORDER BY date ASC LIMIT 1`
  ).get();
}

function getScoreboardTournament() {
  let t = db.prepare(`SELECT * FROM tournaments WHERE status='active' ORDER BY date DESC LIMIT 1`).get();
  if (!t) t = db.prepare(`SELECT * FROM tournaments WHERE status='completed' ORDER BY date DESC LIMIT 1`).get();
  return t || null;
}

function normalizePhotoPath(photoPath = '') {
  if (!photoPath || typeof photoPath !== 'string') return '';

  let normalized = photoPath.trim();
  if (!normalized) return '';

  // Keep external/media URIs untouched.
  if (/^(https?:)?\/\//i.test(normalized) || normalized.startsWith('data:') || normalized.startsWith('blob:')) {
    return normalized;
  }

  // Normalize legacy Windows and relative paths.
  normalized = normalized.replace(/\\+/g, '/').replace(/^\.\//, '');

  // Accept both /public/uploads/* and public/uploads/* by mapping to /uploads/*.
  normalized = normalized.replace(/^\/?public\//, '/');

  // Collapse any accidental duplicate uploads prefix.
  normalized = normalized.replace(/^\/?uploads\/uploads\//, '/uploads/');

  if (normalized.startsWith('/uploads/')) return normalized;
  if (normalized.startsWith('uploads/')) return `/${normalized}`;

  // Legacy values may be a bare filename, or include other app-local folders.
  if (!normalized.includes('/')) return `/uploads/${normalized}`;
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function getUploadFsPath(publicUploadPath = '') {
  const normalized = normalizePhotoPath(publicUploadPath);
  if (!normalized.startsWith('/uploads/')) return null;
  return path.join(uploadsDir, normalized.replace(/^\/uploads\//, ''));
}

function tournamentExists(tournamentId) {
  return !!db.prepare('SELECT id FROM tournaments WHERE id=? LIMIT 1').get(tournamentId);
}

function syncScorePhotoToGallery({ tournamentId, scoreId, photoPath }) {
  const existing = db.prepare(
    `SELECT id FROM gallery_photos
     WHERE tournament_id=? AND caption=?
     LIMIT 1`
  ).get(tournamentId, `score:${scoreId}`);

  if (existing) {
    db.prepare('UPDATE gallery_photos SET photo_path=?, uploaded_at=CURRENT_TIMESTAMP WHERE id=?')
      .run(photoPath, existing.id);
    return;
  }

  db.prepare(
    'INSERT INTO gallery_photos (tournament_id, photo_path, caption) VALUES (?,?,?)'
  ).run(tournamentId, photoPath, `score:${scoreId}`);
}

function rebuildPhotoDatabase(tournamentId = null) {
  const whereTournament = tournamentId ? 'WHERE tm.tournament_id=?' : '';
  const scoreRows = db.prepare(
    `SELECT s.id, s.team_id, tm.tournament_id, s.photo_path, s.is_published
     FROM scores s
     JOIN teams tm ON tm.id=s.team_id
     ${whereTournament}`
  ).all(...(tournamentId ? [tournamentId] : []));

  let normalizedScores = 0;
  let normalizedGallery = 0;
  let normalizedLegacy = 0;
  let syncedScoreCaptions = 0;

  scoreRows.forEach(s => {
    const normalized = normalizePhotoPath(s.photo_path);
    const shouldPublish = s.is_published ? 1 : 0;

    if ((s.photo_path || '') !== normalized || s.is_published !== shouldPublish) {
      db.prepare('UPDATE scores SET photo_path=?, is_published=? WHERE id=?').run(normalized || null, shouldPublish, s.id);
      normalizedScores++;
    }

    if (!normalized) {
      db.prepare('DELETE FROM gallery_photos WHERE tournament_id=? AND caption=?').run(s.tournament_id, `score:${s.id}`);
      return;
    }

    const existing = db.prepare(
      'SELECT id, photo_path, is_published FROM gallery_photos WHERE tournament_id=? AND caption=? LIMIT 1'
    ).get(s.tournament_id, `score:${s.id}`);

    if (existing) {
      const normalizedExisting = normalizePhotoPath(existing.photo_path);
      if (normalizedExisting !== normalized || Number(existing.is_published || 0) !== shouldPublish) {
        db.prepare(
          'UPDATE gallery_photos SET photo_path=?, is_published=?, uploaded_at=CURRENT_TIMESTAMP WHERE id=?'
        ).run(normalized, shouldPublish, existing.id);
        syncedScoreCaptions++;
      }
      return;
    }

    db.prepare(
      'INSERT INTO gallery_photos (tournament_id, photo_path, caption, is_published) VALUES (?,?,?,?)'
    ).run(s.tournament_id, normalized, `score:${s.id}`, shouldPublish);
    syncedScoreCaptions++;
  });

  const galleryRows = db.prepare(
    `SELECT id, photo_path, is_published FROM gallery_photos ${tournamentId ? 'WHERE tournament_id=?' : ''}`
  ).all(...(tournamentId ? [tournamentId] : []));
  galleryRows.forEach(p => {
    const normalized = normalizePhotoPath(p.photo_path);
    const shouldPublish = p.is_published ? 1 : 0;
    if ((p.photo_path || '') !== normalized || p.is_published !== shouldPublish) {
      db.prepare('UPDATE gallery_photos SET photo_path=?, is_published=? WHERE id=?').run(normalized || null, shouldPublish, p.id);
      normalizedGallery++;
    }
  });

  const legacyRows = db.prepare('SELECT id, winner_photo FROM legacy').all();
  legacyRows.forEach(row => {
    const normalized = normalizePhotoPath(row.winner_photo);
    if ((row.winner_photo || '') !== normalized) {
      db.prepare('UPDATE legacy SET winner_photo=? WHERE id=?').run(normalized || null, row.id);
      normalizedLegacy++;
    }
  });

  return {
    normalized_scores: normalizedScores,
    normalized_gallery: normalizedGallery,
    normalized_legacy: normalizedLegacy,
    synced_score_captions: syncedScoreCaptions
  };
}


function resolveTeamForActiveTournament(req, pinInput) {
  const t = db.prepare(`SELECT * FROM tournaments WHERE status='active' ORDER BY date DESC LIMIT 1`).get();
  if (!t) return { error: { status: 404, message: 'Ingen aktiv turnering' } };

  const pin = String(pinInput || '').trim();
  if (pin) {
    const teamByPin = db.prepare('SELECT id, team_name, tournament_id FROM teams WHERE tournament_id=? AND pin_code=? LIMIT 1').get(t.id, pin);
    if (!teamByPin) return { error: { status: 401, message: 'Ugyldig PIN' } };
    return { tournament: t, team: teamByPin };
  }

  if (req.session?.teamId) {
    const sessionTeam = db.prepare('SELECT id, team_name, tournament_id FROM teams WHERE id=? LIMIT 1').get(req.session.teamId);
    if (sessionTeam && sessionTeam.tournament_id === t.id) {
      return { tournament: t, team: sessionTeam };
    }
  }

  return { error: { status: 400, message: 'Mangler pin for chat' } };
}


function getSponsorsForTournament(tournamentId, placement) {
  return db.prepare(
    `SELECT id, tournament_id, placement, slot_key, spot_number, hole_number, sponsor_name, description,
            logo_path, is_enabled
     FROM sponsors
     WHERE tournament_id=? AND placement=?
     ORDER BY CASE WHEN placement='home' THEN spot_number ELSE hole_number END ASC`
  ).all(tournamentId, placement).map(row => ({
    ...row,
    logo_path: normalizePhotoPath(row.logo_path),
    is_enabled: row.is_enabled ? 1 : 0
  }));
}

function buildScoreboard(tournament) {
  const teams     = db.prepare('SELECT * FROM teams WHERE tournament_id=?').all(tournament.id);
  const holes     = db.prepare('SELECT * FROM holes WHERE tournament_id=? ORDER BY hole_number').all(tournament.id);
  const allScoreRows = teams.length
    ? db.prepare(`SELECT * FROM scores WHERE team_id IN (${teams.map(() => '?').join(',')})`).all(...teams.map(t => t.id))
    : [];

  // Compute best awards from award_claims (robust: bypasses missing UNIQUE constraint on awards table)
  const allClaims = db.prepare(
    `SELECT ac.*, t.team_name, t.player1, t.player2
     FROM award_claims ac LEFT JOIN teams t ON t.id=ac.team_id
     WHERE ac.tournament_id=?`
  ).all(tournament.id);
  const bestMap = {};
  allClaims.forEach(c => {
    const key = `${c.award_type}_${c.hole_number}`;
    const val = parseFloat(c.detail) || 0;
    if (!bestMap[key]) { bestMap[key] = c; return; }
    const cur = parseFloat(bestMap[key].detail) || 0;
    if (c.award_type === 'longest_drive' && val > cur) bestMap[key] = c;
    else if (c.award_type === 'closest_to_pin' && val > 0 && (cur <= 0 || val < cur)) bestMap[key] = c;
  });
  // Admin manual overrides take precedence
  const manualAwards = db.prepare(
    `SELECT a.*, t.team_name, t.player1, t.player2
     FROM awards a LEFT JOIN teams t ON t.id=a.team_id
     WHERE a.tournament_id=?`
  ).all(tournament.id);
  manualAwards.forEach(a => { bestMap[`${a.award_type}_${a.hole_number}`] = a; });

  const awards = Object.values(bestMap).map(a => ({
    id: a.id || null, tournament_id: a.tournament_id, award_type: a.award_type,
    team_id: a.team_id, player_name: a.player_name || null,
    hole_number: a.hole_number, detail: a.detail,
    team_name: a.team_name || null, player1: a.player1 || null, player2: a.player2 || null
  }));

  const slopeRating = tournament.slope_rating || 113;

  const scoreboard = teams.map(team => {
    const teamScores = allScoreRows.filter(s => s.team_id === team.id);
    let total = 0, par = 0, done = 0;
    const holeScores = {};
    teamScores.forEach(s => {
      const h = holes.find(h => h.hole_number === s.hole_number);
      if (h) { total += s.score; par += h.par; done++; }
      holeScores[s.hole_number] = { score: s.score, photo: normalizePhotoPath(s.photo_path) };
    });
    const hcpIndex = ((team.player1_handicap || 0) + (team.player2_handicap || 0)) * 0.25;
    const courseHcp = Math.round(hcpIndex * slopeRating / 113);
    let usedHandicapStrokes = 0;
    teamScores.forEach(s => {
      const h = holes.find(h => h.hole_number === s.hole_number);
      const si = h?.stroke_index || 0;
      if (!si || courseHcp <= 0) return;
      if (courseHcp >= si) usedHandicapStrokes += 1;
      if (courseHcp >= si + 18) usedHandicapStrokes += 1;
    });
    const netScore = total > 0 ? total - usedHandicapStrokes : 0;
    const netToPar = total > 0 ? netScore - par : 0;
    return {
      team_id: team.id, team_name: team.team_name,
      player1: team.player1, player2: team.player2,
      player1_handicap: team.player1_handicap || 0, player2_handicap: team.player2_handicap || 0,
      handicap: courseHcp, used_handicap_strokes: usedHandicapStrokes, net_score: netScore, net_to_par: netToPar,
      total_score: total, total_par: par, to_par: total - par,
      holes_completed: done, hole_scores: holeScores
    };
  });

  const hasHandicaps = teams.some(t => (t.player1_handicap || 0) + (t.player2_handicap || 0) > 0);
  scoreboard.sort((a, b) => {
    if (a.holes_completed === 0 && b.holes_completed === 0) return 0;
    if (a.holes_completed === 0) return 1;
    if (b.holes_completed === 0) return -1;
    return hasHandicaps ? (a.net_to_par - b.net_to_par) : (a.to_par - b.to_par);
  });

  return { tournament, scoreboard, holes, awards };
}

// ════════════════════════════════════════════════════════════════════════════
//  PUBLIC API
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/version', (req, res) => {
  res.json({ version: '3.0.0-sqlite', stack: 'SQLite', lang: 'nb', ok: true });
});

app.get('/api/tournament', (req, res) => {
  try {
    const t = getActiveTournament();
    if (!t) return res.json({ tournament: null, holes: [] });
    const holes = db.prepare('SELECT * FROM holes WHERE tournament_id=? ORDER BY hole_number').all(t.id);
    res.json({ tournament: t, holes });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/sponsors', (req, res) => {
  try {
    const placement = String(req.query.placement || 'home');
    if (!['home', 'hole'].includes(placement)) {
      return res.status(400).json({ error: 'Ugyldig sponsor-plassering' });
    }

    let tournamentId = parseInt(req.query.tournament_id, 10);
    if (!Number.isFinite(tournamentId)) {
      const t = getActiveTournament() || getScoreboardTournament();
      tournamentId = t?.id;
    }
    if (!tournamentId) return res.json({ sponsors: [] });

    const sponsors = getSponsorsForTournament(tournamentId, placement).filter(s => s.is_enabled);
    if (placement === 'hole') {
      const holeNumber = parseInt(req.query.hole_number, 10);
      if (Number.isFinite(holeNumber)) {
        return res.json({ sponsors: sponsors.filter(s => s.hole_number === holeNumber) });
      }
    }
    res.json({ sponsors });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/scoreboard', (req, res) => {
  try {
    const t = getScoreboardTournament();
    if (!t) return res.json({ scoreboard: [], holes: [], awards: [], tournament: null });
    res.json(buildScoreboard(t));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/legacy', (req, res) => {
  try {
    const legacy = db.prepare('SELECT id,year,winner_team,player1,player2,score,score_to_par,course,notes,winner_photo,winner_photo_focus FROM legacy ORDER BY year DESC').all();
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


app.get('/api/chat/messages', (req, res) => {
  try {
    const t = getScoreboardTournament();
    if (!t) return res.json({ messages: [] });
    const messages = db.prepare(
      `SELECT id, team_name, message, image_path, created_at
       FROM chat_messages
       WHERE tournament_id=?
       ORDER BY id DESC
       LIMIT 100`
    ).all(t.id).reverse();
    res.json({ messages });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/chat/send', chatUpload.single('image'), (req, res) => {
  const body = req.body || {};
  const msg = String(body.message || '').trim();
  const imagePath = req.file ? normalizePhotoPath(`/uploads/chat/${req.file.filename}`) : '';

  const resolved = resolveTeamForActiveTournament(req, body.pin);
  if (resolved.error) return res.status(resolved.error.status).json({ error: resolved.error.message });
  if (!msg && !imagePath) return res.status(400).json({ error: 'Melding eller bilde er påkrevd' });
  if (msg.length > 400) return res.status(400).json({ error: 'Meldingen er for lang (maks 400 tegn)' });
  try {
    const t = resolved.tournament;
    const team = resolved.team;
    const result = db.prepare(
      'INSERT INTO chat_messages (tournament_id, team_id, team_name, message, image_path) VALUES (?,?,?,?,?)'
    ).run(t.id, team.id, team.team_name, msg, imagePath);
    const created = db.prepare('SELECT id, team_name, message, image_path, created_at FROM chat_messages WHERE id=?').get(result.lastInsertRowid);
    broadcast('chat_message', created);
    res.json({ success: true, message: created });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/team/birdie-shot', (req, res) => {
  const { pin, note } = req.body || {};
  try {
    const resolved = resolveTeamForActiveTournament(req, pin);
    if (resolved.error) return res.status(resolved.error.status).json({ error: resolved.error.message });
    const t = resolved.tournament;
    const team = resolved.team;
    const payload = {
      team_name: team.team_name,
      note: String(note || '').trim().slice(0, 140)
    };
    const shoutMessage = `⛳ ${team.team_name} roper birdie! ${payload.note || 'Alle spillere må ta birdie shots! 🥃'}`;
    const chatResult = db.prepare(
      'INSERT INTO chat_messages (tournament_id, team_id, team_name, message, image_path) VALUES (?,?,?,?,?)'
    ).run(t.id, team.id, team.team_name, shoutMessage.slice(0, 400), '');
    const chatMessage = db.prepare('SELECT id, team_name, message, image_path, created_at FROM chat_messages WHERE id=?').get(chatResult.lastInsertRowid);
    broadcast('chat_message', chatMessage);
    broadcast('birdie_shot', payload);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
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
    res.cookie(ADMIN_COOKIE_NAME, createAdminToken(), {
      httpOnly: true,
      sameSite: 'lax',
      secure: !!process.env.VERCEL,
      maxAge: ADMIN_COOKIE_TTL_MS,
      path: '/'
    });
    return req.session.save(() => res.json({ success: true }));
  }
  res.status(401).json({ error: 'Ugyldig passord' });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie(ADMIN_COOKIE_NAME, { path: '/' });
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/auth/status', (req, res) => {
  if (isAdminAuthenticated(req)) {
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
    const team       = db.prepare('SELECT * FROM teams WHERE id=?').get(req.session.teamId);
    const tournament = db.prepare('SELECT id,name,slope_rating FROM tournaments WHERE id=?').get(req.session.tournamentId);
    const holes      = db.prepare('SELECT * FROM holes WHERE tournament_id=? ORDER BY hole_number').all(req.session.tournamentId);
    const scoresRaw  = db.prepare('SELECT * FROM scores WHERE team_id=?').all(req.session.teamId);
    const scores     = scoresRaw.map(s => ({ ...s, photo_path: normalizePhotoPath(s.photo_path) }));
    const claims     = db.prepare('SELECT * FROM award_claims WHERE tournament_id=? AND team_id=?').all(req.session.tournamentId, req.session.teamId);
    const holeSponsors = getSponsorsForTournament(req.session.tournamentId, 'hole').filter(s => s.is_enabled);
    res.json({ team: { ...team, locked: team.locked || 0 }, tournament, holes, scores, claims, hole_sponsors: holeSponsors });
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
    const teamLock = db.prepare('SELECT locked FROM teams WHERE id=?').get(req.session.teamId);
    if (teamLock?.locked) return res.status(403).json({ error: 'Resultatkort er låst. Kontakt turnerings-administrator for å endre.' });
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
    const uploadDir = path.join(uploadsDir, 'admin', `t${tid}`, 'scoreboard', `h${holeNum}`);
    ensureDir(uploadDir);
    const dynamicUpload = multer({
      storage: multer.diskStorage({
        destination: uploadDir,
        filename: (req, file, cb) => cb(null, `hole-${Date.now()}-${Math.round(Math.random()*1e6)}${path.extname(file.originalname)}`)
      }),
      limits: { fileSize: 15 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        if (isAllowedImageUpload(file)) return cb(null, true);
        cb(new Error('Kun bilder er tillatt'));
      }
    }).single('photo');
    dynamicUpload(req, res, err => {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: 'Ingen fil lastet opp' });
      const photoPath = `/uploads/admin/t${tid}/scoreboard/h${holeNum}/${req.file.filename}`;
      const existing = db.prepare('SELECT id FROM scores WHERE team_id=? AND hole_number=?').get(req.session.teamId, holeNum);
      let scoreId;
      if (existing) {
        db.prepare('UPDATE scores SET photo_path=?, is_published=1 WHERE id=?').run(photoPath, existing.id);
        scoreId = existing.id;
      } else {
        const created = db.prepare('INSERT INTO scores (team_id, hole_number, score, photo_path, is_published) VALUES (?,?,0,?,1)')
          .run(req.session.teamId, holeNum, photoPath);
        scoreId = Number(created.lastInsertRowid);
      }
      syncScorePhotoToGallery({ tournamentId: tid, scoreId, photoPath });
      broadcast('score_updated', { tournament_id: tid });
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
  const { date, course, description, gameday_info, slope_rating } = req.body;
  if (!date) return res.status(400).json({ error: 'Dato er påkrevd' });
  const year = new Date(date).getFullYear();
  if (!Number.isFinite(year)) return res.status(400).json({ error: 'Ugyldig dato' });
  const name = 'Lorgen Invitational';
  try {
    const result = db.prepare(
      'INSERT INTO tournaments (year, name, date, course, description, gameday_info, slope_rating) VALUES (?,?,?,?,?,?,?)'
    ).run(year, name, date, course||'', description||'', gameday_info||'', slope_rating||113);
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
  const { date, course, description, gameday_info, status, slope_rating } = req.body;
  if (!date) return res.status(400).json({ error: 'Dato er påkrevd' });
  const year = new Date(date).getFullYear();
  if (!Number.isFinite(year)) return res.status(400).json({ error: 'Ugyldig dato' });
  const name = 'Lorgen Invitational';
  try {
    db.prepare(
      'UPDATE tournaments SET year=?, name=?, date=?, course=?, description=?, gameday_info=?, status=?, slope_rating=? WHERE id=?'
    ).run(year, name, date, course||'', description||'', gameday_info||'', status, slope_rating||113, req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/tournament/:id/slope', requireAdmin, (req, res) => {
  try {
    db.prepare('UPDATE tournaments SET slope_rating=? WHERE id=?').run(parseInt(req.body.slope_rating)||113, req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


app.get('/api/admin/tournament/:id/sponsors', requireAdmin, (req, res) => {
  try {
    const tournamentId = parseInt(req.params.id, 10);
    const home = getSponsorsForTournament(tournamentId, 'home');
    const hole = getSponsorsForTournament(tournamentId, 'hole');
    res.json({ home, hole });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/tournament/:id/sponsors', requireAdmin, (req, res) => {
  try {
    const tournamentId = parseInt(req.params.id, 10);
    const sponsors = Array.isArray(req.body.sponsors) ? req.body.sponsors : [];
    const stmt = db.prepare(
      `INSERT INTO sponsors (tournament_id, placement, slot_key, spot_number, hole_number, sponsor_name, description, logo_path, is_enabled, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
       ON CONFLICT(tournament_id, placement, slot_key)
       DO UPDATE SET
         spot_number=excluded.spot_number,
         hole_number=excluded.hole_number,
         sponsor_name=excluded.sponsor_name,
         description=excluded.description,
         logo_path=excluded.logo_path,
         is_enabled=excluded.is_enabled,
         updated_at=CURRENT_TIMESTAMP`
    );

    const tx = db.transaction(() => {
      sponsors.forEach(item => {
        const placement = item.placement === 'hole' ? 'hole' : 'home';
        const slotNumber = placement === 'home' ? (parseInt(item.spot_number, 10) || null) : null;
        const holeNumber = placement === 'hole' ? (parseInt(item.hole_number, 10) || null) : null;
        const slotKey = placement === 'home' ? `spot_${slotNumber}` : `hole_${holeNumber}`;
        if (!slotNumber && !holeNumber) return;
        stmt.run(
          tournamentId,
          placement,
          slotKey,
          slotNumber,
          holeNumber,
          String(item.sponsor_name || '').trim(),
          String(item.description || '').trim(),
          String(item.logo_path || '').trim(),
          item.is_enabled ? 1 : 0
        );
      });
    });

    tx();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/tournament/:id/sponsor-logo', requireAdmin, (req, res) => {
  const tournamentId = parseInt(req.params.id, 10);
  if (!Number.isInteger(tournamentId) || !tournamentExists(tournamentId)) {
    return res.status(404).json({ error: 'Turnering ikke funnet' });
  }
  const uploadDir = path.join(uploadsDir, 'admin', `t${tournamentId}`, 'sponsors');
  ensureDir(uploadDir);

  const dynamicUpload = multer({
    storage: multer.diskStorage({
      destination: uploadDir,
      filename: (req, file, cb) => cb(null, `sponsor-${Date.now()}-${Math.round(Math.random()*1e6)}${path.extname(file.originalname)}`)
    }),
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (isAllowedImageUpload(file)) return cb(null, true);
      cb(new Error('Kun bilder er tillatt'));
    }
  }).single('logo');

  dynamicUpload(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Ingen fil lastet opp' });
    const logoPath = `/uploads/admin/t${tournamentId}/sponsors/${req.file.filename}`;
    res.json({ success: true, logo_path: logoPath });
  });
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
  const { tournament_id, team_name, player1, player2, pin_code, player1_handicap, player2_handicap } = req.body;
  if (!tournament_id || !team_name || !player1 || !player2 || !pin_code)
    return res.status(400).json({ error: 'Alle felt er påkrevd' });
  try {
    if (!tournamentExists(tournament_id)) {
      const hint = usingEphemeralStorage
        ? ' Appen kjører med midlertidig lagring på Vercel (/tmp), så data kan forsvinne mellom kall.'
        : '';
      return res.status(404).json({ error: 'Valgt turnering finnes ikke lenger. Oppdater siden og prøv igjen.' + hint });
    }
    const existing = db.prepare('SELECT id FROM teams WHERE tournament_id=? AND pin_code=?').get(tournament_id, pin_code);
    if (existing) return res.status(400).json({ error: 'PIN allerede i bruk i denne turneringen' });
    const result = db.prepare(
      'INSERT INTO teams (tournament_id, team_name, player1, player2, pin_code, player1_handicap, player2_handicap) VALUES (?,?,?,?,?,?,?)'
    ).run(tournament_id, team_name, player1, player2, pin_code, parseFloat(player1_handicap)||0, parseFloat(player2_handicap)||0);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/team/:id', requireAdmin, (req, res) => {
  const { team_name, player1, player2, pin_code, player1_handicap, player2_handicap } = req.body;
  try {
    db.prepare('UPDATE teams SET team_name=?, player1=?, player2=?, pin_code=?, player1_handicap=?, player2_handicap=? WHERE id=?')
      .run(team_name, player1, player2, pin_code, parseFloat(player1_handicap)||0, parseFloat(player2_handicap)||0, req.params.id);
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

app.put('/api/admin/team/:id/lock', requireAdmin, (req, res) => {
  try {
    const locked = req.body.locked ? 1 : 0;
    db.prepare('UPDATE teams SET locked=? WHERE id=?').run(locked, req.params.id);
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
      'UPDATE holes SET par=?, requires_photo=?, is_longest_drive=?, is_closest_to_pin=?, stroke_index=? WHERE tournament_id=? AND hole_number=?'
    );
    const updateAll = db.transaction(() => {
      for (const h of holes) {
        update.run(h.par, h.requires_photo ? 1 : 0, h.is_longest_drive ? 1 : 0, h.is_closest_to_pin ? 1 : 0, h.stroke_index || 0, tid, h.hole_number);
        if (h.requires_photo) {
          const dir = path.join(uploadsDir, `t${tid}`, `h${h.hole_number}`);
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
      id: s.id, hole_number: s.hole_number, photo_path: normalizePhotoPath(s.photo_path), submitted_at: s.submitted_at,
      is_published: !!s.is_published,
      team_name:      teamsMap[s.team_id]?.team_name,
      player1:        teamsMap[s.team_id]?.player1,
      player2:        teamsMap[s.team_id]?.player2,
      par:            holesMap[s.hole_number]?.par,
      requires_photo: holesMap[s.hole_number]?.requires_photo
    }));
    res.json({ photos });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/tournament/:id/rebuild-photo-db', requireAdmin, (req, res) => {
  try {
    const tournamentId = Number(req.params.id);
    if (!Number.isFinite(tournamentId)) return res.status(400).json({ error: 'Ugyldig turnerings-ID' });
    const tournament = db.prepare('SELECT id FROM tournaments WHERE id=?').get(tournamentId);
    if (!tournament) return res.status(404).json({ error: 'Turnering ikke funnet' });

    const result = rebuildPhotoDatabase(tournamentId);
    res.json({ success: true, ...result });
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
    // Auto-register claim as award only if it beats the current best result
    // Find best existing claim (from award_claims, not awards — robust regardless of schema)
    const allExistingClaims = db.prepare(
      'SELECT detail FROM award_claims WHERE tournament_id=? AND award_type=? AND hole_number=?'
    ).all(req.session.tournamentId, award_type, hole_number);
    const newVal = parseFloat(detail) || 0;
    let isNewBest = allExistingClaims.length === 0;
    if (!isNewBest) {
      // Compare new claim against all existing claims
      let bestExisting = null;
      allExistingClaims.forEach(c => {
        const v = parseFloat(c.detail) || 0;
        if (bestExisting === null) { bestExisting = v; return; }
        if (award_type === 'longest_drive' && v > bestExisting) bestExisting = v;
        else if (award_type === 'closest_to_pin' && v > 0 && (bestExisting <= 0 || v < bestExisting)) bestExisting = v;
      });
      if (award_type === 'longest_drive') isNewBest = newVal > (bestExisting || 0);
      else if (award_type === 'closest_to_pin') isNewBest = newVal > 0 && (bestExisting === null || bestExisting <= 0 || newVal < bestExisting);
    }
    if (isNewBest) {
      // DELETE all existing rows for this type+hole (handles missing UNIQUE constraint), then INSERT best
      db.prepare('DELETE FROM awards WHERE tournament_id=? AND award_type=? AND hole_number=?')
        .run(req.session.tournamentId, award_type, hole_number);
      db.prepare(
        `INSERT INTO awards (tournament_id, award_type, team_id, player_name, hole_number, detail) VALUES (?,?,?,?,?,?)`
      ).run(req.session.tournamentId, award_type, req.session.teamId, player_name, hole_number, detail||'');
    }
    broadcast('award_updated', {});
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Team lock scorecard ───────────────────────────────────────────────────────
app.post('/api/team/lock-scorecard', requireTeam, (req, res) => {
  try {
    db.prepare('UPDATE teams SET locked=1 WHERE id=?').run(req.session.teamId);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Public photo gallery ──────────────────────────────────────────────────────

function getVoterIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
}

function getLatestTournamentWithPublishedPhotos() {
  const latestWithPhotos = db.prepare(
    `SELECT x.tournament_id FROM (
       SELECT gp.tournament_id, gp.uploaded_at AS ts FROM gallery_photos gp WHERE gp.is_published=1
     ) x
     ORDER BY x.ts DESC
     LIMIT 1`
  ).get();

  if (!latestWithPhotos?.tournament_id) return null;
  return db.prepare('SELECT * FROM tournaments WHERE id=?').get(latestWithPhotos.tournament_id) || null;
}

function getTournamentForPhotoRef(photoRef) {
  if (!photoRef || typeof photoRef !== 'string') return null;

  if (photoRef.startsWith('gallery:')) {
    const id = Number(photoRef.split(':')[1]);
    if (!Number.isFinite(id)) return null;
    const row = db.prepare('SELECT tournament_id FROM gallery_photos WHERE id=?').get(id);
    if (!row?.tournament_id) return null;
    return db.prepare('SELECT * FROM tournaments WHERE id=?').get(row.tournament_id) || null;
  }

  if (photoRef.startsWith('score:')) {
    const id = Number(photoRef.split(':')[1]);
    if (!Number.isFinite(id)) return null;
    const row = db.prepare(
      `SELECT tm.tournament_id FROM scores s
       JOIN teams tm ON tm.id=s.team_id
       WHERE s.id=?`
    ).get(id);
    if (!row?.tournament_id) return null;
    return db.prepare('SELECT * FROM tournaments WHERE id=?').get(row.tournament_id) || null;
  }

  return null;
}

app.get('/api/gallery', (req, res) => {
  try {
    // Show the most recently updated published gallery first, so users always
    // see the same photos as in admin regardless of tournament status.
    let t = getLatestTournamentWithPublishedPhotos();
    if (!t) t = getActiveTournament();
    if (!t) t = db.prepare(`SELECT * FROM tournaments WHERE status='completed' ORDER BY date DESC LIMIT 1`).get();
    const collectPhotosForTournament = (tournamentId) => {
      const items = [];
      const scoreIdsFromGallery = new Set();

      const galleryPhotos = db.prepare(
        `SELECT id, photo_path, caption, uploaded_at FROM gallery_photos WHERE tournament_id=? AND is_published=1 ORDER BY uploaded_at DESC`
      ).all(tournamentId);
      galleryPhotos.forEach(g => {
        const scoreMatch = String(g.caption || '').match(/^score:(\d+)$/);
        if (scoreMatch) {
          scoreIdsFromGallery.add(Number(scoreMatch[1]));
          return;
        }
        if (String(g.caption || '').startsWith('score:')) return;
        const photoPath = normalizePhotoPath(g.photo_path);
        if (!photoPath) return;
        items.push({
          photo_ref: `gallery:${g.id}`,
          hole_number: null,
          photo_path: photoPath,
          team_name: g.caption || '',
          submitted_at: g.uploaded_at,
          source: 'gallery'
        });
      });

      const scores = db.prepare(
        `SELECT s.id, s.team_id, s.hole_number, s.photo_path, s.submitted_at, t.team_name
         FROM scores s
         JOIN teams t ON t.id=s.team_id
         WHERE t.tournament_id=?
         AND is_published=1
         AND photo_path IS NOT NULL AND photo_path != ''
         ORDER BY submitted_at DESC`
      ).all(tournamentId);
      scores.forEach(s => {
        scoreIdsFromGallery.delete(Number(s.id));
        const photoPath = normalizePhotoPath(s.photo_path);
        if (!photoPath) return;
        items.push({
          photo_ref: `score:${s.id}`,
          hole_number: s.hole_number,
          photo_path: photoPath,
          team_name: s.team_name || '',
          submitted_at: s.submitted_at,
          source: 'player'
        });
      });

      // Fallback: include score-linked gallery entries when score rows are gone,
      // so older photos do not disappear after team resets/imports.
      if (scoreIdsFromGallery.size) {
        const missingScoreRefs = Array.from(scoreIdsFromGallery);
        const placeholders = db.prepare(
          `SELECT caption, photo_path, uploaded_at FROM gallery_photos
           WHERE tournament_id=? AND is_published=1
           AND caption IN (${missingScoreRefs.map(() => '?').join(',')})`
        ).all(tournamentId, ...missingScoreRefs.map(id => `score:${id}`));

        placeholders.forEach(p => {
          const photoPath = normalizePhotoPath(p.photo_path);
          if (!photoPath) return;
          const scoreId = Number(String(p.caption || '').split(':')[1]);
          if (!Number.isFinite(scoreId)) return;
          items.push({
            photo_ref: `score:${scoreId}`,
            hole_number: null,
            photo_path: photoPath,
            team_name: 'Lagbilde',
            submitted_at: p.uploaded_at,
            source: 'player'
          });
        });
      }

      return items;
    };

    if (!t) return res.json({ photos: [], tournament: null });

    let photos = collectPhotosForTournament(t.id);
    if (!photos.length) {
      const fallbackTournament = getLatestTournamentWithPublishedPhotos();
      if (fallbackTournament && fallbackTournament.id !== t.id) {
        if (fallbackTournament) {
          const fallbackPhotos = collectPhotosForTournament(fallbackTournament.id);
          if (fallbackPhotos.length) {
            t = fallbackTournament;
            photos = fallbackPhotos;
          }
        }
      }
    }

    // Add vote counts and voter status
    const voterIp = getVoterIp(req);
    const voteCounts = db.prepare(
      `SELECT photo_ref, COUNT(*) as count FROM photo_votes WHERE tournament_id=? GROUP BY photo_ref`
    ).all(t.id);
    const myVotes = db.prepare(
      `SELECT photo_ref FROM photo_votes WHERE tournament_id=? AND voter_ip=?`
    ).all(t.id, voterIp);
    const voteMap = {};
    voteCounts.forEach(v => voteMap[v.photo_ref] = v.count);
    const myVoteSet = new Set(myVotes.map(v => v.photo_ref));

    photos.forEach(p => {
      p.votes = voteMap[p.photo_ref] || 0;
      p.voted = myVoteSet.has(p.photo_ref);
    });

    // Sort by most votes first, then newest
    photos.sort((a, b) => (b.votes - a.votes) || (new Date(b.submitted_at) - new Date(a.submitted_at)));
    res.json({ photos, tournament: t });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Vote on photo ─────────────────────────────────────────────────────────────

app.post('/api/gallery/vote', (req, res) => {
  const { photo_ref } = req.body;
  if (!photo_ref) return res.status(400).json({ error: 'photo_ref er påkrevd' });
  try {
    // Always store votes on the tournament that owns the selected image.
    let t = getTournamentForPhotoRef(photo_ref);
    if (!t) t = getLatestTournamentWithPublishedPhotos();
    if (!t) t = getActiveTournament();
    if (!t) t = db.prepare(`SELECT * FROM tournaments WHERE status='completed' ORDER BY date DESC LIMIT 1`).get();
    if (!t) return res.status(404).json({ error: 'Ingen aktiv turnering' });
    const voterIp = getVoterIp(req);
    // Toggle vote
    const existing = db.prepare('SELECT id FROM photo_votes WHERE tournament_id=? AND photo_ref=? AND voter_ip=?')
      .get(t.id, photo_ref, voterIp);
    if (existing) {
      db.prepare('DELETE FROM photo_votes WHERE id=?').run(existing.id);
      return res.json({ voted: false });
    }
    db.prepare('INSERT INTO photo_votes (tournament_id, photo_ref, voter_ip) VALUES (?,?,?)')
      .run(t.id, photo_ref, voterIp);
    res.json({ voted: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Admin gallery (admin-uploaded photos) ────────────────────────────────────

app.get('/api/admin/tournament/:id/gallery', requireAdmin, (req, res) => {
  try {
    const photosRaw = db.prepare(
      'SELECT * FROM gallery_photos WHERE tournament_id=? ORDER BY uploaded_at DESC'
    ).all(req.params.id);
    const photos = photosRaw.map(p => ({ ...p, photo_path: normalizePhotoPath(p.photo_path) }));
    res.json({ photos });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/tournament/:id/gallery', requireAdmin, galleryUpload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Ingen fil lastet opp' });
  try {
    if (!tournamentExists(req.params.id)) {
      return res.status(404).json({ error: 'Turnering ikke funnet' });
    }
    const photoPath = `/uploads/glimtskudd/${req.file.filename}`;
    const caption = req.body.caption || '';
    const result = db.prepare(
      'INSERT INTO gallery_photos (tournament_id, photo_path, caption) VALUES (?,?,?)'
    ).run(req.params.id, photoPath, caption);
    res.json({ success: true, id: result.lastInsertRowid, photo_path: photoPath });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/gallery/:id/publish', requireAdmin, (req, res) => {
  try {
    const isPublished = req.body?.is_published ? 1 : 0;
    db.prepare('UPDATE gallery_photos SET is_published=? WHERE id=?').run(isPublished, req.params.id);
    res.json({ success: true, is_published: !!isPublished });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/gallery/:id/download', requireAdmin, (req, res) => {
  try {
    const photo = db.prepare('SELECT photo_path FROM gallery_photos WHERE id=?').get(req.params.id);
    if (!photo?.photo_path) return res.status(404).json({ error: 'Bilde ikke funnet' });
    const normalized = normalizePhotoPath(photo.photo_path);
    if (!normalized.startsWith('/uploads/')) return res.status(400).json({ error: 'Kan ikke laste ned eksternt bilde' });
    const filePath = getUploadFsPath(normalized);
    if (!filePath) return res.status(400).json({ error: 'Ugyldig filsti' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Filen finnes ikke på server' });
    return res.download(filePath, path.basename(filePath));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/photo/:id/download', requireAdmin, (req, res) => {
  try {
    const score = db.prepare('SELECT photo_path FROM scores WHERE id=?').get(req.params.id);
    if (!score?.photo_path) return res.status(404).json({ error: 'Bilde ikke funnet' });
    const normalized = normalizePhotoPath(score.photo_path);
    if (!normalized.startsWith('/uploads/')) return res.status(400).json({ error: 'Kan ikke laste ned eksternt bilde' });
    const filePath = getUploadFsPath(normalized);
    if (!filePath) return res.status(400).json({ error: 'Ugyldig filsti' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Filen finnes ikke på server' });
    return res.download(filePath, path.basename(filePath));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/gallery/:id', requireAdmin, (req, res) => {
  try {
    const photo = db.prepare('SELECT photo_path FROM gallery_photos WHERE id=?').get(req.params.id);
    if (photo) {
      const filePath = getUploadFsPath(photo.photo_path);
      if (!filePath) return res.status(400).json({ error: 'Ugyldig filsti' });
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

// ── Courses ──────────────────────────────────────────────────────────────────

app.get('/api/admin/courses', requireAdmin, (req, res) => {
  try {
    const courses = db.prepare('SELECT * FROM courses ORDER BY name ASC').all();
    res.json({ courses });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/course', requireAdmin, (req, res) => {
  const { name, slope_rating, location, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Banenavn er påkrevd' });
  try {
    const result = db.prepare(
      'INSERT INTO courses (name, slope_rating, location, notes) VALUES (?,?,?,?)'
    ).run(name, parseInt(slope_rating)||113, location||'', notes||'');
    res.json({ success: true, id: result.lastInsertRowid });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/course/:id', requireAdmin, (req, res) => {
  const { name, slope_rating, location, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Banenavn er påkrevd' });
  try {
    db.prepare('UPDATE courses SET name=?, slope_rating=?, location=?, notes=? WHERE id=?')
      .run(name, parseInt(slope_rating)||113, location||'', notes||'', req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/course/:id', requireAdmin, (req, res) => {
  try {
    db.prepare('DELETE FROM course_holes WHERE course_id=?').run(req.params.id);
    db.prepare('DELETE FROM courses WHERE id=?').run(req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/course/:id/holes', requireAdmin, (req, res) => {
  try {
    let holes = db.prepare('SELECT * FROM course_holes WHERE course_id=? ORDER BY hole_number').all(req.params.id);
    // If no template saved yet, return default 18 holes
    if (!holes.length) {
      holes = Array.from({ length: 18 }, (_, i) => ({
        course_id: parseInt(req.params.id), hole_number: i + 1,
        par: 4, requires_photo: 0, is_longest_drive: 0, is_closest_to_pin: 0
      }));
    }
    res.json({ holes });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/course/:id/holes', requireAdmin, (req, res) => {
  const { holes } = req.body;
  const courseId = req.params.id;
  try {
    const upsert = db.prepare(
      `INSERT INTO course_holes (course_id, hole_number, par, requires_photo, is_longest_drive, is_closest_to_pin, stroke_index)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(course_id, hole_number) DO UPDATE SET
         par=excluded.par, requires_photo=excluded.requires_photo,
         is_longest_drive=excluded.is_longest_drive, is_closest_to_pin=excluded.is_closest_to_pin,
         stroke_index=excluded.stroke_index`
    );
    const saveAll = db.transaction(() => {
      for (const h of holes) {
        upsert.run(courseId, h.hole_number, h.par, h.requires_photo ? 1 : 0, h.is_longest_drive ? 1 : 0, h.is_closest_to_pin ? 1 : 0, h.stroke_index || 0);
      }
    });
    saveAll();
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
  const dir = path.join(uploadsDir, 'legacy');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const legacyUpload = multer({
    storage: multer.diskStorage({
      destination: dir,
      filename: (req, file, cb) => cb(null, `legacy-${legacyId}-${Date.now()}${path.extname(file.originalname)}`)
    }),
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (isAllowedImageUpload(file)) return cb(null, true);
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

app.put('/api/admin/legacy/:id/photo-focus', requireAdmin, (req, res) => {
  try {
    const focus = req.body.focus || '50% 50%';
    db.prepare('UPDATE legacy SET winner_photo_focus=? WHERE id=?').run(focus, req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/legacy/:id', requireAdmin, (req, res) => {
  try {
    db.prepare('DELETE FROM legacy WHERE id=?').run(req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Delete photo from score ───────────────────────────────────────────────────
app.delete('/api/admin/photo/:id', requireAdmin, (req, res) => {
  try {
    const score = db.prepare('SELECT photo_path FROM scores WHERE id=?').get(req.params.id);
    if (score && score.photo_path) {
      const filePath = getUploadFsPath(score.photo_path);
      if (!filePath) return res.status(400).json({ error: 'Ugyldig filsti' });
      if (fs.existsSync(filePath)) { try { fs.unlinkSync(filePath); } catch(_) {} }
    }
    db.prepare('UPDATE scores SET photo_path=NULL WHERE id=?').run(req.params.id);
    db.prepare('DELETE FROM gallery_photos WHERE caption=?').run(`score:${req.params.id}`);
    broadcast('score_updated', {});
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/photo/:id/publish', requireAdmin, (req, res) => {
  try {
    const isPublished = req.body?.is_published ? 1 : 0;
    db.prepare('UPDATE scores SET is_published=? WHERE id=?').run(isPublished, req.params.id);
    res.json({ success: true, is_published: !!isPublished });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Coin back image ───────────────────────────────────────────────────────────
app.get('/api/coin-back', (req, res) => {
  try {
    const active = db.prepare(
      `SELECT photo_path, focal_point
       FROM coin_back_images
       WHERE is_active=1
       ORDER BY created_at DESC, id DESC
       LIMIT 1`
    ).get();

    if (active?.photo_path) {
      return res.json({
        photo_path: normalizePhotoPath(active.photo_path),
        focal_point: active.focal_point || '50% 50%'
      });
    }
  } catch (_) {}

  const configPath = path.join(uploadsDir, 'coin-back.json');
  if (fs.existsSync(configPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return res.json({
        photo_path: normalizePhotoPath(data.photo_path || ''),
        focal_point: data.focal_point || '50% 50%'
      });
    } catch (_) {}
  }
  res.json({ photo_path: null, focal_point: '50% 50%' });
});

app.put('/api/admin/coin-back/focus', requireAdmin, (req, res) => {
  try {
    const focalPoint = req.body.focal_point || '50% 50%';
    const active = db.prepare(
      `SELECT id FROM coin_back_images
       WHERE is_active=1
       ORDER BY created_at DESC, id DESC
       LIMIT 1`
    ).get();

    if (active?.id) {
      db.prepare('UPDATE coin_back_images SET focal_point=? WHERE id=?').run(focalPoint, active.id);
    }

    const configPath = path.join(uploadsDir, 'coin-back.json');
    let data = {};
    if (fs.existsSync(configPath)) data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    data.focal_point = focalPoint;
    fs.writeFileSync(configPath, JSON.stringify(data));
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/coin-back', requireAdmin, (req, res) => {
  const dir = path.join(uploadsDir, 'coin');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const coinUpload = multer({
    storage: multer.diskStorage({
      destination: dir,
      filename: (req, file, cb) => cb(null, `back${path.extname(file.originalname)}`)
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (isAllowedImageUpload(file)) return cb(null, true);
      cb(new Error('Kun bilder er tillatt'));
    }
  }).single('photo');
  coinUpload(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Ingen fil lastet opp' });
    const photoPath = `/uploads/coin/${req.file.filename}`;
    const existingFocus = db.prepare(
      `SELECT focal_point FROM coin_back_images
       WHERE is_active=1
       ORDER BY created_at DESC, id DESC
       LIMIT 1`
    ).get()?.focal_point || '50% 50%';

    const tx = db.transaction(() => {
      db.prepare('UPDATE coin_back_images SET is_active=0 WHERE is_active=1').run();
      db.prepare(
        'INSERT INTO coin_back_images (photo_path, focal_point, is_active) VALUES (?,?,1)'
      ).run(photoPath, existingFocus);
    });
    tx();

    fs.writeFileSync(
      path.join(uploadsDir, 'coin-back.json'),
      JSON.stringify({ photo_path: photoPath, focal_point: existingFocus })
    );
    res.json({ success: true, photo_path: normalizePhotoPath(photoPath), focal_point: existingFocus });
  });
});

// ── Instagram QR code ─────────────────────────────────────────────────────────
app.get('/api/instagram-qr', (req, res) => {
  try {
    const QRCode = require('qrcode');
    const url = 'https://www.instagram.com/lorgeninvitational';
    QRCode.toBuffer(url, { type: 'png', width: 200, margin: 1, color: { dark: '#0D1B2A', light: '#FFFFFF' } }, (err, buf) => {
      if (err) return res.status(500).end();
      res.set('Content-Type', 'image/png');
      res.set('Cache-Control', 'public, max-age=86400');
      res.send(buf);
    });
  } catch(e) { res.status(500).end(); }
});

// ── Clean URL routing ────────────────────────────────────────────────────────
['gameday', 'scoreboard', 'legacy', 'enter-score', 'admin', 'gallery'].forEach(p => {
  app.get(`/${p}`, (req, res) => res.sendFile(path.join(__dirname, `public/${p}.html`)));
});

if (require.main === module) {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`
  ╔══════════════════════════════════════╗
  ║   LORGEN INVITATIONAL                ║
  ║   Server running on port ${PORT}         ║
  ╚══════════════════════════════════════╝
  `);
  });

  function shutdown(signal) {
    console.log(`Mottok ${signal}. Stopper server...`);
    server.close(() => {
      console.log('Server stoppet.');
      process.exit(0);
    });
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = app;
