-- Restore sponsor/advertising support for Railway + Supabase.

CREATE TABLE IF NOT EXISTS sponsors (
  id BIGSERIAL PRIMARY KEY,
  tournament_id BIGINT REFERENCES tournaments(id) ON DELETE CASCADE,
  placement TEXT NOT NULL DEFAULT 'frontpage',
  hole_number INTEGER,
  spot_number INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 1,
  sponsor_name TEXT DEFAULT '',
  name TEXT DEFAULT '',
  description TEXT DEFAULT '',
  tagline TEXT DEFAULT '',
  logo_path TEXT DEFAULT '',
  sponsor_logo TEXT DEFAULT '',
  logo_url TEXT DEFAULT '',
  sponsor_url TEXT DEFAULT '',
  website_url TEXT DEFAULT '',
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS tournament_id BIGINT REFERENCES tournaments(id) ON DELETE CASCADE;
ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS placement TEXT NOT NULL DEFAULT 'frontpage';
ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS hole_number INTEGER;
ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS spot_number INTEGER NOT NULL DEFAULT 1;
ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 1;
ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS sponsor_name TEXT DEFAULT '';
ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS name TEXT DEFAULT '';
ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';
ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS tagline TEXT DEFAULT '';
ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS logo_path TEXT DEFAULT '';
ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS sponsor_logo TEXT DEFAULT '';
ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS logo_url TEXT DEFAULT '';
ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS sponsor_url TEXT DEFAULT '';
ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS website_url TEXT DEFAULT '';
ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

UPDATE sponsors
SET
  placement = COALESCE(NULLIF(placement, ''), 'frontpage'),
  spot_number = COALESCE(spot_number, position, 1),
  position = COALESCE(position, spot_number, 1),
  sponsor_name = COALESCE(NULLIF(sponsor_name, ''), NULLIF(name, ''), ''),
  name = COALESCE(NULLIF(name, ''), NULLIF(sponsor_name, ''), ''),
  logo_path = COALESCE(NULLIF(logo_path, ''), NULLIF(sponsor_logo, ''), NULLIF(logo_url, ''), ''),
  sponsor_logo = COALESCE(NULLIF(sponsor_logo, ''), NULLIF(logo_path, ''), NULLIF(logo_url, ''), ''),
  logo_url = COALESCE(NULLIF(logo_url, ''), NULLIF(logo_path, ''), NULLIF(sponsor_logo, ''), ''),
  sponsor_url = COALESCE(NULLIF(sponsor_url, ''), NULLIF(website_url, ''), ''),
  website_url = COALESCE(NULLIF(website_url, ''), NULLIF(sponsor_url, ''), ''),
  description = COALESCE(NULLIF(description, ''), NULLIF(tagline, ''), ''),
  tagline = COALESCE(NULLIF(tagline, ''), NULLIF(description, ''), ''),
  is_enabled = COALESCE(is_enabled, active, FALSE),
  active = COALESCE(active, is_enabled, FALSE);

CREATE INDEX IF NOT EXISTS idx_sponsors_tournament_placement ON sponsors(tournament_id, placement);
CREATE INDEX IF NOT EXISTS idx_sponsors_hole ON sponsors(tournament_id, hole_number) WHERE placement = 'hole';
ALTER TABLE sponsors ENABLE ROW LEVEL SECURITY;
