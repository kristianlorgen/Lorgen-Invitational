-- Harden award_claims for backend upsert compatibility and schema-cache consistency.
-- This migration is safe to run multiple times.

BEGIN;

-- 1) Ensure required columns exist with expected types.
ALTER TABLE public.award_claims
  ADD COLUMN IF NOT EXISTS round_id BIGINT REFERENCES public.rounds(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS hole_number INTEGER,
  ADD COLUMN IF NOT EXISTS award_type TEXT,
  ADD COLUMN IF NOT EXISTS player_id BIGINT REFERENCES public.players(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS distance NUMERIC,
  ADD COLUMN IF NOT EXISTS detail TEXT,
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Keep updated_at initialized for existing rows.
UPDATE public.award_claims
SET updated_at = COALESCE(updated_at, created_at, claimed_at, NOW())
WHERE updated_at IS NULL;

-- 2) Drop older unique constraints that can conflict with the intended ON CONFLICT target.
DO $$
DECLARE
  rec RECORD;
  expected int2[];
BEGIN
  SELECT ARRAY_AGG(a.attnum::int2 ORDER BY x.ord)
  INTO expected
  FROM (
    VALUES
      ('round_id', 1),
      ('hole_number', 2),
      ('award_type', 3),
      ('player_id', 4)
  ) AS x(col, ord)
  JOIN pg_attribute a
    ON a.attrelid = 'public.award_claims'::regclass
   AND a.attname = x.col;

  FOR rec IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.award_claims'::regclass
      AND c.contype = 'u'
      AND c.conkey IS DISTINCT FROM expected
  LOOP
    EXECUTE format('ALTER TABLE public.award_claims DROP CONSTRAINT IF EXISTS %I', rec.conname);
  END LOOP;
END $$;

-- 3) Drop unique indexes that do not exactly match (round_id, hole_number, award_type, player_id).
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT idx.relname AS indexname
    FROM pg_index i
    JOIN pg_class tbl ON tbl.oid = i.indrelid
    JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
    JOIN pg_class idx ON idx.oid = i.indexrelid
    WHERE ns.nspname = 'public'
      AND tbl.relname = 'award_claims'
      AND i.indisunique = TRUE
      AND i.indisprimary = FALSE
      AND pg_get_indexdef(i.indexrelid) NOT ILIKE '%(round_id, hole_number, award_type, player_id)%'
      AND pg_get_indexdef(i.indexrelid) ILIKE '%(team_id, tournament_id, hole_number)%'
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS public.%I', rec.indexname);
  END LOOP;
END $$;

-- 4) Add the exact unique constraint used by backend upsert ON CONFLICT target.
DO $$
DECLARE
  expected int2[];
BEGIN
  SELECT ARRAY_AGG(a.attnum::int2 ORDER BY x.ord)
  INTO expected
  FROM (
    VALUES
      ('round_id', 1),
      ('hole_number', 2),
      ('award_type', 3),
      ('player_id', 4)
  ) AS x(col, ord)
  JOIN pg_attribute a
    ON a.attrelid = 'public.award_claims'::regclass
   AND a.attname = x.col;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'public.award_claims'::regclass
      AND c.contype = 'u'
      AND c.conkey = expected
  ) THEN
    ALTER TABLE public.award_claims
      ADD CONSTRAINT award_claims_round_hole_award_player_unique
      UNIQUE (round_id, hole_number, award_type, player_id);
  END IF;
END $$;

COMMIT;
