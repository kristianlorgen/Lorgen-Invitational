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
| `LORGEN_DATA_DIR` | `./data` (local) / `/tmp/lorgen-data` (Vercel) | Where SQLite DB is stored |
| `LORGEN_STORAGE_DIR` | project root (local) / `/tmp/lorgen-storage` (Vercel) | Where uploads and session files are stored |
| `LORGEN_ALLOW_EPHEMERAL_STORAGE` | `0` | Set to `1` to explicitly allow temporary Vercel `/tmp` storage for test use |
| `LORGEN_STRICT_PERSISTENCE` | `1` on Vercel / `0` otherwise | Set to `1` to hard-block write APIs when durable storage is missing |

### Vercel note

On Vercel the deployment bundle is read-only, so SQLite/session/upload paths must point to a writable folder (`/tmp`).  
This repo now defaults to `/tmp` automatically when `VERCEL=1`, but **data in `/tmp` is ephemeral** between invocations/redeploys.  
Typical symptoms are: newly created tournaments disappear, adding teams says the tournament does not exist, and uploaded images/coin backdrops vanish after refresh or tab close.  

By default on Vercel, write APIs are now blocked with `503` when only ephemeral `/tmp` storage is available.  
To temporarily bypass this in a test environment, set `LORGEN_ALLOW_EPHEMERAL_STORAGE=1`.  
Outside Vercel you can force strict behavior with `LORGEN_STRICT_PERSISTENCE=1`.  
For persistent production data, move storage to an external service (for example Supabase Postgres + object storage), or host on infrastructure with a persistent writable filesystem and set `LORGEN_DATA_DIR` accordingly.

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
