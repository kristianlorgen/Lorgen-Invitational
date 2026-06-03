'use strict';

const fs = require('fs');
const https = require('https');
const path = require('path');
const expressPath = require.resolve('express');
const express = require(expressPath);
const originalExpress = express;

const SPONSOR_SCRIPT = '<script src="/js/sponsor-ads.js?v=sponsor-server-render-20260603" defer></script>';
const INJECT_PATHS = new Set(['/', '/index.html', '/scoreboard', '/scoreboard.html', '/enter-score', '/enter-score.html', '/admin', '/admin.html']);
const PAGE_PLACEMENTS = new Map([
  ['/', 'frontpage'],
  ['/index.html', 'frontpage'],
  ['/scoreboard', 'live_results'],
  ['/scoreboard.html', 'live_results']
]);

function env(name) {
  return String(process.env[name] || '').trim();
}

function normalizeSupabaseUrl(value = '') {
  return String(value || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/rest\/v1$/i, '')
    .replace(/\/storage\/v1$/i, '');
}

function getSupabaseConfig() {
  const url = normalizeSupabaseUrl(env('SUPABASE_URL'));
  const key = env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SERVICE_KEY') || env('SUPABASE_ANON_KEY');
  const bucket = env('SUPABASE_SPONSOR_BUCKET') || env('SPONSOR_STORAGE_BUCKET') || 'sponsor-ads';
  if (!url || !key) return null;
  return { url, key, bucket };
}

function httpsRequest(urlString, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const body = options.body || null;
    const request = https.request({
      protocol: url.protocol,
      hostname: url.hostname,
      servername: url.hostname,
      family: 4,
      port: url.port || 443,
      path: `${url.pathname}${url.search}`,
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: 12000
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ statusCode: response.statusCode || 0, text: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}

function initials(name) {
  return String(name || 'Sponsor').split(' ').map(part => part[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

function storageObjectPath(value = '') {
  const cfg = getSupabaseConfig();
  const raw = String(value || '').trim();
  if (!raw || !cfg) return '';
  if (/^sponsors\//i.test(raw)) return raw;
  try {
    const url = new URL(raw);
    const publicPrefix = `/storage/v1/object/public/${cfg.bucket}/`;
    const privatePrefix = `/storage/v1/object/${cfg.bucket}/`;
    if (url.pathname.startsWith(publicPrefix)) return decodeURIComponent(url.pathname.slice(publicPrefix.length));
    if (url.pathname.startsWith(privatePrefix)) return decodeURIComponent(url.pathname.slice(privatePrefix.length));
  } catch (_) {}
  return '';
}

function sponsorLogoForDisplay(value = '') {
  const raw = String(value || '').trim();
  const objectPath = storageObjectPath(raw);
  if (!objectPath) return raw;
  return `/api/sponsor-image?src=${encodeURIComponent(raw)}`;
}

async function loadPageSponsors(placement) {
  const cfg = getSupabaseConfig();
  if (!cfg || !placement) return [];
  const select = 'id,placement,position,spot_number,sponsor_name,name,description,tagline,logo_path,sponsor_logo,logo_url,sponsor_url,website_url,is_enabled,active';
  const query = [
    'select=' + encodeURIComponent(select),
    'is_enabled=eq.true',
    `placement=eq.${encodeURIComponent(placement)}`,
    'order=position.asc',
    'order=spot_number.asc'
  ].join('&');
  const response = await httpsRequest(`${cfg.url}/rest/v1/sponsors?${query}`, {
    headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` }
  });
  if (response.statusCode < 200 || response.statusCode >= 300) return [];
  try { return JSON.parse(response.text) || []; }
  catch (_) { return []; }
}

function sponsorCard(row) {
  const name = row.sponsor_name || row.name || 'Sponsor';
  const desc = row.description || row.tagline || '';
  const logo = sponsorLogoForDisplay(row.logo_path || row.sponsor_logo || row.logo_url || '');
  const url = row.sponsor_url || row.website_url || '';
  const card = `
    <article style="width:220px;border:1px solid var(--gold-border);border-radius:12px;background:var(--white);box-shadow:var(--shadow-sm);padding:18px 16px;display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center">
      <div style="width:130px;height:160px;background:var(--gold-pale);border:1px solid var(--gold-border);display:flex;align-items:center;justify-content:center;overflow:hidden">
        ${logo ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(name)}" style="width:100%;height:100%;object-fit:cover;display:block">` : `<div style="font-weight:800;color:var(--gold-dark);font-size:1.2rem">${escapeHtml(initials(name))}</div>`}
      </div>
      <div>
        <div style="font-weight:800;color:var(--dark);font-size:1.02rem;line-height:1.2">${escapeHtml(name)}</div>
        ${desc ? `<div style="font-size:.74rem;color:var(--text-muted);line-height:1.35;margin-top:4px">${escapeHtml(desc)}</div>` : ''}
      </div>
    </article>`;
  return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit">${card}</a>` : card;
}

async function pageSponsorMarkup(placement) {
  const sponsors = await loadPageSponsors(placement);
  if (!sponsors.length) return '';
  return `
<section data-server-sponsor-placement="${escapeHtml(placement)}" style="margin:28px auto;max-width:1080px;padding:0 24px;text-align:center">
  <div style="margin:0 0 12px;font-size:.62rem;font-weight:800;letter-spacing:.32em;text-transform:uppercase;color:var(--text-muted)">Sponsorer</div>
  <div style="display:flex;justify-content:center;flex-wrap:wrap;gap:18px">${sponsors.map(sponsorCard).join('')}</div>
</section>`;
}

function injectSponsorScript(html) {
  const withoutOldScript = html.replace(/<script src="\/js\/sponsor-ads\.js[^\"]*" defer><\/script>\s*/g, '');
  return withoutOldScript.replace(/<\/body>/i, `${SPONSOR_SCRIPT}\n</body>`);
}

async function injectPageSponsorMarkup(html, reqPath) {
  const placement = PAGE_PLACEMENTS.get(reqPath);
  if (!placement || html.includes('data-server-sponsor-placement')) return html;
  const markup = await pageSponsorMarkup(placement);
  if (!markup) return html;
  if (placement === 'frontpage') {
    if (html.includes('<!-- Turneringsinfo -->')) return html.replace('<!-- Turneringsinfo -->', `${markup}\n\n<!-- Turneringsinfo -->`);
    return html.replace('</section>', `</section>\n${markup}`);
  }
  if (html.includes('<div id="noTournamentState"')) return html.replace('<div id="noTournamentState"', `${markup}\n\n<div id="noTournamentState"`);
  return html.replace('<!-- ── Ingen aktiv turnering', `${markup}\n\n<!-- ── Ingen aktiv turnering`);
}

async function injectHtml(html, reqPath) {
  const withMarkup = await injectPageSponsorMarkup(html, reqPath);
  return injectSponsorScript(withMarkup);
}

async function sendInjectedFile(req, res, filePath) {
  try {
    const html = fs.readFileSync(filePath, 'utf8');
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(await injectHtml(html, req.path));
  } catch (error) {
    res.status(500).send('Kunne ikke laste side');
  }
}

function wrappedExpress(...args) {
  const app = originalExpress(...args);

  app.use(async (req, res, next) => {
    if (INJECT_PATHS.has(req.path)) {
      const clean = req.path === '/' ? 'index' : req.path.replace(/^\//, '').replace(/\.html$/, '');
      const filePath = path.join(__dirname, 'public', `${clean}.html`);
      if (fs.existsSync(filePath)) return sendInjectedFile(req, res, filePath);
    }

    const originalSendFile = res.sendFile.bind(res);
    res.sendFile = (filePath, ...sendArgs) => {
      if (typeof filePath === 'string' && filePath.endsWith('.html') && INJECT_PATHS.has(req.path) && fs.existsSync(filePath)) {
        return sendInjectedFile(req, res, filePath);
      }
      return originalSendFile(filePath, ...sendArgs);
    };
    next();
  });

  const originalListen = app.listen.bind(app);
  let sponsorRoutesAttached = false;

  app.listen = (...listenArgs) => {
    if (!sponsorRoutesAttached) {
      sponsorRoutesAttached = true;
      require('./sponsor-routes')(app);
    }
    return originalListen(...listenArgs);
  };

  return app;
}

Object.assign(wrappedExpress, originalExpress);
require.cache[expressPath].exports = wrappedExpress;
require('./server');