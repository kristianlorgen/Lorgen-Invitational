CREATE TABLE IF NOT EXISTS hole_images (
  id BIGSERIAL PRIMARY KEY,
  tournament_id BIGINT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team_id BIGINT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  hole_number INTEGER NOT NULL,
  image_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS hole_images_tournament_created_idx
  ON hole_images(tournament_id, created_at DESC);

CREATE INDEX IF NOT EXISTS hole_images_team_hole_created_idx
  ON hole_images(team_id, hole_number, created_at DESC);
