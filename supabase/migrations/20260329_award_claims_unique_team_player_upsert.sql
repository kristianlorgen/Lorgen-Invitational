-- Align award_claims uniqueness with backend ON CONFLICT target to avoid duplicates.
BEGIN;

ALTER TABLE public.award_claims
  DROP CONSTRAINT IF EXISTS award_claims_round_hole_award_player_unique;

ALTER TABLE public.award_claims
  DROP CONSTRAINT IF EXISTS award_claims_unique;

ALTER TABLE public.award_claims
  ADD CONSTRAINT award_claims_round_hole_award_team_player_unique
  UNIQUE (round_id, hole_number, award_type, team_id, player_name);

COMMIT;
