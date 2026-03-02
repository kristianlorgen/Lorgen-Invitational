# Feilsøkingsguide: Produkt vises ikke i nettbutikken

Denne guiden er laget for deg som vil finne ut hvorfor et produkt ikke dukker opp på `/shop`.

## Mål

Du skal bekrefte disse fire punktene i rekkefølge:

1. Frontend henter produkter fra riktig API.
2. API-et returnerer faktisk produktet.
3. Produktet er aktivt i databasen (`is_active=1`).
4. Printful-kobling/variant er gyldig (`printful_variant_id` finnes).

---

## Steg 1 — Sjekk at `/api/shop/products` faktisk svarer

Kjør:

```bash
curl -sS https://DITT-DOMENE.no/api/shop/products | jq
```

Se etter:

- at `products` finnes
- om `products` er tom (`[]`) eller inneholder produkter
- feltet `printful_sync.last_error`

**Hvis `products` er tom:** gå videre til steg 2.

**Hvis API feiler (500/502):** sjekk server-logger først, deretter steg 3 og 4.

---

## Steg 2 — Sjekk checkout/readiness (miljøvariabler + produktlenker)

Kjør:

```bash
curl -sS https://DITT-DOMENE.no/api/shop/config | jq
```

Se etter:

- `ready_for_checkout: true/false`
- `issues[]`

Vanlige `issues`:

- `MISSING_PRINTFUL_API_TOKEN`
- `MISSING_STRIPE_SECRET_KEY`
- `MISSING_STRIPE_WEBHOOK_SECRET`
- `MISSING_PRINTFUL_LINKS`

**Tiltak:** legg inn manglende variabler i deploy-miljøet og redeploy.

---

## Steg 3 — Verifiser at produktet er aktivt i databasen

Kjør på server/container der appen kjører:

```bash
sqlite3 data/tournament.db "SELECT id, slug, name, is_active, printful_variant_id FROM webshop_products ORDER BY id;"
```

Se etter produktet ditt:

- `is_active` må være `1`
- `printful_variant_id` bør ha tallverdi

Hvis `is_active=0`, aktiver produktet:

```bash
sqlite3 data/tournament.db "UPDATE webshop_products SET is_active=1 WHERE id=PRODUKT_ID;"
```

---

## Steg 4 — Verifiser Printful-kobling (variant)

Hvis `printful_variant_id` mangler/null, vil checkout og ordreflyt feile for produktet.

Bruk admin-endepunkt for å finne manglende koblinger:

```bash
curl -sS -H "Authorization: Bearer DIN_ADMIN_API_KEY" \
  https://DITT-DOMENE.no/api/admin/shop/products/missing-printful | jq
```

Koble et produkt manuelt:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer DIN_ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"printful_variant_id":123456789}' \
  https://DITT-DOMENE.no/api/admin/shop/products/PRODUKT_ID/link-printful | jq
```

---

## Steg 5 — Test visuelt i nettbutikken

1. Åpne `https://DITT-DOMENE.no/shop`
2. Hard refresh (`Ctrl+F5` / `Cmd+Shift+R`)
3. Bekreft at produktkort vises
4. Legg i handlekurv og test checkout

Hvis produkt fortsatt mangler:

- sjekk at `slug`/`name` ikke overskrives av feil synk-data
- sjekk serverlogg for meldingen om Printful produktsync
- sjekk om Printful-produktet faktisk har `sync_variants`

---

## Hurtigsjekk (5 minutter)

Kjør disse i rekkefølge:

```bash
curl -sS https://DITT-DOMENE.no/api/shop/products | jq '.products | length'
curl -sS https://DITT-DOMENE.no/api/shop/config | jq
sqlite3 data/tournament.db "SELECT id,name,is_active,printful_variant_id FROM webshop_products ORDER BY id;"
```

Hvis du deler output fra disse tre, kan feilen vanligvis lokaliseres med en gang.
