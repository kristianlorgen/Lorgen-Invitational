require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { supabaseAdmin } = require('./lib/supabaseClient');
const { getTournamentFormat, getTeamSizeForFormat } = require('./services/tournamentFormat');

if (!supabaseAdmin) {
  throw new Error('Supabase client is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
}
const supabase = supabaseAdmin;

const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

function forwardTo(req, res, method, url) {
  req.method = method;
  req.url = url;
  return app.handle(req, res);
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.get('/health', (_, res) => res.status(200).json({ status: 'ok' }));
app.get('/ready', (_, res) => res.status(200).json({ status: 'ready' }));

function asInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function ensureSupabaseEnv() {
  const hasUrl = !!(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
  const hasKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!hasUrl || !hasKey) {
    const missing = [];
    if (!hasUrl) missing.push('SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)');
    if (!hasKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
    const message = `Missing Supabase environment variables: ${missing.join(', ')}`;
    console.error('[api:admin:tournaments] env check failed', {
      hasUrl,
      hasServiceRole: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      hasAnon: !!process.env.SUPABASE_ANON_KEY,
      hasPublicAnon: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    });
    return message;
  }

  return null;
}

function handleSupabaseError(res, error, context) {
  console.error(`Supabase error${context ? ` (${context})` : ''}:`, error);
  return res.status(500).json({ error: error?.message || 'Supabase request failed' });
}

function routeLog(route, phase, details = {}) {
  const payload = { route, phase, ...details };
  // eslint-disable-next-line no-console
  console.log('[api:compat]', payload);
}

function normalizeTeamRow(row) {
  return {
    ...row,
    team_name: row.team_name ?? row.name ?? '',
    name: row.name ?? row.team_name ?? '',
    pin: row.pin ?? row.pin_code ?? '',
    pin_code: row.pin_code ?? row.pin ?? ''
  };
}

async function resolveTeamByTournamentAndPin(tournamentId, pin) {
  let teamResult = await supabase
    .from('teams')
    .select('id, tournament_id, name, team_name, pin, pin_code, locked')
    .eq('tournament_id', tournamentId)
    .eq('pin', pin)
    .maybeSingle();

  if (teamResult.error && isMissingColumnError(teamResult.error, 'pin')) {
    teamResult = await supabase
      .from('teams')
      .select('id, tournament_id, name, team_name, pin, pin_code, locked')
      .eq('tournament_id', tournamentId)
      .eq('pin_code', pin)
      .maybeSingle();
  }
  if (teamResult.error) throw teamResult.error;
  if (!teamResult.data) return null;

  const team = normalizeTeamRow(teamResult.data);
  const { data: members, error: membersError } = await supabase
    .from('team_members')
    .select('players(name, handicap)')
    .eq('team_id', team.id);
  if (membersError) throw membersError;

  const players = (members || []).map((row) => row.players).filter(Boolean);
  const [player1, player2] = players;
  return {
    ...team,
    player1: player1?.name || '',
    player2: player2?.name || '',
    player1_handicap: player1?.handicap ?? null,
    player2_handicap: player2?.handicap ?? null
  };
}

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_COOKIE_NAME = 'admin_auth';
const ADMIN_COOKIE_TTL_SECONDS = 60 * 60 * 12; // 12 timer
const ADMIN_SIGNING_SECRET = process.env.SESSION_SECRET || process.env.ADMIN_SIGNING_SECRET || ADMIN_PASSWORD || 'lorgen-admin';

function signAdminCookieValue(payload) {
  const hmac = crypto
    .createHmac('sha256', ADMIN_SIGNING_SECRET)
    .update(payload)
    .digest('hex');
  return `${payload}.${hmac}`;
}

function verifyAdminCookieValue(value) {
  if (!value || !value.includes('.')) return false;
  const idx = value.lastIndexOf('.');
  const payload = value.slice(0, idx);
  const sig = value.slice(idx + 1);
  const expected = crypto
    .createHmac('sha256', ADMIN_SIGNING_SECRET)
    .update(payload)
    .digest('hex');
  if (sig.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  const [issuedAtRaw] = payload.split(':');
  const issuedAt = Number.parseInt(issuedAtRaw, 10);
  if (!Number.isFinite(issuedAt)) return false;
  const ageSeconds = Math.floor(Date.now() / 1000) - issuedAt;
  return ageSeconds >= 0 && ageSeconds <= ADMIN_COOKIE_TTL_SECONDS;
}

function readCookies(req) {
  const raw = req.headers.cookie || '';
  return raw.split(';').reduce((acc, pair) => {
    const [key, ...parts] = pair.trim().split('=');
    if (!key) return acc;
    acc[key] = decodeURIComponent(parts.join('='));
    return acc;
  }, {});
}

function setAdminAuthCookie(res) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const token = signAdminCookieValue(`${issuedAt}:admin`);
  const secureFlag = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${ADMIN_COOKIE_TTL_SECONDS}; SameSite=Lax${secureFlag}`);
}

function clearAdminAuthCookie(res) {
  const secureFlag = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${ADMIN_COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secureFlag}`);
}

function isAdminAuthenticated(req) {
  const cookies = readCookies(req);
  return verifyAdminCookieValue(cookies[ADMIN_COOKIE_NAME]);
}

app.post('/api/auth/admin-login', async (req, res) => {
  try {
    const password = String(req.body?.password || '');
    if (!ADMIN_PASSWORD) {
      return res.status(500).json({ error: 'ADMIN_PASSWORD mangler i miljøvariabler.' });
    }
    if (!password || password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Ugyldig passord' });
    }
    setAdminAuthCookie(res);
    res.json({ success: true, type: 'admin' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/auth/status', (req, res) => {
  if (isAdminAuthenticated(req)) {
    return res.json({ type: 'admin' });
  }
  res.json({ type: null });
});

app.post('/api/auth/logout', (_, res) => {
  clearAdminAuthCookie(res);
  res.json({ success: true });
});

app.get('/api/auth/github-url', (_, res) => {
  res.status(501).json({ error: 'GitHub-innlogging er ikke aktivert i denne deployen.' });
});

app.post('/api/auth/github-token', (_, res) => {
  res.status(501).json({ error: 'GitHub-innlogging er ikke aktivert i denne deployen.' });
});

app.post('/api/auth/team-login', async (req, res) => {
  const route = '/api/auth/team-login';
  try {
    const pin = String(req.body?.pin || '').trim();
    const requestedTournamentId = asInt(req.body?.tournament_id);
    routeLog(route, 'hit', { payload: { pinLength: pin.length, requestedTournamentId } });

    if (!pin) {
      return res.status(400).json({ success: false, error: 'PIN er påkrevd' });
    }

    const tournamentId = requestedTournamentId || await resolveTournamentId(null);
    if (!tournamentId) {
      return res.status(404).json({ success: false, error: 'Ingen aktiv turnering funnet' });
    }

    const team = await resolveTeamByTournamentAndPin(tournamentId, pin);
    if (!team) {
      return res.status(401).json({ success: false, error: 'Ugyldig PIN' });
    }

    routeLog(route, 'db_action', { action: 'team_lookup_success', tournamentId, teamId: team.id });
    return res.json({ success: true, tournament_id: tournamentId, team });
  } catch (error) {
    routeLog(route, 'error', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: error?.message || 'Innlogging feilet' });
  }
});

app.post('/auth/team-login', (req, res) => forwardTo(req, res, 'POST', '/api/auth/team-login'));

app.post('/api/team/birdie-shot', async (req, res) => {
  const route = '/api/team/birdie-shot';
  try {
    const note = String(req.body?.note || '').trim();
    const pin = String(req.body?.pin || '').trim();
    const requestedTournamentId = asInt(req.body?.tournament_id);
    routeLog(route, 'hit', { payload: { noteLength: note.length, pinLength: pin.length, requestedTournamentId } });

    const tournamentId = requestedTournamentId || await resolveTournamentId(null);
    if (!tournamentId) {
      return res.status(404).json({ success: false, error: 'Ingen aktiv turnering funnet' });
    }

    const team = pin ? await resolveTeamByTournamentAndPin(tournamentId, pin) : null;
    if (!team) {
      return res.status(401).json({ success: false, error: 'Kunne ikke verifisere lag for birdie shoutout' });
    }

    const payload = {
      tournament_id: tournamentId,
      team_id: team.id,
      team_name: team.team_name,
      note: note || null
    };
    const { data, error } = await supabase
      .from('chat_messages')
      .insert(payload)
      .select('*')
      .single();
    if (error) throw error;

    routeLog(route, 'db_action', { action: 'insert_shoutout', id: data?.id, tournamentId, teamId: team.id });
    return res.json({ success: true, shoutout: data });
  } catch (error) {
    routeLog(route, 'error', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: error?.message || 'Kunne ikke sende birdie shoutout' });
  }
});

app.post('/team/birdie-shot', (req, res) => forwardTo(req, res, 'POST', '/api/team/birdie-shot'));

async function resolveTournamentId(tournamentId) {
  const parsed = asInt(tournamentId);
  if (parsed) return parsed;

  const { data, error } = await supabase
    .from('tournaments')
    .select('id')
    .in('status', ['active', 'upcoming'])
    .order('date', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data?.id || null;
}

async function getTournament(tournamentId) {
  const { data, error } = await supabase
    .from('tournaments')
    .select('*')
    .eq('id', tournamentId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

function isMissingColumnError(error, columnName) {
  const message = `${error?.message || ''} ${error?.details || ''}`;
  return message.includes(`'${columnName}'`) && (message.includes('Could not find') || message.includes('column') || message.includes('schema cache'));
}

async function insertTeamCompat(payload) {
  const basePayload = {
    tournament_id: payload.tournament_id,
    name: payload.name,
    team_name: payload.name,
    pin: payload.pin,
    pin_code: payload.pin,
    locked: false
  };

  const attempts = [
    { ...basePayload },
    { ...basePayload, pin_code: undefined },
    { ...basePayload, team_name: undefined },
    { tournament_id: payload.tournament_id, name: payload.name, pin: payload.pin, locked: false },
    { tournament_id: payload.tournament_id, team_name: payload.name, pin_code: payload.pin, locked: false }
  ];

  let lastError = null;
  for (const attempt of attempts) {
    const insertPayload = Object.fromEntries(Object.entries(attempt).filter(([, value]) => value !== undefined));
    const { data, error } = await supabase.from('teams').insert(insertPayload).select('*').single();
    if (!error) return data;
    lastError = error;

    const missingColumn =
      isMissingColumnError(error, 'team_name') ||
      isMissingColumnError(error, 'name') ||
      isMissingColumnError(error, 'pin_code') ||
      isMissingColumnError(error, 'pin');
    if (!missingColumn) break;
  }

  throw lastError || new Error('Unable to create team');
}

async function fetchTeamsWithPlayers(tournamentId) {
  let teamsResult = await supabase
    .from('teams')
    .select('id, tournament_id, name, pin, created_at')
    .eq('tournament_id', tournamentId)
    .order('id', { ascending: true });
  if (teamsResult.error && (isMissingColumnError(teamsResult.error, 'name') || isMissingColumnError(teamsResult.error, 'pin'))) {
    teamsResult = await supabase
      .from('teams')
      .select('id, tournament_id, team_name, pin_code, created_at')
      .eq('tournament_id', tournamentId)
      .order('id', { ascending: true });
  }
  if (teamsResult.error) throw teamsResult.error;

  const teams = (teamsResult.data || []).map((row) => ({
    ...row,
    name: row.name ?? row.team_name ?? '',
    team_name: row.team_name ?? row.name ?? '',
    pin: row.pin ?? row.pin_code ?? '',
    pin_code: row.pin_code ?? row.pin ?? ''
  }));

  if (!teams.length) return [];

  const teamIds = teams.map((team) => team.id);
  const { data: members, error: membersError } = await supabase
    .from('team_members')
    .select('team_id, players (id, tournament_id, name, handicap, created_at)')
    .in('team_id', teamIds);
  if (membersError) throw membersError;

  const playersByTeamId = members.reduce((acc, row) => {
    if (!acc[row.team_id]) acc[row.team_id] = [];
    if (row.players) acc[row.team_id].push(row.players);
    return acc;
  }, {});

  return teams.map((team) => ({
    ...team,
    players: playersByTeamId[team.id] || []
  }));
}

app.get('/api/tournament', async (req, res) => {
  try {
    const tid = await resolveTournamentId(req.query.tournamentId);
    if (!tid) return res.json({ tournament: null });
    const tournament = await getTournament(tid);
    res.json({ tournament });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/tournaments', async (req, res) => {
  console.info('[api:admin:tournaments] request start', { method: req.method, path: req.path });
  try {
    const envError = ensureSupabaseEnv();
    if (envError) {
      return res.status(500).json({ success: false, error: envError });
    }

    console.info('[api:admin:tournaments] supabase query start', { action: 'list tournaments' });
    const { data, error } = await supabase
      .from('tournaments')
      .select('*')
      .order('year', { ascending: false });

    console.info('[api:admin:tournaments] supabase response', {
      error: error ? error.message : null,
      count: Array.isArray(data) ? data.length : null
    });

    if (error) throw error;
    res.json({ success: true, tournaments: data || [] });
  } catch (error) {
    console.error('[api:admin:tournaments] caught error', { error: error.message, stack: error.stack });
    res.status(500).json({ success: false, error: error.message || 'Failed to load tournaments' });
  }
});

async function createTournamentHandler(req, res) {
  try {
    const payload = req.body || {};
    console.info('[api:createTournament] request start', { method: req.method, path: req.path });
    console.info('[api:createTournament] incoming payload', payload);

    const envError = ensureSupabaseEnv();
    if (envError) {
      return res.status(500).json({ success: false, error: envError });
    }

    const rawName = typeof payload.name === 'string' ? payload.name.trim() : '';
    const rawDate = payload.date || payload.start_date || null;
    const rawCourse = payload.course ?? payload.course_name ?? '';
    const rawSlope = payload.slope_rating ?? payload.slope ?? null;
    const rawDescription = payload.description ?? '';

    const parsedDate = rawDate ? new Date(rawDate) : null;
    const date = parsedDate && Number.isFinite(parsedDate.getTime()) ? parsedDate.toISOString() : null;
    const year = Number.isFinite(Number(payload.year)) ? Number(payload.year) : (date ? new Date(date).getUTCFullYear() : null);
    const slope_rating = Number.isFinite(Number(rawSlope)) ? Number(rawSlope) : 113;
    const course = typeof rawCourse === 'string' ? rawCourse : '';
    const description = typeof rawDescription === 'string' ? rawDescription : '';
    const status = payload.status || 'upcoming';
    const format = payload.format || 'scramble';
    const mode = payload.mode ?? null;
    const handicap_percent = payload.handicap_percent ?? null;
    const is_published = Boolean(payload.is_published);
    const is_active = Boolean(payload.is_active);

    console.info('[api:createTournament] create start', { path: req.path, year, name: rawName, date });
    console.info('[api:createTournament] env presence', {
      hasNextPublicSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      hasSupabaseServiceRoleKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      hasNextPublicSupabaseAnonKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    });
    console.info('[api:createTournament] supabase client auth key source', {
      keyName: 'SUPABASE_SERVICE_ROLE_KEY',
      usingServiceRoleKey: true
    });

    if (!rawName) {
      return res.status(400).json({ success: false, error: 'Missing tournament name' });
    }
    if (!date) {
      return res.status(400).json({ success: false, error: 'Missing or invalid tournament date' });
    }
    if (!year) {
      return res.status(400).json({ success: false, error: 'Missing or invalid tournament year' });
    }

    const extendedInsertPayload = {
      year,
      name: rawName,
      date,
      course,
      slope_rating,
      description,
      status,
      format,
      mode,
      handicap_percent,
      is_published,
      is_active
    };

    const compatibilityInsertPayload = {
      year,
      name: rawName,
      date,
      course,
      slope_rating,
      description,
      status
    };

    const connectivityTest = await supabaseAdmin.from('tournaments').select('id').limit(1);
    if (connectivityTest.error) {
      console.error('[api:createTournament] supabase connectivity test error object:', connectivityTest.error);
      return res.status(500).json({ success: false, error: `Supabase connectivity test failed: ${connectivityTest.error.message}` });
    }

    console.info('[api:createTournament] insert payload (extended):', extendedInsertPayload);

    console.info('[api:createTournament] supabase query start', { action: 'insert tournament', mode: 'extended' });
    let { data, error } = await supabaseAdmin
      .from('tournaments')
      .insert([extendedInsertPayload])
      .select('*')
      .single();

    const undefinedColumn = error?.code === '42703' || /column .* does not exist/i.test(error?.message || '');
    if (error && undefinedColumn) {
      console.warn('[api:createTournament] falling back to compatibility insert due to missing column', {
        error: error.message,
        code: error.code || null
      });
      console.info('[api:createTournament] insert payload (compatibility):', compatibilityInsertPayload);
      const fallbackResponse = await supabaseAdmin
        .from('tournaments')
        .insert([compatibilityInsertPayload])
        .select('*')
        .single();
      data = fallbackResponse.data;
      error = fallbackResponse.error;
    }

    console.info('[api:createTournament] supabase response', {
      error: error ? error.message : null,
      tournamentId: data?.id || null
    });
    if (error) {
      console.error('[api:createTournament] supabase insert error object:', error);
      return res.status(500).json({ success: false, error: error.message || 'Failed to create tournament' });
    }

    console.info('[api:createTournament] create success', { tournamentId: data.id, path: req.path });
    res.status(201).json({ success: true, tournamentId: data.id, tournament: data });
  } catch (err) {
    console.error('[api:createTournament] caught error object:', err);
    res.status(500).json({
      success: false,
      error: err?.message || 'Unknown error',
      stack: process.env.NODE_ENV !== 'production' ? err?.stack : undefined
    });
  }
}

app.post('/api/admin/tournament', createTournamentHandler);
app.post('/api/admin/tournaments', createTournamentHandler);

app.put('/api/admin/tournament/:id', async (req, res) => {
  try {
    const tournamentId = asInt(req.params.id);
    if (!tournamentId) return res.status(400).json({ error: 'Invalid tournament id' });

    const updates = {};
    const allowedFields = ['year', 'name', 'date', 'course', 'description', 'status', 'format', 'mode', 'handicap_percent', 'slope_rating', 'is_published', 'is_active', 'gameday_info'];
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const { data, error } = await supabase
      .from('tournaments')
      .update(updates)
      .eq('id', tournamentId)
      .select('*')
      .single();
    if (error) throw error;

    res.json({ tournament: data });
  } catch (error) {
    return handleSupabaseError(res, error, 'PUT /api/admin/tournament/:id');
  }
});

app.delete('/api/admin/tournament/:id', async (req, res) => {
  try {
    const tournamentId = asInt(req.params.id);
    if (!tournamentId) return res.status(400).json({ error: 'Invalid tournament id' });

    const { error } = await supabase
      .from('tournaments')
      .delete()
      .eq('id', tournamentId);
    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    return handleSupabaseError(res, error, 'DELETE /api/admin/tournament/:id');
  }
});

function normalizeHoles(rawHoles) {
  return Array.from({ length: 18 }, (_, idx) => {
    const holeNumber = idx + 1;
    const source = (rawHoles || []).find((h) => Number(h.hole_number) === holeNumber) || {};
    return {
      hole_number: holeNumber,
      par: Number(source.par) || 4,
      stroke_index: Number(source.stroke_index) || 0,
      requires_photo: !!source.requires_photo,
      is_longest_drive: !!source.is_longest_drive,
      is_closest_to_pin: !!source.is_closest_to_pin
    };
  });
}

async function getCourseWithHoles(courseId) {
  const { data: course, error: cErr } = await supabase.from('courses').select('*').eq('id', courseId).maybeSingle();
  if (cErr) throw cErr;
  if (!course) return { course: null, holes: [] };
  const { data: holes, error: hErr } = await supabase.from('course_holes').select('*').eq('course_id', courseId).order('hole_number', { ascending: true });
  if (hErr) throw hErr;
  return { course, holes: normalizeHoles(holes) };
}

app.get('/api/admin/courses', async (_, res) => {
  try {
    const { data, error } = await supabase.from('courses').select('*').order('name', { ascending: true });
    if (error) throw error;
    res.json({ courses: data || [] });
  } catch (error) {
    return handleSupabaseError(res, error, 'GET /api/admin/courses');
  }
});

app.post('/api/admin/courses', async (req, res) => {
  try {
    const { name, slope_rating = 113, location = '', notes = '' } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    const { data, error } = await supabase.from('courses').insert({ name, slope_rating, location, notes }).select('*').single();
    if (error) throw error;
    const holes = normalizeHoles([]);
    const payload = holes.map((h) => ({ ...h, course_id: data.id }));
    const hResp = await supabase.from('course_holes').insert(payload).select('*');
    if (hResp.error) throw hResp.error;
    res.status(201).json({ course: data, holes });
  } catch (error) {
    return handleSupabaseError(res, error, 'POST /api/admin/courses');
  }
});

app.post('/api/admin/course', (req, res) => forwardTo(req, res, 'POST', '/api/admin/courses'));

app.get('/api/admin/courses/:id', async (req, res) => {
  try {
    const courseId = asInt(req.params.id);
    if (!courseId) return res.status(400).json({ error: 'Invalid course id' });
    const response = await getCourseWithHoles(courseId);
    if (!response.course) return res.status(404).json({ error: 'Course not found' });
    res.json(response);
  } catch (error) {
    return handleSupabaseError(res, error, 'GET /api/admin/courses/:id');
  }
});

app.get('/api/admin/course/:id', (req, res) => forwardTo(req, res, 'GET', `/api/admin/courses/${req.params.id}`));

app.patch('/api/admin/courses/:id', async (req, res) => {
  try {
    const courseId = asInt(req.params.id);
    if (!courseId) return res.status(400).json({ error: 'Invalid course id' });
    const updates = {};
    for (const field of ['name', 'slope_rating', 'location', 'notes']) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'No valid fields to update' });
    const { data, error } = await supabase.from('courses').update(updates).eq('id', courseId).select('*').maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Course not found' });
    res.json({ course: data });
  } catch (error) {
    return handleSupabaseError(res, error, 'PATCH /api/admin/courses/:id');
  }
});

app.put('/api/admin/course/:id', (req, res) => forwardTo(req, res, 'PATCH', `/api/admin/courses/${req.params.id}`));

app.delete('/api/admin/courses/:id', async (req, res) => {
  try {
    const courseId = asInt(req.params.id);
    if (!courseId) return res.status(400).json({ error: 'Invalid course id' });
    await supabase.from('course_holes').delete().eq('course_id', courseId);
    const { error } = await supabase.from('courses').delete().eq('id', courseId);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    return handleSupabaseError(res, error, 'DELETE /api/admin/courses/:id');
  }
});

app.delete('/api/admin/course/:id', (req, res) => forwardTo(req, res, 'DELETE', `/api/admin/courses/${req.params.id}`));

app.get('/api/admin/courses/:id/holes', async (req, res) => {
  try {
    const courseId = asInt(req.params.id);
    if (!courseId) return res.status(400).json({ error: 'Invalid course id' });
    const { holes } = await getCourseWithHoles(courseId);
    res.json({ holes });
  } catch (error) {
    return handleSupabaseError(res, error, 'GET /api/admin/courses/:id/holes');
  }
});

app.get('/api/admin/course/:id/holes', (req, res) => forwardTo(req, res, 'GET', `/api/admin/courses/${req.params.id}/holes`));

app.post('/api/admin/courses/:id/holes', async (req, res) => {
  try {
    const courseId = asInt(req.params.id);
    if (!courseId) return res.status(400).json({ error: 'Invalid course id' });
    const holes = normalizeHoles(req.body?.holes || []);
    await supabase.from('course_holes').delete().eq('course_id', courseId);
    const payload = holes.map((h) => ({ ...h, course_id: courseId }));
    const { error } = await supabase.from('course_holes').insert(payload);
    if (error) throw error;
    res.json({ success: true, holes });
  } catch (error) {
    return handleSupabaseError(res, error, 'POST /api/admin/courses/:id/holes');
  }
});

app.post('/api/admin/course/:id/holes', (req, res) => forwardTo(req, res, 'POST', `/api/admin/courses/${req.params.id}/holes`));

app.get('/api/admin/tournaments/:id', async (req, res) => {
  try {
    const tournamentId = asInt(req.params.id);
    if (!tournamentId) return res.status(400).json({ error: 'Invalid tournament id' });
    const tournament = await getTournament(tournamentId);
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    res.json({ tournament });
  } catch (error) {
    return handleSupabaseError(res, error, 'GET /api/admin/tournaments/:id');
  }
});

app.patch('/api/admin/tournaments/:id', (req, res) => forwardTo(req, res, 'PUT', `/api/admin/tournament/${req.params.id}`));
app.delete('/api/admin/tournaments/:id', (req, res) => forwardTo(req, res, 'DELETE', `/api/admin/tournament/${req.params.id}`));

app.get('/api/admin/tournaments/:id/holes', async (req, res) => {
  try {
    const tournamentId = asInt(req.params.id);
    if (!tournamentId) return res.status(400).json({ error: 'Invalid tournament id' });
    const { data, error } = await supabase.from('tournament_holes').select('*').eq('tournament_id', tournamentId).order('hole_number', { ascending: true });
    if (error) throw error;
    res.json({ holes: normalizeHoles(data) });
  } catch (error) {
    return handleSupabaseError(res, error, 'GET /api/admin/tournaments/:id/holes');
  }
});

app.get('/api/admin/tournament/:id/holes', (req, res) => forwardTo(req, res, 'GET', `/api/admin/tournaments/${req.params.id}/holes`));

app.post('/api/admin/tournaments/:id/holes', async (req, res) => {
  try {
    const tournamentId = asInt(req.params.id);
    if (!tournamentId) return res.status(400).json({ error: 'Invalid tournament id' });
    const holes = normalizeHoles(req.body?.holes || []);
    await supabase.from('tournament_holes').delete().eq('tournament_id', tournamentId);
    const payload = holes.map((h) => ({ ...h, tournament_id: tournamentId }));
    const { error } = await supabase.from('tournament_holes').insert(payload);
    if (error) throw error;
    res.json({ success: true, holes });
  } catch (error) {
    return handleSupabaseError(res, error, 'POST /api/admin/tournaments/:id/holes');
  }
});

app.post('/api/admin/tournament/:id/holes', (req, res) => forwardTo(req, res, 'POST', `/api/admin/tournaments/${req.params.id}/holes`));

app.post('/api/admin/tournaments/:id/import-course-template', async (req, res) => {
  try {
    const tournamentId = asInt(req.params.id);
    const courseId = asInt(req.body?.course_id || req.body?.courseId);
    if (!tournamentId || !courseId) return res.status(400).json({ error: 'tournament id and course_id are required' });
    const { course, holes } = await getCourseWithHoles(courseId);
    if (!course) return res.status(404).json({ error: 'Course not found' });
    await supabase.from('tournament_holes').delete().eq('tournament_id', tournamentId);
    const payload = holes.map((h) => ({ ...h, tournament_id: tournamentId }));
    const insertResp = await supabase.from('tournament_holes').insert(payload);
    if (insertResp.error) throw insertResp.error;
    const updateResp = await supabase.from('tournaments').update({ course: course.name, slope_rating: course.slope_rating }).eq('id', tournamentId).select('*').single();
    if (updateResp.error) throw updateResp.error;
    res.json({ success: true, tournament: updateResp.data, holes });
  } catch (error) {
    return handleSupabaseError(res, error, 'POST /api/admin/tournaments/:id/import-course-template');
  }
});

app.put('/api/admin/tournament/:id/slope', async (req, res) => {
  try {
    const tournamentId = asInt(req.params.id);
    const slope_rating = Number(req.body?.slope_rating);
    if (!tournamentId || !Number.isFinite(slope_rating)) return res.status(400).json({ error: 'Invalid input' });
    const { data, error } = await supabase.from('tournaments').update({ slope_rating }).eq('id', tournamentId).select('*').single();
    if (error) throw error;
    res.json({ tournament: data });
  } catch (error) {
    return handleSupabaseError(res, error, 'PUT /api/admin/tournament/:id/slope');
  }
});

app.get('/api/players', async (req, res) => {
  try {
    const tournamentId = await resolveTournamentId(req.query.tournamentId);
    if (!tournamentId) return res.json({ players: [] });

    const { data, error } = await supabase
      .from('players')
      .select('*')
      .eq('tournament_id', tournamentId)
      .order('name', { ascending: true });
    if (error) throw error;

    res.json({ players: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/players', async (req, res) => {
  try {
    const tournamentId = asInt(req.body.tournament_id);
    const { name, handicap = 0 } = req.body;
    if (!tournamentId || !name) return res.status(400).json({ error: 'tournament_id and name are required' });

    const { data, error } = await supabase
      .from('players')
      .insert({ tournament_id: tournamentId, name, handicap })
      .select('*')
      .single();
    if (error) throw error;

    res.status(201).json({ player: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/players', async (req, res) => {
  try {
    const tournamentId = asInt(req.query.tournamentId);
    let query = supabase.from('players').select('*').order('name', { ascending: true });
    if (tournamentId) query = query.eq('tournament_id', tournamentId);
    const { data, error } = await query;
    if (error) throw error;
    res.json({ players: data || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/players', (req, res) => forwardTo(req, res, 'POST', '/api/players'));

app.get('/api/admin/players/:id', async (req, res) => {
  try {
    const playerId = asInt(req.params.id);
    if (!playerId) return res.status(400).json({ error: 'Invalid player id' });
    const { data, error } = await supabase.from('players').select('*').eq('id', playerId).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Player not found' });
    res.json({ player: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/admin/players/:id', async (req, res) => {
  try {
    const playerId = asInt(req.params.id);
    if (!playerId) return res.status(400).json({ error: 'Invalid player id' });
    const updates = {};
    for (const field of ['name', 'handicap']) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'No valid fields to update' });
    const { data, error } = await supabase.from('players').update(updates).eq('id', playerId).select('*').maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Player not found' });
    res.json({ player: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/players/:id', async (req, res) => {
  try {
    const playerId = asInt(req.params.id);
    if (!playerId) return res.status(400).json({ error: 'Invalid player id' });
    await supabase.from('team_members').delete().eq('player_id', playerId);
    const { error } = await supabase.from('players').delete().eq('id', playerId);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/teams', async (req, res) => {
  try {
    const tournamentId = await resolveTournamentId(req.query.tournamentId);
    if (!tournamentId) return res.json({ teams: [] });

    const teams = await fetchTeamsWithPlayers(tournamentId);
    res.json({ teams });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/teams', async (req, res) => {
  try {
    const tournamentId = asInt(req.body.tournament_id || req.body.tournamentId);
    const name = req.body.name || req.body.team_name;
    const pin = req.body.pin || req.body.pin_code;
    console.info('[api:teams:create] payload', {
      tournament_id: req.body?.tournament_id ?? req.body?.tournamentId ?? null,
      name: req.body?.name ?? null,
      team_name: req.body?.team_name ?? null,
      pin: req.body?.pin ?? null,
      pin_code: req.body?.pin_code ?? null,
      player1: req.body?.player1 ?? null,
      player2: req.body?.player2 ?? null,
      player1_handicap: req.body?.player1_handicap ?? null,
      player2_handicap: req.body?.player2_handicap ?? null
    });
    if (!tournamentId || !name || !pin) {
      return res.status(400).json({ success: false, error: 'tournament_id, name and pin are required' });
    }

    const data = await insertTeamCompat({ tournament_id: tournamentId, name, pin });

    res.status(201).json({ team: data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/teams', async (req, res) => {
  try {
    const tournamentId = asInt(req.query.tournamentId);
    if (!tournamentId) return res.status(400).json({ error: 'tournamentId is required' });
    const teams = await fetchTeamsWithPlayers(tournamentId);
    res.json({ teams });
  } catch (error) {
    return handleSupabaseError(res, error, 'GET /api/admin/teams');
  }
});

app.post('/api/admin/teams', (req, res) => forwardTo(req, res, 'POST', '/api/teams'));

app.get('/api/admin/teams/:id', async (req, res) => {
  try {
    const teamId = asInt(req.params.id);
    if (!teamId) return res.status(400).json({ error: 'Invalid team id' });
    const { data: team, error: teamError } = await supabase.from('teams').select('*').eq('id', teamId).maybeSingle();
    if (teamError) throw teamError;
    if (!team) return res.status(404).json({ error: 'Team not found' });
    const { data: members, error: mErr } = await supabase.from('team_members').select('player_id, players (*)').eq('team_id', teamId);
    if (mErr) throw mErr;
    res.json({ team: { ...team, players: (members || []).map((m) => m.players).filter(Boolean) } });
  } catch (error) {
    return handleSupabaseError(res, error, 'GET /api/admin/teams/:id');
  }
});

app.patch('/api/admin/teams/:id', async (req, res) => {
  try {
    const teamId = asInt(req.params.id);
    if (!teamId) return res.status(400).json({ error: 'Invalid team id' });
    const updates = {};
    if (req.body.name !== undefined || req.body.team_name !== undefined) updates.name = req.body.name || req.body.team_name;
    if (req.body.pin !== undefined || req.body.pin_code !== undefined) updates.pin = req.body.pin || req.body.pin_code;
    if (req.body.locked !== undefined) updates.locked = !!req.body.locked;
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'No valid fields to update' });
    const { data, error } = await supabase.from('teams').update(updates).eq('id', teamId).select('*').maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Team not found' });
    res.json({ team: data });
  } catch (error) {
    return handleSupabaseError(res, error, 'PATCH /api/admin/teams/:id');
  }
});

app.put('/api/admin/team/:id', (req, res) => forwardTo(req, res, 'PATCH', `/api/admin/teams/${req.params.id}`));
app.put('/api/admin/team/:id/lock', (req, res) => forwardTo(req, res, 'PATCH', `/api/admin/teams/${req.params.id}`));

app.delete('/api/admin/teams/:id', async (req, res) => {
  try {
    const teamId = asInt(req.params.id);
    if (!teamId) return res.status(400).json({ error: 'Invalid team id' });
    await supabase.from('team_members').delete().eq('team_id', teamId);
    await supabase.from('scores').delete().eq('team_id', teamId);
    const { error } = await supabase.from('teams').delete().eq('id', teamId);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    return handleSupabaseError(res, error, 'DELETE /api/admin/teams/:id');
  }
});

app.post('/api/admin/teams/:id/players', async (req, res) => {
  try {
    const teamId = asInt(req.params.id);
    const playerId = asInt(req.body?.player_id || req.body?.playerId);
    if (!teamId || !playerId) return res.status(400).json({ error: 'team id and player id are required' });
    const { data, error } = await supabase.from('team_members').insert({ team_id: teamId, player_id: playerId }).select('*').single();
    if (error) throw error;
    res.status(201).json({ membership: data });
  } catch (error) {
    return handleSupabaseError(res, error, 'POST /api/admin/teams/:id/players');
  }
});

app.post('/api/teams/:id/add-player', async (req, res) => {
  try {
    const teamId = asInt(req.params.id);
    const playerId = asInt(req.body.player_id || req.body.playerId);
    if (!teamId || !playerId) return res.status(400).json({ error: 'team id and player id are required' });

    const { data: team, error: teamError } = await supabase
      .from('teams')
      .select('id, tournament_id')
      .eq('id', teamId)
      .single();
    if (teamError) throw teamError;

    const tournament = await getTournament(team.tournament_id);
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

    const { count, error: countError } = await supabase
      .from('team_members')
      .select('*', { count: 'exact', head: true })
      .eq('team_id', teamId);
    if (countError) throw countError;

    const maxPlayers = getTeamSizeForFormat(getTournamentFormat(tournament));
    if ((count || 0) >= maxPlayers) {
      return res.status(400).json({ error: 'Antall spillere passer ikke med valgt lagstørrelse' });
    }

    const { data: player, error: playerError } = await supabase
      .from('players')
      .select('id, tournament_id')
      .eq('id', playerId)
      .single();
    if (playerError) throw playerError;

    if (player.tournament_id !== team.tournament_id) {
      return res.status(400).json({ error: 'Player must belong to same tournament as team' });
    }

    const { data, error } = await supabase
      .from('team_members')
      .insert({ team_id: teamId, player_id: playerId })
      .select('*')
      .single();
    if (error) throw error;

    res.status(201).json({ membership: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/teams/:id', async (req, res) => {
  try {
    const teamId = asInt(req.params.id);
    const tournamentId = asInt(req.query.tournamentId || req.body?.tournamentId);
    if (!teamId || !tournamentId) return res.status(400).json({ error: 'team id and tournamentId are required' });

    await supabase.from('team_members').delete().eq('team_id', teamId);
    await supabase.from('scores').delete().eq('team_id', teamId);
    const { error } = await supabase.from('teams').delete().eq('id', teamId).eq('tournament_id', tournamentId);
    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/tournament/:id/teams', async (req, res) => {
  try {
    const tournamentId = asInt(req.params.id);
    if (!tournamentId) return res.status(400).json({ error: 'Invalid tournament id' });
    const teams = await fetchTeamsWithPlayers(tournamentId);

    const compat = teams.map((team) => ({
      id: team.id,
      tournament_id: team.tournament_id,
      team_name: team.name,
      pin_code: team.pin,
      players: team.players,
      player1: team.players[0]?.name || '',
      player2: team.players[1]?.name || ''
    }));

    res.json({ teams: compat });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/tournament/:id/scores', async (req, res) => {
  try {
    const tournamentId = asInt(req.params.id);
    if (!tournamentId) return res.status(400).json({ error: 'Invalid tournament id' });

    const { data: teams, error: teamError } = await supabase
      .from('teams')
      .select('id,name')
      .eq('tournament_id', tournamentId);
    if (teamError) throw teamError;

    const teamIds = teams.map((team) => team.id);
    if (!teamIds.length) return res.json({ scores: [] });

    const { data: scores, error: scoreError } = await supabase
      .from('scores')
      .select('*')
      .eq('tournament_id', tournamentId)
      .in('team_id', teamIds);
    if (scoreError) throw scoreError;

    res.json({ scores });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/scores', async (req, res) => {
  try {
    const tournamentId = asInt(req.query.tournamentId);
    let query = supabase.from('scores').select('*').order('hole_number', { ascending: true });
    if (tournamentId) query = query.eq('tournament_id', tournamentId);
    const { data, error } = await query;
    if (error) throw error;
    res.json({ scores: data || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/scores', async (req, res) => {
  try {
    const { tournament_id, team_id, hole_number, score, par = null, photo_path = null } = req.body || {};
    if (!tournament_id || !team_id || !hole_number || !score) return res.status(400).json({ error: 'tournament_id, team_id, hole_number and score are required' });
    const { data, error } = await supabase.from('scores').insert({ tournament_id, team_id, hole_number, score, par, photo_path }).select('*').single();
    if (error) throw error;
    res.status(201).json({ score: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/scores/:id', async (req, res) => {
  try {
    const scoreId = asInt(req.params.id);
    if (!scoreId) return res.status(400).json({ error: 'Invalid score id' });
    const { data, error } = await supabase.from('scores').select('*').eq('id', scoreId).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Score not found' });
    res.json({ score: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/admin/scores/:id', async (req, res) => {
  try {
    const scoreId = asInt(req.params.id);
    if (!scoreId) return res.status(400).json({ error: 'Invalid score id' });
    const updates = {};
    for (const field of ['score', 'par', 'photo_path']) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'No valid fields to update' });
    const { data, error } = await supabase.from('scores').update(updates).eq('id', scoreId).select('*').maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Score not found' });
    res.json({ score: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/admin/score/:id', (req, res) => forwardTo(req, res, 'PATCH', `/api/admin/scores/${req.params.id}`));

app.delete('/api/admin/scores/:id', async (req, res) => {
  try {
    const scoreId = asInt(req.params.id);
    if (!scoreId) return res.status(400).json({ error: 'Invalid score id' });
    const { error } = await supabase.from('scores').delete().eq('id', scoreId);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/score/:id', (req, res) => forwardTo(req, res, 'DELETE', `/api/admin/scores/${req.params.id}`));

app.post('/api/admin/team', async (req, res) => {
  try {
    const { tournament_id, team_name, pin_code, player1, player2 } = req.body || {};
    if (!tournament_id || !team_name || !pin_code) {
      return res.status(400).json({ success: false, error: 'tournament_id, team_name and pin_code are required' });
    }

    const createTeamData = await insertTeamCompat({ tournament_id, name: team_name, pin: pin_code });

    const players = [player1, player2].filter(Boolean);
    for (const playerName of players) {
      const createPlayer = await supabase
        .from('players')
        .insert({ tournament_id, name: playerName })
        .select('*')
        .single();
      if (createPlayer.error) throw createPlayer.error;

      const linkPlayer = await supabase
        .from('team_members')
        .insert({ team_id: createTeamData.id, player_id: createPlayer.data.id })
        .select('*')
        .single();
      if (linkPlayer.error) throw linkPlayer.error;
    }

    res.status(201).json({ team: createTeamData });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/admin/team/:id', async (req, res) => {
  try {
    const teamId = asInt(req.params.id);
    const { data: team, error } = await supabase.from('teams').select('id,tournament_id').eq('id', teamId).single();
    if (error) throw error;

    const del = await supabase.from('teams').delete().eq('id', teamId).eq('tournament_id', team.tournament_id);
    if (del.error) throw del.error;

    await supabase.from('team_members').delete().eq('team_id', teamId);
    await supabase.from('scores').delete().eq('team_id', teamId);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/scoreboard', async (req, res) => {
  try {
    const tournamentId = await resolveTournamentId(req.query.tournamentId);
    if (!tournamentId) return res.json({ tournament: null, scoreboard: [] });

    const tournament = await getTournament(tournamentId);
    const teams = await fetchTeamsWithPlayers(tournamentId);
    const teamIds = teams.map((team) => team.id);

    let scores = [];
    if (teamIds.length) {
      const { data, error } = await supabase
        .from('scores')
        .select('team_id, score')
        .in('team_id', teamIds);
      if (error) throw error;
      scores = data;
    }

    const totals = teams.map((team) => {
      const teamScores = scores.filter((row) => row.team_id === team.id);
      const total = teamScores.reduce((sum, row) => sum + Number(row.score || 0), 0);
      const player1 = team.players[0]?.name || '';
      const player2 = team.players[1]?.name || '';
      const holeScores = {};
      for (const s of teamScores) holeScores[s.hole_number] = { score: s.score };
      return {
        team_id: team.id,
        team_name: team.name,
        players: team.players,
        player1,
        player2,
        total_score: total,
        holes_completed: teamScores.length,
        to_par: 0,
        hole_scores: holeScores
      };
    }).sort((a, b) => a.total_score - b.total_score);

    res.json({ tournament, holes: [], awards: [], scoreboard: totals });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.write('event: ping\\ndata: {}\\n\\n');
});

app.put('/api/admin/tournament/:id/gameday', async (req, res) => {
  try {
    const tournamentId = asInt(req.params.id);
    if (!tournamentId) return res.status(400).json({ error: 'Invalid tournament id' });
    const { data, error } = await supabase.from('tournaments').update({ gameday_info: req.body?.gameday_info || '' }).eq('id', tournamentId).select('*').single();
    if (error) throw error;
    res.json({ tournament: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/tournament/:id/photos', async (req, res) => {
  const route = '/api/admin/tournament/:id/photos';
  try {
    const tournamentId = asInt(req.params.id);
    routeLog(route, 'hit', { payload: { tournamentId } });
    if (!tournamentId) return res.status(400).json({ success: false, error: 'Invalid tournament id' });

    const { data: scoreRows, error: scoreError } = await supabase
      .from('scores')
      .select('id, team_id, hole_number, photo_path, created_at')
      .eq('tournament_id', tournamentId)
      .not('photo_path', 'is', null)
      .order('created_at', { ascending: false });
    if (scoreError) throw scoreError;

    const teamIds = [...new Set((scoreRows || []).map((row) => row.team_id).filter(Boolean))];
    let teamsById = {};
    if (teamIds.length) {
      const { data: teams, error: teamsError } = await supabase
        .from('teams')
        .select('id, name, team_name')
        .in('id', teamIds);
      if (teamsError) throw teamsError;
      teamsById = Object.fromEntries((teams || []).map((team) => [team.id, normalizeTeamRow(team)]));
    }

    let playerNamesByTeamId = {};
    if (teamIds.length) {
      const { data: members, error: membersError } = await supabase
        .from('team_members')
        .select('team_id, players(name)')
        .in('team_id', teamIds);
      if (membersError) throw membersError;
      playerNamesByTeamId = (members || []).reduce((acc, row) => {
        if (!acc[row.team_id]) acc[row.team_id] = [];
        if (row.players?.name) acc[row.team_id].push(row.players.name);
        return acc;
      }, {});
    }

    const photos = (scoreRows || []).map((row) => ({
      id: row.id,
      team_id: row.team_id,
      team_name: teamsById[row.team_id]?.team_name || 'Lag',
      player1: playerNamesByTeamId[row.team_id]?.[0] || '',
      player2: playerNamesByTeamId[row.team_id]?.[1] || '',
      hole_number: row.hole_number,
      photo_path: row.photo_path,
      submitted_at: row.created_at,
      is_published: true
    }));

    routeLog(route, 'db_action', { action: 'fetch_score_photos', count: photos.length, tournamentId });
    return res.json({ success: true, photos });
  } catch (error) {
    routeLog(route, 'error', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: error?.message || 'Kunne ikke hente turneringsbilder' });
  }
});

app.get('/admin/tournament/:id/photos', (req, res) => forwardTo(req, res, 'GET', `/api/admin/tournament/${req.params.id}/photos`));

app.get('/api/admin/tournament/:id/gallery', async (req, res) => {
  const route = '/api/admin/tournament/:id/gallery:GET';
  try {
    const tournamentId = asInt(req.params.id);
    routeLog(route, 'hit', { payload: { tournamentId } });
    if (!tournamentId) return res.status(400).json({ success: false, error: 'Invalid tournament id' });

    const { data, error } = await supabase
      .from('tournament_gallery_images')
      .select('id, tournament_id, photo_path, storage_path, caption, is_published, uploaded_at')
      .eq('tournament_id', tournamentId)
      .order('uploaded_at', { ascending: false });
    if (error) throw error;

    routeLog(route, 'db_action', { action: 'fetch_gallery', count: data?.length || 0, tournamentId });
    return res.json({ success: true, photos: data || [] });
  } catch (error) {
    routeLog(route, 'error', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: error?.message || 'Kunne ikke hente galleri' });
  }
});

app.post('/api/admin/tournament/:id/gallery', upload.single('photo'), async (req, res) => {
  const route = '/api/admin/tournament/:id/gallery:POST';
  try {
    const tournamentId = asInt(req.params.id);
    const caption = String(req.body?.caption || '').trim();
    routeLog(route, 'hit', { payload: { tournamentId, captionLength: caption.length, hasFile: !!req.file } });
    if (!tournamentId) return res.status(400).json({ success: false, error: 'Invalid tournament id' });
    if (!req.file) return res.status(400).json({ success: false, error: 'Mangler bildefil (photo)' });

    const extension = path.extname(req.file.originalname || '').toLowerCase() || '.jpg';
    const safeExt = /^[.][a-z0-9]+$/.test(extension) ? extension : '.jpg';
    const storagePath = `tournament/${tournamentId}/${Date.now()}-${crypto.randomUUID()}${safeExt}`;

    const { error: storageError } = await supabase
      .storage
      .from('tournament-gallery')
      .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype || 'image/jpeg', upsert: false });
    if (storageError) throw storageError;

    const { data: publicData } = supabase.storage.from('tournament-gallery').getPublicUrl(storagePath);
    const insertPayload = {
      tournament_id: tournamentId,
      photo_path: publicData?.publicUrl || null,
      storage_path: storagePath,
      caption: caption || null,
      is_published: true
    };
    const { data, error } = await supabase
      .from('tournament_gallery_images')
      .insert(insertPayload)
      .select('*')
      .single();
    if (error) throw error;

    routeLog(route, 'db_action', { action: 'upload_gallery_image', imageId: data?.id, storagePath });
    return res.json({ success: true, photo: data });
  } catch (error) {
    routeLog(route, 'error', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: error?.message || 'Kunne ikke laste opp galleri-bilde' });
  }
});

app.get('/admin/tournament/:id/gallery', (req, res) => forwardTo(req, res, 'GET', `/api/admin/tournament/${req.params.id}/gallery`));
app.post('/admin/tournament/:id/gallery', (req, res) => forwardTo(req, res, 'POST', `/api/admin/tournament/${req.params.id}/gallery`));

app.get('/api/admin/legacy', async (_req, res) => {
  const route = '/api/admin/legacy:GET';
  try {
    routeLog(route, 'hit');
    const { data, error } = await supabase
      .from('legacy_entries')
      .select('*')
      .order('year', { ascending: false });
    if (error) throw error;
    routeLog(route, 'db_action', { action: 'fetch_legacy', count: data?.length || 0 });
    return res.json({ success: true, legacy: data || [] });
  } catch (error) {
    routeLog(route, 'error', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: error?.message || 'Kunne ikke hente historikk' });
  }
});

app.post('/api/admin/legacy', async (req, res) => {
  const route = '/api/admin/legacy:POST';
  try {
    const payload = {
      year: asInt(req.body?.year),
      winner_team: String(req.body?.winner_team || '').trim(),
      player1: String(req.body?.player1 || '').trim(),
      player2: String(req.body?.player2 || '').trim(),
      score: req.body?.score ? String(req.body.score).trim() : null,
      score_to_par: req.body?.score_to_par ? String(req.body.score_to_par).trim() : null,
      course: req.body?.course ? String(req.body.course).trim() : null,
      notes: req.body?.notes ? String(req.body.notes).trim() : null
    };
    routeLog(route, 'hit', { payload });

    if (!payload.year || !payload.winner_team || !payload.player1 || !payload.player2) {
      return res.status(400).json({ success: false, error: 'Mangler påkrevde felt: year, winner_team, player1, player2' });
    }

    const { data, error } = await supabase.from('legacy_entries').insert(payload).select('*').single();
    if (error) throw error;
    routeLog(route, 'db_action', { action: 'insert_legacy', id: data?.id, year: data?.year });
    return res.json({ success: true, legacy: data });
  } catch (error) {
    routeLog(route, 'error', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: error?.message || 'Kunne ikke lagre historikkoppføring' });
  }
});

app.delete('/api/admin/legacy/:id', async (req, res) => {
  const route = '/api/admin/legacy/:id:DELETE';
  try {
    const legacyId = asInt(req.params.id);
    routeLog(route, 'hit', { payload: { legacyId } });
    if (!legacyId) return res.status(400).json({ success: false, error: 'Invalid legacy id' });
    const { error } = await supabase.from('legacy_entries').delete().eq('id', legacyId);
    if (error) throw error;
    routeLog(route, 'db_action', { action: 'delete_legacy', legacyId });
    return res.json({ success: true });
  } catch (error) {
    routeLog(route, 'error', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: error?.message || 'Kunne ikke slette historikkoppføring' });
  }
});

app.post('/admin/legacy', (req, res) => forwardTo(req, res, 'POST', '/api/admin/legacy'));

app.use('/api', (req, res) => {
  res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` });
});

if (require.main === module) {
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Lorgen Invitational listening on ${PORT}`);
  });
}

module.exports = app;
