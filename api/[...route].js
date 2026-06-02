const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const baseApp = require('./index');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });
const publicDir = path.join(__dirname, '..', 'public');

app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: true }));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const SESSION_SECRET = process.env.SESSION_SECRET || process.env.AUTH_SECRET || 'dev-secret';
const SPONSOR_BUCKET = process.env.SUPABASE_SPONSOR_BUCKET || process.env.SPONSOR_STORAGE_BUCKET || 'sponsor-ads';

const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

const placements = new Set(['frontpage', 'live_results', 'scorecard', 'admin', 'hole']);
const injectedPages = {
  '/': 'index.html',
  '/admin': 'admin.html',
  '/enter-score': 'enter-score.html',
  '/scoreboard': 'scoreboard.html',
  '/sponsor-admin': 'sponsor-admin.html'
};

function sendInjectedPage(req, res, fileName) {
  const filePath = path.join(publicDir, fileName);
  fs.readFile(filePath, 'utf8', (error, html) => {
    if (error) return res.status(404).send('Not found');
    if (fileName === 'sponsor-admin.html' || html.includes('/js/sponsor-ads.js')) {
      return res.type('html').send(html);
    }
    return res.type('html').send(html.replace('</body>', '<script src="/js/sponsor-ads.js" defer></script>\n</body>'));
  });
}

for (const [routePath, fileName] of Object.entries(injectedPages)) {
  app.get(routePath, (req, res) => sendInjectedPage(req, res, fileName));
}

function ok(res, data = {}, status = 200) {
  return res.status(status).json({ success: true, ...data });
}

function fail(res, status, error, details) {
  return res.status(status).json({ success: false, error, ...(details ? { details } : {}) });
}

function asInt(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function parseCookies(req) {
  const cookies = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index > -1) cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
}

function decodeSession(token) {
  if (!token) return null;
  const [body, signature] = token.split('.');
  if (!body || !signature || sign(body) !== signature) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!parsed.exp || parsed.exp < Date.now()) return null;
    return parsed;
  } catch (_error) {
    return null;
  }
}

function requireAdmin(req, res) {
  const session = decodeSession(parseCookies(req).admin_session);
  if (session?.role === 'admin') return true;

  const headerToken = req.headers['x-admin-api-key'] || req.headers['x-admin-token'];
  const bearerToken = typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ')
    ? req.headers.authorization.slice(7).trim()
    : '';
  const expectedApiKey = process.env.ADMIN_API_KEY || '';
  if (expectedApiKey && (headerToken === expectedApiKey || bearerToken === expectedApiKey)) return true;

  fail(res, 401, 'Admin authentication required');
  return false;
}

function firstValue(source, keys, fallback = '') {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return fallback;
}

function normalizeSponsor(row = {}) {
  const logo = firstValue(row, ['logo_path', 'sponsor_logo', 'logo_url']);
  const url = firstValue(row, ['sponsor_url', 'website_url']);
  const name = firstValue(row, ['sponsor_name', 'name']);
  return {
    ...row,
    sponsor_name: name,
    name,
    logo_path: logo,
    sponsor_logo: logo,
    logo_url: logo,
    sponsor_url: url,
    website_url: url,
    is_enabled: Boolean(row.is_enabled ?? row.active),
    active: Boolean(row.active ?? row.is_enabled)
  };
}

function sponsorPayload(body = {}) {
  const placement = placements.has(String(body.placement || '').trim()) ? String(body.placement).trim() : 'frontpage';
  const name = String(firstValue(body, ['sponsor_name', 'name'])).trim();
  const logo = String(firstValue(body, ['logo_path', 'sponsor_logo', 'logo_url'])).trim();
  const url = String(firstValue(body, ['sponsor_url', 'website_url'])).trim();
  const description = String(firstValue(body, ['description', 'tagline'])).trim();
  const enabled = body.is_enabled === true || body.is_enabled === 'true' || body.active === true || body.active === 'true';

  return {
    tournament_id: asInt(body.tournament_id),
    placement,
    hole_number: placement === 'hole' ? asInt(body.hole_number) : null,
    spot_number: asInt(body.spot_number) || asInt(body.position) || 1,
    position: asInt(body.position) || asInt(body.spot_number) || 1,
    sponsor_name: name,
    name,
    description,
    tagline: description,
    logo_path: logo,
    sponsor_logo: logo,
    logo_url: logo,
    sponsor_url: url,
    website_url: url,
    is_enabled: enabled,
    active: enabled,
    updated_at: new Date().toISOString()
  };
}

async function getActiveTournamentId() {
  const { data } = await supabase
    .from('tournaments')
    .select('id')
    .in('status', ['active', 'upcoming'])
    .order('date', { ascending: true })
    .limit(1)
    .maybeSingle();
  return asInt(data?.id);
}

function asyncRoute(fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (error) {
      console.error(`[sponsors:error] ${req.method} ${req.path}`, error);
      fail(res, 500, 'Unexpected sponsor API error');
    }
  };
}

app.get('/api/sponsors', asyncRoute(async (req, res, next) => {
  if (!supabase) return next();

  const placement = placements.has(String(req.query.placement || '').trim()) ? String(req.query.placement).trim() : null;
  const tournamentId = asInt(req.query.tournament_id || req.query.tournamentId) || await getActiveTournamentId();
  const holeNumber = asInt(req.query.hole_number || req.query.holeNumber);

  let query = supabase
    .from('sponsors')
    .select('*')
    .or('is_enabled.eq.true,active.eq.true')
    .order('position', { ascending: true })
    .order('spot_number', { ascending: true });

  if (placement) query = query.eq('placement', placement);
  if (tournamentId) query = query.or(`tournament_id.eq.${tournamentId},tournament_id.is.null`);
  if (holeNumber) query = query.eq('hole_number', holeNumber);

  const { data, error } = await query;
  if (error) return fail(res, 500, 'Could not fetch sponsors', error.message);
  return ok(res, { sponsors: (data || []).map(normalizeSponsor) });
}));

app.get('/api/admin/sponsors', asyncRoute(async (req, res, next) => {
  if (!supabase) return next();
  if (!requireAdmin(req, res)) return;

  const { data, error } = await supabase
    .from('sponsors')
    .select('*')
    .order('placement', { ascending: true })
    .order('position', { ascending: true })
    .order('hole_number', { ascending: true });
  if (error) return fail(res, 500, 'Could not fetch sponsors', error.message);
  return ok(res, { sponsors: (data || []).map(normalizeSponsor) });
}));

app.post('/api/admin/sponsors/upload', upload.single('image'), asyncRoute(async (req, res, next) => {
  if (!supabase) return next();
  if (!requireAdmin(req, res)) return;
  if (!req.file) return fail(res, 400, 'No image file uploaded');

  const extension = (req.file.originalname.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const tournamentId = asInt(req.body?.tournament_id) || 'generic';
  const storagePath = `sponsors/${tournamentId}/${Date.now()}-${Math.round(Math.random() * 1e6)}.${extension}`;
  const uploadResult = await supabase.storage.from(SPONSOR_BUCKET).upload(storagePath, req.file.buffer, {
    contentType: req.file.mimetype || 'application/octet-stream',
    upsert: true
  });
  if (uploadResult.error) return fail(res, 500, 'Could not upload sponsor image', uploadResult.error.message);

  const publicUrl = supabase.storage.from(SPONSOR_BUCKET).getPublicUrl(storagePath).data.publicUrl;
  return ok(res, { logo_path: publicUrl, sponsor_logo: publicUrl, logo_url: publicUrl, storage_path: storagePath }, 201);
}));

app.post('/api/admin/sponsors', asyncRoute(async (req, res, next) => {
  if (!supabase) return next();
  if (!requireAdmin(req, res)) return;

  const payload = { ...sponsorPayload(req.body), created_at: new Date().toISOString() };
  if (payload.placement === 'hole' && !payload.hole_number) return fail(res, 400, 'hole_number is required for hole sponsors');
  const { data, error } = await supabase.from('sponsors').insert(payload).select('*').single();
  if (error) return fail(res, 500, 'Could not create sponsor', error.message);
  return ok(res, { sponsor: normalizeSponsor(data) }, 201);
}));

app.put('/api/admin/sponsors/:id', asyncRoute(async (req, res, next) => {
  if (!supabase) return next();
  if (!requireAdmin(req, res)) return;

  const id = asInt(req.params.id);
  if (!id) return fail(res, 400, 'Invalid sponsor id');
  const payload = sponsorPayload(req.body);
  if (payload.placement === 'hole' && !payload.hole_number) return fail(res, 400, 'hole_number is required for hole sponsors');
  const { data, error } = await supabase.from('sponsors').update(payload).eq('id', id).select('*').single();
  if (error) return fail(res, 500, 'Could not update sponsor', error.message);
  return ok(res, { sponsor: normalizeSponsor(data) });
}));

app.delete('/api/admin/sponsors/:id', asyncRoute(async (req, res, next) => {
  if (!supabase) return next();
  if (!requireAdmin(req, res)) return;

  const id = asInt(req.params.id);
  if (!id) return fail(res, 400, 'Invalid sponsor id');
  const { error } = await supabase.from('sponsors').delete().eq('id', id);
  if (error) return fail(res, 500, 'Could not delete sponsor', error.message);
  return ok(res, { deleted: true });
}));

app.use((req, res) => baseApp(req, res));

module.exports = (req, res) => app(req, res);
