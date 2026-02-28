// shop-routes.js
const express = require('express');
const router = express.Router();
const Stripe = require('stripe');

const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY;
const PRINTFUL_PRODUCT_ID = process.env.PRINTFUL_PRODUCT_ID;

// Lazy Stripe initialization - unngår feil under bygging
let stripe;
function getStripe() {
  if (!stripe) stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  return stripe;
}

// ─────────────────────────────────────────
// POST /api/shop/create-checkout
// ─────────────────────────────────────────
router.post('/api/shop/create-checkout', async (req, res) => {
  const { size } = req.body;

  if (!size) {
    return res.status(400).json({ error: 'Størrelse mangler' });
  }

  try {
    const session = await getStripe().checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'nok',
            product_data: {
              name: 'Lorgen Invitational Flat Bill Cap',
              description: `Størrelse: ${size}`,
              images: [],
            },
            unit_amount: 40000,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      shipping_address_collection: {
        allowed_countries: ['NO', 'SE', 'DK', 'FI'],
      },
      metadata: {
        product: 'flat-bill-cap',
        size: size,
        printful_product_id: PRINTFUL_PRODUCT_ID,
      },
      success_url: `${process.env.BASE_URL}/shop/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.BASE_URL}/shop`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
// POST /api/shop/webhook
// ─────────────────────────────────────────
router.post('/api/shop/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = getStripe().webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { size, printful_product_id } = session.metadata;
    const shipping = session.shipping_details;
    const customerEmail = session.customer_details?.email;

    try {
      await createPrintfulOrder({ session, size, printful_product_id, shipping, customerEmail });
      console.log(`✅ Printful order created for session ${session.id}`);
    } catch (err) {
      console.error('Printful order error:', err.message);
    }
  }

  res.json({ received: true });
});

// ─────────────────────────────────────────
// Hjelpefunksjon: Hent Printful variant ID
// ─────────────────────────────────────────
async function getPrintfulVariantId(productId, size) {
  const res = await fetch(`https://api.printful.com/store/products/${productId}`, {
    headers: { 'Authorization': `Bearer ${PRINTFUL_API_KEY}` }
  });
  const data = await res.json();

  if (!data.result) throw new Error('Klarte ikke hente Printful-produkt');

  const variants = data.result.sync_variants;
  const match = variants.find(v =>
    v.name.toLowerCase().includes(size.toLowerCase())
  );

  if (!match) {
    console.warn(`Ingen variant funnet for størrelse ${size}, bruker første`);
    return variants[0].id;
  }

  return match.id;
}

// ─────────────────────────────────────────
// Hjelpefunksjon: Opprett Printful-ordre
// ─────────────────────────────────────────
async function createPrintfulOrder({ session, size, printful_product_id, shipping, customerEmail }) {
  const variantId = await getPrintfulVariantId(printful_product_id, size);

  const addr = shipping?.address;
  const name = shipping?.name || session.customer_details?.name || 'Kunde';

  const order = {
    recipient: {
      name: name,
      email: customerEmail,
      address1: addr?.line1 || '',
      address2: addr?.line2 || '',
      city: addr?.city || '',
      zip: addr?.postal_code || '',
      country_code: addr?.country || 'NO',
    },
    items: [
      {
        sync_variant_id: variantId,
        quantity: 1,
      }
    ],
    retail_costs: {
      currency: 'NOK',
      subtotal: '400.00',
    }
  };

  const res = await fetch('https://api.printful.com/orders', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${PRINTFUL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(order)
  });

  const data = await res.json();

  if (data.code !== 200) {
    throw new Error(`Printful API feil: ${JSON.stringify(data)}`);
  }

  await fetch(`https://api.printful.com/orders/${data.result.id}/confirm`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${PRINTFUL_API_KEY}` }
  });

  return data.result;
}

// ─────────────────────────────────────────
// GET /shop
// ─────────────────────────────────────────
router.get('/shop', (req, res) => {
  res.sendFile('shop.html', { root: './public' });
});

// ─────────────────────────────────────────
// GET /shop/success
// ─────────────────────────────────────────
router.get('/shop/success', (req, res) => {
  res.sendFile('shop-success.html', { root: './public' });
});

module.exports = router;
