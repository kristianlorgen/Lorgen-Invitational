-- V2 hardening: canonical lock + score submission timestamps.

alter table public.teams
  add column if not exists is_locked boolean not null default false;

update public.teams
set is_locked = coalesce(is_locked, locked, false)
where true;

alter table public.scores
  add column if not exists gross_score int,
  add column if not exists submitted_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

update public.scores
set
  gross_score = coalesce(gross_score, strokes, score),
  submitted_at = coalesce(submitted_at, updated_at, now()),
  updated_at = coalesce(updated_at, now())
where true;

create unique index if not exists scores_team_tournament_hole_unique
  on public.scores (team_id, tournament_id, hole_number);
