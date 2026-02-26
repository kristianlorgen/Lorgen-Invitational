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

## Webshop (Stripe + Printify, med valgfri Supabase)

Webshop er nå bygget inn i nettsiden på `/webshop` med flyten:

1. Kunde velger produkt i webshop
2. `POST /api/checkout` oppretter Stripe Checkout Session
3. Stripe redirecter til `/webshop/success` eller `/webshop/cancel`
4. Stripe webhook (`POST /api/stripe/webhook`) verifiserer signatur på raw body
5. Ordre lagres i Supabase (`orders`) **hvis konfigurert**, ellers i lokal SQLite (`webshop_orders`)
6. Ordren sendes videre til Printify og oppdateres til `submitted` ved suksess

### Miljøvariabler

Sett følgende i `.env` (ikke commit secrets):

- `NEXT_PUBLIC_SITE_URL`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `PRINTIFY_API_TOKEN` (eller alias `PRINTIFY_API_TOKEN_LORGENINV` under token-rotasjon)
- `SUPABASE_URL` *(valgfri)*
- `SUPABASE_ANON_KEY` *(valgfri)*
- `SUPABASE_SERVICE_ROLE_KEY` *(valgfri)*

### Feil: `Missing env var: STRIPE_SECRET_KEY`

Hvis nettsiden viser `Missing env var: STRIPE_SECRET_KEY`, betyr det at serveren mangler Stripe-secret i runtime-miljøet.

Sjekkliste:

1. Legg inn `STRIPE_SECRET_KEY` i `.env` lokalt eller i secrets-panelet hos hostingleverandøren.
2. Legg også inn `PRINTIFY_API_TOKEN` (brukes når ordre skal sendes videre til Printify).
3. Restart serveren etter at miljøvariabler er oppdatert.
4. Verifiser status på `GET /api/webshop/status`.

Tips: Del aldri secret keys i chat eller commit dem til git.

### Lokal fallback (anbefalt for rask gjenoppbygging)

Webshop fungerer nå uten Supabase så lenge Stripe + Printify er satt:

1. Legg inn `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` og `PRINTIFY_API_TOKEN` i `.env`.
2. Start serveren på nytt.
3. Verifiser `GET /api/webshop/status` (skal vise integrated når Stripe/Printify er på plass).
4. Legg inn Printify-mapping per produkt i lokal SQLite-tabell `webshop_products`:

```sql
update webshop_products
set printify_shop_id = 'DIN_SHOP_ID',
    printify_product_id = 'DIN_PRINTIFY_PRODUCT_ID',
    printify_variant_id = 12345
where id = 1;
```

> Ved checkout lagres ordre lokalt og webhook sender deretter ordren til Printify.

### Supabase migrasjon

Kjør SQL-migrasjonen i `supabase/migrations/20260225141000_webshop.sql`.
Den oppretter tabellene `products` og `orders` + RLS policy.


### Nytt webshop-oppsett (anbefalt restart)

Hvis webshop ikke fungerer etter tidligere oppsett, kjør en «ren» restart slik:

1. Oppdater `.env` med alle webshop-nøkler (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PRINTIFY_API_TOKEN` (evt. `PRINTIFY_API_TOKEN_LORGENINV`), `NEXT_PUBLIC_SITE_URL`).
2. Kjør SQL fra `supabase/migrations/20260225141000_webshop.sql` på nytt i Supabase SQL Editor.
3. Tøm gamle testordrer/produkter om nødvendig, og legg inn minst ett aktivt produkt i `public.products`.
4. Start serveren på nytt.
5. Verifiser status på `GET /api/webshop/status` (alle konfigurerte checks skal være `OK`).

> Backend prioriterer nå `SUPABASE_SERVICE_ROLE_KEY` for webshop-APIene, slik at webshop fortsatt fungerer selv om anon-key/policy-oppsett ikke er helt riktig.

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
