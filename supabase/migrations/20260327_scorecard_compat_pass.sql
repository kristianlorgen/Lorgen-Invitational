-- Scorecard compatibility pass (additive-only)
-- Covers award claims, private chat, sponsors, score photos, and upsert compatibility.

BEGIN;

-- award_claims: make sure all scorecard award fields exist.
CREATE TABLE IF NOT EXISTS award_claims (
  id BIGSERIAL PRIMARY KEY,
  tournament_id BIGINT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team_id BIGINT REFERENCES teams(id) ON DELETE SET NULL,
  team_name TEXT,
  hole_number INTEGER NOT NULL,
  award_type TEXT NOT NULL,
  player_name TEXT NOT NULL,
  detail TEXT,
  value TEXT,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE award_claims ADD COLUMN IF NOT EXISTS tournament_id BIGINT REFERENCES tournaments(id) ON DELETE CASCADE;
ALTER TABLE award_claims ADD COLUMN IF NOT EXISTS team_id BIGINT REFERENCES teams(id) ON DELETE SET NULL;
ALTER TABLE award_claims ADD COLUMN IF NOT EXISTS team_name TEXT;
ALTER TABLE award_claims ADD COLUMN IF NOT EXISTS hole_number INTEGER;
ALTER TABLE award_claims ADD COLUMN IF NOT EXISTS award_type TEXT;
ALTER TABLE award_claims ADD COLUMN IF NOT EXISTS player_name TEXT;
ALTER TABLE award_claims ADD COLUMN IF NOT EXISTS detail TEXT;
ALTER TABLE award_claims ADD COLUMN IF NOT EXISTS value TEXT;
ALTER TABLE award_claims ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE award_claims ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- chat_messages: canonical private chat schema expected by scorecard chat.
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

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS tournament_id BIGINT REFERENCES tournaments(id) ON DELETE CASCADE;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS team_id BIGINT REFERENCES teams(id) ON DELETE SET NULL;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS team_name TEXT;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS message TEXT;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS image_path TEXT;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- sponsors: required for hole-sponsor rendering in private scorecard.
CREATE TABLE IF NOT EXISTS sponsors (
  id BIGSERIAL PRIMARY KEY,
  tournament_id BIGINT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  placement TEXT,
  spot_number INTEGER,
  hole_number INTEGER,
  sponsor_name TEXT,
  description TEXT,
  logo_path TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS placement TEXT;
ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS spot_number INTEGER;
ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS hole_number INTEGER;
ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS sponsor_name TEXT;
ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS logo_path TEXT;
ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- photo metadata table used by gallery/admin photo endpoints.
CREATE TABLE IF NOT EXISTS tournament_gallery_images (
  id BIGSERIAL PRIMARY KEY,
  tournament_id BIGINT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  photo_path TEXT NOT NULL,
  storage_path TEXT,
  caption TEXT,
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE tournament_gallery_images ADD COLUMN IF NOT EXISTS tournament_id BIGINT REFERENCES tournaments(id) ON DELETE CASCADE;
ALTER TABLE tournament_gallery_images ADD COLUMN IF NOT EXISTS photo_path TEXT;
ALTER TABLE tournament_gallery_images ADD COLUMN IF NOT EXISTS storage_path TEXT;
ALTER TABLE tournament_gallery_images ADD COLUMN IF NOT EXISTS caption TEXT;
ALTER TABLE tournament_gallery_images ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT TRUE;
ALTER TABLE tournament_gallery_images ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMPTZ DEFAULT NOW();

-- score upsert compatibility used by /api/team/submit-score and /api/team/upload-photo/:holeNum
CREATE UNIQUE INDEX IF NOT EXISTS scores_team_tournament_hole_uidx ON scores (team_id, tournament_id, hole_number);

-- Performance/supporting indexes for scorecard features.
CREATE INDEX IF NOT EXISTS award_claims_team_tournament_idx ON award_claims (team_id, tournament_id);
CREATE INDEX IF NOT EXISTS chat_messages_tournament_created_idx ON chat_messages (tournament_id, created_at);
CREATE INDEX IF NOT EXISTS sponsors_tournament_placement_idx ON sponsors (tournament_id, placement, is_enabled);

COMMIT;
