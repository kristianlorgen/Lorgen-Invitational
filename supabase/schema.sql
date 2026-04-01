-- ============================================================
-- Lorgen Invitational — Supabase PostgreSQL Schema
-- Run this in the Supabase SQL Editor (supabase.com/dashboard)
-- ============================================================

CREATE TABLE IF NOT EXISTS tournaments (
  id        BIGSERIAL PRIMARY KEY,
  year      INTEGER NOT NULL,
  name      TEXT NOT NULL,
  date      TEXT NOT NULL,
  course    TEXT DEFAULT '',
  description TEXT DEFAULT '',
  gameday_info TEXT DEFAULT '',
  status    TEXT DEFAULT 'upcoming',   -- upcoming | active | completed
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS holes (
  id             BIGSERIAL PRIMARY KEY,
  tournament_id  BIGINT NOT NULL REFERENCES tournaments(id),
  hole_number    INTEGER NOT NULL,
  par            INTEGER NOT NULL DEFAULT 4,
  requires_photo BOOLEAN DEFAULT FALSE,
  stroke_index   INTEGER DEFAULT NULL,
  is_longest_drive BOOLEAN DEFAULT FALSE,
  is_nearest_pin BOOLEAN DEFAULT FALSE,
  UNIQUE(tournament_id, hole_number)
);

CREATE TABLE IF NOT EXISTS teams (
  id             BIGSERIAL PRIMARY KEY,
  tournament_id  BIGINT NOT NULL REFERENCES tournaments(id),
  team_name      TEXT NOT NULL,
  player1        TEXT NOT NULL,
  player2        TEXT NOT NULL,
  pin_code       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scores (
  id           BIGSERIAL PRIMARY KEY,
  team_id      BIGINT NOT NULL REFERENCES teams(id),
  hole_number  INTEGER NOT NULL,
  score        INTEGER NOT NULL DEFAULT 0,
  photo_path   TEXT,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(team_id, hole_number)
);

CREATE TABLE IF NOT EXISTS awards (
  id             BIGSERIAL PRIMARY KEY,
  tournament_id  BIGINT NOT NULL REFERENCES tournaments(id),
  award_type     TEXT NOT NULL,          -- longest_drive | closest_to_pin
  team_id        BIGINT REFERENCES teams(id),
  hole_number    INTEGER DEFAULT 0,
  detail         TEXT DEFAULT '',
  UNIQUE(tournament_id, award_type, hole_number)
);

CREATE TABLE IF NOT EXISTS legacy (
  id           BIGSERIAL PRIMARY KEY,
  year         INTEGER NOT NULL,
  winner_team  TEXT NOT NULL,
  player1      TEXT NOT NULL,
  player2      TEXT NOT NULL,
  score        TEXT DEFAULT '',
  score_to_par TEXT DEFAULT '',
  course       TEXT DEFAULT '',
  notes        TEXT DEFAULT ''
);

-- ============================================================
-- Row Level Security
-- The backend uses the service role key which bypasses RLS.
-- Enable RLS so the anon key cannot access data directly.
-- ============================================================
ALTER TABLE tournaments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE holes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams        ENABLE ROW LEVEL SECURITY;
ALTER TABLE scores       ENABLE ROW LEVEL SECURITY;
ALTER TABLE awards       ENABLE ROW LEVEL SECURITY;
ALTER TABLE legacy       ENABLE ROW LEVEL SECURITY;

-- No public policies needed — all access goes through the Express backend
-- using the service role key.
