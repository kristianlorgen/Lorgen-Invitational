-- Shop persistence migration (products + printful sync state)

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS printful_variant_id text,
  ADD COLUMN IF NOT EXISTS printful_product_id text,
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS price numeric,
  ADD COLUMN IF NOT EXISTS active boolean DEFAULT true;

CREATE TABLE IF NOT EXISTS public.shop_sync_state (
  key text PRIMARY KEY,
  last_error text NULL,
  last_synced_at timestamptz NULL
);

-- Optional but recommended for sync upsert and lookup performance
CREATE UNIQUE INDEX IF NOT EXISTS products_printful_variant_id_uidx
  ON public.products (printful_variant_id)
  WHERE printful_variant_id IS NOT NULL;

INSERT INTO public.shop_sync_state (key, last_error, last_synced_at)
VALUES ('printful', NULL, NULL)
ON CONFLICT (key) DO NOTHING;
