# Lorgen Invitational

> Power. Precision. Party.

An annual 2-man scramble golf tournament website backed by Supabase for persistent data and storage.

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
| `NEXT_PUBLIC_SUPABASE_URL` | — | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | — | Supabase anon key for client requests |
| `SUPABASE_SERVICE_ROLE_KEY` | — | Service role key for trusted server-side writes |
| `ADMIN_PASSWORD` | `LorgenAdmin2025` | Admin panel password |
| `SESSION_SECRET` | required | Session signing secret |

### Vercel note

Vercel local filesystem is ephemeral and is **never** used for persistence in production.
All tournament data (tournaments, teams, scores) is stored in Supabase tables, and uploaded images are stored in Supabase Storage.

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

- **Backend**: Next.js API routes
- **Database**: Supabase Postgres
- **Storage**: Supabase Storage
- **Auth**: Session cookies + Supabase-backed APIs
- **Frontend**: Next.js + static assets
