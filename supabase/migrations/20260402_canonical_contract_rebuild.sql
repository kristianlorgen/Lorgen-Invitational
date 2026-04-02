-- Canonical contract rebuild for tournament holes, teams, scores, and upload metadata.

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

update public.teams
set
  team_name = coalesce(team_name, name),
  player1_name = coalesce(player1_name, player1),
  player2_name = coalesce(player2_name, player2),
  pin = coalesce(pin, pin_code),
  hcp_player1 = coalesce(hcp_player1, player1_hcp, player1_handicap, 0),
  hcp_player2 = coalesce(hcp_player2, player2_hcp, player2_handicap, 0)
where true;

alter table public.scores
  add column if not exists tournament_id bigint,
  add column if not exists hole_number int,
  add column if not exists points int,
  add column if not exists net_score int,
  add column if not exists gross_score int,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.scores s
set
  tournament_id = coalesce(s.tournament_id, t.tournament_id),
  hole_number = coalesce(s.hole_number, s.hole),
  gross_score = coalesce(s.gross_score, s.strokes, s.score)
from public.teams t
where t.id = s.team_id;

create unique index if not exists scores_team_tournament_hole_unique
on public.scores (team_id, tournament_id, hole_number);

insert into public.tournament_holes (tournament_id, hole_number, par, stroke_index, requires_photo, is_longest_drive, is_nearest_pin)
select t.id, gs.hole_number, 4, gs.hole_number, false, false, false
from public.tournaments t
cross join generate_series(1, 18) as gs(hole_number)
on conflict (tournament_id, hole_number) do nothing;

insert into public.tournament_holes (tournament_id, hole_number, par, stroke_index, requires_photo, is_longest_drive, is_nearest_pin)
select
  h.tournament_id,
  h.hole_number,
  coalesce(h.par, 4),
  coalesce(h.stroke_index, h.hole_number),
  coalesce(h.requires_photo, false),
  coalesce(h.is_longest_drive, false),
  coalesce(h.is_nearest_pin, false)
from public.holes h
where h.tournament_id is not null and h.hole_number between 1 and 18
on conflict (tournament_id, hole_number)
do update set
  par = excluded.par,
  stroke_index = excluded.stroke_index,
  requires_photo = excluded.requires_photo,
  is_longest_drive = excluded.is_longest_drive,
  is_nearest_pin = excluded.is_nearest_pin,
  updated_at = now();
