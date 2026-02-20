const Database = require('better-sqlite3');
const fs = require('fs');

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

module.exports = db;
