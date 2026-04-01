ALTER TABLE holes
  ADD COLUMN IF NOT EXISTS stroke_index INTEGER,
  ADD COLUMN IF NOT EXISTS is_longest_drive BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_nearest_pin BOOLEAN DEFAULT FALSE;

UPDATE holes
SET stroke_index = hole_number
WHERE stroke_index IS NULL;
