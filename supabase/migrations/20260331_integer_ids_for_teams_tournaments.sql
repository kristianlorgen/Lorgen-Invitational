BEGIN;

-- 1) Remove foreign-key constraints pointing to tournaments/teams so column types can change.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT con.conname, nsp.nspname AS schema_name, cls.relname AS table_name
    FROM pg_constraint con
    JOIN pg_class cls ON cls.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = cls.relnamespace
    WHERE con.contype = 'f'
      AND con.confrelid IN ('public.tournaments'::regclass, 'public.teams'::regclass)
  ) LOOP
    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I', r.schema_name, r.table_name, r.conname);
  END LOOP;
END $$;

-- 2) Build UUID -> INTEGER mapping for existing rows (if these IDs are currently UUID).
CREATE TEMP TABLE tmp_tournament_id_map (
  old_id UUID PRIMARY KEY,
  new_id INTEGER NOT NULL UNIQUE
) ON COMMIT DROP;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tournaments'
      AND column_name = 'id'
      AND data_type = 'uuid'
  ) THEN
    INSERT INTO tmp_tournament_id_map (old_id, new_id)
    SELECT id, row_number() OVER (ORDER BY created_at, id)::INTEGER
    FROM public.tournaments;
  END IF;
END $$;

CREATE TEMP TABLE tmp_team_id_map (
  old_id UUID PRIMARY KEY,
  new_id INTEGER NOT NULL UNIQUE
) ON COMMIT DROP;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'teams'
      AND column_name = 'id'
      AND data_type = 'uuid'
  ) THEN
    INSERT INTO tmp_team_id_map (old_id, new_id)
    SELECT id, row_number() OVER (ORDER BY created_at, id)::INTEGER
    FROM public.teams;
  END IF;
END $$;

-- 3) Convert primary keys.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tournaments' AND column_name = 'id' AND data_type = 'uuid'
  ) THEN
    ALTER TABLE public.tournaments
      ALTER COLUMN id DROP DEFAULT,
      ALTER COLUMN id TYPE INTEGER USING (
        SELECT m.new_id FROM tmp_tournament_id_map m WHERE m.old_id = tournaments.id
      );
  ELSIF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tournaments' AND column_name = 'id' AND data_type = 'bigint'
  ) THEN
    ALTER TABLE public.tournaments
      ALTER COLUMN id TYPE INTEGER USING id::INTEGER;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'teams' AND column_name = 'id' AND data_type = 'uuid'
  ) THEN
    ALTER TABLE public.teams
      ALTER COLUMN id DROP DEFAULT,
      ALTER COLUMN id TYPE INTEGER USING (
        SELECT m.new_id FROM tmp_team_id_map m WHERE m.old_id = teams.id
      );
  ELSIF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'teams' AND column_name = 'id' AND data_type = 'bigint'
  ) THEN
    ALTER TABLE public.teams
      ALTER COLUMN id TYPE INTEGER USING id::INTEGER;
  END IF;
END $$;

-- 4) Convert all foreign-key columns to INTEGER.
DO $$
BEGIN
  -- tournament_id references
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='teams' AND column_name='tournament_id' AND data_type='uuid') THEN
    ALTER TABLE public.teams ALTER COLUMN tournament_id TYPE INTEGER USING ((SELECT m.new_id FROM tmp_tournament_id_map m WHERE m.old_id = teams.tournament_id));
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='teams' AND column_name='tournament_id' AND data_type='bigint') THEN
    ALTER TABLE public.teams ALTER COLUMN tournament_id TYPE INTEGER USING tournament_id::INTEGER;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='players' AND column_name='tournament_id' AND data_type='uuid') THEN
    ALTER TABLE public.players ALTER COLUMN tournament_id TYPE INTEGER USING ((SELECT m.new_id FROM tmp_tournament_id_map m WHERE m.old_id = players.tournament_id));
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='players' AND column_name='tournament_id' AND data_type='bigint') THEN
    ALTER TABLE public.players ALTER COLUMN tournament_id TYPE INTEGER USING tournament_id::INTEGER;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='rounds' AND column_name='tournament_id' AND data_type='uuid') THEN
    ALTER TABLE public.rounds ALTER COLUMN tournament_id TYPE INTEGER USING ((SELECT m.new_id FROM tmp_tournament_id_map m WHERE m.old_id = rounds.tournament_id));
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='rounds' AND column_name='tournament_id' AND data_type='bigint') THEN
    ALTER TABLE public.rounds ALTER COLUMN tournament_id TYPE INTEGER USING tournament_id::INTEGER;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='scores' AND column_name='tournament_id' AND data_type='uuid') THEN
    ALTER TABLE public.scores ALTER COLUMN tournament_id TYPE INTEGER USING ((SELECT m.new_id FROM tmp_tournament_id_map m WHERE m.old_id = scores.tournament_id));
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='scores' AND column_name='tournament_id' AND data_type='bigint') THEN
    ALTER TABLE public.scores ALTER COLUMN tournament_id TYPE INTEGER USING tournament_id::INTEGER;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='scores' AND column_name='team_id' AND data_type='uuid') THEN
    ALTER TABLE public.scores ALTER COLUMN team_id TYPE INTEGER USING ((SELECT m.new_id FROM tmp_team_id_map m WHERE m.old_id = scores.team_id));
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='scores' AND column_name='team_id' AND data_type='bigint') THEN
    ALTER TABLE public.scores ALTER COLUMN team_id TYPE INTEGER USING team_id::INTEGER;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='rounds' AND column_name='team_id' AND data_type='uuid') THEN
    ALTER TABLE public.rounds ALTER COLUMN team_id TYPE INTEGER USING ((SELECT m.new_id FROM tmp_team_id_map m WHERE m.old_id = rounds.team_id));
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='rounds' AND column_name='team_id' AND data_type='bigint') THEN
    ALTER TABLE public.rounds ALTER COLUMN team_id TYPE INTEGER USING team_id::INTEGER;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='team_members' AND column_name='team_id' AND data_type='uuid') THEN
    ALTER TABLE public.team_members ALTER COLUMN team_id TYPE INTEGER USING ((SELECT m.new_id FROM tmp_team_id_map m WHERE m.old_id = team_members.team_id));
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='team_members' AND column_name='team_id' AND data_type='bigint') THEN
    ALTER TABLE public.team_members ALTER COLUMN team_id TYPE INTEGER USING team_id::INTEGER;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tournament_holes' AND column_name='tournament_id' AND data_type='uuid') THEN
    ALTER TABLE public.tournament_holes ALTER COLUMN tournament_id TYPE INTEGER USING ((SELECT m.new_id FROM tmp_tournament_id_map m WHERE m.old_id = tournament_holes.tournament_id));
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tournament_holes' AND column_name='tournament_id' AND data_type='bigint') THEN
    ALTER TABLE public.tournament_holes ALTER COLUMN tournament_id TYPE INTEGER USING tournament_id::INTEGER;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='hole_images' AND column_name='tournament_id' AND data_type='uuid') THEN
    ALTER TABLE public.hole_images ALTER COLUMN tournament_id TYPE INTEGER USING ((SELECT m.new_id FROM tmp_tournament_id_map m WHERE m.old_id = hole_images.tournament_id));
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='hole_images' AND column_name='tournament_id' AND data_type='bigint') THEN
    ALTER TABLE public.hole_images ALTER COLUMN tournament_id TYPE INTEGER USING tournament_id::INTEGER;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='hole_images' AND column_name='team_id' AND data_type='uuid') THEN
    ALTER TABLE public.hole_images ALTER COLUMN team_id TYPE INTEGER USING ((SELECT m.new_id FROM tmp_team_id_map m WHERE m.old_id = hole_images.team_id));
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='hole_images' AND column_name='team_id' AND data_type='bigint') THEN
    ALTER TABLE public.hole_images ALTER COLUMN team_id TYPE INTEGER USING team_id::INTEGER;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='chat_messages' AND column_name='tournament_id' AND data_type='uuid') THEN
    ALTER TABLE public.chat_messages ALTER COLUMN tournament_id TYPE INTEGER USING ((SELECT m.new_id FROM tmp_tournament_id_map m WHERE m.old_id = chat_messages.tournament_id));
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='chat_messages' AND column_name='tournament_id' AND data_type='bigint') THEN
    ALTER TABLE public.chat_messages ALTER COLUMN tournament_id TYPE INTEGER USING tournament_id::INTEGER;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='chat_messages' AND column_name='team_id' AND data_type='uuid') THEN
    ALTER TABLE public.chat_messages ALTER COLUMN team_id TYPE INTEGER USING ((SELECT m.new_id FROM tmp_team_id_map m WHERE m.old_id = chat_messages.team_id));
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='chat_messages' AND column_name='team_id' AND data_type='bigint') THEN
    ALTER TABLE public.chat_messages ALTER COLUMN team_id TYPE INTEGER USING team_id::INTEGER;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tournament_gallery_images' AND column_name='tournament_id' AND data_type='uuid') THEN
    ALTER TABLE public.tournament_gallery_images ALTER COLUMN tournament_id TYPE INTEGER USING ((SELECT m.new_id FROM tmp_tournament_id_map m WHERE m.old_id = tournament_gallery_images.tournament_id));
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tournament_gallery_images' AND column_name='tournament_id' AND data_type='bigint') THEN
    ALTER TABLE public.tournament_gallery_images ALTER COLUMN tournament_id TYPE INTEGER USING tournament_id::INTEGER;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='award_claims' AND column_name='tournament_id' AND data_type='uuid') THEN
    ALTER TABLE public.award_claims ALTER COLUMN tournament_id TYPE INTEGER USING ((SELECT m.new_id FROM tmp_tournament_id_map m WHERE m.old_id = award_claims.tournament_id));
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='award_claims' AND column_name='tournament_id' AND data_type='bigint') THEN
    ALTER TABLE public.award_claims ALTER COLUMN tournament_id TYPE INTEGER USING tournament_id::INTEGER;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='award_claims' AND column_name='team_id' AND data_type='uuid') THEN
    ALTER TABLE public.award_claims ALTER COLUMN team_id TYPE INTEGER USING ((SELECT m.new_id FROM tmp_team_id_map m WHERE m.old_id = award_claims.team_id));
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='award_claims' AND column_name='team_id' AND data_type='bigint') THEN
    ALTER TABLE public.award_claims ALTER COLUMN team_id TYPE INTEGER USING team_id::INTEGER;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sponsors' AND column_name='tournament_id' AND data_type='uuid') THEN
    ALTER TABLE public.sponsors ALTER COLUMN tournament_id TYPE INTEGER USING ((SELECT m.new_id FROM tmp_tournament_id_map m WHERE m.old_id = sponsors.tournament_id));
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sponsors' AND column_name='tournament_id' AND data_type='bigint') THEN
    ALTER TABLE public.sponsors ALTER COLUMN tournament_id TYPE INTEGER USING tournament_id::INTEGER;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='awards' AND column_name='tournament_id' AND data_type='uuid') THEN
    ALTER TABLE public.awards ALTER COLUMN tournament_id TYPE INTEGER USING ((SELECT m.new_id FROM tmp_tournament_id_map m WHERE m.old_id = awards.tournament_id));
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='awards' AND column_name='tournament_id' AND data_type='bigint') THEN
    ALTER TABLE public.awards ALTER COLUMN tournament_id TYPE INTEGER USING tournament_id::INTEGER;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='awards' AND column_name='team_id' AND data_type='uuid') THEN
    ALTER TABLE public.awards ALTER COLUMN team_id TYPE INTEGER USING ((SELECT m.new_id FROM tmp_team_id_map m WHERE m.old_id = awards.team_id));
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='awards' AND column_name='team_id' AND data_type='bigint') THEN
    ALTER TABLE public.awards ALTER COLUMN team_id TYPE INTEGER USING team_id::INTEGER;
  END IF;
END $$;

-- 5) Re-create integer identity defaults for PKs.
CREATE SEQUENCE IF NOT EXISTS public.tournaments_id_seq;
ALTER TABLE public.tournaments ALTER COLUMN id SET DEFAULT nextval('public.tournaments_id_seq');
SELECT setval('public.tournaments_id_seq', COALESCE((SELECT MAX(id) FROM public.tournaments), 1), true);
ALTER SEQUENCE public.tournaments_id_seq OWNED BY public.tournaments.id;

CREATE SEQUENCE IF NOT EXISTS public.teams_id_seq;
ALTER TABLE public.teams ALTER COLUMN id SET DEFAULT nextval('public.teams_id_seq');
SELECT setval('public.teams_id_seq', COALESCE((SELECT MAX(id) FROM public.teams), 1), true);
ALTER SEQUENCE public.teams_id_seq OWNED BY public.teams.id;

-- 6) Rebuild FKs as INTEGER references.
ALTER TABLE public.teams ADD CONSTRAINT teams_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE;
ALTER TABLE public.players ADD CONSTRAINT players_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE;
ALTER TABLE public.rounds ADD CONSTRAINT rounds_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE;
ALTER TABLE public.tournament_holes ADD CONSTRAINT tournament_holes_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE;
ALTER TABLE public.scores ADD CONSTRAINT scores_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE;
ALTER TABLE public.scores ADD CONSTRAINT scores_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;
ALTER TABLE public.team_members ADD CONSTRAINT team_members_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;
ALTER TABLE public.hole_images ADD CONSTRAINT hole_images_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE;
ALTER TABLE public.hole_images ADD CONSTRAINT hole_images_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;
ALTER TABLE public.chat_messages ADD CONSTRAINT chat_messages_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE;
ALTER TABLE public.chat_messages ADD CONSTRAINT chat_messages_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE SET NULL;
ALTER TABLE public.tournament_gallery_images ADD CONSTRAINT tournament_gallery_images_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE;
ALTER TABLE public.award_claims ADD CONSTRAINT award_claims_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE;
ALTER TABLE public.award_claims ADD CONSTRAINT award_claims_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE SET NULL;
ALTER TABLE public.sponsors ADD CONSTRAINT sponsors_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE;
ALTER TABLE public.awards ADD CONSTRAINT awards_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE;
ALTER TABLE public.awards ADD CONSTRAINT awards_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE SET NULL;

COMMIT;
