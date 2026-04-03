-- Vercel-native canonical v2 contract hardening

create table if not exists public.tournament_holes (
  id bigserial primary key,
  tournament_id bigint not null references public.tournaments(id) on delete cascade,
  hole_number integer not null,
  par integer not null default 4,
  stroke_index integer not null,
  requires_photo boolean not null default false,
  is_longest_drive boolean not null default false,
  is_nearest_pin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tournament_id, hole_number)
);

alter table public.tournament_holes
  add column if not exists requires_photo boolean not null default false,
  add column if not exists is_longest_drive boolean not null default false,
  add column if not exists is_nearest_pin boolean not null default false,
  add column if not exists par integer not null default 4,
  add column if not exists stroke_index integer,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists tournament_holes_tournament_id_hole_number_key
  on public.tournament_holes(tournament_id, hole_number);

alter table public.teams
  add column if not exists team_name text,
  add column if not exists player1_name text,
  add column if not exists player2_name text,
  add column if not exists pin text,
  add column if not exists hcp_player1 numeric,
  add column if not exists hcp_player2 numeric;

update public.teams
set
  team_name = coalesce(team_name, name),
  player1_name = coalesce(player1_name, player1),
  player2_name = coalesce(player2_name, player2),
  pin = coalesce(pin, pin_code),
  hcp_player1 = coalesce(hcp_player1, hcp1),
  hcp_player2 = coalesce(hcp_player2, hcp2)
where
  team_name is null
  or player1_name is null
  or player2_name is null
  or pin is null
  or hcp_player1 is null
  or hcp_player2 is null;

insert into public.tournament_holes
  (tournament_id, hole_number, par, stroke_index, requires_photo, is_longest_drive, is_nearest_pin)
select
  t.id,
  gs.hole_number,
  4,
  gs.hole_number,
  false,
  false,
  false
from public.tournaments t
cross join lateral (
  select generate_series(1, 18) as hole_number
) gs
on conflict (tournament_id, hole_number) do nothing;
