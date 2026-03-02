#!/usr/bin/env node
const http = require('http');

function maskSecret(value = '') {
  const clean = String(value || '');
  if (!clean) return '(empty)';
  if (clean.length <= 8) return `${clean.slice(0, 4)}****`;
  return `${clean.slice(0, 8)}****${clean.slice(-4)}`;
}

function validateEnv() {
  const issues = [];
  const stripeSecret = String(process.env.STRIPE_SECRET_KEY || '').trim();
  const webhookSecret = String(process.env.STRIPE_WEBHOOK_SECRET || '').trim();
  const printfulToken = String(process.env.PRINTFUL_API_TOKEN || process.env.PRINTFUL_API_KEY || '').trim();

  if (!stripeSecret) issues.push('MISSING_STRIPE_SECRET_KEY: STRIPE_SECRET_KEY mangler');
  else if (!stripeSecret.startsWith('sk_test_') && !stripeSecret.startsWith('sk_live_')) {
    issues.push('INVALID_STRIPE_SECRET_KEY_PREFIX: STRIPE_SECRET_KEY må starte med sk_test_ eller sk_live_');
  }

  if (!webhookSecret) issues.push('MISSING_STRIPE_WEBHOOK_SECRET: STRIPE_WEBHOOK_SECRET mangler');
  else if (!webhookSecret.startsWith('whsec_')) {
    issues.push('INVALID_STRIPE_WEBHOOK_SECRET_PREFIX: STRIPE_WEBHOOK_SECRET må starte med whsec_');
  }

  if (!printfulToken) issues.push('MISSING_PRINTFUL_API_TOKEN: PRINTFUL_API_TOKEN mangler');

  console.log('Env status:');
  console.log(`- STRIPE_SECRET_KEY: ${maskSecret(stripeSecret)}`);
  console.log(`- STRIPE_WEBHOOK_SECRET: ${maskSecret(webhookSecret)}`);
  console.log(`- PRINTFUL_API_TOKEN: ${maskSecret(printfulToken)}`);
  if (issues.length) {
    console.log('\nMiljøvariabel-feil:');
    issues.forEach(issue => console.log(`  - ${issue}`));
  } else {
    console.log('\nMiljøvariabler ser OK ut.');
  }
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw || '{}') });
        } catch (e) {
          reject(new Error(`Ugyldig JSON fra ${url}: ${raw.slice(0, 300)}`));
        }
      });
    });
    req.on('error', reject);
  });
}

(async () => {
  validateEnv();

  const baseUrl = process.env.READY_BASE_URL || process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  try {
    const configRes = await getJson(`${baseUrl}/api/shop/config`);
    console.log(`\nGET ${baseUrl}/api/shop/config -> ${configRes.status}`);
    console.log(JSON.stringify(configRes.body, null, 2));

    const missingLinks = (configRes.body?.issues || []).find(i => i.code === 'MISSING_PRINTFUL_LINKS');
    if (missingLinks) {
      const products = missingLinks?.meta?.products || [];
      console.log('\nProdukter som mangler Printful-link:');
      products.forEach(product => {
        console.log(`- id=${product.id} name="${product.name || ''}" slug="${product.slug || ''}"`);
      });
      if (!products.length && Array.isArray(missingLinks?.meta?.product_ids)) {
        missingLinks.meta.product_ids.forEach(id => console.log(`- id=${id}`));
      }
    }

    process.exit(configRes.body?.ready_for_checkout ? 0 : 1);
  } catch (e) {
    console.error(`\nKunne ikke hente readiness fra server: ${e.message}`);
    process.exit(2);
  }
})();
