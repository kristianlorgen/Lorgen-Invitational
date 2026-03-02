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


  CREATE TABLE IF NOT EXISTS webshop_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    image_url TEXT DEFAULT '',
    price_nok INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'nok',
    printful_variant_id INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS webshop_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    full_name TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending_payment',
    currency TEXT NOT NULL DEFAULT 'nok',
    amount_total INTEGER NOT NULL DEFAULT 0,
    stripe_session_id TEXT DEFAULT '',
    stripe_payment_intent_id TEXT DEFAULT '',
    printful_order_id TEXT DEFAULT '',
    printful_status TEXT DEFAULT '',
    tracking_number TEXT DEFAULT '',
    tracking_url TEXT DEFAULT '',
    shipping_json TEXT DEFAULT '',
    metadata_json TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS webshop_order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price INTEGER NOT NULL,
    printful_variant_id INTEGER,
    FOREIGN KEY (order_id) REFERENCES webshop_orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES webshop_products(id)
  );

  CREATE TABLE IF NOT EXISTS webshop_webhook_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    event_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(provider, event_id)
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



try {
  const existingProducts = db.prepare('SELECT COUNT(*) AS count FROM webshop_products').get();
  if (!existingProducts || !existingProducts.count) {
    const insertProduct = db.prepare(
      `INSERT INTO webshop_products (slug, name, description, image_url, price_nok, currency, printful_variant_id, is_active)
       VALUES (?,?,?,?,?,?,?,1)`
    );
    insertProduct.run('lorgen-cap', 'Lorgen Caps', 'Klassisk caps med brodert Lorgen-logo.', '/images/logo.png', 34900, 'nok', null);
    insertProduct.run('lorgen-polo', 'Lorgen Polo', 'Komfortabel golfpolo med turneringsprofil.', '/images/logo.png', 59900, 'nok', null);
    insertProduct.run('lorgen-hoodie', 'Lorgen Hoodie', 'Varm hoodie for kjølige kvelder på banen.', '/images/logo.png', 79900, 'nok', null);
  }
} catch (_) {}

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

