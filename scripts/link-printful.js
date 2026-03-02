#!/usr/bin/env node
const http = require('http');

const args = process.argv.slice(2);
const shouldLinkAllMissing = args.includes('--all-missing');
if (!shouldLinkAllMissing) {
  console.log('Bruk: npm run link:printful -- --all-missing');
  process.exit(0);
}

const baseUrl = process.env.READY_BASE_URL || process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const adminToken = String(process.env.ADMIN_API_KEY || process.env.ADMIN_TOKEN || '').trim();

function requestJson(method, path, body) {
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = http.request(`${baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    }, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch (_) {}
        if (res.statusCode >= 400) {
          return reject(new Error(`${method} ${path} feilet (${res.statusCode}): ${data.error || raw || 'ukjent feil'}`));
        }
        resolve(data);
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

(async () => {
  try {
    const missing = await requestJson('GET', '/api/admin/shop/products/missing-printful');
    const products = Array.isArray(missing.products) ? missing.products : [];
    if (!products.length) {
      console.log('Ingen aktive produkter mangler Printful-link.');
      return;
    }

    console.log(`Fant ${products.length} produkter som mangler Printful-link.`);
    const failed = [];

    for (const product of products) {
      try {
        const result = await requestJson('POST', `/api/admin/shop/products/${product.id}/link-printful`, {});
        console.log(`✔ Produkt ${product.id} (${product.slug}) linket til variant ${result.linked_variant_id}`);
      } catch (e) {
        failed.push({ id: product.id, slug: product.slug, error: e.message });
        console.log(`✖ Produkt ${product.id} (${product.slug}) feilet: ${e.message}`);
      }
    }

    if (failed.length) {
      console.log(`\n${failed.length} produkter feilet:`);
      failed.forEach(f => console.log(`- ${f.id} (${f.slug}): ${f.error}`));
      process.exit(1);
    }

    console.log('\nAlle manglende produkter ble forsøkt linket.');
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
})();
