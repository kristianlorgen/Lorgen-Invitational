'use strict';

const dns = require('dns');
const https = require('https');
const multer = require('multer');
const path = require('path');
const db = require('./database');

const sponsorUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const mime = String(file.mimetype || '').toLowerCase();
    if (mime.startsWith('image/')) return cb(null, true);
    cb(new Error('Kun bilder er tillatt'));
  }
});

const PAGE_PLACEMENTS = new Set(['frontpage', 'live_results', 'scorecard', 'admin']);
const ALL_PLACEMENTS = new Set([...PAGE_PLACEMENTS, 'hole']);

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

function getSupabaseKeySource() {
  if (env('SUPABASE_SERVICE_ROLE_KEY')) return 'SUPABASE_SERVICE_ROLE_KEY';
  if (env('SUPABASE_SERVICE_KEY')) return 'SUPABASE_SERVICE_KEY';
  if (env('SUPABASE_ANON_KEY')) return 'SUPABASE_ANON_KEY';
  return '';
}

function getSupabaseDiagnosticBase() {
  const cfg = getSupabaseConfig();
  let host = '';
  if (cfg?.url) {
    try { host = new URL(cfg.url).hostname; }
    catch (_) { host = ''; }
  }
  return {
    has_supabase_url: Boolean(env('SUPABASE_URL')),
    normalized_url: cfg?.url || normalizeSupabaseUrl(env('SUPABASE_URL')),
    host,
    has_key: Boolean(getSupabaseKeySource()),
    key_source: getSupabaseKeySource(),
    bucket: cfg?.bucket || env('SUPABASE_SPONSOR_BUCKET') || env('SPONSOR_STORAGE_BUCKET') || 'sponsor-ads',
    node_version: process.version
  };
}

function jsonError(res, status, message) {
  return res.status(status).json({ error: message });
}

function requireAdminSession(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return jsonError(res, 401, 'Admininnlogging påkrevd');
}

function normalizeUrl(value = '') {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (/^(https?:)?\/\//i.test(trimmed) || trimmed.startsWith('mailto:') || trimmed.startsWith('tel:') || trimmed.startsWith('/')) return trimmed;
  return `https://${trimmed}`;
}

function getLocalActiveTournamentId() {
  try {
    const row = db.prepare("SELECT id FROM tournaments WHERE status IN ('active','upcoming') ORDER BY date ASC LIMIT 1").get();
    return row ? Number(row.id) : null;
  } catch (_) {
    return null;
  }
}

function sponsorSelect() {
  return 'id,tournament_id,placement,hole_number,spot_number,position,sponsor_name,name,description,tagline,logo_path,sponsor_logo,logo_url,sponsor_url,website_url,is_enabled,active,created_at,updated_at';
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

function normalizeSponsor(row) {
  const sponsorName = row.sponsor_name || row.name || '';
  const rawLogoPath = row.logo_path || row.sponsor_logo || row.logo_url || '';
  const logoPath = sponsorLogoForDisplay(rawLogoPath);
  const sponsorUrl = normalizeUrl(row.sponsor_url || row.website_url || '');
  const description = row.description || row.tagline || '';
  const enabled = Boolean(row.is_enabled || row.active);
  return {
    id: row.id,
    tournament_id: row.tournament_id,
    placement: row.placement,
    hole_number: row.hole_number,
    spot_number: row.spot_number || row.position || 1,
    position: row.position || row.spot_number || 1,
    sponsor_name: sponsorName,
    name: sponsorName,
    description,
    tagline: description,
    logo_path: logoPath,
    sponsor_logo: logoPath,
    logo_url: logoPath,
    raw_logo_path: rawLogoPath,
    sponsor_url: sponsorUrl,
    website_url: sponsorUrl,
    is_enabled: enabled,
    active: enabled,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function parseBody(text) {
  if (!text) return null;
  try { return JSON.parse(text); }
  catch (_) { return { message: text }; }
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
      timeout: 15000
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          statusCode: response.statusCode || 0,
          headers: response.headers || {},
          buffer,
          text: buffer.toString('utf8')
        });
      });
    });
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

async function supabaseRest(pathname, options = {}) {
  const cfg = getSupabaseConfig();
  if (!cfg) throw new Error('Supabase mangler SUPABASE_URL og service/anon key');
  const headers = {
    apikey: cfg.key,
    Authorization: `Bearer ${cfg.key}`,
    ...options.headers
  };
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

  let response;
  try {
    response = await httpsRequest(`${cfg.url}/rest/v1/${pathname}`, { ...options, headers });
  } catch (error) {
    throw new Error(`Kunne ikke kontakte Supabase (${cfg.url}): ${error.message || error}`);
  }

  const data = parseBody(response.text);
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(data?.message || data?.hint || `Supabase-feil ${response.statusCode}`);
  }
  return data;
}

async function getActiveTournamentId() {
  try {
    const rows = await supabaseRest('tournaments?select=id&status=in.(active,upcoming)&order=date.asc&limit=1');
    if (rows && rows[0] && rows[0].id) return Number(rows[0].id);
  } catch (_) {}
  return getLocalActiveTournamentId();
}

async function uploadToSupabaseStorage(file) {
  const cfg = getSupabaseConfig();
  if (!cfg) throw new Error('Supabase mangler SUPABASE_URL og service/anon key');
  const ext = path.extname(file.originalname || '').toLowerCase() || '.png';
  const objectPath = `sponsors/${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;

  let response;
  try {
    response = await httpsRequest(`${cfg.url}/storage/v1/object/${cfg.bucket}/${objectPath}`, {
      method: 'POST',
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
        'Content-Type': file.mimetype || 'application/octet-stream',
        'Cache-Control': '31536000',
        upsert: 'false'
      },
      body: file.buffer
    });
  } catch (error) {
    throw new Error(`Kunne ikke kontakte Supabase Storage (${cfg.url}): ${error.message || error}`);
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    const data = parseBody(response.text);
    throw new Error(data?.message || response.text || `Storage-feil ${response.statusCode}`);
  }
  return `${cfg.url}/storage/v1/object/${cfg.bucket}/${objectPath}`;
}

function sanitizeSponsorPayload(body = {}) {
  const placement = String(body.placement || '').trim() || 'frontpage';
  if (!ALL_PLACEMENTS.has(placement)) throw new Error('Ugyldig placement');
  const isHole = placement === 'hole';
  const holeNumber = isHole ? Number(body.hole_number) : null;
  if (isHole && (!Number.isInteger(holeNumber) || holeNumber < 1 || holeNumber > 18)) throw new Error('Ugyldig hullnummer');
  const spotNumber = Number(body.spot_number || body.position || 1) || 1;
  return {
    tournament_id: body.tournament_id ? Number(body.tournament_id) : null,
    placement,
    hole_number: holeNumber,
    spot_number: spotNumber,
    position: spotNumber,
    sponsor_name: String(body.sponsor_name || body.name || '').trim(),
    name: String(body.sponsor_name || body.name || '').trim(),
    description: String(body.description || body.tagline || '').trim(),
    tagline: String(body.description || body.tagline || '').trim(),
    logo_path: String(body.logo_path || body.raw_logo_path || body.sponsor_logo || body.logo_url || '').trim(),
    sponsor_logo: String(body.logo_path || body.raw_logo_path || body.sponsor_logo || body.logo_url || '').trim(),
    logo_url: String(body.logo_path || body.raw_logo_path || body.sponsor_logo || body.logo_url || '').trim(),
    sponsor_url: normalizeUrl(body.sponsor_url || body.website_url || ''),
    website_url: normalizeUrl(body.sponsor_url || body.website_url || ''),
    is_enabled: Boolean(body.is_enabled ?? body.active ?? true),
    active: Boolean(body.is_enabled ?? body.active ?? true)
  };
}

function dnsLookup(hostname) {
  return new Promise(resolve => {
    if (!hostname) return resolve({ error: 'Mangler Supabase-host' });
    dns.lookup(hostname, { all: true, family: 4 }, (error, addresses) => {
      if (error) return resolve({ error: error.message });
      resolve(addresses.map(address => address.address));
    });
  });
}

module.exports = function attachSponsorRoutes(app) {
  app.get('/api/sponsor-image', async (req, res) => {
    try {
      const cfg = getSupabaseConfig();
      if (!cfg) return res.status(404).end();
      const objectPath = storageObjectPath(req.query.src || '');
      if (!objectPath || objectPath.includes('..') || !objectPath.startsWith('sponsors/')) return res.status(404).end();
      const response = await httpsRequest(`${cfg.url}/storage/v1/object/${cfg.bucket}/${objectPath}`, {
        headers: {
          apikey: cfg.key,
          Authorization: `Bearer ${cfg.key}`
        }
      });
      if (response.statusCode < 200 || response.statusCode >= 300) return res.status(404).end();
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.type(response.headers['content-type'] || 'image/png').send(response.buffer);
    } catch (_) {
      res.status(404).end();
    }
  });

  app.get('/api/sponsors', async (req, res) => {
    try {
      const placement = String(req.query.placement || '').trim();
      if (placement && !ALL_PLACEMENTS.has(placement)) return jsonError(res, 400, 'Ugyldig placement');
      const tournamentId = req.query.tournament_id ? Number(req.query.tournament_id) : await getActiveTournamentId();
      const filters = ['select=' + encodeURIComponent(sponsorSelect()), 'is_enabled=eq.true'];
      if (placement) filters.push(`placement=eq.${encodeURIComponent(placement)}`);
      if (tournamentId) filters.push(`or=(tournament_id.is.null,tournament_id.eq.${tournamentId})`);
      if (req.query.hole_number) filters.push(`hole_number=eq.${Number(req.query.hole_number)}`);
      filters.push('order=placement.asc', 'order=position.asc', 'order=hole_number.asc');
      const rows = await supabaseRest(`sponsors?${filters.join('&')}`);
      res.json({ sponsors: (rows || []).map(normalizeSponsor), tournament_id: tournamentId || null });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/admin/sponsors', requireAdminSession, async (req, res) => {
    try {
      const tournamentId = req.query.tournament_id ? Number(req.query.tournament_id) : await getActiveTournamentId();
      const filters = ['select=' + encodeURIComponent(sponsorSelect())];
      if (tournamentId) filters.push(`or=(tournament_id.is.null,tournament_id.eq.${tournamentId})`);
      filters.push('order=placement.asc', 'order=position.asc', 'order=hole_number.asc');
      const rows = await supabaseRest(`sponsors?${filters.join('&')}`);
      res.json({ sponsors: (rows || []).map(normalizeSponsor), tournament_id: tournamentId || null });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/admin/sponsors/debug', requireAdminSession, async (req, res) => {
    const diagnostic = getSupabaseDiagnosticBase();
    try {
      const cfg = getSupabaseConfig();
      const dns_ipv4 = await dnsLookup(diagnostic.host);
      if (!cfg) return res.json({ ...diagnostic, dns_ipv4, rest_ok: false, rest_status: null, rest_error: 'Supabase mangler SUPABASE_URL og service/anon key' });

      let rest_status = null;
      let rest_error = null;
      try {
        const response = await httpsRequest(`${cfg.url}/rest/v1/`, {
          headers: {
            apikey: cfg.key,
            Authorization: `Bearer ${cfg.key}`,
            Accept: 'application/openapi+json'
          }
        });
        rest_status = response.statusCode;
      } catch (error) {
        rest_error = error.message || String(error);
      }

      res.json({
        ...diagnostic,
        dns_ipv4,
        rest_ok: Boolean(rest_status && rest_status >= 200 && rest_status < 500),
        rest_status,
        rest_error
      });
    } catch (error) {
      res.status(500).json({ ...diagnostic, error: error.message || String(error) });
    }
  });

  app.post('/api/admin/sponsors/upload', requireAdminSession, sponsorUpload.single('image'), async (req, res) => {
    try {
      if (!req.file) return jsonError(res, 400, 'Ingen fil lastet opp');
      const logoPath = await uploadToSupabaseStorage(req.file);
      res.json({ success: true, logo_path: logoPath, sponsor_logo: logoPath, logo_url: logoPath });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/admin/sponsors', requireAdminSession, async (req, res) => {
    try {
      const payload = sanitizeSponsorPayload(req.body);
      if (!payload.tournament_id) payload.tournament_id = await getActiveTournamentId();
      if (!payload.tournament_id) throw new Error('Ingen aktiv eller kommende turnering funnet');
      const rows = await supabaseRest('sponsors?select=' + encodeURIComponent(sponsorSelect()), {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(payload)
      });
      res.json({ success: true, sponsor: normalizeSponsor(rows[0]) });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.put('/api/admin/sponsors/:id', requireAdminSession, async (req, res) => {
    try {
      const payload = sanitizeSponsorPayload(req.body);
      if (!payload.tournament_id) payload.tournament_id = await getActiveTournamentId();
      if (!payload.tournament_id) throw new Error('Ingen aktiv eller kommende turnering funnet');
      const rows = await supabaseRest(`sponsors?id=eq.${Number(req.params.id)}&select=${encodeURIComponent(sponsorSelect())}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(payload)
      });
      res.json({ success: true, sponsor: normalizeSponsor(rows[0]) });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete('/api/admin/sponsors/:id', requireAdminSession, async (req, res) => {
    try {
      await supabaseRest(`sponsors?id=eq.${Number(req.params.id)}`, { method: 'DELETE' });
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/sponsor-admin', requireAdminSession, (req, res) => {
    res.sendFile(path.join(__dirname, 'public/sponsor-admin.html'));
  });
};
