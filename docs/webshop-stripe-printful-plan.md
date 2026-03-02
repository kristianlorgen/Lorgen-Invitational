# Webshop-oppsett (Stripe + Printful) – komplett gjennomføringsplan

Denne planen er laget for raskest mulig vei til en robust nettbutikk med:

- **Stripe** for betaling
- **Printful** for katalog, produksjon og dropshipping
- **Egen nettside** som frontend og kontrollflate

Mål: En løsning som er enkel å implementere, men med profesjonell struktur (idempotente webhooks, ordresporing, feilhåndtering og tydelig dataflyt).

---

## 0) Konkret sjekkliste: dette må være på plass før du kan lansere

Hvis du følger planen, trenger du dette for å sette opp en **fullt fungerende webshop**:

### A) Kontoer og tilgang
- Stripe-konto (aktivert for betaling i landet ditt)
- Printful-konto med ferdig oppsatt butikk/integrasjon
- Hosting for backend/frontend (for eksempel Vercel/Render/Railway)
- Database (Postgres eller SQLite i enkel MVP)
- Domene + DNS-kontroll
- E-posttjeneste for ordrebekreftelse (f.eks. Resend/Sendgrid/Postmark)

### B) Nøkler og hemmeligheter (env)
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `PRINTFUL_API_KEY`
- `PRINTFUL_WEBHOOK_SECRET`
- `SESSION_SECRET`
- `DATABASE_URL`
- `APP_BASE_URL`

### C) Minimum funksjoner i kode
- Produktside med varianter (størrelse/farge)
- Handlekurv
- `POST /api/checkout-session`
- Stripe webhook-endepunkt med signaturverifisering
- Opprettelse av ordre i lokal DB
- Opprettelse av Printful-ordre etter betalt checkout
- Printful webhook-endepunkt som oppdaterer ordrestatus/tracking
- Ordresporing-side for kunde
- Enkel admin-side/logg for feilede ordre

### D) Innhold/juridisk før produksjon
- Kjøpsvilkår
- Personvernerklæring
- Retur/angrerett-policy
- Fraktinfo (leveringstid/kostnader)
- Kontaktinformasjon og supportprosess

### E) Drift og kvalitet
- Test av hele flyten i Stripe test mode
- Testordre til Printful sandbox/testflyt
- Overvåking av webhook-feil
- Retry-jobb for midlertidige API-feil
- Backup-rutine for database

Når A–E er dekket, har du i praksis alt som trengs for en fungerende, produksjonsklar webshop med Stripe + Printful.

---


## 0.1) Så hva trenger du å sende meg for at jeg skal bygge dette?

Hvis målet er at jeg skal implementere dette for deg, trenger jeg disse konkrete inputene:

1. **Teknisk tilgang**
   - Git-repo med skrive-tilgang
   - Deploy-mål (Vercel/Render/Railway)
   - Valgt database (Supabase/Neon/Postgres/SQLite)

2. **Stripe**
   - Test API-nøkler (`STRIPE_SECRET_KEY`, ev. publishable key)
   - Opprettet webhook-endepunkt + `STRIPE_WEBHOOK_SECRET`
   - Hvilke land/valutaer du skal støtte

3. **Printful**
   - `PRINTFUL_API_KEY`
   - Liste over produkter/varianter som skal selges (eller klarsignal til å hente alt)
   - Opprettet webhook + `PRINTFUL_WEBHOOK_SECRET`

4. **Butikkregler**
   - Fraktregler (gratis frakt-grense, pris per land, leveringstider)
   - Retur/refusjon-regler
   - MVA-oppsett (inkl./ekskl. mva i pris)

5. **Innhold/design**
   - Produkttekster og bilder
   - Brand (logo/farger/typografi)
   - Sider: vilkår, personvern, kontakt

6. **MVP-scope (beslutning)**
   - Hvilke funksjoner som er “must-have” ved launch
   - Hva som kan vente til fase 2 (rabattkoder, gavekort, flere språk, osv.)

Når dette er levert, kan implementeringen kjøres ende-til-ende uten blokkere.

---


## 0.2) Konkret input-liste: dette kan jeg **ikke** hente selv

Dette er informasjon du må gi meg manuelt (jeg kan ikke trygt/automatisk hente dette fra internett):

1. **Tilganger og hemmeligheter**
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - `PRINTFUL_API_KEY`
   - `PRINTFUL_WEBHOOK_SECRET`
   - Eventuelle deploy-nøkler / DB-credentials

2. **Forretningsvalg**
   - Hvilke land du selger til
   - Hvilken valuta du bruker
   - Fraktregler (pris, gratis-frakt-grense, leveringstider)
   - MVA-oppsett (inkl./ekskl. mva, satser per marked)

3. **Juridisk innhold**
   - Kjøpsvilkår
   - Personvernerklæring
   - Retur- og refusjonspolicy
   - Kontaktinfo for kundeservice

4. **Produkt- og merkeinnhold**
   - Hvilke produkter/varianter som skal være aktive
   - Endelige priser og marginmål
   - Produkttekster, bilder og evt. størrelsesguider
   - Logo, farger og visuell profil

5. **Operative beslutninger**
   - Hva som er MVP ved launch vs. senere faser
   - Hvordan du vil håndtere support (e-post, svartid, ansvarlig person)
   - Regler for manuell overstyring ved feil ordre

### Kort oppsummert
Hvis du gir meg punktene over, kan jeg bygge resten (kode, integrasjon, dataflyt, webhook-logikk, adminflyt og produksjonsoppsett).

---

## 0.3) Nøyaktig steg-for-steg: slik finner du all informasjonen jeg mangler

Bruk denne som en ren arbeidsliste. Når du er ferdig, limer du alt i én melding til meg.

### Del A — Stripe (15–30 min)

1. Logg inn på `dashboard.stripe.com`.
2. Sørg for at du står i riktig modus:
   - Start med **Test mode** aktivert.
3. Hent API-nøkler:
   - Gå til **Developers → API keys**.
   - Kopier:
     - `Publishable key` (starter ofte med `pk_test_...`)
     - `Secret key` (starter ofte med `sk_test_...`)
4. Opprett webhook-endepunkt:
   - Gå til **Developers → Webhooks → Add endpoint**.
   - Endpoint URL: `https://DITT-DOMENE.no/api/webhooks/stripe`
   - Velg events:
     - `checkout.session.completed`
     - `payment_intent.payment_failed`
     - `charge.refunded`
5. Kopier webhook secret:
   - Åpne webhooken du lagde.
   - Trykk **Reveal** på signing secret.
   - Kopier verdien (starter ofte med `whsec_...`).
6. Avklar betalingsinnstillinger:
   - **Settings → Payments**: noter hvilke betalingsmetoder du vil aktivere (kort, Vipps via Stripe-partner, osv. dersom tilgjengelig).
   - Noter valuta du vil bruke (f.eks. `NOK`).

**Send meg dette fra Stripe:**
- `STRIPE_PUBLISHABLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- Valuta + ønskede betalingsmetoder

### Del B — Printful (20–40 min)

1. Logg inn på `printful.com`.
2. Opprett/gjennomgå butikktilkobling:
   - Gå til **Stores** og bekreft hvilken store som skal brukes.
3. Hent API-nøkkel:
   - Gå til **Settings → API** (kan ligge under developer/API-seksjon avhengig av UI-versjon).
   - Opprett ny private token/API key med tilgang til produkter + ordre.
   - Kopier nøkkelen.
4. Sett opp webhook:
   - Gå til webhook-seksjonen i Printful-innstillinger.
   - Endpoint URL: `https://DITT-DOMENE.no/api/webhooks/printful`
   - Aktiver ordre/tracking-relaterte events.
5. Kopier webhook secret/signature key (hvis vist i UI).
6. Eksporter produktgrunnlag:
   - Fra store-katalogen, noter hvilke produkter/varianter som skal selges i MVP.
   - For hver variant: noter navn, variant-ID, kostpris, tilgjengelige størrelser/farger.

**Send meg dette fra Printful:**
- `PRINTFUL_API_KEY`
- `PRINTFUL_WEBHOOK_SECRET` (eller bekreft om Printful-kontoen din ikke viser egen secret)
- Liste over aktive produkter/varianter for launch

### Del C — Domene, drift og database (15–30 min)

1. Velg hvor siden hostes:
   - F.eks. Vercel / Render / Railway.
2. Velg database:
   - MVP: SQLite ok
   - Produksjon: Postgres (Supabase/Neon/Railway)
3. Sett produksjonsdomene:
   - Eksempel: `shop.dittdomene.no` eller `dittdomene.no`.
4. Bekreft at DNS styres av deg (så webhook-URLene faktisk kan peke til riktig app).

**Send meg dette for drift:**
- Hostingplattform
- `APP_BASE_URL`
- Databasevalg + `DATABASE_URL`

### Del D — Forretningsregler jeg ikke kan gjette (20–45 min)

1. Markeder:
   - Hvilke land skal kunne bestille?
2. Frakt:
   - Fast pris eller dynamisk?
   - Gratis frakt over X kr?
3. MVA:
   - Prisene vist inkl. eller ekskl. MVA?
4. Retur/refusjon:
   - Antall dager angrerett
   - Hvem betaler returfrakt?
5. Kundeservice:
   - Support-epost
   - Mål for svartid

**Send meg dette som punktliste:**
- Land, valuta, fraktregler, MVA-regler, returpolicy, support-epost

### Del E — Innhold og merkevare (30–90 min)

1. Logo:
   - SVG/PNG i høy kvalitet.
2. Farger/typografi:
   - Primærfarge, sekundærfarge, knappestil.
3. Produkter:
   - Endelig salgspris per variant.
   - Produktnavn + kort beskrivelse.
4. Juridiske sider (kan være kladd):
   - Kjøpsvilkår
   - Personvernerklæring
   - Retur/refusjon
   - Kontakt-side

**Send meg dette samlet:**
- Logo + brandvalg + produkttekster/priser + juridisk tekstutkast

### Del F — Leveringsformat (kopier/lim-mal)

Send alt tilbake i dette formatet:

```txt
[Stripe]
STRIPE_PUBLISHABLE_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
Valuta=
Betalingsmetoder=

[Printful]
PRINTFUL_API_KEY=
PRINTFUL_WEBHOOK_SECRET=
Produkter/varianter for launch=

[Drift]
Hosting=
APP_BASE_URL=
DATABASE_URL=

[Forretning]
Land=
Fraktregler=
MVA=
Retur/refusjon=
Support-epost=

[Innhold]
Logo lenke/fil=
Farger/font=
Produkttekster/priser=
Lenker/tekst til juridiske sider=
```

Når du sender denne utfylt, kan jeg gå rett i implementering uten flere blokkere.

---

## 1) Kan du levere en hel fungerende webshop?

Kort svar: **Ja, teknisk sett kan dette leveres ende-til-ende**.

Leveranseomfang som er realistisk:

1. Produktkatalog med varianter og prisvisning
2. Handlekurv + Stripe Checkout
3. Webhook-basert ordrebehandling
4. Automatisk opprettelse av ordre i Printful etter bekreftet betaling
5. Statusoppdateringer (processing / fulfilled / shipped)
6. Enkel ordresporingsside for kunde
7. Admin-visning for feil/retry

Avklaringer før produksjonssetting:

- Juridisk innhold (vilkår, angrerett, personvern, cookies)
- MVA/frakt-strategi per marked
- Kundeserviceflyt (refusjon/retur)
- Domene, e-post, og overvåking

---

## 2) Foreslått arkitektur (MVP → produksjon)

**Frontend (nettsiden din):**
- Produktsider
- Handlekurv
- Redirect til Stripe Checkout
- Ordresporing-side

**Backend (API-lag):**
- `POST /api/checkout-session`
- `POST /api/webhooks/stripe`
- `POST /api/webhooks/printful`
- `GET /api/orders/:publicId`
- `POST /api/admin/orders/:id/retry` (admin)

**Databaser/tabeller:**
- `products`
- `product_variants`
- `orders`
- `order_items`
- `webhook_events`
- `integration_logs`

**Integrasjoner:**
- Stripe API + webhook-signaturverifisering
- Printful API + webhook-signaturverifisering

---

## 3) Hvilken informasjon trengs – og fra hvem?

## 3.1 Fra Stripe

### A) Credentials / oppsett
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- (Valgfritt) `STRIPE_PUBLISHABLE_KEY` hvis du viser dynamiske betalingselementer

### B) Data du må lese/lagre
- `checkout.session.id`
- `payment_intent`
- `customer_details` (navn, e-post, telefon)
- `amount_total`, `currency`
- `shipping_details` (mottaker + adresse)
- `metadata` (interne referanser som `cartId`, `orderDraftId`)

### C) Hendelser du må håndtere
- `checkout.session.completed` (kritisk)
- `payment_intent.payment_failed` (feiltilfeller)
- `charge.refunded` (etterbehandling)

---

## 3.2 Fra Printful

### A) Credentials / oppsett
- `PRINTFUL_API_KEY`
- `PRINTFUL_WEBHOOK_SECRET`

### B) Data du må lese/lagre
- `product` og `variant`-ID-er
- Lager/status-informasjon for varianter
- Fraktmetoder (når relevant)
- `order.id` hos Printful
- `status` (`draft`, `pending`, `inprocess`, `fulfilled`, `shipped`, osv.)
- Tracking-data (`tracking_number`, `tracking_url`, carrier)

### C) Hendelser du må håndtere
- Ordrestatus-endringer
- Sending/tracking oppdateringer
- Eventuelle avvisninger/feil

---

## 3.3 Fra egen nettside (kundeinput)

- E-post
- Fullt navn
- Telefonnummer (valgfritt, men anbefalt for levering)
- Leveringsadresse
- Kurvinnhold (produktvariant + antall)
- Samtykker (vilkår/personvern)

---

## 4) Nøyaktig hvordan hente informasjonen

## 4.1 Stripe – implementasjonsflyt

1. **Opprett Checkout Session**
   - Frontend sender kurv til `POST /api/checkout-session`.
   - Backend validerer variant-ID-er/priser fra egen DB (ikke stol på frontend-pris).
   - Backend lager Stripe Session med `line_items`, `success_url`, `cancel_url`, `metadata`.

2. **Motta webhook**
   - Stripe sender `checkout.session.completed` til `POST /api/webhooks/stripe`.
   - Backend verifiserer signatur med `STRIPE_WEBHOOK_SECRET`.
   - Event-ID lagres i `webhook_events` (idempotens).

3. **Opprett intern ordre**
   - Lag `orders` + `order_items` med status `paid`.
   - Lås totalbeløp/valuta i ordren.

4. **Send ordre til Printful**
   - Opprett ordre mot Printful API med kundedata + variant-linjer.
   - Lagre `printful_order_id`.

---

## 4.2 Printful – implementasjonsflyt

1. **Produktsynk (batch / cron / manuell trigger)**
   - Hent produkter/varianter fra Printful API.
   - Oppdater `products` og `product_variants` i egen DB.

2. **Webhook for ordrestatus**
   - Printful sender statusendringer til `POST /api/webhooks/printful`.
   - Verifiser signatur med `PRINTFUL_WEBHOOK_SECRET`.
   - Oppdater `orders.status` og tracking-felt.

3. **Varsling til kunde**
   - Ved `shipped`: send e-post med sporingslenke.

---

## 4.3 Datavalidering (må være på plass)

- Ingen priser fra frontend godtas uten server-side validering.
- Kun tillatte land/postformat godtas (dersom du begrenser marked).
- Webhooks behandles idempotent (`event_id` unik indeks).
- Alle integrasjonskall logges med korrelasjons-ID.

---

## 5) Datamodell (minimum)

## `products`
- `id`
- `printful_product_id`
- `name`
- `description`
- `image_url`
- `active`
- `updated_at`

## `product_variants`
- `id`
- `product_id`
- `printful_variant_id`
- `sku`
- `size`
- `color`
- `price_minor`
- `currency`
- `in_stock`

## `orders`
- `id`
- `public_id`
- `stripe_checkout_session_id`
- `stripe_payment_intent_id`
- `printful_order_id`
- `email`
- `customer_name`
- `shipping_json`
- `status`
- `total_minor`
- `currency`
- `created_at`

## `order_items`
- `id`
- `order_id`
- `product_variant_id`
- `title`
- `quantity`
- `unit_price_minor`

## `webhook_events`
- `id`
- `provider` (`stripe` | `printful`)
- `event_id`
- `received_at`
- `processed_at`
- `status`

---

## 6) Sikkerhet og drift

- Hold alle nøkler i miljøvariabler (aldri i frontend).
- Verifiser webhook-signatur før parsing/forretningslogikk.
- Rate-limit API-endepunkter.
- Kjør retry-kø for kall til Printful ved 429/5xx.
- Sett opp monitorering (f.eks. Sentry + uptime checks).
- Daglig rapport for mislykkede ordre-syncs.

---

## 7) Leveranseplan (praktisk)

## Fase 1 – MVP (ca. 1–2 uker)
1. Produktvisning + handlekurv
2. Stripe Checkout Session
3. Stripe webhook → `orders`
4. Opprette Printful-ordre etter betaling
5. Enkel ordresporing-side

## Fase 2 – Hardening (ca. 1 uke)
1. Idempotens og retry-kø
2. Full webhook-observability/logging
3. Admin-verktøy for retry/manual override

## Fase 3 – Produksjon (ca. 1 uke)
1. Juridiske sider + samtykketekster
2. E-postflyt for ordre/shipping
3. Lasttest + incident-runbook

---

## 8) Hva som leveres ferdig i en “hel fungerende webshop”

- Ferdig checkout med Stripe
- Automatisk ordreopprettelse i Printful
- Full statusflyt med sporingslenker
- Stabil feil- og retry-håndtering
- Admin-innsyn i ordre og integrasjonsfeil
- Dokumentasjon for drift, support og videreutvikling

Hvis du vil, kan neste steg være å bygge dette direkte inn i repoet med konkrete API-ruter, DB-migreringer og webhook-håndtering i Node/Express.
