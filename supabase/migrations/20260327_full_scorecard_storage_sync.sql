-- Full scorecard/chat/storage sync pass
-- Ensures chat schema compatibility and canonical storage bucket guidance.

BEGIN;

-- chat_messages compatibility (frontend expects message + optional note/image).
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

CREATE INDEX IF NOT EXISTS chat_messages_tournament_created_idx ON chat_messages (tournament_id, created_at);

-- Canonical storage bucket for scorecard/chat/gallery media assets.
-- If this statement cannot run in your environment, create it manually in Supabase:
--   Create bucket: tournament-gallery
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'buckets') THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('tournament-gallery', 'tournament-gallery', true)
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

COMMIT;
