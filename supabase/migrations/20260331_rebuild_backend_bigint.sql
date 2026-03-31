-- Core schema rebuilt for bigint identities and clean API integration.

drop table if exists public.hole_images cascade;
drop table if exists public.scores cascade;
drop table if exists public.teams cascade;
drop table if exists public.tournaments cascade;

create table public.tournaments (
  id bigint primary key generated always as identity,
  name text not null,
  course text not null,
  status text not null check (status in ('upcoming', 'active', 'completed')),
  created_at timestamp without time zone not null default now()
);

create table public.teams (
  id bigint primary key generated always as identity,
  tournament_id bigint not null references public.tournaments(id) on delete cascade,
  name text not null,
  player1_hcp int,
  player2_hcp int,
  pin_code text
);

create table public.scores (
  id bigint primary key generated always as identity,
  team_id bigint not null references public.teams(id) on delete cascade,
  hole int not null,
  strokes int not null
);

create table public.hole_images (
  id bigint primary key generated always as identity,
  tournament_id bigint not null references public.tournaments(id) on delete cascade,
  team_id bigint not null references public.teams(id) on delete cascade,
  image_url text not null
);

alter table public.tournaments enable row level security;
alter table public.teams enable row level security;
alter table public.scores enable row level security;
alter table public.hole_images enable row level security;

create policy "public read tournaments" on public.tournaments for select using (true);
create policy "public read teams" on public.teams for select using (true);
create policy "public read scores" on public.scores for select using (true);
create policy "public read hole_images" on public.hole_images for select using (true);

insert into storage.buckets (id, name, public)
values ('tournament-gallery', 'tournament-gallery', true)
on conflict (id) do update set public = true;

create policy "public read tournament-gallery"
on storage.objects for select
using (bucket_id = 'tournament-gallery');

create policy "public upload tournament-gallery"
on storage.objects for insert
with check (bucket_id = 'tournament-gallery');
