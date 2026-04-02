-- Isolated V2 contract for canonical holes + team fields.

create table if not exists public.tournament_holes (
  id bigint generated always as identity primary key,
  tournament_id bigint not null references public.tournaments(id) on delete cascade,
  hole_number int not null check (hole_number between 1 and 18),
  par int not null default 4,
  stroke_index int not null,
  requires_photo boolean not null default false,
  is_longest_drive boolean not null default false,
  is_nearest_pin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tournament_id, hole_number)
);

alter table public.teams
  add column if not exists team_name text,
  add column if not exists player1_name text,
  add column if not exists player2_name text,
  add column if not exists pin text,
  add column if not exists hcp_player1 int,
  add column if not exists hcp_player2 int,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists locked boolean not null default false;

create unique index if not exists tournament_holes_tournament_hole_unique
  on public.tournament_holes (tournament_id, hole_number);
