-- Lorgen Invitational canonical Supabase schema

CREATE TABLE IF NOT EXISTS tournaments (
  id BIGSERIAL PRIMARY KEY,
  year INTEGER NOT NULL,
  name TEXT NOT NULL,
  date TIMESTAMPTZ NOT NULL,
  course TEXT DEFAULT '',
  slope_rating INTEGER DEFAULT 113,
  description TEXT DEFAULT '',
  gameday_info TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'upcoming',
  format TEXT NOT NULL DEFAULT 'scramble',
  mode TEXT,
  handicap_percent NUMERIC,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS courses (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slope_rating INTEGER NOT NULL DEFAULT 113,
  location TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS course_holes (
  id BIGSERIAL PRIMARY KEY,
  course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  hole_number INTEGER NOT NULL,
  par INTEGER NOT NULL DEFAULT 4,
  stroke_index INTEGER NOT NULL DEFAULT 0,
  requires_photo BOOLEAN NOT NULL DEFAULT FALSE,
  is_longest_drive BOOLEAN NOT NULL DEFAULT FALSE,
  is_closest_to_pin BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (course_id, hole_number)
);

CREATE TABLE IF NOT EXISTS tournament_holes (
  id BIGSERIAL PRIMARY KEY,
  tournament_id BIGINT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  hole_number INTEGER NOT NULL,
  par INTEGER NOT NULL DEFAULT 4,
  stroke_index INTEGER NOT NULL DEFAULT 0,
  requires_photo BOOLEAN NOT NULL DEFAULT FALSE,
  is_longest_drive BOOLEAN NOT NULL DEFAULT FALSE,
  is_closest_to_pin BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (tournament_id, hole_number)
);

CREATE TABLE IF NOT EXISTS players (
  id BIGSERIAL PRIMARY KEY,
  tournament_id BIGINT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  handicap NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teams (
  id BIGSERIAL PRIMARY KEY,
  tournament_id BIGINT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  pin TEXT NOT NULL,
  locked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tournament_id, name)
);

CREATE TABLE IF NOT EXISTS team_members (
  id BIGSERIAL PRIMARY KEY,
  team_id BIGINT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  player_id BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (team_id, player_id)
);

CREATE TABLE IF NOT EXISTS rounds (
  id BIGSERIAL PRIMARY KEY,
  tournament_id BIGINT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  round_order INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tournament_id, round_order)
);

CREATE TABLE IF NOT EXISTS scores (
  id BIGSERIAL PRIMARY KEY,
  tournament_id BIGINT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round_id BIGINT REFERENCES rounds(id) ON DELETE SET NULL,
  team_id BIGINT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  hole_number INTEGER NOT NULL,
  par INTEGER,
  photo_path TEXT,
  score INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(team_id, round_id, hole_number)
);
CREATE UNIQUE INDEX IF NOT EXISTS scores_team_tournament_hole_uidx ON scores(team_id, tournament_id, hole_number);

CREATE TABLE IF NOT EXISTS hole_images (
  id BIGSERIAL PRIMARY KEY,
  tournament_id BIGINT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team_id BIGINT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  hole_number INTEGER NOT NULL,
  image_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS hole_images_tournament_created_idx ON hole_images(tournament_id, created_at DESC);
CREATE INDEX IF NOT EXISTS hole_images_team_hole_created_idx ON hole_images(team_id, hole_number, created_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGSERIAL PRIMARY KEY,
  tournament_id BIGINT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team_id BIGINT REFERENCES teams(id) ON DELETE SET NULL,
  team_name TEXT,
  message TEXT,
  note TEXT,
  image_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS chat_messages_tournament_created_idx ON chat_messages(tournament_id, created_at);

-- Supabase Storage (manual step if missing):
-- Create bucket: tournament-gallery

CREATE TABLE IF NOT EXISTS tournament_gallery_images (
  id BIGSERIAL PRIMARY KEY,
  tournament_id BIGINT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  photo_path TEXT NOT NULL,
  storage_path TEXT,
  caption TEXT,
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS legacy_entries (
  id BIGSERIAL PRIMARY KEY,
  year INTEGER NOT NULL UNIQUE,
  winner_team TEXT NOT NULL,
  player1 TEXT NOT NULL,
  player2 TEXT NOT NULL,
  score TEXT,
  score_to_par TEXT,
  course TEXT,
  notes TEXT,
  winner_photo TEXT,
  winner_photo_focus TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS award_claims (
  id BIGSERIAL PRIMARY KEY,
  tournament_id BIGINT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round_id BIGINT REFERENCES rounds(id) ON DELETE CASCADE,
  team_id BIGINT REFERENCES teams(id) ON DELETE SET NULL,
  player_id BIGINT REFERENCES players(id) ON DELETE SET NULL,
  team_name TEXT,
  hole_number INTEGER NOT NULL,
  award_type TEXT NOT NULL,
  player_name TEXT NOT NULL,
  detail TEXT,
  image_url TEXT,
  distance NUMERIC,
  value TEXT,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT award_claims_round_hole_award_team_player_unique UNIQUE (round_id, hole_number, award_type, team_id, player_name)
);

CREATE TABLE IF NOT EXISTS sponsors (
  id BIGSERIAL PRIMARY KEY,
  tournament_id BIGINT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  placement TEXT NOT NULL CHECK (placement IN ('home', 'hole')),
  spot_number INTEGER,
  hole_number INTEGER,
  sponsor_name TEXT,
  description TEXT,
  logo_path TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS awards (
  id BIGSERIAL PRIMARY KEY,
  tournament_id BIGINT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team_id BIGINT REFERENCES teams(id) ON DELETE SET NULL,
  team_name TEXT,
  award_type TEXT NOT NULL,
  player_name TEXT NOT NULL,
  hole_number INTEGER,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coin_back_images (
  id BIGSERIAL PRIMARY KEY,
  photo_path TEXT NOT NULL,
  storage_path TEXT,
  focal_point TEXT DEFAULT '50% 50%',
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_holes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_holes ENABLE ROW LEVEL SECURITY;
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_gallery_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE legacy_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE award_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsors ENABLE ROW LEVEL SECURITY;
ALTER TABLE awards ENABLE ROW LEVEL SECURITY;
ALTER TABLE coin_back_images ENABLE ROW LEVEL SECURITY;
