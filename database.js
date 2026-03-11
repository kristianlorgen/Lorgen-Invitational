const Database = require('better-sqlite3');
const fs = require('fs');
const { normalizeTournamentFormat } = require('./lib/tournament-formats');

if (!fs.existsSync('./data')) {
  fs.mkdirSync('./data', { recursive: true });
}

const db = new Database('./data/tournament.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS tournaments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    year INTEGER NOT NULL,
    name TEXT NOT NULL,
    date TEXT NOT NULL,
    start_date TEXT,
    end_date TEXT,
    format TEXT DEFAULT 'strokeplay',
    format_settings TEXT,
    course TEXT DEFAULT '',
    description TEXT DEFAULT '',
    gameday_info TEXT DEFAULT '',
    status TEXT DEFAULT 'draft',
    results_published INTEGER NOT NULL DEFAULT 0,
    scoring_locked INTEGER NOT NULL DEFAULT 0,
    archived_at DATETIME,
    tournament_mode TEXT DEFAULT 'single_format',
    active_stage_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tournament_stages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    stage_order INTEGER NOT NULL DEFAULT 1,
    date TEXT,
    format TEXT DEFAULT 'strokeplay',
    status TEXT DEFAULT 'draft',
    is_published INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 0,
    leaderboard_type TEXT DEFAULT 'individual',
    settings TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS tournament_sides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    short_name TEXT DEFAULT '',
    color TEXT DEFAULT '',
    logo TEXT DEFAULT '',
    side_order INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    handicap REAL,
    team_id INTEGER,
    active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
    FOREIGN KEY (team_id) REFERENCES tournament_sides(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS stage_pairings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stage_id INTEGER NOT NULL,
    team_id INTEGER,
    player_ids TEXT NOT NULL,
    pairing_order INTEGER NOT NULL DEFAULT 1,
    tee_time TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (stage_id) REFERENCES tournament_stages(id) ON DELETE CASCADE,
    FOREIGN KEY (team_id) REFERENCES tournament_sides(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS stage_pairing_matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stage_id INTEGER NOT NULL,
    pairing_a_id INTEGER NOT NULL,
    pairing_b_id INTEGER,
    format TEXT DEFAULT 'matchplay',
    match_order INTEGER NOT NULL DEFAULT 1,
    tee_time TEXT,
    status TEXT DEFAULT 'scheduled',
    winner_pairing_id INTEGER,
    result_text TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (stage_id) REFERENCES tournament_stages(id) ON DELETE CASCADE,
    FOREIGN KEY (pairing_a_id) REFERENCES stage_pairings(id) ON DELETE CASCADE,
    FOREIGN KEY (pairing_b_id) REFERENCES stage_pairings(id) ON DELETE SET NULL,
    FOREIGN KEY (winner_pairing_id) REFERENCES stage_pairings(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS stage_matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stage_id INTEGER NOT NULL,
    side_a_id INTEGER NOT NULL,
    side_b_id INTEGER NOT NULL,
    team_a_id INTEGER,
    team_b_id INTEGER,
    lineup_a TEXT,
    lineup_b TEXT,
    format TEXT DEFAULT 'matchplay',
    match_order INTEGER NOT NULL DEFAULT 1,
    tee_time TEXT,
    status TEXT DEFAULT 'scheduled',
    winner_side_id INTEGER,
    result_text TEXT DEFAULT '',
    points_awarded_a REAL NOT NULL DEFAULT 0,
    points_awarded_b REAL NOT NULL DEFAULT 0,
    is_halved INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (stage_id) REFERENCES tournament_stages(id) ON DELETE CASCADE,
    FOREIGN KEY (side_a_id) REFERENCES tournament_sides(id) ON DELETE CASCADE,
    FOREIGN KEY (side_b_id) REFERENCES tournament_sides(id) ON DELETE CASCADE,
    FOREIGN KEY (winner_side_id) REFERENCES tournament_sides(id) ON DELETE SET NULL,
    FOREIGN KEY (team_a_id) REFERENCES teams(id) ON DELETE SET NULL,
    FOREIGN KEY (team_b_id) REFERENCES teams(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS site_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS holes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL,
    hole_number INTEGER NOT NULL,
    par INTEGER NOT NULL DEFAULT 4,
    requires_photo INTEGER DEFAULT 0,
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id),
    UNIQUE(tournament_id, hole_number)
  );

  CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL,
    team_name TEXT NOT NULL,
    player1 TEXT NOT NULL,
    player2 TEXT NOT NULL,
    pin_code TEXT NOT NULL,
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id)
  );

  CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL,
    hole_number INTEGER NOT NULL,
    score INTEGER NOT NULL DEFAULT 0,
    photo_path TEXT,
    is_published INTEGER NOT NULL DEFAULT 1,
    submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES teams(id),
    UNIQUE(team_id, hole_number)
  );

  CREATE TABLE IF NOT EXISTS awards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL,
    award_type TEXT NOT NULL,
    team_id INTEGER,
    player_name TEXT DEFAULT '',
    hole_number INTEGER,
    detail TEXT DEFAULT '',
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id),
    FOREIGN KEY (team_id) REFERENCES teams(id),
    UNIQUE(tournament_id, award_type, hole_number)
  );

  CREATE TABLE IF NOT EXISTS award_claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL,
    team_id INTEGER NOT NULL,
    hole_number INTEGER NOT NULL,
    award_type TEXT NOT NULL,
    player_name TEXT DEFAULT '',
    detail TEXT DEFAULT '',
    claimed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id),
    FOREIGN KEY (team_id) REFERENCES teams(id),
    UNIQUE(tournament_id, team_id, hole_number, award_type)
  );

  CREATE TABLE IF NOT EXISTS legacy (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    year INTEGER NOT NULL,
    winner_team TEXT NOT NULL,
    player1 TEXT NOT NULL,
    player2 TEXT NOT NULL,
    score TEXT DEFAULT '',
    score_to_par TEXT DEFAULT '',
    course TEXT DEFAULT '',
    notes TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slope_rating INTEGER NOT NULL DEFAULT 113,
    location TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS course_holes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id INTEGER NOT NULL,
    hole_number INTEGER NOT NULL,
    par INTEGER NOT NULL DEFAULT 4,
    requires_photo INTEGER DEFAULT 0,
    is_longest_drive INTEGER DEFAULT 0,
    is_closest_to_pin INTEGER DEFAULT 0,
    FOREIGN KEY (course_id) REFERENCES courses(id),
    UNIQUE(course_id, hole_number)
  );

  CREATE TABLE IF NOT EXISTS gallery_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL,
    photo_path TEXT NOT NULL,
    caption TEXT DEFAULT '',
    is_published INTEGER NOT NULL DEFAULT 1,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id)
  );


  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL,
    team_id INTEGER NOT NULL,
    team_name TEXT NOT NULL,
    message TEXT NOT NULL,
    image_path TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id),
    FOREIGN KEY (team_id) REFERENCES teams(id)
  );

  CREATE TABLE IF NOT EXISTS photo_votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL,
    photo_ref TEXT NOT NULL,
    voter_ip TEXT NOT NULL,
    voted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tournament_id, photo_ref, voter_ip)
  );

  CREATE TABLE IF NOT EXISTS sponsors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL,
    placement TEXT NOT NULL,
    slot_key TEXT NOT NULL,
    spot_number INTEGER,
    hole_number INTEGER,
    sponsor_name TEXT DEFAULT '',
    description TEXT DEFAULT '',
    logo_path TEXT DEFAULT '',
    is_enabled INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id),
    UNIQUE(tournament_id, placement, slot_key)
  );
`);

// Migrate existing databases
try { db.exec(`ALTER TABLE tournaments ADD COLUMN gameday_info TEXT DEFAULT ''`); } catch(_) {}
try { db.exec(`ALTER TABLE holes ADD COLUMN is_longest_drive INTEGER DEFAULT 0`); } catch(_) {}
try { db.exec(`ALTER TABLE holes ADD COLUMN is_closest_to_pin INTEGER DEFAULT 0`); } catch(_) {}
try { db.exec(`ALTER TABLE awards ADD COLUMN player_name TEXT DEFAULT ''`); } catch(_) {}
try { db.exec(`ALTER TABLE legacy ADD COLUMN winner_photo TEXT DEFAULT ''`); } catch(_) {}
try { db.exec(`ALTER TABLE legacy ADD COLUMN winner_photo_focus TEXT DEFAULT ''`); } catch(_) {}
try { db.exec(`ALTER TABLE teams ADD COLUMN locked INTEGER DEFAULT 0`); } catch(_) {}
try { db.exec(`ALTER TABLE tournaments ADD COLUMN slope_rating INTEGER DEFAULT 113`); } catch(_) {}
try { db.exec(`ALTER TABLE tournaments ADD COLUMN start_date TEXT`); } catch(_) {}
try { db.exec(`ALTER TABLE tournaments ADD COLUMN end_date TEXT`); } catch(_) {}
try { db.exec(`ALTER TABLE tournaments ADD COLUMN format TEXT DEFAULT 'strokeplay'`); } catch(_) {}
try { db.exec(`ALTER TABLE tournaments ADD COLUMN format_settings TEXT`); } catch(_) {}
try { db.exec(`ALTER TABLE tournaments ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP`); } catch(_) {}
try { db.exec(`ALTER TABLE tournaments ADD COLUMN tournament_mode TEXT DEFAULT 'single_format'`); } catch(_) {}
try { db.exec(`ALTER TABLE tournaments ADD COLUMN active_stage_id INTEGER`); } catch(_) {}

try { db.exec(`ALTER TABLE tournaments ADD COLUMN results_published INTEGER NOT NULL DEFAULT 0`); } catch(_) {}
try { db.exec(`ALTER TABLE tournaments ADD COLUMN scoring_locked INTEGER NOT NULL DEFAULT 0`); } catch(_) {}
try { db.exec(`ALTER TABLE tournaments ADD COLUMN archived_at DATETIME`); } catch(_) {}
try { db.exec(`UPDATE tournaments SET status='draft' WHERE status IS NULL OR TRIM(status)=''`); } catch(_) {}
try { db.exec(`UPDATE tournaments SET status='published' WHERE LOWER(status)='upcoming'`); } catch(_) {}
try { db.exec(`UPDATE tournaments SET status='live' WHERE LOWER(status)='active'`); } catch(_) {}
try { db.exec(`ALTER TABLE teams ADD COLUMN player1_handicap REAL DEFAULT 0`); } catch(_) {}
try { db.exec(`ALTER TABLE teams ADD COLUMN player2_handicap REAL DEFAULT 0`); } catch(_) {}
try { db.exec(`ALTER TABLE holes ADD COLUMN stroke_index INTEGER DEFAULT 0`); } catch(_) {}
try { db.exec(`ALTER TABLE course_holes ADD COLUMN stroke_index INTEGER DEFAULT 0`); } catch(_) {}
try { db.exec(`ALTER TABLE scores ADD COLUMN is_published INTEGER NOT NULL DEFAULT 1`); } catch(_) {}
try { db.exec(`UPDATE scores SET is_published=1 WHERE is_published IS NULL`); } catch(_) {}
try { db.exec(`ALTER TABLE gallery_photos ADD COLUMN is_published INTEGER NOT NULL DEFAULT 1`); } catch(_) {}
try { db.exec(`UPDATE gallery_photos SET is_published=1 WHERE is_published IS NULL`); } catch(_) {}
try { db.exec(`ALTER TABLE chat_messages ADD COLUMN image_path TEXT DEFAULT ''`); } catch(_) {}
try { db.exec(`CREATE TABLE IF NOT EXISTS photo_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL,
  photo_ref TEXT NOT NULL,
  voter_ip TEXT NOT NULL,
  voted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tournament_id, photo_ref, voter_ip)
)`); } catch(_) {}
try { db.exec(`CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`); } catch(_) {}
try { db.exec(`CREATE TABLE IF NOT EXISTS tournament_stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  stage_order INTEGER NOT NULL DEFAULT 1,
  date TEXT,
  format TEXT DEFAULT 'strokeplay',
  status TEXT DEFAULT 'draft',
  is_published INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 0,
  leaderboard_type TEXT DEFAULT 'individual',
  settings TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
)`); } catch(_) {}
try { db.exec(`CREATE TABLE IF NOT EXISTS tournament_sides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  short_name TEXT DEFAULT '',
  color TEXT DEFAULT '',
  logo TEXT DEFAULT '',
  side_order INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
)`); } catch(_) {}
try { db.exec(`CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  handicap REAL,
  team_id INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
  FOREIGN KEY (team_id) REFERENCES tournament_sides(id) ON DELETE SET NULL
)`); } catch(_) {}
try { db.exec(`CREATE TABLE IF NOT EXISTS stage_pairings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stage_id INTEGER NOT NULL,
  team_id INTEGER,
  player_ids TEXT NOT NULL,
  pairing_order INTEGER NOT NULL DEFAULT 1,
  tee_time TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (stage_id) REFERENCES tournament_stages(id) ON DELETE CASCADE,
  FOREIGN KEY (team_id) REFERENCES tournament_sides(id) ON DELETE SET NULL
)`); } catch(_) {}
try { db.exec(`CREATE TABLE IF NOT EXISTS stage_pairing_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stage_id INTEGER NOT NULL,
  pairing_a_id INTEGER NOT NULL,
  pairing_b_id INTEGER,
  format TEXT DEFAULT 'matchplay',
  match_order INTEGER NOT NULL DEFAULT 1,
  tee_time TEXT,
  status TEXT DEFAULT 'scheduled',
  winner_pairing_id INTEGER,
  result_text TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (stage_id) REFERENCES tournament_stages(id) ON DELETE CASCADE,
  FOREIGN KEY (pairing_a_id) REFERENCES stage_pairings(id) ON DELETE CASCADE,
  FOREIGN KEY (pairing_b_id) REFERENCES stage_pairings(id) ON DELETE SET NULL,
  FOREIGN KEY (winner_pairing_id) REFERENCES stage_pairings(id) ON DELETE SET NULL
)`); } catch(_) {}
try { db.exec(`CREATE TABLE IF NOT EXISTS stage_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stage_id INTEGER NOT NULL,
  side_a_id INTEGER NOT NULL,
  side_b_id INTEGER NOT NULL,
  team_a_id INTEGER,
  team_b_id INTEGER,
  lineup_a TEXT,
  lineup_b TEXT,
  format TEXT DEFAULT 'matchplay',
  match_order INTEGER NOT NULL DEFAULT 1,
  tee_time TEXT,
  status TEXT DEFAULT 'scheduled',
  winner_side_id INTEGER,
  result_text TEXT DEFAULT '',
  points_awarded_a REAL NOT NULL DEFAULT 0,
  points_awarded_b REAL NOT NULL DEFAULT 0,
  is_halved INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (stage_id) REFERENCES tournament_stages(id) ON DELETE CASCADE,
  FOREIGN KEY (side_a_id) REFERENCES tournament_sides(id) ON DELETE CASCADE,
  FOREIGN KEY (side_b_id) REFERENCES tournament_sides(id) ON DELETE CASCADE,
  FOREIGN KEY (winner_side_id) REFERENCES tournament_sides(id) ON DELETE SET NULL,
  FOREIGN KEY (team_a_id) REFERENCES teams(id) ON DELETE SET NULL,
  FOREIGN KEY (team_b_id) REFERENCES teams(id) ON DELETE SET NULL
)`); } catch(_) {}


try {
  const tournaments = db.prepare('SELECT id, format FROM tournaments').all();
  const updateFormat = db.prepare('UPDATE tournaments SET format=? WHERE id=?');
  tournaments.forEach((t) => {
    const normalized = normalizeTournamentFormat(t.format);
    if ((t.format || '').trim().toLowerCase() !== normalized) {
      updateFormat.run(normalized, t.id);
    }
  });
} catch (_) {}

try {
  const tournaments = db.prepare('SELECT id, name, date, format FROM tournaments').all();
  const selectStages = db.prepare('SELECT id FROM tournament_stages WHERE tournament_id=? LIMIT 1');
  const insertStage = db.prepare(
    `INSERT INTO tournament_stages (tournament_id, name, stage_order, date, format, status, is_published, is_active, leaderboard_type, updated_at)
     VALUES (?, ?, 1, ?, ?, 'published', 1, 1, 'individual', CURRENT_TIMESTAMP)`
  );
  const updateTournament = db.prepare('UPDATE tournaments SET active_stage_id=COALESCE(active_stage_id, ?), tournament_mode=COALESCE(tournament_mode, ?) WHERE id=?');
  tournaments.forEach((t) => {
    const existing = selectStages.get(t.id);
    const stageName = t.name ? `${t.name} – Dag 1` : 'Dag 1';
    const stageId = existing ? existing.id : insertStage.run(t.id, stageName, t.date || null, normalizeTournamentFormat(t.format)).lastInsertRowid;
    updateTournament.run(stageId, 'single_format', t.id);
  });
} catch (_) {}

const existingActiveTournamentSetting = db.prepare("SELECT value FROM site_settings WHERE key='activeTournamentId' LIMIT 1").get();
if (!existingActiveTournamentSetting) {
  const fallback = db.prepare("SELECT id FROM tournaments WHERE status IN ('live','published','draft','paused','completed') ORDER BY date DESC LIMIT 1").get()
    || null;
  db.prepare(
    "INSERT INTO site_settings (key, value, updated_at) VALUES ('activeTournamentId', ?, CURRENT_TIMESTAMP)"
  ).run(fallback ? String(fallback.id) : null);
}

module.exports = db;

try { db.exec(`CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL,
  team_id INTEGER NOT NULL,
  team_name TEXT NOT NULL,
  message TEXT NOT NULL,
  image_path TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`); } catch(_) {}
