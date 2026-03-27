-- Ensure award_claims supports longest-drive/award upsert payloads.

BEGIN;

ALTER TABLE award_claims
ADD COLUMN IF NOT EXISTS detail TEXT;

ALTER TABLE award_claims
ADD COLUMN IF NOT EXISTS image_url TEXT;

ALTER TABLE award_claims
ADD COLUMN IF NOT EXISTS distance NUMERIC;

ALTER TABLE award_claims
ADD COLUMN IF NOT EXISTS round_id BIGINT REFERENCES rounds(id) ON DELETE CASCADE;

ALTER TABLE award_claims
ADD COLUMN IF NOT EXISTS player_id BIGINT REFERENCES players(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'award_claims_unique'
      AND conrelid = 'award_claims'::regclass
  ) THEN
    ALTER TABLE award_claims
      ADD CONSTRAINT award_claims_unique
      UNIQUE (round_id, hole_number, award_type, player_id);
  END IF;
END $$;

COMMIT;
