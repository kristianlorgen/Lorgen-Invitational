CREATE TABLE IF NOT EXISTS public.holes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id integer NOT NULL,
  hole_number integer NOT NULL,
  par integer DEFAULT 4,
  stroke_index integer,
  requires_photo boolean DEFAULT false,
  is_longest_drive boolean DEFAULT false,
  is_nearest_pin boolean DEFAULT false,
  created_at timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS holes_tournament_id_hole_number_idx
  ON public.holes (tournament_id, hole_number);
