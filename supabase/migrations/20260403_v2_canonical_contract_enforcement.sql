-- V2 canonical contract enforcement for teams and tournament_holes.

create table if not exists public.tournaments (
  id bigint generated always as identity primary key,
  year int,
  name text,
  date date,
  course text,
  description text,
  slope_rating numeric,
  status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.teams (
  id bigint generated always as identity primary key,
  tournament_id bigint not null references public.tournaments(id) on delete cascade,
  team_name text not null,
  player1_name text not null,
  player2_name text not null,
  pin text not null,
  hcp_player1 numeric not null default 0,
  hcp_player2 numeric not null default 0,
  created_at timestamptz not null default now()
);

alter table public.teams
  add column if not exists tournament_id bigint references public.tournaments(id) on delete cascade,
  add column if not exists team_name text,
  add column if not exists player1_name text,
  add column if not exists player2_name text,
  add column if not exists pin text,
  add column if not exists hcp_player1 numeric not null default 0,
  add column if not exists hcp_player2 numeric not null default 0,
  add column if not exists created_at timestamptz not null default now();

alter table public.teams
  alter column team_name set not null,
  alter column player1_name set not null,
  alter column player2_name set not null,
  alter column pin set not null;

create table if not exists public.tournament_holes (
  id bigint generated always as identity primary key,
  tournament_id bigint not null references public.tournaments(id) on delete cascade,
  hole_number int not null check (hole_number between 1 and 18),
  par int not null,
  stroke_index int not null,
  requires_photo boolean not null default false,
  is_longest_drive boolean not null default false,
  is_nearest_pin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tournament_id, hole_number)
);

alter table public.tournament_holes
  add column if not exists tournament_id bigint references public.tournaments(id) on delete cascade,
  add column if not exists hole_number int,
  add column if not exists par int not null default 4,
  add column if not exists stroke_index int,
  add column if not exists requires_photo boolean not null default false,
  add column if not exists is_longest_drive boolean not null default false,
  add column if not exists is_nearest_pin boolean not null default false,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.tournament_holes
  alter column tournament_id set not null,
  alter column hole_number set not null,
  alter column par set not null,
  alter column stroke_index set not null;

create unique index if not exists tournament_holes_tournament_hole_unique
  on public.tournament_holes(tournament_id, hole_number);
