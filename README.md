# Lorgen Invitational

> Power. Precision. Party.

An annual 2-man scramble golf tournament website built with Node.js + Express + SQLite.

## Features

- **Homepage** — Tournament info, countdown timer, latest champion
- **Gameday Info** — Schedule, format rules, teams, photo challenge holes
- **Live Scoreboard** — Real-time leaderboard via Server-Sent Events, hole-by-hole scorecard, awards
- **Legacy / Hall of Fame** — Year-by-year champion history
- **Score Entry** — PIN-protected player portal for entering hole scores and uploading photos
- **Admin Panel** — Full tournament management (tournaments, teams, holes, scores, awards, legacy)

## Getting Started

```bash
npm install
cp .env.example .env   # Edit password and secret
npm start              # Runs on http://localhost:3000
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server port |
| `SESSION_SECRET` | `lorgen-inv-secret` | Session encryption key |
| `ADMIN_PASSWORD` | `LorgenAdmin2025` | Admin panel password |
| `NEXT_PUBLIC_SUPABASE_URL` | _(required)_ | Supabase project URL (required for client init) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | _(required)_ | Supabase anon/public key (required for client init) |

## Vercel deployment note (important)

Denne appen er bygget som en **stateful Express-server** med:

- lokal SQLite-fil (`./data/tournament.db`)
- filopplasting til lokal disk (`./uploads/*`)
- session-lagring på disk (`./data/sessions`)
- Server-Sent Events (`/api/events`) for live-oppdatering

På Vercel kjører backend som serverless-funksjoner med ephemeralt filsystem og uten vedvarende prosess.
Det betyr at miljøvariabler alene ikke er nok for at backend skal fungere stabilt.

Hvis du deployer på Vercel må du flytte state ut av lokal disk:

1. Bytt fra lokal SQLite til ekstern database (f.eks. Supabase Postgres).
2. Bytt filopplasting fra `./uploads` til objektlagring (f.eks. Supabase Storage / S3).
3. Bytt sessions til ekstern store (Redis/Postgres) eller stateless auth.
4. Vurder å erstatte SSE med en løsning som tåler serverless (polling/realtime-tjeneste).

## Railway note

Nei — denne endringen ødelegger **ikke** Railway.  
README-notatet er dokumentasjon, ikke kodeendring.

Railway kan fungere med dagens arkitektur hvis du setter opp vedvarende lagring:

- mount et persistent volume for `./data` (SQLite + sessions)
- mount et persistent volume for `./uploads` (bilder)
- behold én vedvarende web-prosess for SSE

Uten persistent volume vil du få samme type problemer etter restart/redeploy (tap av DB-filer, sessions og uploads).

## Tournament Day Flow

1. **Admin** creates the tournament (name, date, course)
2. **Admin** configures 18 holes (par values, photo-required holes)
3. **Admin** adds teams with unique 4-digit PINs
4. **Admin** sets tournament status to `active`
5. **Players** log in with their PIN on `/enter-score`
6. **Players** enter scores hole-by-hole; photo upload required on marked holes
7. **Spectators** watch the live scoreboard at `/scoreboard`
8. **Admin** assigns Longest Drive and Closest to Pin awards
9. **Admin** marks tournament as `completed` and adds to Legacy

## Tech Stack

- **Backend**: Node.js + Express
- **Database**: SQLite (better-sqlite3)
- **Live Updates**: Server-Sent Events (SSE)
- **File Uploads**: Multer
- **Auth**: Express-session (PIN for teams, password for admin)
- **Frontend**: Vanilla HTML/CSS/JS
