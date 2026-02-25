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

## Webshop (Stripe + Printify + Supabase)

Webshop er nå bygget inn i nettsiden på `/webshop` med flyten:

1. Kunde velger produkt i webshop
2. `POST /api/checkout` oppretter Stripe Checkout Session
3. Stripe redirecter til `/webshop/success` eller `/webshop/cancel`
4. Stripe webhook (`POST /api/stripe/webhook`) verifiserer signatur på raw body
5. Ordre lagres i Supabase (`orders`)
6. Ordren sendes videre til Printify og oppdateres til `submitted` ved suksess

### Miljøvariabler

Sett følgende i `.env` (ikke commit secrets):

- `NEXT_PUBLIC_SITE_URL`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `PRINTIFY_API_TOKEN`

### Supabase migrasjon

Kjør SQL-migrasjonen i `supabase/migrations/20260225141000_webshop.sql`.
Den oppretter tabellene `products` og `orders` + RLS policy.

### Stripe webhook setup

Lokalt (med Stripe CLI):

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Bruk `whsec_...` fra CLI/dashboard i `STRIPE_WEBHOOK_SECRET`.

### How to add products (V1)

1. Opprett produkt i Printify UI.
2. Finn `shop_id` og `product_id` i Printify (fra URL/API).
3. Sett inn produkt i Supabase `products`:

```sql
insert into public.products (
  name,
  description,
  image_url,
  price_nok,
  currency,
  printify_shop_id,
  printify_product_id,
  printify_variant_id,
  is_active
) values (
  'Lorgen Cap',
  'Offisiell Lorgen cap',
  'https://.../image.jpg',
  34900,
  'NOK',
  '1234567',
  'abcdef123456',
  12345,
  true
);
```

> `price_nok` er i øre (f.eks. `34900` = 349,00 NOK).
