# 🛒 Shop Setup — Lorgen Invitational

Følg disse stegene i rekkefølge.

---

## Steg 1 — Kopier filer til repoet ditt

Kopier disse filene til riktig sted i prosjektet:

| Fil | Plassering |
|-----|-----------|
| `public/shop.html` | `public/shop.html` |
| `public/shop-success.html` | `public/shop-success.html` |
| `shop-routes.js` | `shop-routes.js` (rotnivå) |

---

## Steg 2 — Installer Stripe i prosjektet

Kjør dette i terminalen din (i prosjektmappen):

```bash
npm install stripe
```

---

## Steg 3 — Koble inn shop-routes.js i server.js

Åpne `server.js` og legg til disse to linjene.

**Øverst i filen (ved de andre require-linjene):**
```js
const shopRoutes = require('./shop-routes');
```

**Etter at `app` er opprettet, men FØR webhook-ruten (viktig!):**
```js
// Webhook MÅ komme før express.json() — legg denne linjen tidlig
app.use('/api/shop/webhook', express.raw({ type: 'application/json' }));

// Deretter resten av shop-rutene
app.use(shopRoutes);
```

> ⚠️ **Viktig:** Stripe webhook krever `express.raw()` og MÅ registreres
> FØR eventuelle `express.json()` middleware-linjer i server.js.

---

## Steg 4 — Legg til miljøvariabler

### Lokalt (.env-filen):
```
STRIPE_SECRET_KEY=sk_live_xxxxxxxxxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxx
PRINTFUL_API_KEY=ditt_nye_printful_token
PRINTFUL_PRODUCT_ID=69a1683e755074
BASE_URL=https://lorgen-invitational-production.up.railway.app
```

### På Railway:
1. Gå til [railway.app](https://railway.app) → ditt prosjekt
2. Klikk på tjenesten → **Variables**
3. Legg til de samme variablene som over

---

## Steg 5 — Sett opp Stripe Webhook

1. Gå til [dashboard.stripe.com/webhooks](https://dashboard.stripe.com/webhooks)
2. Klikk **"Add endpoint"**
3. URL: `https://lorgen-invitational-production.up.railway.app/api/shop/webhook`
4. Event: velg **`checkout.session.completed`**
5. Klikk **"Add endpoint"**
6. Kopier **"Signing secret"** (starter med `whsec_`)
7. Lim inn denne som `STRIPE_WEBHOOK_SECRET` i Railway-variablene

---

## Steg 6 — Legg til Shop-lenke i navigasjonen (valgfritt)

Hvis du vil ha Shop i navigasjonen på alle sidene, finn nav-menyen i de eksisterende HTML-filene og legg til:

```html
<li><a href="/shop">Shop</a></li>
```

---

## Steg 7 — Regenerer Printful API-token

Siden tokenet ble delt i chatten, gå til:
👉 [printful.com/dashboard/settings/api](https://www.printful.com/dashboard/settings/api)

Slett det gamle og lag et nytt. Oppdater `PRINTFUL_API_KEY` i Railway.

---

## Steg 8 — Push og deploy

```bash
git add .
git commit -m "Add shop with Stripe + Printful integration"
git push
```

Railway deployer automatisk når du pusher til main. ✅

---

## Test-modus

Vil du teste uten ekte betaling?
- Bruk `STRIPE_SECRET_KEY=sk_test_xxxx` (finn i Stripe Dashboard → test-modus)
- Testkortnummer: `4242 4242 4242 4242`, utløp: `12/34`, CVC: `123`

---

## Flyt når noen kjøper

```
Kunde → /shop
  → Velger størrelse
  → Klikker "Kjøp nå"
  → Stripe Checkout (kortbetaling)
  → Stripe sender webhook til /api/shop/webhook
  → Server oppretter ordre i Printful
  → Printful produserer og sender caps til kunde
  → Kunde videresendes til /shop/success
```
