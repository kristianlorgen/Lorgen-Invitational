const fs = require('fs');
const path = require('path');

function createDatabase(dbPath) {
  const preferredDriver = (process.env.LORGEN_SQLITE_DRIVER || 'auto').toLowerCase();
  const tryBetterSqlite3 = preferredDriver === 'auto' || preferredDriver === 'better-sqlite3';
  const tryNodeSqlite = preferredDriver === 'auto' || preferredDriver === 'node:sqlite';

  if (tryBetterSqlite3) {
    try {
      const BetterSqlite3 = require('better-sqlite3');
      const db = new BetterSqlite3(dbPath);
      db.__driver = 'better-sqlite3';
      return db;
    } catch (error) {
      if (!isModuleLoadError(error)) throw error;
    }
  }

  if (tryNodeSqlite) {
    try {
      // Node.js >= 22 includes a built-in synchronous sqlite driver.
      const sqlite = require('node:sqlite');
      const DatabaseSync = sqlite.DatabaseSync || (sqlite.default && sqlite.default.DatabaseSync);
      if (!DatabaseSync) {
        throw new Error('DatabaseSync not available in node:sqlite');
      }
      const db = new DatabaseSync(dbPath);
      const wrapped = wrapNodeSqliteDatabase(db);
      wrapped.__driver = 'node:sqlite';
      return wrapped;
    } catch (error) {
      if (!isModuleLoadError(error)) throw error;
    }
  }

  throw new Error(
    'Unable to initialize SQLite driver. Install better-sqlite3 (Node 20.x) or run on Node.js 22+ with node:sqlite available.'
  );
}

function isModuleLoadError(error) {
  return error && (
    error.code === 'MODULE_NOT_FOUND' ||
    error.code === 'ERR_UNKNOWN_BUILTIN_MODULE' ||
    /Cannot find module/.test(error.message)
  );
}

function wrapNodeSqliteDatabase(db) {
  return {
    exec(sql) {
      return db.exec(sql);
    },
    prepare(sql) {
      const statement = db.prepare(sql);
      return {
        run(...params) {
          return statement.run(...params);
        },
        get(...params) {
          return statement.get(...params);
        },
        all(...params) {
          return statement.all(...params);
        }
      };
    },
    pragma(sql) {
      return db.exec(`PRAGMA ${sql}`);
    },
    transaction(fn) {
      return (...args) => {
        db.exec('BEGIN');
        try {
          const result = fn(...args);
          db.exec('COMMIT');
          return result;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      };
    }
  };
}

const runningOnVercel = Boolean(process.env.VERCEL);
const dataRoot = process.env.LORGEN_DATA_DIR
  ? path.resolve(process.env.LORGEN_DATA_DIR)
  : (runningOnVercel ? '/tmp/lorgen-data' : path.resolve('./data'));

if (runningOnVercel && !process.env.LORGEN_DATA_DIR) {
  console.warn('[Lorgen] VERCEL detected without LORGEN_DATA_DIR. SQLite data is stored in /tmp and is not durable between function instances.');
}

if (!fs.existsSync(dataRoot)) fs.mkdirSync(dataRoot, { recursive: true });

const dbPath = path.join(dataRoot, 'tournament.db');
const db = createDatabase(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
console.log(`[Lorgen] SQLite driver: ${db.__driver || 'unknown'}`);

db.exec(`
  CREATE TABLE IF NOT EXISTS tournaments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    year INTEGER NOT NULL,
    name TEXT NOT NULL,
    date TEXT NOT NULL,
    course TEXT DEFAULT '',
    description TEXT DEFAULT '',
    gameday_info TEXT DEFAULT '',
    status TEXT DEFAULT 'upcoming',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

  CREATE TABLE IF NOT EXISTS coin_back_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    photo_path TEXT NOT NULL,
    focal_point TEXT DEFAULT '50% 50%',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
try { db.exec(`CREATE TABLE IF NOT EXISTS coin_back_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  photo_path TEXT NOT NULL,
  focal_point TEXT DEFAULT '50% 50%',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`); } catch(_) {}
try { db.exec(`ALTER TABLE coin_back_images ADD COLUMN focal_point TEXT DEFAULT '50% 50%'`); } catch(_) {}
try { db.exec(`ALTER TABLE coin_back_images ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1`); } catch(_) {}
try { db.exec(`ALTER TABLE coin_back_images ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP`); } catch(_) {}

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
