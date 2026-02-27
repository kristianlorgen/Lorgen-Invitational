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



-- ============================================================
-- Webshop (Stripe + Printful)
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  price_nok INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'NOK',
  printful_sync_product_id TEXT,
  printful_variant_id INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  email TEXT,
  amount_nok INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'NOK',
  status TEXT NOT NULL CHECK (status IN ('created', 'paid', 'submitted', 'failed')),
  stripe_session_id TEXT UNIQUE,
  stripe_payment_intent_id TEXT,
  printful_order_id TEXT,
  shipping_name TEXT,
  shipping_address_json JSONB,
  items_json JSONB
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
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders   ENABLE ROW LEVEL SECURITY;

-- No public policies needed — all access goes through the Express backend
-- using the service role key.


-- Public can only read active products. Orders are server-only.
DROP POLICY IF EXISTS "products_active_select" ON public.products;
CREATE POLICY "products_active_select"
  ON public.products
  FOR SELECT
  TO anon
  USING (is_active = TRUE);

DROP POLICY IF EXISTS "orders_no_anon" ON public.orders;
CREATE POLICY "orders_no_anon"
  ON public.orders
  FOR SELECT
  TO anon
  USING (FALSE);
