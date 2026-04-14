-- Ensure delete flows are reliable even when historical schemas drift.
-- Rebuild critical FK delete actions used by admin delete endpoints.

BEGIN;

DO $$
DECLARE
  rec RECORD;
  constraint_name TEXT;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      ('teams', 'tournament_id', 'tournaments', 'id', 'CASCADE'),
      ('scores', 'team_id', 'teams', 'id', 'CASCADE'),
      ('scores', 'tournament_id', 'tournaments', 'id', 'CASCADE'),
      ('players', 'team_id', 'teams', 'id', 'CASCADE'),
      ('players', 'tournament_id', 'tournaments', 'id', 'CASCADE'),
      ('rounds', 'team_id', 'teams', 'id', 'CASCADE'),
      ('rounds', 'tournament_id', 'tournaments', 'id', 'CASCADE'),
      ('holes', 'tournament_id', 'tournaments', 'id', 'CASCADE'),
      ('tournament_holes', 'tournament_id', 'tournaments', 'id', 'CASCADE'),
      ('hole_images', 'team_id', 'teams', 'id', 'CASCADE'),
      ('hole_images', 'tournament_id', 'tournaments', 'id', 'CASCADE'),
      ('chat_messages', 'tournament_id', 'tournaments', 'id', 'CASCADE'),
      ('tournament_gallery_images', 'tournament_id', 'tournaments', 'id', 'CASCADE'),
      ('sponsors', 'tournament_id', 'tournaments', 'id', 'CASCADE'),
      ('awards', 'tournament_id', 'tournaments', 'id', 'CASCADE'),
      ('award_claims', 'tournament_id', 'tournaments', 'id', 'CASCADE')
    ) AS t(src_table, src_col, dst_table, dst_col, delete_action)
  LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = rec.src_table
        AND column_name = rec.src_col
    )
    AND EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = rec.dst_table
        AND column_name = rec.dst_col
    ) THEN
      FOR constraint_name IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_class src ON src.oid = c.conrelid
        JOIN pg_namespace nsp ON nsp.oid = src.relnamespace
        JOIN pg_attribute att ON att.attrelid = src.oid AND att.attnum = ANY(c.conkey)
        WHERE c.contype = 'f'
          AND nsp.nspname = 'public'
          AND src.relname = rec.src_table
          AND att.attname = rec.src_col
      LOOP
        EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', rec.src_table, constraint_name);
      END LOOP;

      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.%I(%I) ON DELETE %s',
        rec.src_table,
        rec.src_table || '_' || rec.src_col || '_fkey',
        rec.src_col,
        rec.dst_table,
        rec.dst_col,
        rec.delete_action
      );
    END IF;
  END LOOP;
END $$;

COMMIT;
