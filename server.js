require('dotenv').config();
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const db      = require('./database');
const { normalizeTournamentFormat, getFormatDefinition } = require('./lib/tournament-formats');

const app  = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'LorgenAdmin2025';
const TOURNAMENT_STATUSES = ['draft', 'published', 'live', 'paused', 'completed', 'archived'];

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
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads', { recursive: true });
if (!fs.existsSync('./uploads/glimtskudd')) fs.mkdirSync('./uploads/glimtskudd', { recursive: true });
if (!fs.existsSync('./uploads/chat')) fs.mkdirSync('./uploads/chat', { recursive: true });
if (!fs.existsSync('./data/sessions')) fs.mkdirSync('./data/sessions', { recursive: true });

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
    if (isAllowedImageUpload(file)) return cb(null, true);
    cb(new Error('Kun bilder er tillatt'));
  }
});

const galleryStorage = multer.diskStorage({
  destination: './uploads/glimtskudd/',
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
  destination: './uploads/chat/',
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
app.use('/uploads', express.static('uploads', { fallthrough: true }));
app.use(express.static('public', {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
    if (filePath.endsWith('service-worker.js') || filePath.endsWith('manifest.webmanifest')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));
let sessionStore;
try {
  sessionStore = new FileStore({ path: './data/sessions', ttl: 86400, retries: 0, logFn: () => {} });
} catch(_) {
  sessionStore = undefined; // falls back to MemoryStore
}
app.use(session({
  ...(sessionStore ? { store: sessionStore } : {}),
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

// ── Platform health checks ──────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/ready', (req, res) => {
  res.status(200).json({ status: 'ready' });
});

// ── Helpers ──────────────────────────────────────────────────────────────────
function getSetting(key) {
  const row = db.prepare('SELECT value FROM site_settings WHERE key=? LIMIT 1').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare(
    `INSERT INTO site_settings (key, value, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`
  ).run(key, value === undefined ? null : value);
}

function getActiveTournamentId() {
  const activeTournamentId = parseInt(getSetting('activeTournamentId') || '', 10);
  return Number.isFinite(activeTournamentId) ? activeTournamentId : null;
}

function getActiveTournament() {
  const activeTournamentId = getActiveTournamentId();
  if (!activeTournamentId) return null;
  const tournament = getTournamentById(activeTournamentId);
  if (!tournament) return null;
  if (tournament.status === 'archived') return null;
  return tournament;
}

const CONTROL_DEFAULTS = {
  scoringOpen: false,
  scoringLocked: false,
  scorecardsOpen: false,
  leaderboardVisible: false,
  resultsPublished: false,
  showAudienceFeed: true,
  showSponsors: true,
  tournamentStatus: 'draft'
};

function getControlSettings() {
  const parseBool = (key, fallback) => {
    const raw = getSetting(key);
    if (raw === null || raw === undefined || raw === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
  };
  const statusRaw = String(getSetting('tournamentStatus') || CONTROL_DEFAULTS.tournamentStatus).toLowerCase();
  const tournamentStatus = TOURNAMENT_STATUSES.includes(statusRaw)
    ? statusRaw
    : CONTROL_DEFAULTS.tournamentStatus;
  return {
    scoringOpen: parseBool('scoringOpen', CONTROL_DEFAULTS.scoringOpen),
    scoringLocked: parseBool('scoringLocked', CONTROL_DEFAULTS.scoringLocked),
    scorecardsOpen: parseBool('scorecardsOpen', CONTROL_DEFAULTS.scorecardsOpen),
    leaderboardVisible: parseBool('leaderboardVisible', CONTROL_DEFAULTS.leaderboardVisible),
    resultsPublished: parseBool('resultsPublished', CONTROL_DEFAULTS.resultsPublished),
    showAudienceFeed: parseBool('showAudienceFeed', CONTROL_DEFAULTS.showAudienceFeed),
    showSponsors: parseBool('showSponsors', CONTROL_DEFAULTS.showSponsors),
    tournamentStatus
  };
}

function setControlSettings(next = {}) {
  const current = getControlSettings();
  const merged = { ...current, ...next };
  const normalizedStatus = TOURNAMENT_STATUSES.includes(String(merged.tournamentStatus || '').toLowerCase())
    ? String(merged.tournamentStatus).toLowerCase()
    : CONTROL_DEFAULTS.tournamentStatus;
  setSetting('scoringOpen', merged.scoringOpen ? '1' : '0');
  setSetting('scoringLocked', merged.scoringLocked ? '1' : '0');
  setSetting('scorecardsOpen', merged.scorecardsOpen ? '1' : '0');
  setSetting('leaderboardVisible', merged.leaderboardVisible ? '1' : '0');
  setSetting('resultsPublished', merged.resultsPublished ? '1' : '0');
  setSetting('showAudienceFeed', merged.showAudienceFeed ? '1' : '0');
  setSetting('showSponsors', merged.showSponsors ? '1' : '0');
  setSetting('tournamentStatus', normalizedStatus);

  const activeId = getActiveTournamentId();
  if (activeId) {
    db.prepare(
      `UPDATE tournaments
       SET status=?, results_published=?, scoring_locked=?, archived_at=CASE WHEN ?='archived' THEN COALESCE(archived_at, CURRENT_TIMESTAMP) ELSE archived_at END, updated_at=CURRENT_TIMESTAMP
       WHERE id=?`
    ).run(normalizedStatus, merged.resultsPublished ? 1 : 0, merged.scoringLocked ? 1 : 0, normalizedStatus, activeId);
    if (normalizedStatus === 'archived') setSetting('activeTournamentId', null);
  }

  return getControlSettings();
}

function safeJsonParse(raw, fallback = null) {
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch (_) { return fallback; }
}

function getStagesByTournament(tournamentId) {
  return db.prepare(
    `SELECT * FROM tournament_stages WHERE tournament_id=? ORDER BY stage_order ASC, id ASC`
  ).all(tournamentId).map((stage) => {
    const format = normalizeTournamentFormat(stage.format);
    return { ...stage, format, format_label: getFormatDefinition(format).label, settings: safeJsonParse(stage.settings, null) };
  });
}

function getActiveStage(tournamentId, tournament = null) {
  const t = tournament || db.prepare('SELECT * FROM tournaments WHERE id=? LIMIT 1').get(tournamentId);
  if (!t) return null;
  const stages = getStagesByTournament(tournamentId);
  if (!stages.length) return null;
  if (t.active_stage_id) {
    const explicit = stages.find((stage) => stage.id === t.active_stage_id);
    if (explicit) return explicit;
  }
  if ((t.tournament_mode || 'single_format') === 'single_format' && stages.length === 1) return stages[0];
  return stages.find((stage) => stage.is_active) || stages[0];
}

function getTournamentSides(tournamentId) {
  return db.prepare('SELECT * FROM tournament_sides WHERE tournament_id=? ORDER BY side_order ASC, id ASC').all(tournamentId);
}

function getStageMatches(stageId) {
  return db.prepare(
    `SELECT m.*, sa.name AS side_a_name, sb.name AS side_b_name, ws.name AS winner_side_name
     FROM stage_matches m
     LEFT JOIN tournament_sides sa ON sa.id=m.side_a_id
     LEFT JOIN tournament_sides sb ON sb.id=m.side_b_id
     LEFT JOIN tournament_sides ws ON ws.id=m.winner_side_id
     WHERE m.stage_id=?
     ORDER BY m.match_order ASC, m.id ASC`
  ).all(stageId).map((match) => ({
    ...match,
    lineup_a: safeJsonParse(match.lineup_a, []),
    lineup_b: safeJsonParse(match.lineup_b, [])
  }));
}


function getTournamentPlayers(tournamentId) {
  return db.prepare(
    `SELECT p.*, s.name AS side_name
     FROM players p
     LEFT JOIN tournament_sides s ON s.id=p.team_id
     WHERE p.tournament_id=?
     ORDER BY p.active DESC, p.name COLLATE NOCASE ASC, p.id ASC`
  ).all(tournamentId);
}

function getStagePairings(stageId) {
  const stage = db.prepare('SELECT id, tournament_id FROM tournament_stages WHERE id=? LIMIT 1').get(stageId);
  if (!stage) return [];
  const players = getTournamentPlayers(stage.tournament_id);
  const playerMap = new Map(players.map((pl) => [pl.id, pl]));
  return db.prepare(
    `SELECT sp.*, ts.name AS side_name
     FROM stage_pairings sp
     LEFT JOIN tournament_sides ts ON ts.id=sp.team_id
     WHERE sp.stage_id=?
     ORDER BY sp.pairing_order ASC, sp.id ASC`
  ).all(stageId).map((pairing) => {
    const ids = safeJsonParse(pairing.player_ids, []) || [];
    const pairingPlayers = ids.map((id) => playerMap.get(id)).filter(Boolean);
    return {
      ...pairing,
      player_ids: ids,
      players: pairingPlayers,
      label: pairingPlayers.length ? pairingPlayers.map((pl) => pl.name).join(' + ') : 'TBD'
    };
  });
}

function getStagePairingMatches(stageId) {
  const pairings = getStagePairings(stageId);
  const pairingMap = new Map(pairings.map((p) => [p.id, p]));
  return db.prepare(
    `SELECT m.*
     FROM stage_pairing_matches m
     WHERE m.stage_id=?
     ORDER BY m.match_order ASC, m.id ASC`
  ).all(stageId).map((match) => ({
    ...match,
    pairing_a: pairingMap.get(match.pairing_a_id) || null,
    pairing_b: pairingMap.get(match.pairing_b_id) || null,
    winner_pairing: pairingMap.get(match.winner_pairing_id) || null
  }));
}

function buildCupStandings(matches = [], sides = []) {
  const sideTotals = {};
  sides.forEach((side) => {
    sideTotals[side.id] = { sideId: side.id, name: side.name, points: 0, matchesWon: 0, matchesHalved: 0 };
  });
  let completedMatches = 0;
  let inProgressMatches = 0;
  matches.forEach((m) => {
    if (sideTotals[m.side_a_id]) sideTotals[m.side_a_id].points += Number(m.points_awarded_a || 0);
    if (sideTotals[m.side_b_id]) sideTotals[m.side_b_id].points += Number(m.points_awarded_b || 0);
    if (m.status === 'completed') completedMatches += 1;
    if (m.status === 'in_progress') inProgressMatches += 1;
    if (m.is_halved) {
      if (sideTotals[m.side_a_id]) sideTotals[m.side_a_id].matchesHalved += 1;
      if (sideTotals[m.side_b_id]) sideTotals[m.side_b_id].matchesHalved += 1;
    } else if (m.winner_side_id && sideTotals[m.winner_side_id]) {
      sideTotals[m.winner_side_id].matchesWon += 1;
    }
  });
  return {
    totals: Object.values(sideTotals),
    completedMatches,
    inProgressMatches,
    totalMatches: matches.length
  };
}

function getActiveTournamentAndStage() {
  const tournament = getActiveTournament();
  if (!tournament) return { tournament: null, stage: null, stages: [] };
  const stages = getStagesByTournament(tournament.id);
  const stage = getActiveStage(tournament.id, tournament);
  return { tournament, stage, stages };
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
  const t = getActiveTournament();
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

function buildScoreboard(tournament, activeStage = null) {
  const effectiveFormat = activeStage?.format || tournament.format;
  const formatKey = normalizeTournamentFormat(effectiveFormat);
  const formatDef = getFormatDefinition(formatKey);
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
    const stablefordPoints = teamScores.reduce((sum, sc) => {
      const h = holes.find(x => x.hole_number === sc.hole_number);
      if (!h) return sum;
      const diff = sc.score - h.par;
      const pts = diff <= -3 ? 5 : diff === -2 ? 4 : diff === -1 ? 3 : diff === 0 ? 2 : diff === 1 ? 1 : 0;
      return sum + pts;
    }, 0);
    return {
      team_id: team.id, team_name: team.team_name,
      player1: team.player1, player2: team.player2,
      player1_handicap: team.player1_handicap || 0, player2_handicap: team.player2_handicap || 0,
      handicap: courseHcp, used_handicap_strokes: usedHandicapStrokes, net_score: netScore, net_to_par: netToPar,
      total_score: total, total_par: par, to_par: total - par, stableford_points: stablefordPoints,
      holes_completed: done, hole_scores: holeScores
    };
  });

  const hasHandicaps = teams.some(t => (t.player1_handicap || 0) + (t.player2_handicap || 0) > 0);
  scoreboard.sort((a, b) => {
    if (a.holes_completed === 0 && b.holes_completed === 0) return 0;
    if (a.holes_completed === 0) return 1;
    if (b.holes_completed === 0) return -1;
    if (formatKey === 'stableford') {
      const ap = (a.stableford_points || 0);
      const bp = (b.stableford_points || 0);
      if (bp !== ap) return bp - ap;
      return a.total_score - b.total_score;
    }
    if (formatKey === 'matchplay') {
      return a.team_name.localeCompare(b.team_name, 'nb');
    }
    return hasHandicaps ? (a.net_to_par - b.net_to_par) : (a.to_par - b.to_par);
  });

  return { tournament: { ...tournament, format: formatKey, format_label: formatDef.label }, activeStage, scoreboard, holes, awards };
}



function normalizeTournamentStatus(status) {
  const normalized = String(status || '').toLowerCase();
  return TOURNAMENT_STATUSES.includes(normalized) ? normalized : 'draft';
}

function resolveTournamentControl(tournament = null) {
  const control = getControlSettings();
  if (!tournament) return { ...control, scoringLocked: Boolean(control.scoringLocked) };
  return {
    ...control,
    resultsPublished: Boolean(tournament.results_published),
    scoringLocked: Boolean(tournament.scoring_locked),
    tournamentStatus: normalizeTournamentStatus(tournament.status)
  };
}

function getTournamentById(tournamentId) {
  const t = db.prepare('SELECT * FROM tournaments WHERE id=? LIMIT 1').get(tournamentId);
  if (!t) return null;
  const normalizedFormat = normalizeTournamentFormat(t.format);
  return {
    ...t,
    status: normalizeTournamentStatus(t.status),
    results_published: Number(t.results_published || 0),
    scoring_locked: Number(t.scoring_locked || 0),
    format: normalizedFormat,
    tournament_mode: t.tournament_mode || 'single_format',
    format_label: getFormatDefinition(normalizedFormat).label
  };
}

function getArchivedTournaments() {
  return db.prepare("SELECT * FROM tournaments WHERE status IN ('completed','archived') ORDER BY year DESC, date DESC, id DESC").all()
    .map((t) => getTournamentById(t.id));
}

function getCompletedTournaments() {
  return db.prepare("SELECT * FROM tournaments WHERE status='completed' ORDER BY year DESC, date DESC, id DESC").all()
    .map((t) => getTournamentById(t.id));
}

function getTournamentResults(tournamentId) {
  const tournament = getTournamentById(tournamentId);
  if (!tournament) return null;
  const stages = getStagesByTournament(tournament.id);
  const activeStage = getActiveStage(tournament.id, tournament);
  const isPublished = Boolean(tournament.results_published);

  if ((tournament.tournament_mode || 'single_format') === 'ryder_cup') {
    const sides = getTournamentSides(tournament.id);
    const matchesByStage = stages.map((stage) => ({
      ...stage,
      matches: getStageMatches(stage.id)
    }));
    const allMatches = matchesByStage.flatMap((stage) => stage.matches);
    const cup = buildCupStandings(allMatches, sides);
    const sortedTotals = [...(cup.totals || [])].sort((a, b) => b.points - a.points);
    const winner = sortedTotals[0] || null;
    return { tournament, isPublished, stages: matchesByStage, activeStage, cup, winner, sides, mode: 'ryder_cup' };
  }

  const base = buildScoreboard(tournament, activeStage);
  const podium = (base.scoreboard || []).slice(0, 3);
  return {
    tournament,
    isPublished,
    stages: stages.map((stage) => ({ ...stage, pairings: getStagePairings(stage.id), pairingMatches: getStagePairingMatches(stage.id) })),
    activeStage,
    mode: tournament.tournament_mode || 'single_format',
    ...base,
    podium,
    winner: podium[0] || null
  };
}

function getHallOfFameEntries() {
  return getArchivedTournaments()
    .filter((t) => t.results_published)
    .map((t) => {
      const result = getTournamentResults(t.id);
      if (!result) return null;
      if (result.mode === 'ryder_cup') {
        return {
          tournamentId: t.id,
          year: t.year,
          tournamentName: t.name,
          format: t.format,
          tournamentMode: t.tournament_mode,
          winnerLabel: result.winner?.name || 'Ingen vinner',
          winnerType: 'side',
          scoreLabel: result.winner ? `${result.winner.points} poeng` : '—'
        };
      }
      const winner = result.winner;
      return {
        tournamentId: t.id,
        year: t.year,
        tournamentName: t.name,
        format: t.format,
        tournamentMode: t.tournament_mode,
        winnerLabel: winner ? winner.team_name : 'Ingen vinner',
        winnerType: 'team',
        playerLabel: winner ? `${winner.player1} & ${winner.player2}` : '',
        scoreLabel: winner ? String(winner.total_score ?? '—') : '—',
        toPar: winner ? winner.to_par : null
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.year - a.year);
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

app.get('/api/active-tournament', (req, res) => {
  try {
    const { tournament, stage, stages } = getActiveTournamentAndStage();
    res.json({ tournament, activeStage: stage, stages });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/active-tournament-stage', (req, res) => {
  try {
    const { tournament, stage, stages } = getActiveTournamentAndStage();
    res.json({ tournament, stage, stages, control: getControlSettings() });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/control-state', (req, res) => {
  try {
    const { tournament, stage } = getActiveTournamentAndStage();
    res.json({ control: getControlSettings(), tournament, activeStage: stage });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/sponsors', (req, res) => {
  try {
    let control = getControlSettings();
    if (!control.showSponsors) return res.json({ sponsors: [] });
    const placement = String(req.query.placement || 'home');
    if (!['home', 'hole'].includes(placement)) {
      return res.status(400).json({ error: 'Ugyldig sponsor-plassering' });
    }

    const tournamentId = getActiveTournamentId();
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
    let control = getControlSettings();
    const ctx = getActiveTournamentAndStage();
    const t = ctx.tournament;
    if (!t) return res.json({ scoreboard: [], holes: [], awards: [], tournament: null, activeStage: null, stages: [] });
    control = resolveTournamentControl(t);
    if (!control.leaderboardVisible) {
      return res.json({
        hidden: true,
        message: 'Leaderboard er ikke publisert ennå.',
        mode: t.tournament_mode || 'single_format',
        tournament: t,
        activeStage: ctx.stage,
        stages: ctx.stages,
        control
      });
    }

    if ((t.tournament_mode || 'single_format') === 'ryder_cup') {
      const sides = getTournamentSides(t.id);
      const stage = ctx.stage;
      if (!stage) {
        return res.json({
          mode: 'ryder_cup',
          tournament: t,
          activeStage: null,
          stages: ctx.stages,
          sides,
          matches: [],
          cup: buildCupStandings([], sides),
          message: 'Ingen aktiv stage valgt ennå.'
        });
      }
      const stageMatches = getStageMatches(stage.id);
      const allMatches = ctx.stages.flatMap((st) => getStageMatches(st.id));
      const cup = buildCupStandings(allMatches, sides);
      return res.json({
        mode: 'ryder_cup',
        tournament: t,
        activeStage: stage,
        stages: ctx.stages,
        sides,
        matches: stageMatches,
        cup,
        control
      });
    }

    const base = buildScoreboard(t, ctx.stage);
    const stagePairings = ctx.stage ? getStagePairings(ctx.stage.id) : [];
    const stagePairingMatches = ctx.stage ? getStagePairingMatches(ctx.stage.id) : [];
    res.json({ ...base, mode: t.tournament_mode || 'single_format', stages: ctx.stages, pairings: stagePairings, pairingMatches: stagePairingMatches, control });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/legacy', (req, res) => {
  try {
    const entries = getHallOfFameEntries();
    const legacy = entries.map((entry) => ({
      id: entry.tournamentId,
      year: entry.year,
      winner_team: entry.winnerLabel,
      player1: entry.playerLabel ? entry.playerLabel.split(' & ')[0] : '',
      player2: entry.playerLabel ? entry.playerLabel.split(' & ')[1] || '' : '',
      score: entry.scoreLabel || '',
      score_to_par: entry.toPar === 0 ? 'E' : (entry.toPar > 0 ? `+${entry.toPar}` : `${entry.toPar || ''}`),
      course: '',
      notes: `${entry.tournamentName} (${entry.format})`,
      winner_photo: null,
      winner_photo_focus: null
    }));
    res.json({ legacy });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


app.get('/api/historikk', (req, res) => {
  try {
    const tournaments = getArchivedTournaments().map((t) => {
      const result = getTournamentResults(t.id);
      return {
        ...t,
        resultsPublished: Boolean(t.results_published),
        archivedAt: t.archived_at || null,
        winner: result?.winner || null,
        podium: result?.podium || []
      };
    });
    res.json({ tournaments });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/historikk/:id', (req, res) => {
  try {
    const result = getTournamentResults(req.params.id);
    if (!result) return res.status(404).json({ error: 'Turnering ikke funnet' });
    if (!result.isPublished) {
      return res.json({
        tournament: result.tournament,
        isPublished: false,
        message: 'Sluttresultater er ikke publisert for denne turneringen.'
      });
    }
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/hall-of-fame', (req, res) => {
  try {
    const entries = getHallOfFameEntries();
    res.json({ entries });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
    if (!getControlSettings().showAudienceFeed) return res.json({ messages: [], disabled: true });
    const t = getActiveTournament();
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
  if (!getControlSettings().showAudienceFeed) return res.status(403).json({ error: 'Publikumsfeed er deaktivert akkurat nå.' });
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
  if (!getControlSettings().showAudienceFeed) return res.status(403).json({ error: 'Publikumsfeed er deaktivert akkurat nå.' });
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
    let control = getControlSettings();
    if (!control.scorecardsOpen) return res.status(403).json({ error: 'Scorekort er ikke åpne akkurat nå.' });
    if (control.scoringLocked) return res.status(403).json({ error: 'Scoring er låst av administrator.' });
    const team       = db.prepare('SELECT * FROM teams WHERE id=?').get(req.session.teamId);
    const tournament = db.prepare('SELECT id,name,slope_rating FROM tournaments WHERE id=?').get(req.session.tournamentId);
    const holes      = db.prepare('SELECT * FROM holes WHERE tournament_id=? ORDER BY hole_number').all(req.session.tournamentId);
    const scoresRaw  = db.prepare('SELECT * FROM scores WHERE team_id=?').all(req.session.teamId);
    const scores     = scoresRaw.map(s => ({ ...s, photo_path: normalizePhotoPath(s.photo_path) }));
    const claims     = db.prepare('SELECT * FROM award_claims WHERE tournament_id=? AND team_id=?').all(req.session.tournamentId, req.session.teamId);
    const holeSponsors = getSponsorsForTournament(req.session.tournamentId, 'hole').filter(s => s.is_enabled);
    res.json({ team: { ...team, locked: team.locked || 0 }, tournament, holes, scores, claims, hole_sponsors: holeSponsors, control });
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
    let control = getControlSettings();
    if (!control.scorecardsOpen) return res.status(403).json({ error: 'Scorekort er ikke åpne akkurat nå.' });
    if (control.scoringLocked) return res.status(403).json({ error: 'Scoring er låst av administrator.' });
    if (!control.scoringOpen) return res.status(403).json({ error: 'Scoring er ikke åpen akkurat nå.' });
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
    let control = getControlSettings();
    if (!control.scorecardsOpen) return res.status(403).json({ error: 'Scorekort er ikke åpne akkurat nå.' });
    if (control.scoringLocked) return res.status(403).json({ error: 'Scoring er låst av administrator.' });
    const hole = db.prepare('SELECT * FROM holes WHERE tournament_id=? AND hole_number=?').get(tid, holeNum);
    if (!hole) return res.status(404).json({ error: 'Hull ikke funnet' });
    const uploadDir = `./uploads/admin/t${tid}/scoreboard/h${holeNum}`;
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
    const activeTournamentId = parseInt(getSetting('activeTournamentId') || '', 10);
    const tournaments = db.prepare('SELECT * FROM tournaments ORDER BY year DESC').all()
      .map(t => {
        const format = normalizeTournamentFormat(t.format);
        return { ...t, status: normalizeTournamentStatus(t.status), format, format_label: getFormatDefinition(format).label, is_active: Number.isFinite(activeTournamentId) && t.id === activeTournamentId };
      });
    res.json({ tournaments, activeTournamentId: Number.isFinite(activeTournamentId) ? activeTournamentId : null });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/control-panel', requireAdmin, (req, res) => {
  try {
    let control = getControlSettings();
    const activeTournamentId = getActiveTournamentId();
    const tournaments = db.prepare('SELECT * FROM tournaments ORDER BY year DESC, id DESC').all()
      .map((t) => ({ ...t, status: normalizeTournamentStatus(t.status), format: normalizeTournamentFormat(t.format), format_label: getFormatDefinition(normalizeTournamentFormat(t.format)).label }));
    const tournament = activeTournamentId
      ? tournaments.find((t) => t.id === activeTournamentId) || null
      : null;
    const stages = tournament ? getStagesByTournament(tournament.id) : [];
    const activeStage = tournament ? getActiveStage(tournament.id, tournament) : null;

    let totalScoreEntries = 0;
    let totalAudienceComments = 0;
    let totalMatches = 0;
    let completedMatches = 0;
    let liveMatches = 0;

    if (tournament) {
      totalScoreEntries = db.prepare(
        `SELECT COUNT(*) AS cnt
         FROM scores s
         JOIN teams tm ON tm.id=s.team_id
         WHERE tm.tournament_id=?`
      ).get(tournament.id)?.cnt || 0;
      totalAudienceComments = db.prepare('SELECT COUNT(*) AS cnt FROM chat_messages WHERE tournament_id=?').get(tournament.id)?.cnt || 0;

      if (activeStage) {
        totalMatches = db.prepare('SELECT COUNT(*) AS cnt FROM stage_matches WHERE stage_id=?').get(activeStage.id)?.cnt || 0;
        completedMatches = db.prepare("SELECT COUNT(*) AS cnt FROM stage_matches WHERE stage_id=? AND status='completed'").get(activeStage.id)?.cnt || 0;
        liveMatches = db.prepare("SELECT COUNT(*) AS cnt FROM stage_matches WHERE stage_id=? AND status='in_progress'").get(activeStage.id)?.cnt || 0;
      }
    }

    if (tournament) control = resolveTournamentControl(tournament);

    const cup = tournament && tournament.tournament_mode === 'ryder_cup'
      ? buildCupStandings(stages.flatMap((st) => getStageMatches(st.id)), getTournamentSides(tournament.id))
      : null;

    res.json({
      control,
      activeTournamentId,
      tournament,
      tournaments,
      stages,
      activeStage,
      stats: {
        totalScoreEntries,
        totalAudienceComments,
        totalMatches,
        completedMatches,
        liveMatches
      },
      cup
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/control-panel', requireAdmin, (req, res) => {
  try {
    const body = req.body || {};
    const next = {};
    ['scoringOpen', 'scoringLocked', 'scorecardsOpen', 'leaderboardVisible', 'resultsPublished', 'showAudienceFeed', 'showSponsors'].forEach((key) => {
      if (body[key] !== undefined) next[key] = Boolean(body[key]);
    });
    if (body.tournamentStatus !== undefined) next.tournamentStatus = String(body.tournamentStatus || '').toLowerCase();
    const control = setControlSettings(next);
    broadcast('control_updated', control);
    res.json({ success: true, control });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/control-panel/quick-action', requireAdmin, (req, res) => {
  try {
    const action = String(req.body?.action || '');
    const actions = {
      start_tournament: { tournamentStatus: 'live', scorecardsOpen: true, scoringOpen: true, leaderboardVisible: true },
      pause_tournament: { tournamentStatus: 'paused', scoringOpen: false },
      resume_tournament: { tournamentStatus: 'live', scoringOpen: true },
      complete_tournament: { tournamentStatus: 'completed', scoringOpen: false, scorecardsOpen: false, scoringLocked: true, resultsPublished: true },
      open_scoring: { scoringOpen: true, scorecardsOpen: true },
      close_scoring: { scoringOpen: false },
      lock_scoring: { scoringLocked: true, scoringOpen: false },
      unlock_scoring: { scoringLocked: false },
      publish_leaderboard: { leaderboardVisible: true },
      hide_leaderboard: { leaderboardVisible: false },
      publish_results: { resultsPublished: true },
      hide_results: { resultsPublished: false },
      pause_live_views: { leaderboardVisible: false, showAudienceFeed: false },
      reset_live_views: { leaderboardVisible: false, resultsPublished: false, showAudienceFeed: false }
    };
    const update = actions[action];
    if (!update) return res.status(400).json({ error: 'Ugyldig quick action' });
    const control = setControlSettings(update);
    broadcast('control_updated', control);
    res.json({ success: true, action, control });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/tournament', requireAdmin, (req, res) => {
  const { name, year, description, format, status, startDate, endDate, date, course, gameday_info, slope_rating, tournamentMode } = req.body;
  const resolvedStartDate = startDate || date;
  if (!resolvedStartDate) return res.status(400).json({ error: 'Startdato er påkrevd' });
  const parsedYear = parseInt(year, 10) || new Date(resolvedStartDate).getFullYear();
  if (!Number.isFinite(parsedYear)) return res.status(400).json({ error: 'Ugyldig år' });
  const resolvedName = (name || 'Lorgen Invitational').trim() || 'Lorgen Invitational';
  try {
    const result = db.prepare(
      `INSERT INTO tournaments (year, name, date, start_date, end_date, format, course, description, gameday_info, status, slope_rating, tournament_mode, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`
    ).run(parsedYear, resolvedName, resolvedStartDate, resolvedStartDate, endDate || resolvedStartDate, normalizeTournamentFormat(format), course||'', description||'', gameday_info||'', normalizeTournamentStatus(status), slope_rating||113, tournamentMode || 'single_format');
    const tid = result.lastInsertRowid;
    const insertHole = db.prepare('INSERT INTO holes (tournament_id, hole_number, par, requires_photo) VALUES (?,?,4,0)');
    const insertAllHoles = db.transaction(() => {
      for (let i = 1; i <= 18; i++) insertHole.run(tid, i);
    });
    insertAllHoles();
    const stageResult = db.prepare(
      `INSERT INTO tournament_stages (tournament_id, name, stage_order, date, format, status, is_published, is_active, leaderboard_type, updated_at)
       VALUES (?, ?, 1, ?, ?, 'published', 1, 1, ?, CURRENT_TIMESTAMP)`
    ).run(tid, 'Dag 1', resolvedStartDate, normalizeTournamentFormat(format), (tournamentMode === 'ryder_cup' ? 'cup' : 'individual'));
    db.prepare('UPDATE tournaments SET active_stage_id=? WHERE id=?').run(stageResult.lastInsertRowid, tid);
    res.json({ success: true, id: tid });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/tournament/:id', requireAdmin, (req, res) => {
  const { name, year, description, format, status, startDate, endDate, date, course, gameday_info, slope_rating, tournamentMode } = req.body;
  const resolvedStartDate = startDate || date;
  if (!resolvedStartDate) return res.status(400).json({ error: 'Startdato er påkrevd' });
  const parsedYear = parseInt(year, 10) || new Date(resolvedStartDate).getFullYear();
  if (!Number.isFinite(parsedYear)) return res.status(400).json({ error: 'Ugyldig år' });
  const resolvedName = (name || 'Lorgen Invitational').trim() || 'Lorgen Invitational';
  try {
    db.prepare(
      `UPDATE tournaments
       SET year=?, name=?, date=?, start_date=?, end_date=?, format=?, course=?, description=?, gameday_info=?, status=?, slope_rating=?, tournament_mode=?, updated_at=CURRENT_TIMESTAMP
       WHERE id=?`
    ).run(parsedYear, resolvedName, resolvedStartDate, resolvedStartDate, endDate || resolvedStartDate, normalizeTournamentFormat(format), course||'', description||'', gameday_info||'', normalizeTournamentStatus(status), slope_rating||113, tournamentMode || 'single_format', req.params.id);
    const existingStage = db.prepare('SELECT id FROM tournament_stages WHERE tournament_id=? LIMIT 1').get(req.params.id);
    if (!existingStage) {
      const stageResult = db.prepare(
        `INSERT INTO tournament_stages (tournament_id, name, stage_order, date, format, status, is_published, is_active, leaderboard_type, updated_at)
         VALUES (?, ?, 1, ?, ?, 'published', 1, 1, ?, CURRENT_TIMESTAMP)`
      ).run(req.params.id, 'Dag 1', resolvedStartDate, normalizeTournamentFormat(format), (tournamentMode === 'ryder_cup' ? 'cup' : 'individual'));
      db.prepare('UPDATE tournaments SET active_stage_id=? WHERE id=?').run(stageResult.lastInsertRowid, req.params.id);
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


app.post('/api/admin/tournament/:id/lifecycle', requireAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const action = String(req.body?.action || '');
    const tournament = db.prepare('SELECT * FROM tournaments WHERE id=? LIMIT 1').get(id);
    if (!tournament) return res.status(404).json({ error: 'Turnering ikke funnet' });

    if (action === 'publish_results') {
      db.prepare("UPDATE tournaments SET results_published=1, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
      return res.json({ success: true });
    }
    if (action === 'hide_results') {
      db.prepare("UPDATE tournaments SET results_published=0, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
      return res.json({ success: true });
    }
    if (action === 'lock_scoring') {
      db.prepare("UPDATE tournaments SET scoring_locked=1, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
      return res.json({ success: true });
    }
    if (action === 'unlock_scoring') {
      db.prepare("UPDATE tournaments SET scoring_locked=0, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
      return res.json({ success: true });
    }
    if (action === 'complete') {
      db.prepare("UPDATE tournaments SET status='completed', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
      if (getActiveTournamentId() === id) {
        setControlSettings({ tournamentStatus: 'completed', scoringOpen: false, scorecardsOpen: false, scoringLocked: true, resultsPublished: true });
      }
      return res.json({ success: true });
    }
    if (action === 'archive') {
      db.prepare("UPDATE tournaments SET status='archived', archived_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
      if (getActiveTournamentId() === id) {
        setSetting('activeTournamentId', null);
      }
      return res.json({ success: true });
    }

    return res.status(400).json({ error: 'Ugyldig handling' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/tournament/:id/slope', requireAdmin, (req, res) => {
  try {
    db.prepare('UPDATE tournaments SET slope_rating=? WHERE id=?').run(parseInt(req.body.slope_rating)||113, req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});



app.get('/api/admin/tournament/:id/stages', requireAdmin, (req, res) => {
  try {
    const stages = getStagesByTournament(req.params.id);
    const tournament = db.prepare('SELECT id, active_stage_id, tournament_mode FROM tournaments WHERE id=?').get(req.params.id);
    res.json({ stages, activeStageId: tournament?.active_stage_id || null, tournamentMode: tournament?.tournament_mode || 'single_format' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/tournament/:id/stages', requireAdmin, (req, res) => {
  try {
    const tournamentId = parseInt(req.params.id, 10);
    const { name, order, date, format, status, leaderboardType, settings } = req.body || {};
    const row = db.prepare(
      `INSERT INTO tournament_stages (tournament_id, name, stage_order, date, format, status, is_published, leaderboard_type, settings, updated_at)
       VALUES (?,?,?,?,?,?,?, ?, ?, CURRENT_TIMESTAMP)`
    ).run(tournamentId, name || 'Ny stage', parseInt(order, 10) || 1, date || null, normalizeTournamentFormat(format), normalizeTournamentStatus(status), status === 'published' ? 1 : 0, leaderboardType || 'individual', settings ? JSON.stringify(settings) : null);
    const tournament = db.prepare('SELECT active_stage_id FROM tournaments WHERE id=?').get(tournamentId);
    if (!tournament?.active_stage_id) db.prepare('UPDATE tournaments SET active_stage_id=? WHERE id=?').run(row.lastInsertRowid, tournamentId);
    res.json({ success: true, id: row.lastInsertRowid });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/stage/:id', requireAdmin, (req, res) => {
  try {
    const { name, order, date, format, status, leaderboardType, settings } = req.body || {};
    db.prepare(
      `UPDATE tournament_stages
       SET name=?, stage_order=?, date=?, format=?, status=?, is_published=?, leaderboard_type=?, settings=?, updated_at=CURRENT_TIMESTAMP
       WHERE id=?`
    ).run(name || 'Stage', parseInt(order, 10) || 1, date || null, normalizeTournamentFormat(format), normalizeTournamentStatus(status), status === 'published' ? 1 : 0, leaderboardType || 'individual', settings ? JSON.stringify(settings) : null, req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/stage/:id', requireAdmin, (req, res) => {
  try {
    const stage = db.prepare('SELECT id, tournament_id FROM tournament_stages WHERE id=?').get(req.params.id);
    if (!stage) return res.status(404).json({ error: 'Stage finnes ikke' });
    const count = db.prepare('SELECT COUNT(*) as c FROM tournament_stages WHERE tournament_id=?').get(stage.tournament_id);
    if ((count?.c || 0) <= 1) return res.status(400).json({ error: 'Kan ikke slette eneste stage' });
    db.prepare('DELETE FROM tournament_stages WHERE id=?').run(req.params.id);
    const active = db.prepare('SELECT active_stage_id FROM tournaments WHERE id=?').get(stage.tournament_id);
    if (active?.active_stage_id === Number(req.params.id)) {
      const fallback = db.prepare('SELECT id FROM tournament_stages WHERE tournament_id=? ORDER BY stage_order ASC, id ASC LIMIT 1').get(stage.tournament_id);
      db.prepare('UPDATE tournaments SET active_stage_id=? WHERE id=?').run(fallback?.id || null, stage.tournament_id);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/tournament/:id/active-stage/:stageId', requireAdmin, (req, res) => {
  try {
    const stage = db.prepare('SELECT id FROM tournament_stages WHERE id=? AND tournament_id=?').get(req.params.stageId, req.params.id);
    if (!stage) return res.status(404).json({ error: 'Stage finnes ikke for turneringen' });
    db.prepare('UPDATE tournaments SET active_stage_id=? WHERE id=?').run(req.params.stageId, req.params.id);
    res.json({ success: true, activeStageId: Number(req.params.stageId) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/tournament/:id/sides', requireAdmin, (req, res) => {
  try { res.json({ sides: getTournamentSides(req.params.id) }); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/tournament/:id/sides', requireAdmin, (req, res) => {
  try {
    const { name, shortName, color, logo, order } = req.body || {};
    const row = db.prepare(
      `INSERT INTO tournament_sides (tournament_id, name, short_name, color, logo, side_order, updated_at)
       VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)`
    ).run(req.params.id, name || 'Nytt lag', shortName || '', color || '', logo || '', parseInt(order, 10) || 1);
    res.json({ success: true, id: row.lastInsertRowid });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/side/:id', requireAdmin, (req, res) => {
  try {
    const { name, shortName, color, logo, order } = req.body || {};
    db.prepare('UPDATE tournament_sides SET name=?, short_name=?, color=?, logo=?, side_order=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .run(name || 'Lag', shortName || '', color || '', logo || '', parseInt(order, 10) || 1, req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/side/:id', requireAdmin, (req, res) => {
  try { db.prepare('DELETE FROM tournament_sides WHERE id=?').run(req.params.id); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/stage/:id/matches', requireAdmin, (req, res) => {
  try { res.json({ matches: getStageMatches(req.params.id) }); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/stage/:id/match', requireAdmin, (req, res) => {
  try {
    const { sideAId, sideBId, teamAId, teamBId, lineupA, lineupB, format, order, teeTime, status } = req.body || {};
    const row = db.prepare(
      `INSERT INTO stage_matches (stage_id, side_a_id, side_b_id, team_a_id, team_b_id, lineup_a, lineup_b, format, match_order, tee_time, status, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`
    ).run(req.params.id, sideAId, sideBId, teamAId || null, teamBId || null, JSON.stringify(lineupA || []), JSON.stringify(lineupB || []), normalizeTournamentFormat(format || 'matchplay'), parseInt(order, 10) || 1, teeTime || null, status || 'scheduled');
    res.json({ success: true, id: row.lastInsertRowid });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/match/:id', requireAdmin, (req, res) => {
  try {
    const { winnerSideId, isHalved, pointsAwardedA, pointsAwardedB, resultText, status } = req.body || {};
    db.prepare(
      `UPDATE stage_matches
       SET winner_side_id=?, is_halved=?, points_awarded_a=?, points_awarded_b=?, result_text=?, status=?, updated_at=CURRENT_TIMESTAMP
       WHERE id=?`
    ).run(winnerSideId || null, isHalved ? 1 : 0, Number(pointsAwardedA || 0), Number(pointsAwardedB || 0), resultText || '', status || 'completed', req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/match/:id', requireAdmin, (req, res) => {
  try { db.prepare('DELETE FROM stage_matches WHERE id=?').run(req.params.id); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); }
});


app.get('/api/admin/tournament/:id/players', requireAdmin, (req, res) => {
  try {
    res.json({ players: getTournamentPlayers(req.params.id) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/tournament/:id/players', requireAdmin, (req, res) => {
  try {
    const { name, handicap, teamId, active } = req.body || {};
    if (!String(name || '').trim()) return res.status(400).json({ error: 'Navn er påkrevd' });
    const row = db.prepare(
      `INSERT INTO players (tournament_id, name, handicap, team_id, active, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ).run(req.params.id, String(name).trim(), handicap === '' || handicap === null || handicap === undefined ? null : Number(handicap), teamId || null, active === 0 ? 0 : 1);
    res.json({ success: true, id: row.lastInsertRowid });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/player/:id', requireAdmin, (req, res) => {
  try {
    const { name, handicap, teamId, active } = req.body || {};
    if (!String(name || '').trim()) return res.status(400).json({ error: 'Navn er påkrevd' });
    db.prepare(
      `UPDATE players SET name=?, handicap=?, team_id=?, active=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
    ).run(String(name).trim(), handicap === '' || handicap === null || handicap === undefined ? null : Number(handicap), teamId || null, active === 0 ? 0 : 1, req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/player/:id', requireAdmin, (req, res) => {
  try { db.prepare('DELETE FROM players WHERE id=?').run(req.params.id); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/stage/:id/pairings', requireAdmin, (req, res) => {
  try { res.json({ pairings: getStagePairings(req.params.id) }); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/stage/:id/pairing', requireAdmin, (req, res) => {
  try {
    const { teamId, playerIds, order, teeTime } = req.body || {};
    const ids = Array.isArray(playerIds) ? playerIds.map((id) => Number(id)).filter(Number.isFinite) : [];
    if (!ids.length) return res.status(400).json({ error: 'Velg minst én spiller' });
    if (ids.length > 4) return res.status(400).json({ error: 'Maks 4 spillere per pairing' });
    const row = db.prepare(
      `INSERT INTO stage_pairings (stage_id, team_id, player_ids, pairing_order, tee_time, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ).run(req.params.id, teamId || null, JSON.stringify(ids), parseInt(order, 10) || 1, teeTime || null);
    res.json({ success: true, id: row.lastInsertRowid });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/pairing/:id', requireAdmin, (req, res) => {
  try {
    const { teamId, playerIds, order, teeTime } = req.body || {};
    const ids = Array.isArray(playerIds) ? playerIds.map((id) => Number(id)).filter(Number.isFinite) : [];
    if (!ids.length) return res.status(400).json({ error: 'Velg minst én spiller' });
    if (ids.length > 4) return res.status(400).json({ error: 'Maks 4 spillere per pairing' });
    db.prepare(
      `UPDATE stage_pairings
       SET team_id=?, player_ids=?, pairing_order=?, tee_time=?, updated_at=CURRENT_TIMESTAMP
       WHERE id=?`
    ).run(teamId || null, JSON.stringify(ids), parseInt(order, 10) || 1, teeTime || null, req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/pairing/:id', requireAdmin, (req, res) => {
  try { db.prepare('DELETE FROM stage_pairings WHERE id=?').run(req.params.id); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/stage/:id/pairings/auto-generate', requireAdmin, (req, res) => {
  try {
    const stage = db.prepare('SELECT * FROM tournament_stages WHERE id=? LIMIT 1').get(req.params.id);
    if (!stage) return res.status(404).json({ error: 'Stage ikke funnet' });
    const { size, randomize } = req.body || {};
    const pairSize = [1,2,4].includes(Number(size)) ? Number(size) : 2;
    const players = getTournamentPlayers(stage.tournament_id).filter((p) => p.active);
    const ordered = [...players];
    if (randomize !== false) {
      for (let i = ordered.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
      }
    }
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM stage_pairings WHERE stage_id=?').run(stage.id);
      const insert = db.prepare('INSERT INTO stage_pairings (stage_id, team_id, player_ids, pairing_order, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)');
      let order = 1;
      for (let i = 0; i < ordered.length; i += pairSize) {
        const chunk = ordered.slice(i, i + pairSize);
        const firstTeam = chunk[0]?.team_id || null;
        insert.run(stage.id, firstTeam, JSON.stringify(chunk.map((c) => c.id)), order++);
      }
    });
    tx();
    res.json({ success: true, pairings: getStagePairings(stage.id) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/stage/:id/pairing-matches', requireAdmin, (req, res) => {
  try { res.json({ matches: getStagePairingMatches(req.params.id) }); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/stage/:id/pairing-match', requireAdmin, (req, res) => {
  try {
    const { pairingAId, pairingBId, format, order, teeTime, status } = req.body || {};
    if (!pairingAId) return res.status(400).json({ error: 'Pairing A er påkrevd' });
    const row = db.prepare(
      `INSERT INTO stage_pairing_matches (stage_id, pairing_a_id, pairing_b_id, format, match_order, tee_time, status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ).run(req.params.id, pairingAId, pairingBId || null, normalizeTournamentFormat(format || 'matchplay'), parseInt(order, 10) || 1, teeTime || null, status || 'scheduled');
    res.json({ success: true, id: row.lastInsertRowid });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/pairing-match/:id', requireAdmin, (req, res) => {
  try {
    const { pairingAId, pairingBId, format, order, teeTime, status, winnerPairingId, resultText } = req.body || {};
    db.prepare(
      `UPDATE stage_pairing_matches
       SET pairing_a_id=?, pairing_b_id=?, format=?, match_order=?, tee_time=?, status=?, winner_pairing_id=?, result_text=?, updated_at=CURRENT_TIMESTAMP
       WHERE id=?`
    ).run(pairingAId, pairingBId || null, normalizeTournamentFormat(format || 'matchplay'), parseInt(order, 10) || 1, teeTime || null, status || 'scheduled', winnerPairingId || null, resultText || '', req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/pairing-match/:id', requireAdmin, (req, res) => {
  try { db.prepare('DELETE FROM stage_pairing_matches WHERE id=?').run(req.params.id); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); }
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
  const uploadDir = `./uploads/admin/t${tournamentId}/sponsors`;
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

app.put('/api/admin/active-tournament/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Ugyldig turnerings-ID' });
  try {
    const existing = db.prepare('SELECT id, status FROM tournaments WHERE id=?').get(id);
    if (!existing) return res.status(404).json({ error: 'Turnering ikke funnet' });
    if (normalizeTournamentStatus(existing.status) === 'archived') return res.status(400).json({ error: 'Arkiverte turneringer kan ikke settes som aktiv turnering' });
    setSetting('activeTournamentId', String(id));
    res.json({ success: true, activeTournamentId: id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/active-tournament', requireAdmin, (req, res) => {
  try {
    setSetting('activeTournamentId', null);
    res.json({ success: true, activeTournamentId: null });
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
    const activeTournamentId = parseInt(getSetting('activeTournamentId') || '', 10);
    if (Number.isFinite(activeTournamentId) && activeTournamentId === parseInt(id, 10)) {
      setSetting('activeTournamentId', null);
    }
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
    const t = getActiveTournament();
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

    const photos = collectPhotosForTournament(t.id);

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
    const t = getActiveTournament();
    if (!t) return res.status(404).json({ error: 'Ingen aktiv turnering' });
    const photoTournament = getTournamentForPhotoRef(photo_ref);
    if (!photoTournament || photoTournament.id !== t.id) {
      return res.status(400).json({ error: 'Bildet tilhører ikke aktiv turnering' });
    }
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
    const filePath = path.join(__dirname, normalized.replace(/^\//, ''));
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
    const filePath = path.join(__dirname, normalized.replace(/^\//, ''));
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Filen finnes ikke på server' });
    return res.download(filePath, path.basename(filePath));
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
  const dir = './uploads/legacy';
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
      const filePath = path.join(__dirname, score.photo_path.replace(/^\//, ''));
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
  const configPath = path.join(__dirname, 'uploads', 'coin-back.json');
  if (fs.existsSync(configPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return res.json({ photo_path: data.photo_path || null, focal_point: data.focal_point || null });
    } catch(_) {}
  }
  res.json({ photo_path: null, focal_point: null });
});

app.put('/api/admin/coin-back/focus', requireAdmin, (req, res) => {
  const configPath = path.join(__dirname, 'uploads', 'coin-back.json');
  try {
    let data = {};
    if (fs.existsSync(configPath)) data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    data.focal_point = req.body.focal_point || '50% 50%';
    fs.writeFileSync(configPath, JSON.stringify(data));
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/coin-back', requireAdmin, (req, res) => {
  const dir = './uploads/coin';
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
    fs.writeFileSync(path.join(__dirname, 'uploads', 'coin-back.json'), JSON.stringify({ photo_path: photoPath }));
    res.json({ success: true, photo_path: photoPath });
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
['gameday', 'scoreboard', 'legacy', 'historikk', 'enter-score', 'admin', 'gallery'].forEach(p => {
  app.get(`/${p}`, (req, res) => res.sendFile(path.join(__dirname, `public/${p}.html`)));
});
app.get('/historikk/:id', (req, res) => res.sendFile(path.join(__dirname, 'public/historikk-detail.html')));
app.get('/admin/control-panel', (req, res) => res.sendFile(path.join(__dirname, 'public/control-panel.html')));
app.get('/admin-dashboard', (req, res) => res.redirect('/admin/control-panel'));

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
