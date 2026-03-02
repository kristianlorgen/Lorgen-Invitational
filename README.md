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
| `STRIPE_SECRET_KEY` | _(empty)_ | Required for Stripe checkout and some webshop routes |
| `STRIPE_WEBHOOK_SECRET` | _(empty)_ | Required for verifying Stripe webhook signatures |
| `PRINTFUL_API_TOKEN` | _(empty)_ | Required for creating Printful orders and product auto-linking |
| `ADMIN_API_KEY` | _(empty)_ | Optional token for admin API/script auth (Bearer or x-admin-token) |

### Railway deploy-feil: `secret STRIPE_SECRET_KEY: not found`

Hvis deploy-loggen stopper med `failed to solve: secret STRIPE_SECRET_KEY: not found`, er det **som regel ikke app-koden**, men at builden ser etter en Railway-secret som ikke er tilgjengelig i akkurat den tjenesten/miljøet som bygges.

Sjekk dette i rekkefølge:

1. Gå til **Railway → riktig service → Variables** (ikke bare prosjekt-roten).
2. Bekreft at miljøet øverst er riktig (f.eks. `production`, ikke `staging`).
3. Verifiser at nøkkelen heter **eksakt** `STRIPE_SECRET_KEY` (ingen mellomrom, ingen små skrivefeil).
4. Trigger en **ny deploy** etter at variabelen er lagret.
5. Hvis feilen fortsatt er lik, sjekk om du har en egen build-secret/reference i Railway som peker til `STRIPE_SECRET_KEY` uten at den finnes i samme scope.

Typiske årsaker når du "har lagt den inn" men build fortsatt feiler:
- variabelen er lagt på feil service
- variabelen er lagt i feil environment
- navnet matcher ikke 100% (`STRIPE_SECRET_KEY`)
- deployen du ser på startet før variabelen ble lagret

Hvis du ikke skal bruke Stripe enda, kan du midlertidig sette en dummy-verdi for `STRIPE_SECRET_KEY` for å få builden videre, og aktivere ekte nøkkel senere.

> Repoet inneholder nå også en `Dockerfile` som Railway kan bygge direkte. Det omgår Railpack sin secret-resolusjon i build-steget, så deploy blir mindre sårbar for denne feilen.


## Checkout readiness

Kjør readiness-sjekk lokalt (forventer at appen kjører):

```bash
npm run ready
```

Readiness sjekker:
- lokale env vars (Stripe/Printful)
- `GET /api/shop/config` for maskinlesbare issues
- liste over aktive produkter som mangler Printful-link

For batch-linking av alle manglende produkter:

```bash
ADMIN_API_KEY=<din-admin-nokkel> npm run link:printful -- --all-missing
```

> Scriptet bruker `/api/admin/shop/products/missing-printful` og `POST /api/admin/shop/products/:id/link-printful`.

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
- **Database**: SQLite (node:sqlite)
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
