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
- **Gallery** — Public highlights and voting on photos

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

## Webshop Blueprint (Stripe + Printful)

Se detaljert implementeringsplan i `docs/webshop-stripe-printful-plan.md`.

### Raskt svar på "Hva trenger du?"

Se sjekklisten i `docs/webshop-stripe-printful-plan.md`:
- `0) Konkret sjekkliste` (alt som må være på plass før launch)
- `0.1) Så hva trenger du å sende meg` (hvilke inputs som trengs for implementering)
- `0.2) Konkret input-liste` (det jeg ikke kan hente automatisk selv)
- `0.3) Nøyaktig steg-for-steg` (helt konkret fremgangsmåte for å hente alt jeg mangler)
