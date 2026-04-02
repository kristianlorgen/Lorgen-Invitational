const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });
const bootTimestamp = Date.now();

app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: true }));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SESSION_SECRET = process.env.SESSION_SECRET || process.env.AUTH_SECRET || 'dev-secret';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const GALLERY_BUCKET = process.env.SUPABASE_GALLERY_BUCKET || 'tournament-gallery';
const startupIssues = [];

if (!SUPABASE_URL) startupIssues.push('SUPABASE_URL mangler');
if (!SUPABASE_SERVICE_ROLE_KEY) startupIssues.push('SUPABASE_SERVICE_ROLE_KEY mangler');
if (!process.env.SESSION_SECRET && !process.env.AUTH_SECRET) {
  startupIssues.push('SESSION_SECRET/AUTH_SECRET mangler (fallback dev-secret brukes)');
}

let supabase = null;
let supabaseInitError = null;
try {
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  } else {
    supabaseInitError = 'Manglende Supabase-miljøvariabler';
  }
} catch (error) {
  supabaseInitError = error?.message || 'Ukjent Supabase init-feil';
}

console.log('[api:boot] Express API starter', {
  bootTimestamp,
  hasSupabaseUrl: Boolean(SUPABASE_URL),
  hasSupabaseServiceRoleKey: Boolean(SUPABASE_SERVICE_ROLE_KEY),
  hasSessionSecret: Boolean(process.env.SESSION_SECRET || process.env.AUTH_SECRET),
  startupIssues
});
if (supabaseInitError) {
  console.error('[api:boot] Supabase init-feil:', supabaseInitError);
}

app.use((req, _res, next) => {
  console.log(`[api:hit] ${req.method} ${req.path}`);
  if (req.method !== 'GET') {
    console.log(`[api:body] ${req.method} ${req.path}`, req.body || {});
  }
  next();
});

function ok(res, data = {}, status = 200) { return res.status(status).json({ success: true, ...data }); }
function fail(res, status, error, details) {
  return res.status(status).json({ success: false, error, ...(details ? { details } : {}) });
}
function requireSupabase(res) {
  if (supabase) return true;
  return fail(res, 503, 'API ikke klar', {
    startupIssues,
    supabaseInitError: supabaseInitError || null
  });
}
function asInt(v) { const n = Number(v); return Number.isInteger(n) ? n : null; }
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function sign(value) { return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex'); }
function encode(payload) { const body = Buffer.from(JSON.stringify(payload)).toString('base64url'); return `${body}.${sign(body)}`; }
function decode(token) {
  if (!token) return null;
  const [body, signature] = token.split('.');
  if (!body || !signature || sign(body) !== signature) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!parsed.exp || parsed.exp < Date.now()) return null;
    return parsed;
  } catch { return null; }
}
function setCookie(res, name, value, maxAge) {
  const attrs = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Secure'];
  if (maxAge) attrs.push(`Max-Age=${maxAge}`);
  res.append('Set-Cookie', attrs.join('; '));
}
function clearCookie(res, name) { res.append('Set-Cookie', `${name}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`); }
function getAdminSession(req) { return decode(parseCookies(req).admin_session); }
function getTeamSession(req) { return decode(parseCookies(req).team_session); }
function requireAdmin(req, res) {
  const admin = getAdminSession(req);
  if (admin?.role === 'admin') return true;
  fail(res, 401, 'Admin authentication required');
  return false;
}
function asyncRoute(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (error) {
      console.error(`[api:error] ${req.method} ${req.path}`, error);
      fail(res, 500, 'Uventet serverfeil');
    }
  };
}
function logApiDebug(tag, data = {}) {
  try {
    console.log(tag, JSON.stringify(data));
  } catch (_error) {
    console.log(tag, data);
  }
}



const schemaColumnsCache = {};
const schemaCacheTimestamps = {};

function extractTableColumnsFromOpenApi(openApi, tableName) {
  const allSchemas = {
    ...(openApi?.definitions || {}),
    ...(openApi?.components?.schemas || {})
  };

  const directMatch = allSchemas[tableName];
  if (directMatch?.properties) return Object.keys(directMatch.properties);

  const publicMatch = allSchemas[`public.${tableName}`];
  if (publicMatch?.properties) return Object.keys(publicMatch.properties);

  for (const [schemaName, schemaDef] of Object.entries(allSchemas)) {
    if (schemaName.endsWith(`.${tableName}`) && schemaDef?.properties) {
      return Object.keys(schemaDef.properties);
    }
  }

  return [];
}

async function fetchTableColumns(tableName) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return [];
  const now = Date.now();
  const cachedColumns = schemaColumnsCache[tableName];
  const cachedAt = schemaCacheTimestamps[tableName] || 0;
  if (cachedColumns && (now - cachedAt) < 5 * 60 * 1000) {
    return cachedColumns;
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        Accept: 'application/openapi+json'
      }
    });
    if (!response.ok) {
      console.error('[api:schema] Failed to fetch OpenAPI schema', { table: tableName, status: response.status, statusText: response.statusText });
      return cachedColumns || [];
    }

    const openApi = await response.json();
    const columns = extractTableColumnsFromOpenApi(openApi, tableName);

    schemaColumnsCache[tableName] = columns;
    schemaCacheTimestamps[tableName] = now;
    console.log(`[api:schema] public.${tableName} columns`, columns);
    return columns;
  } catch (error) {
    console.error('[api:schema] Could not read table schema', { table: tableName, error: error?.message || error });
    return cachedColumns || [];
  }
}

function buildDefaultHoles(tournamentId) {
  return Array.from({ length: 18 }, (_, index) => {
    const holeNumber = index + 1;
    return {
      tournament_id: tournamentId,
      hole_number: holeNumber,
      par: 4,
      stroke_index: holeNumber,
      requires_photo: false,
      is_longest_drive: false,
      is_nearest_pin: false
    };
  });
}

function normalizeHoleInput(hole = {}, tournamentId, fallbackHoleNumber) {
  const holeNumber = asInt(hole.hole_number) || fallbackHoleNumber;
  const par = asInt(hole.par) || 4;
  const strokeIndex = asInt(hole.stroke_index ?? hole.si);
  const requiresPhoto = hole.requires_photo === true || hole.requires_photo === 'true';
  const isLongestDrive = hole.is_longest_drive === true || hole.is_longest_drive === 'true';
  const isNearestPin = (hole.is_nearest_pin ?? hole.is_closest_to_pin) === true || (hole.is_nearest_pin ?? hole.is_closest_to_pin) === 'true';
  return {
    tournament_id: tournamentId,
    hole_number: holeNumber,
    par,
    stroke_index: strokeIndex || holeNumber,
    requires_photo: requiresPhoto,
    is_longest_drive: isLongestDrive,
    is_nearest_pin: isNearestPin
  };
}

async function getActiveTournament() {
  const { data } = await supabase.from('tournaments').select('*').in('status', ['active', 'upcoming']).order('status', { ascending: true }).order('id').limit(1).maybeSingle();
  return data || null;
}

async function ensureTournamentHoles(tournamentId) {
  const holesColumns = await fetchTableColumns('holes');
  const requiredReadColumns = ['tournament_id', 'hole_number'];
  const missingReadColumns = requiredReadColumns.filter((column) => !holesColumns.includes(column));
  if (missingReadColumns.length) {
    throw new Error(`public.holes mangler nødvendige kolonner for lasting: ${missingReadColumns.join(', ')}`);
  }

  const { data, error } = await supabase
    .from('holes')
    .select(holesColumns.join(','))
    .eq('tournament_id', tournamentId)
    .order('hole_number', { ascending: true });
  if (error) throw new Error(error.message);

  if ((data || []).length > 0) return data;

  const fallbackHoles = buildDefaultHoles(tournamentId);
  const fallbackInsertPayload = fallbackHoles.map((hole) => {
    const row = {};
    for (const [key, value] of Object.entries(hole)) {
      if (holesColumns.includes(key)) row[key] = value;
    }
    return row;
  });

  if (fallbackInsertPayload.some((row) => !Object.prototype.hasOwnProperty.call(row, 'tournament_id') || !Object.prototype.hasOwnProperty.call(row, 'hole_number'))) {
    throw new Error('public.holes støtter ikke påkrevde felter tournament_id og hole_number for standardhull');
  }

  const { error: insertError } = await supabase
    .from('holes')
    .upsert(fallbackInsertPayload, { onConflict: 'tournament_id,hole_number' });
  if (insertError) throw new Error(insertError.message);

  const { data: created, error: createdError } = await supabase
    .from('holes')
    .select(holesColumns.join(','))
    .eq('tournament_id', tournamentId)
    .order('hole_number', { ascending: true });
  if (createdError) throw new Error(createdError.message);
  return created || [];
}

app.post('/api/auth/admin-login', asyncRoute(async (req, res) => {
  if (!ADMIN_PASSWORD) return fail(res, 500, 'ADMIN_PASSWORD er ikke satt');
  if (String(req.body?.password || '') !== ADMIN_PASSWORD) return fail(res, 401, 'Ugyldig innlogging');
  setCookie(res, 'admin_session', encode({ role: 'admin', exp: Date.now() + (8 * 60 * 60 * 1000) }), 8 * 60 * 60);
  return ok(res, { authenticated: true, type: 'admin', role: 'admin' });
}));

app.post('/api/auth/team-login', asyncRoute(async (req, res) => {
  if (!requireSupabase(res)) return;
  const pin = String(req.body?.pin || '').trim();
  if (!/^\d{4}$/.test(pin)) return fail(res, 400, 'PIN må være nøyaktig 4 siffer');
  const { data: team, error } = await supabase.from('teams').select('*').or(`pin_code.eq.${pin},pin.eq.${pin}`).limit(1).maybeSingle();
  if (error) return fail(res, 500, 'Kunne ikke sjekke PIN', error.message);
  if (!team) return fail(res, 401, 'Ugyldig PIN');

  const teamId = asInt(team.id);
  const tournamentId = asInt(team.tournament_id);
  setCookie(res, 'team_session', encode({ type: 'team', team_id: teamId, tournament_id: tournamentId, exp: Date.now() + (2 * 60 * 60 * 1000) }), 2 * 60 * 60);
  return ok(res, { authenticated: true, type: 'team', team: { ...team, id: teamId, tournament_id: tournamentId } });
}));

app.post('/api/auth/logout', asyncRoute(async (_req, res) => {
  clearCookie(res, 'admin_session');
  clearCookie(res, 'team_session');
  return ok(res, { loggedOut: true });
}));

app.get('/api/health', (_req, res) => {
  const healthy = Boolean(supabase);
  return res.status(healthy ? 200 : 503).json({
    success: true,
    ok: healthy,
    runtime: 'express',
    timestamp: Date.now(),
    ...(healthy ? {} : { startupIssues, supabaseInitError })
  });
});

app.get('/api/auth/status', asyncRoute(async (req, res) => {
  const admin = getAdminSession(req);
  if (admin?.role === 'admin') return ok(res, { authenticated: true, type: 'admin', role: 'admin' });
  const team = getTeamSession(req);
  if (team?.type === 'team' && team?.team_id) return ok(res, { authenticated: true, type: 'team' });
  return ok(res, { authenticated: false, type: null });
}));

app.get('/api/admin/tournaments', asyncRoute(async (req, res) => {
  if (!requireSupabase(res)) return;
  if (!requireAdmin(req, res)) return;
  const { data, error } = await supabase.from('tournaments').select('*').order('id', { ascending: false });
  if (error) return fail(res, 500, 'Kunne ikke hente turneringer', error.message);
  return ok(res, { tournaments: data || [] });
}));

app.get('/api/admin/courses', asyncRoute(async (req, res) => {
  if (!requireSupabase(res)) return;
  if (!requireAdmin(req, res)) return;

  const fallbackFromTournaments = async () => {
    const { data: tournaments, error: tournamentError } = await supabase
      .from('tournaments')
      .select('course')
      .order('id', { ascending: false });
    if (tournamentError) {
      logApiDebug('[api:admin-courses] fallback failed', { error: tournamentError.message });
      return [];
    }
    const uniqueCourses = [...new Set((tournaments || [])
      .map((t) => String(t.course || '').trim())
      .filter(Boolean))]
      .map((courseName, index) => ({
        id: -(index + 1),
        name: courseName,
        slope_rating: 113,
        source: 'tournaments_fallback'
      }));
    return uniqueCourses;
  };

  let courses = [];
  const { data, error } = await supabase
    .from('courses')
    .select('*')
    .order('id', { ascending: true });

  if (error) {
    logApiDebug('[api:admin-courses] courses table unavailable, using fallback', {
      error: error.message,
      code: error.code || null
    });
    courses = await fallbackFromTournaments();
  } else {
    courses = (data || []).map((course) => ({
      ...course,
      name: course.name || course.course_name || course.title || ''
    }));
  }

  return ok(res, { courses });
}));

function parseTournamentCreateBody(req) {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  const date = String(body.date || '').trim();
  const course = String(body.course || '').trim();
  const status = String(body.status || 'upcoming');
  const dateObj = new Date(date);
  const missing = [];
  if (!name) missing.push('name');
  if (!date) missing.push('date');
  if (!course) missing.push('course');
  return { body, name, date, course, status, dateObj, missing };
}

function buildTournamentInsertPayload(parsed) {
  const year = parsed.dateObj.getFullYear();
  return {
    name: parsed.name,
    course: parsed.course,
    date: parsed.date,
    year,
    status: parsed.status || 'upcoming'
  };
}

function serializeSupabaseError(error) {
  if (!error) return null;
  return {
    message: error.message || null,
    details: error.details || null,
    hint: error.hint || null,
    code: error.code || null
  };
}

async function handleAdminCreateTournament(req, res, options = {}) {
  const { dryRun = false, stackHint = 'admin_create_tournament' } = options;
  let debugStep = 'route_entered';
  let supabaseErrorForResponse = null;
  try {
    console.log('[api:admin-create-tournament] route entered', {
      method: req.method,
      path: req.path,
      body: req.body || {}
    });
    console.log('[api:admin-create-tournament] env presence', {
      hasSupabaseUrl: !!process.env.SUPABASE_URL,
      hasServiceRoleKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      supabaseUrlPrefix: process.env.SUPABASE_URL ? process.env.SUPABASE_URL.slice(0, 35) : null,
      serviceRoleKeyLength: process.env.SUPABASE_SERVICE_ROLE_KEY ? process.env.SUPABASE_SERVICE_ROLE_KEY.length : 0
    });
    console.log('[api:admin-create-tournament] supabase client config', {
      usesServiceRoleClient: Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY),
      keyType: SUPABASE_SERVICE_ROLE_KEY ? 'service_role' : 'missing'
    });

    debugStep = 'require_supabase';
    if (!requireSupabase(res)) return;

    debugStep = 'admin_session_verification';
    const adminSession = getAdminSession(req);
    const isAdmin = Boolean(adminSession?.role === 'admin');
    console.log('[api:admin-create-tournament] admin session verified', {
      isAdmin,
      hasSession: Boolean(adminSession),
      role: adminSession?.role || null
    });
    if (!isAdmin) {
      return res.status(401).json({ success: false, error: 'Admin authentication required' });
    }

    debugStep = 'request_body_received';
    console.log('[api:admin-create-tournament] request body received', req.body || {});

    debugStep = 'payload_parsing';
    const parsed = parseTournamentCreateBody(req);
    console.log('[api:admin-create-tournament] parsed payload', {
      name: parsed.name,
      date: parsed.date,
      course: parsed.course,
      status: parsed.status
    });

    if (parsed.missing.length) {
      return res.status(400).json({ success: false, error: 'Mangler required fields', missing: parsed.missing });
    }
    if (Number.isNaN(parsed.dateObj.getTime())) {
      return res.status(400).json({ success: false, error: 'Ugyldig datoformat' });
    }

    const payload = buildTournamentInsertPayload(parsed);
    console.log('FINAL TOURNAMENT PAYLOAD:', payload);
    if (dryRun) {
      return res.status(200).json({ success: true, validated: true, payload });
    }

    debugStep = 'before_supabase_select_test';
    console.log('[api:admin-create-tournament] before Supabase select test');
    const { data: testData, error: testError } = await supabase
      .from('tournaments')
      .select('id,name,course,status,created_at')
      .limit(1);
    supabaseErrorForResponse = serializeSupabaseError(testError);
    console.log('TOURNAMENT TEST QUERY RESULT', {
      data: testData || null,
      error: supabaseErrorForResponse
    });
    console.log('[api:admin-create-tournament] after Supabase select test');
    if (testError) {
      return res.status(500).json({
        success: false,
        error: testError?.message || 'Supabase test query failed',
        stackHint,
        debugStep: 'supabase_select_test',
        supabaseError: supabaseErrorForResponse
      });
    }

    debugStep = 'before_insert';
    console.log('[api:admin-create-tournament] before insert', payload);
    const { data, error } = await supabase.from('tournaments').insert(payload).select('*').single();
    debugStep = 'after_insert';
    supabaseErrorForResponse = serializeSupabaseError(error);
    console.log('[api:admin-create-tournament] after insert result', {
      data: data || null,
      error: supabaseErrorForResponse
    });

    if (error) {
      console.log('[api:admin-create-tournament] full Supabase error object', supabaseErrorForResponse);
      return res.status(500).json({
        success: false,
        error: error?.message || 'Unknown create tournament error',
        stackHint,
        debugStep: 'insert',
        supabaseError: supabaseErrorForResponse
      });
    }
    return res.status(201).json({ success: true, tournament: data });
  } catch (error) {
    console.error('[api:admin-create-tournament] caught exception message + stack', {
      message: error?.message || null,
      stack: error?.stack || null,
      debugStep
    });
    return res.status(500).json({
      success: false,
      error: error?.message || 'Unknown create tournament error',
      stackHint,
      debugStep,
      supabaseError: supabaseErrorForResponse
    });
  }
}

app.post('/api/admin/tournaments', async (req, res) => handleAdminCreateTournament(req, res));
app.post('/api/debug/admin-create-tournament', async (req, res) => handleAdminCreateTournament(req, res, { dryRun: true, stackHint: 'admin_create_tournament_debug' }));

app.put('/api/admin/tournament/:id', asyncRoute(async (req, res) => {
  if (!requireSupabase(res)) return;
  if (!requireAdmin(req, res)) return;
  const id = asInt(req.params.id); if (!id) return fail(res, 400, 'Ugyldig turnerings-ID');
  const { data, error } = await supabase.from('tournaments').update(req.body || {}).eq('id', id).select('*').single();
  if (error) return fail(res, 500, 'Kunne ikke oppdatere turnering', error.message);
  return ok(res, { tournament: data });
}));

app.delete('/api/admin/tournament/:id', asyncRoute(async (req, res) => {
  if (!requireSupabase(res)) return;
  if (!requireAdmin(req, res)) return;
  const id = asInt(req.params.id); if (!id) return fail(res, 400, 'Ugyldig turnerings-ID');
  const { error } = await supabase.from('tournaments').delete().eq('id', id);
  if (error) return fail(res, 500, 'Kunne ikke slette turnering', error.message);
  return ok(res, { deleted: true });
}));

app.get('/api/admin/tournament/:id/teams', asyncRoute(async (req, res) => {
  if (!requireSupabase(res)) return;
  if (!requireAdmin(req, res)) return;
  const tournamentId = asInt(req.params.id); if (!tournamentId) return fail(res, 400, 'Ugyldig turnerings-ID');
  const { data, error } = await supabase.from('teams').select('*').eq('tournament_id', tournamentId).order('id');
  if (error) return fail(res, 500, 'Kunne ikke hente lag', error.message);
  return ok(res, { teams: (data || []).map((t) => ({ ...t, team_name: t.team_name || t.name })) });
}));

app.get('/api/admin/tournament/:id/scores', asyncRoute(async (req, res) => {
  if (!requireSupabase(res)) return;
  if (!requireAdmin(req, res)) return;
  const tournamentId = asInt(req.params.id); if (!tournamentId) return fail(res, 400, 'Ugyldig turnerings-ID');
  const { data, error } = await supabase.from('scores').select('*').eq('tournament_id', tournamentId).order('hole_number');
  if (error) return fail(res, 500, 'Kunne ikke hente score', error.message);
  return ok(res, { scores: data || [] });
}));

app.get('/api/admin/tournament/:id/holes', asyncRoute(async (req, res) => {
  if (!requireSupabase(res)) return;
  if (!requireAdmin(req, res)) return;
  const tournamentId = asInt(req.params.id);
  console.log('LOAD HOLES:', tournamentId);
  if (!tournamentId) return fail(res, 400, 'Ugyldig turnerings-ID');
  try {
    const [holesColumns, tournamentsColumns] = await Promise.all([
      fetchTableColumns('holes'),
      fetchTableColumns('tournaments')
    ]);
    console.log('[api:admin-holes:get] schema columns', { holesColumns, tournamentsColumns });
    const holes = await ensureTournamentHoles(tournamentId);
    return res.status(200).json({
      success: true,
      data: holes,
      debug: {
        holesColumns,
        tournamentsColumns,
        stackHint: 'admin_holes_get'
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
      stackHint: 'admin_holes_get'
    });
  }
}));

app.post('/api/admin/tournament/:id/holes', asyncRoute(async (req, res) => {
  if (!requireSupabase(res)) return;
  if (!requireAdmin(req, res)) return;
  const tournamentId = asInt(req.params.id);
  console.log('SAVE HOLES tournament_id:', tournamentId);
  if (!tournamentId) return fail(res, 400, 'Ugyldig turnerings-ID');

  const requestedHoles = Array.isArray(req.body?.holes) ? req.body.holes : null;
  if (!requestedHoles) return fail(res, 400, 'holes må være en liste');

  const [holesColumns, tournamentsColumns] = await Promise.all([
    fetchTableColumns('holes'),
    fetchTableColumns('tournaments')
  ]);
  console.log('[api:admin-holes:save] schema columns', { holesColumns, tournamentsColumns });

  const normalizedHoles = requestedHoles.length
    ? requestedHoles.map((hole, index) => normalizeHoleInput(hole, tournamentId, index + 1))
    : buildDefaultHoles(tournamentId);

  for (const hole of normalizedHoles) {
    if (!Number.isInteger(hole.hole_number) || hole.hole_number < 1 || hole.hole_number > 18) {
      return fail(res, 400, `Ugyldig hole_number: ${hole.hole_number}`);
    }
    if (!Number.isInteger(hole.par)) return fail(res, 400, `Ugyldig par for hull ${hole.hole_number}`);
    if (!Number.isInteger(hole.stroke_index) || hole.stroke_index < 1 || hole.stroke_index > 18) {
      return fail(res, 400, `Ugyldig stroke_index for hull ${hole.hole_number}`);
    }
    if (typeof hole.requires_photo !== 'boolean') return fail(res, 400, `Ugyldig requires_photo for hull ${hole.hole_number}`);
    if (typeof hole.is_longest_drive !== 'boolean') return fail(res, 400, `Ugyldig is_longest_drive for hull ${hole.hole_number}`);
    if (typeof hole.is_nearest_pin !== 'boolean') return fail(res, 400, `Ugyldig is_nearest_pin for hull ${hole.hole_number}`);
  }

  console.log('SAVE HOLES:', normalizedHoles);

  const requiredHoleColumns = ['tournament_id', 'hole_number', 'par', 'stroke_index', 'requires_photo', 'is_longest_drive', 'is_nearest_pin'];
  const unmappedHoleFields = requiredHoleColumns.filter((field) => !holesColumns.includes(field));
  if (unmappedHoleFields.length) {
    return res.status(500).json({
      success: false,
      error: 'public.holes støtter ikke nødvendig felter for admin-hulloppsett',
      actualColumns: holesColumns,
      unmappedFrontendFields: unmappedHoleFields,
      stackHint: 'admin_holes_save'
    });
  }

  const insertPayload = normalizedHoles.map((hole) => {
    const row = {};
    for (const [key, value] of Object.entries(hole)) {
      if (holesColumns.includes(key)) row[key] = value;
    }
    return row;
  });

  const { error } = await supabase
    .from('holes')
    .upsert(insertPayload, { onConflict: 'tournament_id,hole_number' });
  if (error) return res.status(500).json({ success: false, error: error.message });

  const { data, error: fetchError } = await supabase
    .from('holes')
    .select(holesColumns.join(','))
    .eq('tournament_id', tournamentId)
    .order('hole_number', { ascending: true });
  if (fetchError) return res.status(500).json({ success: false, error: fetchError.message });

  return res.status(200).json({
    success: true,
    data: data || [],
    debug: {
      holesColumns,
      tournamentsColumns,
      finalInsertPayload: insertPayload,
      stackHint: 'admin_holes_save'
    }
  });
}));

app.post(['/api/teams', '/api/admin/team'], asyncRoute(async (req, res) => {
  if (!requireSupabase(res)) return;
  if (req.path.includes('/api/admin/') && !requireAdmin(req, res)) return;
  try {
    const b = (req.body && typeof req.body === 'object') ? req.body : {};
    console.log('[api:admin-team:create] request payload', b);

    const [teamsColumns, tournamentsColumns, holesColumns] = await Promise.all([
      fetchTableColumns('teams'),
      fetchTableColumns('tournaments'),
      fetchTableColumns('holes')
    ]);
    console.log('[api:admin-team:create] schema columns', {
      teamsColumns,
      tournamentsColumns,
      holesColumns
    });

    const tournamentId = Number(b.tournament_id);
    const teamName = String(b.team_name || '').trim();
    const player1Name = String(b.player1_name || '').trim();
    const player2Name = String(b.player2_name || '').trim();
    const pinRaw = String(b.pin ?? '').trim();
    const hcpPlayer1 = Number(b.hcp_player1);
    const hcpPlayer2 = Number(b.hcp_player2);

    if (!Number.isInteger(tournamentId)) return fail(res, 400, 'tournament_id er påkrevd');
    if (!teamName) return fail(res, 400, 'team_name er påkrevd');
    if (!/^\d{4}$/.test(pinRaw)) return fail(res, 400, 'PIN må være nøyaktig 4 siffer');
    if (!Number.isFinite(hcpPlayer1) || !Number.isFinite(hcpPlayer2)) {
      return fail(res, 400, 'hcp_player1 og hcp_player2 må være tall');
    }

    const frontendToExactColumn = {
      tournament_id: 'tournament_id',
      team_name: 'team_name',
      player1_name: 'player1_name',
      player2_name: 'player2_name',
      pin: 'pin',
      hcp_player1: 'hcp_player1',
      hcp_player2: 'hcp_player2'
    };

    const sourcePayload = {
      tournament_id: tournamentId,
      team_name: teamName,
      player1_name: player1Name,
      player2_name: player2Name,
      pin: pinRaw,
      hcp_player1: hcpPlayer1,
      hcp_player2: hcpPlayer2
    };

    const finalPayload = {};
    const unmappedFrontendFields = [];
    for (const [frontendField, columnName] of Object.entries(frontendToExactColumn)) {
      if (teamsColumns.includes(columnName)) {
        finalPayload[columnName] = sourcePayload[frontendField];
      } else {
        unmappedFrontendFields.push(frontendField);
      }
    }

    if (unmappedFrontendFields.length > 0) {
      return res.status(500).json({
        success: false,
        error: 'Frontend payload kan ikke mappes mot live public.teams schema uten gjetting.',
        actualColumns: teamsColumns,
        unmappedFrontendFields,
        requestPayload: b,
        finalInsertPayload: finalPayload,
        stackHint: 'admin_create_team'
      });
    }

    console.log('[api:admin-team:create] final insert payload', finalPayload);
    const result = await supabase.from('teams').insert(finalPayload).select('*').single();

    if (result.error) {
      console.error('[api:admin-team:create] supabase error object', result.error);
      return res.status(500).json({
        success: false,
        error: result.error.message,
        requestPayload: b,
        actualColumns: teamsColumns,
        finalInsertPayload: finalPayload,
        supabaseError: result.error,
        stackHint: 'admin_create_team'
      });
    }

    return res.status(201).json({
      success: true,
      data: result.data,
      debug: {
        requestPayload: b,
        teamsColumns,
        tournamentsColumns,
        holesColumns,
        finalInsertPayload: finalPayload,
        supabaseError: null,
        stackHint: 'admin_create_team'
      }
    });
  } catch (err) {
    console.error('[api:admin-team:create] unexpected error', err);
    return res.status(500).json({
      success: false,
      error: err?.message || 'Unknown error',
      requestPayload: req.body || null,
      actualColumns: schemaColumnsCache.teams || [],
      finalInsertPayload: null,
      supabaseError: null,
      stackHint: 'admin_create_team'
    });
  }
}));

app.post('/api/admin/tournament/:id/gallery', upload.single('photo'), asyncRoute(async (req, res) => {
  if (!requireSupabase(res)) return;
  if (!requireAdmin(req, res)) return;
  const tournamentId = asInt(req.params.id);
  if (!tournamentId) {
    logApiDebug('[api:admin-gallery:upload] invalid tournament id', { id: req.params.id });
    return fail(res, 400, 'Ugyldig turnerings-ID');
  }
  if (!req.file) {
    logApiDebug('[api:admin-gallery:upload] missing file', { tournamentId, body: req.body || {} });
    return fail(res, 400, 'Ingen fil lastet opp');
  }
  if (!GALLERY_BUCKET) {
    logApiDebug('[api:admin-gallery:upload] missing bucket env', { tournamentId });
    return fail(res, 500, 'Mangler storage bucket-konfigurasjon');
  }
  const ext = (req.file.originalname.split('.').pop() || 'jpg').toLowerCase();
  const storagePath = `gallery/${tournamentId}/${Date.now()}-${Math.round(Math.random() * 1e6)}.${ext}`;
  logApiDebug('[api:admin-gallery:upload] upload start', {
    tournamentId,
    bucket: GALLERY_BUCKET,
    storagePath,
    mimeType: req.file.mimetype || null,
    size: req.file.size || null
  });

  const uploadResult = await supabase.storage.from(GALLERY_BUCKET).upload(storagePath, req.file.buffer, {
    contentType: req.file.mimetype || 'application/octet-stream',
    upsert: true
  });
  if (uploadResult.error) {
    logApiDebug('[api:admin-gallery:upload] storage upload failed', {
      tournamentId,
      bucket: GALLERY_BUCKET,
      storagePath,
      error: uploadResult.error.message
    });
    return fail(res, 500, 'Opplasting til storage feilet', uploadResult.error.message);
  }

  const publicUrl = supabase.storage.from(GALLERY_BUCKET).getPublicUrl(storagePath).data.publicUrl;
  const caption = String(req.body?.caption || '').trim() || null;
  const { data, error } = await supabase
    .from('tournament_gallery_images')
    .insert({
      tournament_id: tournamentId,
      photo_path: publicUrl,
      storage_path: storagePath,
      caption
    })
    .select('*')
    .single();

  if (error) {
    logApiDebug('[api:admin-gallery:upload] metadata insert failed', {
      tournamentId,
      storagePath,
      error: error.message
    });
    return fail(res, 500, 'Kunne ikke lagre bildefil i databasen', error.message);
  }

  return ok(res, { image: data, storage_path: storagePath, photo_path: publicUrl, url: publicUrl }, 201);
}));

app.get('/api/admin/tournament/:id/gallery', asyncRoute(async (req, res) => {
  if (!requireSupabase(res)) return;
  if (!requireAdmin(req, res)) return;
  const tournamentId = asInt(req.params.id);
  if (!tournamentId) return fail(res, 400, 'Ugyldig turnerings-ID');
  const { data, error } = await supabase
    .from('tournament_gallery_images')
    .select('*')
    .eq('tournament_id', tournamentId)
    .order('uploaded_at', { ascending: false });
  if (error) return fail(res, 500, 'Kunne ikke hente turneringsbilder', error.message);
  return ok(res, { images: data || [], gallery: data || [], photos: data || [] });
}));

app.get('/api/admin/tournament/:id/photos', asyncRoute(async (req, res) => {
  if (!requireSupabase(res)) return;
  if (!requireAdmin(req, res)) return;
  const tournamentId = asInt(req.params.id);
  if (!tournamentId) return fail(res, 400, 'Ugyldig turnerings-ID');
  const { data, error } = await supabase
    .from('hole_images')
    .select('*')
    .eq('tournament_id', tournamentId)
    .order('created_at', { ascending: false });
  if (error) return fail(res, 500, 'Kunne ikke hente hullbilder', error.message);
  return ok(res, { photos: data || [] });
}));

app.put('/api/admin/team/:id', asyncRoute(async (req, res) => {
  if (!requireSupabase(res)) return;
  if (!requireAdmin(req, res)) return;
  const id = asInt(req.params.id); if (!id) return fail(res, 400, 'Ugyldig lag-ID');
  const { data, error } = await supabase.from('teams').update(req.body || {}).eq('id', id).select('*').single();
  if (error) return fail(res, 500, 'Kunne ikke oppdatere lag', error.message);
  return ok(res, { team: data });
}));

app.delete(['/api/teams/:id', '/api/admin/team/:id'], asyncRoute(async (req, res) => {
  if (!requireSupabase(res)) return;
  if (req.path.includes('/api/admin/') && !requireAdmin(req, res)) return;
  const id = asInt(req.params.id); if (!id) return fail(res, 400, 'Ugyldig lag-ID');
  const { error } = await supabase.from('teams').delete().eq('id', id);
  if (error) return fail(res, 500, 'Kunne ikke slette lag', error.message);
  return ok(res, { deleted: true });
}));

app.get('/api/teams', asyncRoute(async (req, res) => {
  if (!requireSupabase(res)) return;
  const tournamentId = asInt(req.query.tournament_id || req.query.tournamentId);
  if (!tournamentId) return fail(res, 400, 'tournament_id er påkrevd');
  const { data, error } = await supabase.from('teams').select('*').eq('tournament_id', tournamentId).order('id');
  if (error) return fail(res, 500, 'Kunne ikke hente lag', error.message);
  return ok(res, { teams: data || [] });
}));

app.get('/api/team/scorecard', asyncRoute(async (req, res) => {
  if (!requireSupabase(res)) return;
  const session = getTeamSession(req);
  if (!session?.team_id) return fail(res, 401, 'Ikke logget inn');
  const teamId = asInt(session.team_id); const tournamentId = asInt(session.tournament_id);

  const [teamResp, scoreResp, claimResp] = await Promise.all([
    supabase.from('teams').select('*').eq('id', teamId).maybeSingle(),
    supabase.from('scores').select('*').eq('team_id', teamId),
    supabase.from('award_claims').select('*').eq('team_id', teamId)
  ]);
  if (teamResp.error || scoreResp.error || claimResp.error) return fail(res, 500, 'Kunne ikke hente scorekort');
  const holes = await ensureTournamentHoles(tournamentId);

  const { data: tournament } = await supabase.from('tournaments').select('*').eq('id', tournamentId).maybeSingle();
  const scores = (scoreResp.data || []).map((s) => ({ ...s, hole_number: s.hole_number || s.hole, score: s.score || s.strokes }));
  return ok(res, { team: teamResp.data, tournament, holes, scores, claims: claimResp.data || [] });
}));

app.post('/api/team/submit-score', asyncRoute(async (req, res) => {
  if (!requireSupabase(res)) return;
  const session = getTeamSession(req);
  if (!session?.team_id) return fail(res, 401, 'Ikke logget inn');
  const teamId = asInt(session.team_id); const tournamentId = asInt(session.tournament_id);
  const holeNumber = asInt(req.body?.hole_number); const score = asInt(req.body?.score);
  if (!holeNumber || !score) return fail(res, 400, 'hole_number og score er påkrevd');
  const payload = { team_id: teamId, tournament_id: tournamentId, hole_number: holeNumber, hole: holeNumber, score, strokes: score, submitted_at: new Date().toISOString() };
  const { data, error } = await supabase.from('scores').upsert(payload, { onConflict: 'team_id,tournament_id,hole_number' }).select('*').single();
  if (error) return fail(res, 500, 'Kunne ikke lagre score', error.message);
  return ok(res, { score: data });
}));

app.get('/api/team/full-scorecard', asyncRoute(async (req, res) => {
  if (!requireSupabase(res)) return;
  const session = getTeamSession(req);
  if (!session?.team_id) return fail(res, 401, 'Ikke logget inn');
  const { data, error } = await supabase.from('scores').select('*').eq('team_id', asInt(session.team_id)).order('hole_number');
  if (error) return fail(res, 500, 'Kunne ikke hente fullstendig scorekort', error.message);
  return ok(res, { scores: data || [] });
}));

app.post('/api/team/lock-scorecard', asyncRoute(async (req, res) => {
  if (!requireSupabase(res)) return;
  const session = getTeamSession(req);
  if (!session?.team_id) return fail(res, 401, 'Ikke logget inn');
  const { data, error } = await supabase.from('teams').update({ locked: true }).eq('id', asInt(session.team_id)).select('*').single();
  if (error) return fail(res, 500, 'Kunne ikke låse scorekort', error.message);
  return ok(res, { team: data });
}));

app.post('/api/team/claim-award', asyncRoute(async (req, res) => {
  if (!requireSupabase(res)) return;
  const session = getTeamSession(req);
  if (!session?.team_id) return fail(res, 401, 'Ikke logget inn');
  const payload = {
    tournament_id: asInt(session.tournament_id), team_id: asInt(session.team_id),
    hole_number: asInt(req.body?.hole_number) || 0, award_type: req.body?.award_type,
    player_name: req.body?.player_name || null, detail: req.body?.detail || null, claimed_at: new Date().toISOString()
  };
  if (!payload.award_type) return fail(res, 400, 'award_type er påkrevd');
  const { data, error } = await supabase.from('award_claims').upsert(payload, { onConflict: 'tournament_id,team_id,award_type,hole_number,player_name' }).select('*').single();
  if (error) return fail(res, 500, 'Kunne ikke registrere utmerkelse', error.message);
  return ok(res, { claim: data }, 201);
}));

app.get('/api/chat/messages', asyncRoute(async (req, res) => {
  if (!requireSupabase(res)) return;
  const session = getTeamSession(req);
  if (!session?.tournament_id) return fail(res, 401, 'Ikke logget inn');
  const { data, error } = await supabase.from('chat_messages').select('*').eq('tournament_id', asInt(session.tournament_id)).order('id').limit(100);
  if (error) return fail(res, 500, 'Kunne ikke hente chat', error.message);
  return ok(res, { messages: data || [] });
}));

app.post('/api/chat/send', upload.single('image'), asyncRoute(async (req, res) => {
  if (!requireSupabase(res)) return;
  const session = getTeamSession(req);
  if (!session?.team_id) return fail(res, 401, 'Ikke logget inn');
  const message = String(req.body?.message || '').trim();
  let imagePath = null;
  if (req.file) {
    const ext = (req.file.originalname.split('.').pop() || 'jpg').toLowerCase();
    const storagePath = `chat/${session.tournament_id}/${session.team_id}/${Date.now()}-${Math.round(Math.random() * 1e6)}.${ext}`;
    const { error } = await supabase.storage.from(GALLERY_BUCKET).upload(storagePath, req.file.buffer, { contentType: req.file.mimetype || 'application/octet-stream', upsert: true });
    if (error) return fail(res, 500, 'Kunne ikke laste opp bilde', error.message);
    imagePath = supabase.storage.from(GALLERY_BUCKET).getPublicUrl(storagePath).data.publicUrl;
  }
  if (!message && !imagePath) return fail(res, 400, 'Melding eller bilde er påkrevd');
  const { data: team } = await supabase.from('teams').select('*').eq('id', asInt(session.team_id)).maybeSingle();
  const { data, error } = await supabase.from('chat_messages').insert({
    tournament_id: asInt(session.tournament_id), team_id: asInt(session.team_id),
    team_name: team?.team_name || team?.name || req.body?.team_name || 'Lag',
    message: message || null, image_path: imagePath, created_at: new Date().toISOString(), event_type: 'chat_message'
  }).select('*').single();
  if (error) return fail(res, 500, 'Kunne ikke sende chatmelding', error.message);
  return ok(res, { message: data }, 201);
}));

app.post('/api/team/birdie-shot', asyncRoute(async (req, res) => {
  if (!requireSupabase(res)) return;
  const session = getTeamSession(req);
  if (!session?.team_id) return fail(res, 401, 'Ikke logget inn');
  const note = String(req.body?.note || '').trim();
  const { data: team } = await supabase.from('teams').select('*').eq('id', asInt(session.team_id)).maybeSingle();
  const message = `⛳ ${note || 'Alle spillere må ta birdie shots! 🥃'}`;
  const { error } = await supabase.from('chat_messages').insert({
    tournament_id: asInt(session.tournament_id), team_id: asInt(session.team_id),
    team_name: team?.team_name || team?.name || 'Lag', message, event_type: 'birdie_shot', created_at: new Date().toISOString()
  });
  if (error) return fail(res, 500, 'Kunne ikke sende birdie shoutout', error.message);
  return ok(res);
}));

app.get('/api/gallery', asyncRoute(async (req, res) => {
  if (!requireSupabase(res)) return;
  const tournamentId = asInt(req.query.tournament_id);
  let query = supabase.from('tournament_gallery_images').select('*').order('uploaded_at', { ascending: false }).limit(200);
  if (tournamentId) query = query.eq('tournament_id', tournamentId);
  const { data, error } = await query;
  if (error) return fail(res, 500, 'Kunne ikke hente galleri', error.message);
  return ok(res, { photos: data || [] });
}));

async function handleHoleUpload(req, res) {
  if (!requireSupabase(res)) return;
  const session = getTeamSession(req);
  if (!session?.team_id) return fail(res, 401, 'Ikke logget inn');
  const holeNumber = asInt(req.params.holeNum || req.body?.hole_number);
  if (!holeNumber) return fail(res, 400, 'hole_number er påkrevd');
  if (!req.file) return fail(res, 400, 'Ingen fil lastet opp');
  const ext = (req.file.originalname.split('.').pop() || 'jpg').toLowerCase();
  const storagePath = `holes/${session.tournament_id}/${session.team_id}/hole-${holeNumber}-${Date.now()}.${ext}`;
  const up = await supabase.storage.from(GALLERY_BUCKET).upload(storagePath, req.file.buffer, { contentType: req.file.mimetype || 'application/octet-stream', upsert: true });
  if (up.error) return fail(res, 500, 'Kunne ikke laste opp bilde', up.error.message);
  const publicUrl = supabase.storage.from(GALLERY_BUCKET).getPublicUrl(storagePath).data.publicUrl;
  await supabase.from('scores').upsert({ team_id: asInt(session.team_id), tournament_id: asInt(session.tournament_id), hole_number: holeNumber, hole: holeNumber, photo_path: publicUrl, submitted_at: new Date().toISOString() }, { onConflict: 'team_id,tournament_id,hole_number' });
  const { data, error } = await supabase.from('hole_images').insert({ tournament_id: asInt(session.tournament_id), team_id: asInt(session.team_id), hole_number: holeNumber, photo_path: publicUrl, image_url: publicUrl, storage_path: storagePath, created_at: new Date().toISOString() }).select('*').single();
  if (error) return fail(res, 500, 'Kunne ikke lagre bilde', error.message);
  return ok(res, { image: data, photo_path: publicUrl }, 201);
}
app.post('/api/upload/hole-photo', upload.single('photo'), asyncRoute(handleHoleUpload));
app.post('/api/team/upload-photo/:holeNum', upload.single('photo'), asyncRoute(handleHoleUpload));

app.get('/api/tournament', asyncRoute(async (_req, res) => {
  if (!requireSupabase(res)) return;
  const tournament = await getActiveTournament();
  return ok(res, { tournament });
}));
app.get('/api/sponsors', asyncRoute(async (req, res) => {
  if (!requireSupabase(res)) return;
  const tournament = await getActiveTournament();
  if (!tournament) return ok(res, { sponsors: [] });
  let query = supabase.from('sponsors').select('*').eq('tournament_id', asInt(tournament.id)).order('position');
  if (req.query.placement) query = query.eq('placement', req.query.placement);
  const { data, error } = await query;
  if (error) return fail(res, 500, 'Kunne ikke hente sponsorer', error.message);
  return ok(res, { sponsors: data || [] });
}));
app.get('/api/legacy', asyncRoute(async (_req, res) => {
  if (!requireSupabase(res)) return;
  const { data, error } = await supabase.from('legacy').select('*').order('year', { ascending: false });
  if (error) return fail(res, 500, 'Kunne ikke hente historikk', error.message);
  return ok(res, { legacy: data || [] });
}));
app.get('/api/admin/legacy', asyncRoute(async (req, res) => {
  if (!requireSupabase(res)) return;
  if (!requireAdmin(req, res)) return;
  const { data, error } = await supabase.from('legacy').select('*').order('year', { ascending: false });
  if (error) return fail(res, 500, 'Kunne ikke hente historikk', error.message);
  return ok(res, { legacy: data || [] });
}));
app.get('/api/coin-back', asyncRoute(async (_req, res) => {
  if (!requireSupabase(res)) return;
  const { data, error } = await supabase
    .from('coin_back_images')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    return res.status(500).json({ success: false, error: error.message });
  }

  const photos = data || [];
  const active = photos.find((p) => p.is_active && p.photo_path) || photos[0] || null;
  return ok(res, {
    photos,
    photo_path: active?.photo_path || null,
    focal_point: active?.focal_point || '50% 50%'
  });
}));

app.post('/api/admin/coin-back', upload.single('photo'), asyncRoute(async (req, res) => {
  if (!requireSupabase(res)) return;
  if (!requireAdmin(req, res)) return;
  if (!req.file) return fail(res, 400, 'Ingen fil lastet opp');

  const extension = (req.file.originalname.split('.').pop() || 'jpg').toLowerCase();
  const filePath = `coin-back/back-${Date.now()}-${Math.round(Math.random() * 1e6)}.${extension}`;

  const uploadResult = await supabase.storage.from('tournament-gallery').upload(filePath, req.file.buffer, {
    contentType: req.file.mimetype || 'application/octet-stream',
    upsert: true
  });

  if (uploadResult.error) {
    return res.status(500).json({ success: false, error: uploadResult.error.message });
  }

  const publicUrl = supabase.storage.from('tournament-gallery').getPublicUrl(filePath).data.publicUrl;

  const { data: activeRow, error: activeError } = await supabase
    .from('coin_back_images')
    .select('focal_point')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activeError) {
    return res.status(500).json({ success: false, error: activeError.message });
  }

  const focalPoint = activeRow?.focal_point || '50% 50%';

  const deactivate = await supabase.from('coin_back_images').update({ is_active: false }).eq('is_active', true);
  if (deactivate.error) {
    return res.status(500).json({ success: false, error: deactivate.error.message });
  }

  const insert = await supabase
    .from('coin_back_images')
    .insert({ photo_path: publicUrl, focal_point: focalPoint, is_active: true })
    .select('*')
    .single();

  if (insert.error) {
    return res.status(500).json({ success: false, error: insert.error.message });
  }

  return ok(res, {
    photo_path: insert.data?.photo_path || publicUrl,
    focal_point: insert.data?.focal_point || '50% 50%'
  });
}));
app.get('/api/scoreboard', asyncRoute(async (_req, res) => {
  if (!requireSupabase(res)) return;
  const tournament = await getActiveTournament();
  if (!tournament) return ok(res, { tournament: null, holes: [], scoreboard: [], awards: [] });

  const [teamsResp, scoreResp, awardsResp] = await Promise.all([
    supabase.from('teams').select('*').eq('tournament_id', asInt(tournament.id)).order('id'),
    supabase.from('scores').select('*').eq('tournament_id', asInt(tournament.id)),
    supabase.from('awards').select('*,teams(team_name,name)').eq('tournament_id', asInt(tournament.id)),
  ]);
  if (teamsResp.error || scoreResp.error || awardsResp.error) return fail(res, 500, 'Kunne ikke hente scoreboard');

  const teams = teamsResp.data || [];
  const holes = await ensureTournamentHoles(asInt(tournament.id));
  const scores = scoreResp.data || [];
  const parByHole = Object.fromEntries(holes.map((h) => [h.hole_number, Number(h.par || 4)]));

  const scoreboard = teams.map((team) => {
    const teamScores = scores.filter((s) => asInt(s.team_id) === asInt(team.id));
    const holeScores = {};
    let total = 0;
    let par = 0;
    for (const s of teamScores) {
      const h = asInt(s.hole_number || s.hole);
      const sc = asInt(s.score || s.strokes) || 0;
      if (!h || !sc) continue;
      holeScores[h] = { score: sc, photo_path: s.photo_path || null };
      total += sc;
      par += parByHole[h] || 4;
    }
    const hcp = asInt(team.player1_handicap || team.player1_hcp || 0) + asInt(team.player2_handicap || team.player2_hcp || 0);
    const netScore = total > 0 ? Math.max(total - Math.round((hcp || 0) / 2), 0) : 0;
    return {
      team_id: asInt(team.id), team_name: team.team_name || team.name || 'Lag', player1: team.player1 || '', player2: team.player2 || '',
      player1_handicap: asInt(team.player1_handicap || team.player1_hcp || 0), player2_handicap: asInt(team.player2_handicap || team.player2_hcp || 0),
      handicap: Math.round((hcp || 0) / 2),
      hole_scores: holeScores,
      holes_completed: Object.keys(holeScores).length,
      total_score: total,
      to_par: total > 0 ? total - par : 0,
      net_score: netScore,
      net_to_par: netScore > 0 ? netScore - par : 0
    };
  }).sort((a, b) => (a.holes_completed === 0 ? 1 : 0) - (b.holes_completed === 0 ? 1 : 0) || a.net_to_par - b.net_to_par || a.total_score - b.total_score);

  const awards = (awardsResp.data || []).map((a) => ({ ...a, team_name: a.team_name || a.teams?.team_name || a.teams?.name || null }));
  return ok(res, { tournament, holes, scoreboard, awards });
}));

app.all('/api/*rest', (_req, res) => fail(res, 404, 'API route not found'));
app.use((err, req, res, _next) => {
  console.error(`[api:error] ${req.method} ${req.path}`, err);
  if (err instanceof multer.MulterError) {
    return fail(res, 400, err.message || 'Ugyldig filopplasting');
  }
  return fail(res, 500, 'Uventet serverfeil');
});

module.exports = app;
module.exports.default = (req, res) => app(req, res);
