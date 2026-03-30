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
const MEDIA_BUCKET = process.env.SUPABASE_MEDIA_BUCKET || 'tournament-gallery';
const HOLE_IMAGE_BUCKET = 'images';
const CHAT_BASE_COLUMNS = ['id', 'tournament_id', 'team_id', 'team_name', 'message', 'created_at'];
const CHAT_OPTIONAL_COLUMNS = ['note', 'image_path'];

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

const UUID_V4ISH_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function normalizeUuid(value) {
  const raw = String(value ?? '').trim();
  if (!raw || !UUID_V4ISH_REGEX.test(raw)) return null;
  return raw.toLowerCase();
}

function normalizeEntityId(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const uuid = normalizeUuid(raw);
  if (uuid) return uuid;
  if (/^\d+$/.test(raw)) return raw;
  return null;
}

function isValidEntityId(value) {
  return !!normalizeEntityId(value);
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

function isMissingTableError(error, tableName = '') {
  const message = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
  if (error?.code === '42P01') return true;
  if (!message.includes('relation') || !message.includes('does not exist')) return false;
  if (!tableName) return true;
  return message.includes(tableName.toLowerCase());
}

function detectMissingColumn(error) {
  const message = `${error?.message || ''} ${error?.details || ''}`;
  const match = message.match(/column ['"]?([a-zA-Z0-9_]+)['"]? does not exist/i);
  if (match?.[1]) return match[1];
  if (error?.code !== '42703') return null;
  const cacheMatch = message.match(/Could not find the '([a-zA-Z0-9_]+)' column/i);
  return cacheMatch?.[1] || null;
}

function isMissingBucketError(error) {
  const message = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
  return message.includes('bucket not found') || (message.includes('bucket') && message.includes('not') && message.includes('found'));
}

function buildTournamentStoragePath({ tournamentId, teamId, holeNumber, extension }) {
  const safeTournamentId = Number.isFinite(Number(tournamentId)) ? Number(tournamentId) : 0;
  const safeTeamId = Number.isFinite(Number(teamId)) ? Number(teamId) : 0;
  const holeSegment = String(holeNumber ?? 0).trim() || '0';
  return `tournament/${safeTournamentId}/team/${safeTeamId}/hole/${holeSegment}/${Date.now()}-${crypto.randomUUID()}${extension}`;
}

function getRequestBaseUrl(req) {
  const protoHeader = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const host = req.headers['x-forwarded-host'] || req.get('host');
  if (!host) return null;
  return `${protoHeader}://${host}`;
}

function toAbsoluteMediaUrl(value, req) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^(https?:)?\/\//i.test(raw) || raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
  if (raw.startsWith('/')) {
    const base = getRequestBaseUrl(req);
    return base ? `${base}${raw}` : raw;
  }
  const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(raw);
  return data?.publicUrl || raw;
}

function withCanonicalImageField(row, req, sourceField = 'photo_path') {
  const resolved = toAbsoluteMediaUrl(row?.[sourceField], req);
  return {
    ...row,
    [sourceField]: resolved,
    image_url: resolved
  };
}

function buildBucketMissingError(bucketName = MEDIA_BUCKET) {
  return {
    success: false,
    error: `Supabase Storage bucket mangler: ${bucketName}.`,
    code: 'STORAGE_BUCKET_NOT_FOUND',
    bucket: bucketName,
    action: `Create bucket: ${bucketName}`
  };
}

function getRequestBaseUrl(req) {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim() || 'https';
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!host) return null;
  return `${proto}://${host}`;
}

function resolveImageUrl(rawPath, req) {
  const value = String(rawPath || '').trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value) || /^data:/i.test(value)) return value;

  if (value.startsWith('/')) {
    const baseUrl = getRequestBaseUrl(req);
    if (!baseUrl) return value;
    try {
      return new URL(value, baseUrl).toString();
    } catch (_) {
      return value;
    }
  }

  let storagePath = value.replace(/^\/+/, '');
  if (storagePath.startsWith(`${MEDIA_BUCKET}/`)) {
    storagePath = storagePath.slice(MEDIA_BUCKET.length + 1);
  }

  const looksLikeStoragePath = storagePath.includes('/') && !storagePath.startsWith('uploads/');
  if (looksLikeStoragePath) {
    const { data: publicData } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(storagePath);
    if (publicData?.publicUrl) return publicData.publicUrl;
  }

  const baseUrl = getRequestBaseUrl(req);
  if (!baseUrl) return value;
  try {
    return new URL(`/${storagePath}`, baseUrl).toString();
  } catch (_) {
    return value;
  }
}

function mapChatRow(row) {
  return {
    id: row?.id ?? null,
    tournament_id: row?.tournament_id ?? null,
    team_id: row?.team_id ?? null,
    team_name: row?.team_name ?? null,
    message: row?.message ?? null,
    note: row?.note ?? null,
    image_path: row?.image_path ?? null,
    created_at: row?.created_at ?? null
  };
}

function mapChatRowForResponse(row, req) {
  const mapped = mapChatRow(row);
  return {
    ...mapped,
    image_path: toAbsoluteMediaUrl(mapped.image_path, req)
  };
}

function isBirdieMessage(row) {
  const text = `${row?.message || ''} ${row?.note || ''}`.toLowerCase();
  return text.includes('birdie shoutout') || text.includes('birdie shots');
}

async function selectChatMessagesCompat({ tournamentId, teamId, req = null }) {
  const requestedColumns = [...CHAT_BASE_COLUMNS, ...CHAT_OPTIONAL_COLUMNS];
  let columns = [...requestedColumns];
  let missingColumn = null;
  while (columns.length) {
    let query = supabase
      .from('chat_messages')
      .select(columns.join(', '))
      .eq('tournament_id', tournamentId);
    if (teamId) query = query.eq('team_id', teamId);
    query = query.order('created_at', { ascending: true }).limit(100);
    const { data, error } = await query;
    if (!error) {
      return {
        rows: (data || []).map((row) => mapChatRowForResponse(row, req)),
        missingOptionalColumn: missingColumn
      };
    }
    const detected = detectMissingColumn(error);
    if (detected && columns.includes(detected)) {
      columns = columns.filter((col) => col !== detected);
      if (CHAT_OPTIONAL_COLUMNS.includes(detected)) {
        missingColumn = detected;
        continue;
      }
    }
    throw error;
  }
  return { rows: [], missingOptionalColumn: missingColumn };
}

async function insertChatMessageCompat(payload) {
  let insertPayload = { ...payload };
  while (true) {
    const { data, error } = await supabase.from('chat_messages').insert(insertPayload).select('*').single();
    if (!error) return mapChatRow(data);
    const missingColumn = detectMissingColumn(error);
    if (missingColumn && Object.hasOwn(insertPayload, missingColumn) && CHAT_OPTIONAL_COLUMNS.includes(missingColumn)) {
      delete insertPayload[missingColumn];
      continue;
    }
    throw error;
  }
}

async function saveScoreCompat(payload) {
  const keyFilters = {
    tournament_id: payload.tournament_id,
    team_id: payload.team_id,
    hole_number: payload.hole_number
  };

  const existingResp = await supabase
    .from('scores')
    .select('id')
    .eq('tournament_id', keyFilters.tournament_id)
    .eq('team_id', keyFilters.team_id)
    .eq('hole_number', keyFilters.hole_number)
    .order('id', { ascending: false })
    .limit(1);
  if (existingResp.error) throw existingResp.error;

  const existingId = Array.isArray(existingResp.data) && existingResp.data[0]?.id
    ? Number(existingResp.data[0].id)
    : null;

  if (existingId) {
    const { data, error } = await supabase
      .from('scores')
      .update(payload)
      .eq('id', existingId)
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from('scores')
    .insert(payload)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function saveAwardClaimCompat(payload) {
  const existingResp = await supabase
    .from('award_claims')
    .select('id')
    .eq('round_id', payload.round_id)
    .eq('hole_number', payload.hole_number)
    .eq('award_type', payload.award_type)
    .eq('team_id', payload.team_id)
    .eq('player_name', payload.player_name)
    .order('id', { ascending: false })
    .limit(1);
  if (existingResp.error) throw existingResp.error;

  const existingId = Array.isArray(existingResp.data) && existingResp.data[0]?.id
    ? Number(existingResp.data[0].id)
    : null;

  if (existingId) {
    const { data, error } = await supabase
      .from('award_claims')
      .update(payload)
      .eq('id', existingId)
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from('award_claims')
    .insert(payload)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

function detectMissingTable(error) {
  if (!isMissingTableError(error)) return null;
  const message = `${error?.message || ''} ${error?.details || ''}`;
  const match = message.match(/relation ['"]?(?:public\.)?([a-zA-Z0-9_]+)['"]? does not exist/i);
  return match?.[1] || null;
}

function routeLog(route, phase, details = {}) {
  const payload = { route, phase, ...details };
  // eslint-disable-next-line no-console
  console.log('[api:compat]', payload);
}

function createRouteTimer(route) {
  const started = Date.now();
  return (phase = 'timing', details = {}) => {
    routeLog(route, phase, { elapsed_ms: Date.now() - started, ...details });
  };
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

  if (!teamResult.error && !teamResult.data) {
    teamResult = await supabase
      .from('teams')
      .select('id, tournament_id, name, team_name, pin, pin_code, locked')
      .eq('tournament_id', tournamentId)
      .eq('pin_code', pin)
      .maybeSingle();
  }

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
const TEAM_COOKIE_NAME = 'team_auth';
const TEAM_COOKIE_TTL_SECONDS = 60 * 60 * 16;

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

function signTeamCookieValue(payload) {
  const hmac = crypto
    .createHmac('sha256', ADMIN_SIGNING_SECRET)
    .update(payload)
    .digest('hex');
  return `${payload}.${hmac}`;
}

function verifyTeamCookieValue(value) {
  if (!value || !value.includes('.')) return null;
  const idx = value.lastIndexOf('.');
  const payload = value.slice(0, idx);
  const sig = value.slice(idx + 1);
  const expected = crypto
    .createHmac('sha256', ADMIN_SIGNING_SECRET)
    .update(payload)
    .digest('hex');
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const [issuedAtRaw, tournamentIdRaw, teamIdRaw] = payload.split(':');
  const issuedAt = Number.parseInt(issuedAtRaw, 10);
  const tournamentId = normalizeEntityId(tournamentIdRaw);
  const teamId = normalizeEntityId(teamIdRaw);
  if (!Number.isFinite(issuedAt) || !tournamentId || !teamId) return null;
  const ageSeconds = Math.floor(Date.now() / 1000) - issuedAt;
  if (!(ageSeconds >= 0 && ageSeconds <= TEAM_COOKIE_TTL_SECONDS)) return null;
  return { tournamentId, teamId };
}

function setTeamAuthCookie(res, tournamentId, teamId) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const token = signTeamCookieValue(`${issuedAt}:${tournamentId}:${teamId}`);
  const secureFlag = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${TEAM_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${TEAM_COOKIE_TTL_SECONDS}; SameSite=Lax${secureFlag}`);
}

function clearTeamAuthCookie(res) {
  const secureFlag = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const existing = res.getHeader('Set-Cookie');
  const teamClear = `${TEAM_COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secureFlag}`;
  if (!existing) {
    res.setHeader('Set-Cookie', teamClear);
    return;
  }
  const next = Array.isArray(existing) ? [...existing, teamClear] : [existing, teamClear];
  res.setHeader('Set-Cookie', next);
}

async function resolveTeamFromCookie(req) {
  const cookies = readCookies(req);
  const parsed = verifyTeamCookieValue(cookies[TEAM_COOKIE_NAME]);
  if (!parsed) return null;

  const { data: team, error } = await supabase
    .from('teams')
    .select('id, tournament_id, name, team_name, pin, pin_code, locked')
    .eq('id', parsed.teamId)
    .eq('tournament_id', parsed.tournamentId)
    .maybeSingle();
  if (error) throw error;
  if (!team) return null;

  const normalized = normalizeTeamRow(team);
  const { data: members, error: membersError } = await supabase
    .from('team_members')
    .select('players(name, handicap)')
    .eq('team_id', normalized.id);
  if (membersError) throw membersError;
  const players = (members || []).map((row) => row.players).filter(Boolean);
  return {
    ...normalized,
    player1: players[0]?.name || '',
    player2: players[1]?.name || '',
    player1_handicap: players[0]?.handicap ?? null,
    player2_handicap: players[1]?.handicap ?? null
  };
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
  resolveTeamFromCookie(req)
    .then((team) => {
      if (team) return res.json({ type: 'team', team });
      if (isAdminAuthenticated(req)) return res.json({ type: 'admin' });
      return res.json({ type: null });
    })
    .catch((error) => res.status(500).json({ type: null, success: false, error: error?.message || 'Status check failed' }));
});

app.post('/api/auth/logout', (_, res) => {
  clearAdminAuthCookie(res);
  clearTeamAuthCookie(res);
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
    const requestedTournamentIdRaw = req.body?.tournament_id;
    const requestedTournamentId = normalizeEntityId(requestedTournamentIdRaw);
    routeLog(route, 'hit', { payload: { pinLength: pin.length, requestedTournamentId } });
    console.log('[team-login] incoming pin', pin);

    if (!pin) {
      return res.status(400).json({ success: false, error: 'PIN er påkrevd' });
    }

    if (requestedTournamentIdRaw && !requestedTournamentId) {
      routeLog(route, 'invalid_tournament_id', { field: 'tournament_id', value: requestedTournamentIdRaw });
      return res.status(400).json({ success: false, error: 'Ugyldig tournament_id format.' });
    }

    const tournamentId = requestedTournamentId || await resolveTournamentId(null);
    if (!tournamentId) {
      return res.status(404).json({ success: false, error: 'Ingen aktiv turnering funnet' });
    }

    let teamResult = await supabase
      .from('teams')
      .select('id, tournament_id, name, team_name, pin, pin_code, locked')
      .eq('tournament_id', tournamentId)
      .eq('pin', pin)
      .maybeSingle();

    if (!teamResult.error && !teamResult.data) {
      teamResult = await supabase
        .from('teams')
        .select('id, tournament_id, name, team_name, pin, pin_code, locked')
        .eq('tournament_id', tournamentId)
        .eq('pin_code', pin)
        .maybeSingle();
    }

    if (teamResult.error && isMissingColumnError(teamResult.error, 'pin')) {
      teamResult = await supabase
        .from('teams')
        .select('id, tournament_id, name, team_name, pin, pin_code, locked')
        .eq('tournament_id', tournamentId)
        .eq('pin_code', pin)
        .maybeSingle();
    }

    if (teamResult.error) throw teamResult.error;
    const team = teamResult.data ? normalizeTeamRow(teamResult.data) : null;

    console.log('[team-login] matched team row', team || null);
    if (!team) {
      return res.status(401).json({ success: false, error: 'Ugyldig PIN' });
    }

    const teamId = normalizeEntityId(team.id);
    const teamTournamentId = normalizeEntityId(team.tournament_id);
    if (!teamId || !teamTournamentId) {
      routeLog(route, 'invalid_team_setup', {
        team_id: team.id,
        tournament_id: team.tournament_id
      });
      return res.status(500).json({ success: false, error: 'Team-oppsett er ugyldig: team_id/tournament_id mangler eller har ugyldig format.' });
    }

    setTeamAuthCookie(res, teamTournamentId, teamId);
    routeLog(route, 'db_action', { action: 'team_lookup_success', tournamentId: teamTournamentId, teamId });
    return res.json({
      success: true,
      team_id: teamId,
      tournament_id: teamTournamentId
    });
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
    routeLog(route, 'hit', { payload: { noteLength: note.length } });
    const { team, tournamentId } = await requireTeamContext(req);
    if (!team || !tournamentId) return res.status(401).json({ success: false, error: 'Team session mangler. Logg inn på nytt.' });

    const payload = {
      tournament_id: tournamentId,
      team_id: team.id,
      team_name: team.team_name,
      message: '⛳ Birdie shoutout!',
      note: note || null
    };
    const data = await insertChatMessageCompat(payload);

    routeLog(route, 'db_action', { action: 'insert_shoutout', id: data?.id, tournamentId, teamId: team.id });
    return res.json({ success: true, shoutout: data });
  } catch (error) {
    routeLog(route, 'error', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: error?.message || 'Kunne ikke sende birdie shoutout' });
  }
});

app.post('/team/birdie-shot', (req, res) => forwardTo(req, res, 'POST', '/api/team/birdie-shot'));

async function resolveTournamentId(tournamentId) {
  const parsed = normalizeEntityId(tournamentId);
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
  const route = '/api/scoreboard';
  const timing = createRouteTimer(route);
  try {
    timing('hit');
    const requestedTournamentId = req.query?.tournamentId;
    if (requestedTournamentId && !isValidEntityId(requestedTournamentId)) {
      routeLog(route, 'invalid_tournament_id', { field: 'tournamentId', value: requestedTournamentId });
      return res.status(400).json({ success: false, error: 'Ugyldig tournament_id format.' });
    }
    const tournamentId = await resolveTournamentId(req.query.tournamentId);
    if (!tournamentId) return res.json({ tournament: null, scoreboard: [] });
    if (!isValidEntityId(tournamentId)) {
      routeLog(route, 'invalid_tournament_id', { field: 'tournament_id', value: tournamentId });
      return res.status(400).json({ success: false, error: 'Ugyldig tournament_id format.' });
    }

    const [tournament, teams, holeResp, awardClaimsResp] = await Promise.all([
      getTournament(tournamentId),
      fetchTeamsWithPlayers(tournamentId),
      supabase.from('tournament_holes').select('*').eq('tournament_id', tournamentId).order('hole_number', { ascending: true }),
      supabase
        .schema('public')
        .from('award_claims')
        .select(`
          id,
          tournament_id,
          round_id,
          team_id,
          hole_number,
          award_type,
          player_name,
          value,
          detail,
          claimed_at,
          teams:team_id ( id, team_name, name ),
          rounds:round_id ( id, tournament_id ),
          tournaments:tournament_id ( id, name )
        `)
        .eq('tournament_id', tournamentId)
        .not('round_id', 'is', null)
        .in('award_type', ['longest_drive', 'closest_to_pin'])
        .order('claimed_at', { ascending: false })
    ]);
    if (holeResp.error) throw holeResp.error;
    if (awardClaimsResp.error && !isMissingTableError(awardClaimsResp.error, 'award_claims')) throw awardClaimsResp.error;

    const teamIds = teams.map((team) => team.id);

    let scores = [];
    if (teamIds.length) {
      const { data, error } = await supabase
        .from('scores')
        .select('team_id, hole_number, score')
        .in('team_id', teamIds);
      if (error) throw error;
      scores = data || [];
    }

    let holes = Array.isArray(holeResp.data) ? normalizeHoles(holeResp.data) : [];
    if (!holes.length && tournament?.course_id) {
      const courseHolesResp = await supabase
        .from('course_holes')
        .select('*')
        .eq('course_id', tournament.course_id)
        .order('hole_number', { ascending: true });
      if (courseHolesResp.error) throw courseHolesResp.error;
      holes = normalizeHoles(courseHolesResp.data || []);
    }
    const parByHole = new Map(holes.map((hole) => [hole.hole_number, Number(hole.par || 0)]));

    const scoresByTeamId = scores.reduce((acc, row) => {
      if (!acc[row.team_id]) acc[row.team_id] = [];
      acc[row.team_id].push(row);
      return acc;
    }, {});

    const totals = teams.map((team) => {
      const teamScores = scoresByTeamId[team.id] || [];
      const total = teamScores.reduce((sum, row) => sum + Number(row.score || 0), 0);
      const teamParTotal = teamScores.reduce((sum, row) => sum + Number(parByHole.get(Number(row.hole_number)) || 0), 0);
      const player1 = team.players[0]?.name || '';
      const player2 = team.players[1]?.name || '';
      const handicap = Math.round(Number(team.players[0]?.handicap || 0) + Number(team.players[1]?.handicap || 0));
      const holeScores = {};
      for (const s of teamScores) holeScores[s.hole_number] = { score: s.score };
      return {
        team_id: team.id,
        team_name: team.name,
        players: team.players,
        player1,
        player2,
        player1_handicap: team.players[0]?.handicap ?? null,
        player2_handicap: team.players[1]?.handicap ?? null,
        handicap,
        total_score: total,
        holes_completed: teamScores.length,
        to_par: teamScores.length ? total - teamParTotal : 0,
        net_score: teamScores.length ? total - handicap : null,
        net_to_par: teamScores.length ? (total - handicap) - teamParTotal : 0,
        hole_scores: holeScores
      };
    }).sort((a, b) => {
      if (a.holes_completed === 0 && b.holes_completed > 0) return 1;
      if (b.holes_completed === 0 && a.holes_completed > 0) return -1;
      if (a.net_score !== null && b.net_score !== null && a.net_score !== b.net_score) return a.net_score - b.net_score;
      if (a.to_par !== b.to_par) return a.to_par - b.to_par;
      return a.total_score - b.total_score;
    });

    const numericAwardValue = (claim) => {
      const parsed = Number.parseFloat(claim?.value ?? claim?.detail ?? '');
      return Number.isFinite(parsed) ? parsed : null;
    };

    const awardRows = Array.isArray(awardClaimsResp.data) ? awardClaimsResp.data : [];
    const bestByType = {};

    for (const claim of awardRows) {
      const type = String(claim?.award_type || '');
      const value = numericAwardValue(claim);
      if (!type || value === null) continue;
      const existing = bestByType[type];
      if (!existing) {
        bestByType[type] = claim;
        continue;
      }
      const existingValue = numericAwardValue(existing);
      const isBetter = type === 'longest_drive'
        ? value > existingValue
        : value < existingValue;
      const isTieButNewer = value === existingValue
        && new Date(claim?.claimed_at || 0).getTime() > new Date(existing?.claimed_at || 0).getTime();
      if (isBetter || isTieButNewer) bestByType[type] = claim;
    }

    const awards = ['longest_drive', 'closest_to_pin']
      .map((type) => bestByType[type])
      .filter(Boolean)
      .map((claim) => ({
        ...claim,
        team_name: claim?.teams?.team_name || claim?.teams?.name || null,
        value: claim?.value ?? claim?.detail ?? null,
        detail: claim?.detail ?? claim?.value ?? null
      }));

    timing('success', {
      tournamentId,
      teams: teams.length,
      holes: holes.length,
      scores: scores.length,
      awards: awards.length
    });
    res.json({ tournament, holes, awards, scoreboard: totals });
  } catch (error) {
    timing('error', { error: error?.message || String(error) });
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/events', (req, res) => {
  requireTeamContext(req)
    .then(({ team, tournamentId }) => {
      if (!team || !tournamentId) {
        res.status(401).json({ success: false, error: 'Team session mangler. Logg inn på nytt.' });
        return;
      }
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      const sendEvent = (eventType, payload) => {
        res.write(`event: ${eventType}\n`);
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      };

      sendEvent('ping', { type: 'ping' });

      let closed = false;
      let lastMessageId = 0;
      const syncNewMessages = async () => {
        if (closed) return;
        try {
          let query = supabase
            .from('chat_messages')
            .select('id, tournament_id, team_id, team_name, message, note, image_path, created_at')
            .eq('tournament_id', tournamentId)
            .order('id', { ascending: true })
            .limit(100);
          if (lastMessageId > 0) query = query.gt('id', lastMessageId);
          const { data, error } = await query;
          if (error) throw error;
          const rows = Array.isArray(data) ? data : [];
          rows.forEach((row) => {
            const numericId = Number(row?.id) || 0;
            if (numericId > lastMessageId) lastMessageId = numericId;
            const safeRow = mapChatRowForResponse(row, req);
            sendEvent('chat_message', { type: 'chat_message', data: safeRow });
            if (isBirdieMessage(row)) {
              sendEvent('birdie_shout', { type: 'birdie_shout', data: safeRow });
            }
          });
        } catch (error) {
          routeLog('/api/events', 'error', { error: error?.message || String(error), tournamentId, teamId: team.id });
        }
      };

      const heartbeatTimer = setInterval(() => {
        if (!closed) sendEvent('ping', { type: 'ping' });
      }, 15000);
      const streamTimer = setInterval(syncNewMessages, 1200);
      syncNewMessages();

      req.on('close', () => {
        closed = true;
        clearInterval(heartbeatTimer);
        clearInterval(streamTimer);
      });
    })
    .catch((error) => {
      res.status(500).json({ success: false, error: error?.message || 'Kunne ikke åpne event-strøm' });
    });
});

async function requireTeamContext(req, { allowPinFallback = false } = {}) {
  const teamFromCookie = await resolveTeamFromCookie(req);
  if (teamFromCookie) {
    return { team: teamFromCookie, tournamentId: teamFromCookie.tournament_id };
  }

  const pin = String(req.body?.pin || req.query?.pin || '').trim();
  if (allowPinFallback && pin) {
    const requestedTournamentId = normalizeEntityId(req.body?.tournament_id || req.query?.tournament_id);
    if ((req.body?.tournament_id || req.query?.tournament_id) && !requestedTournamentId) {
      routeLog('/api/team-context', 'invalid_tournament_id', {
        field: 'tournament_id',
        value: req.body?.tournament_id || req.query?.tournament_id
      });
      return { team: null, tournamentId: null };
    }
    const tournamentId = requestedTournamentId || await resolveTournamentId(null);
    if (!tournamentId) return { team: null, tournamentId: null };
    const team = await resolveTeamByTournamentAndPin(tournamentId, pin);
    if (!team) return { team: null, tournamentId };
    return { team, tournamentId };
  }

  return { team: null, tournamentId: null };
}

app.get('/api/team/scorecard', async (req, res) => {
  const route = '/api/team/scorecard';
  const timing = createRouteTimer(route);
  try {
    routeLog(route, 'hit');
    timing('timing_start');
    const { team, tournamentId } = await requireTeamContext(req);
    routeLog(route, 'session_resolved', {
      authenticated: !!team,
      teamId: team?.id || null,
      teamTournamentId: team?.tournament_id || null,
      cookieTournamentId: tournamentId || null
    });
    if (!team || !tournamentId) return res.status(401).json({ success: false, error: 'Team session mangler. Logg inn på nytt.' });

    if (!isValidEntityId(team.id)) {
      routeLog(route, 'invalid_team_id', { field: 'team_id', value: team.id });
      return res.status(400).json({ success: false, error: 'Ugyldig team_id format.' });
    }
    const teamTournamentUuid = normalizeEntityId(team.tournament_id);
    const resolvedTournamentId = teamTournamentUuid || normalizeEntityId(tournamentId);
    if (!resolvedTournamentId) {
      routeLog(route, 'invalid_tournament_id', { field: 'tournament_id', value: team.tournament_id || tournamentId });
      return res.status(400).json({ success: false, error: 'Ugyldig tournament_id format.' });
    }
    routeLog(route, 'tournament_resolved', { resolvedTournamentId, source: teamTournamentUuid ? 'team_session' : 'cookie_session' });

    const [tournamentResp, holesResp, scoresResp, claimsResp, holeSponsorsResp, holeImagesResp] = await Promise.all([
      supabase.from('tournaments').select('*').eq('id', resolvedTournamentId).maybeSingle(),
      supabase.from('tournament_holes').select('*').eq('tournament_id', resolvedTournamentId).order('hole_number', { ascending: true }),
      supabase.from('scores').select('*').eq('team_id', team.id).eq('tournament_id', resolvedTournamentId),
      supabase.from('award_claims').select('*').eq('team_id', team.id).eq('tournament_id', resolvedTournamentId),
      supabase.from('sponsors').select('*').eq('tournament_id', resolvedTournamentId).eq('placement', 'hole').eq('is_enabled', true).order('hole_number', { ascending: true }),
      supabase
        .from('hole_images')
        .select('id, team_id, tournament_id, hole_number, image_url, created_at')
        .eq('team_id', team.id)
        .eq('tournament_id', resolvedTournamentId)
        .order('created_at', { ascending: false })
    ]);
    if (tournamentResp.error) throw tournamentResp.error;
    if (holesResp.error) throw holesResp.error;
    if (scoresResp.error) throw scoresResp.error;
    if (claimsResp.error && !isMissingTableError(claimsResp.error, 'award_claims')) throw claimsResp.error;
    if (holeSponsorsResp.error && !isMissingTableError(holeSponsorsResp.error, 'sponsors')) throw holeSponsorsResp.error;
    if (holeImagesResp.error && !isMissingTableError(holeImagesResp.error, 'hole_images')) throw holeImagesResp.error;

    routeLog(route, 'dataset_loaded', {
      teamId: team.id,
      tournamentId: resolvedTournamentId,
      tournamentFound: !!tournamentResp.data,
      tournamentHolesCount: Array.isArray(holesResp.data) ? holesResp.data.length : 0,
      scoresCount: Array.isArray(scoresResp.data) ? scoresResp.data.length : 0,
      claimsCount: Array.isArray(claimsResp.data) ? claimsResp.data.length : 0,
      holeSponsorsCount: Array.isArray(holeSponsorsResp.data) ? holeSponsorsResp.data.length : 0,
      holeImagesCount: Array.isArray(holeImagesResp.data) ? holeImagesResp.data.length : 0
    });

    if (!tournamentResp.data) {
      routeLog(route, 'error', { step: 'load_tournament', resolvedTournamentId, message: 'Fant ikke turnering for laget' });
      return res.status(404).json({ success: false, error: 'Fant ikke turnering for laget' });
    }

    let holeRows = Array.isArray(holesResp.data) ? holesResp.data : [];
    if (!holeRows.length) {
      const courseId = asInt(tournamentResp.data.course_id);
      if (courseId) {
        routeLog(route, 'holes_fallback', { from: 'tournament_holes', to: 'course_holes', courseId, tournamentId: resolvedTournamentId });
        const courseHolesResp = await supabase
          .from('course_holes')
          .select('*')
          .eq('course_id', courseId)
          .order('hole_number', { ascending: true });
        if (courseHolesResp.error) {
          routeLog(route, 'error', { step: 'load_course_holes_fallback', error: courseHolesResp.error?.message || String(courseHolesResp.error) });
          throw courseHolesResp.error;
        }
        holeRows = Array.isArray(courseHolesResp.data) ? courseHolesResp.data : [];
      }
    }

    if (!holeRows.length) {
      routeLog(route, 'error', { step: 'resolve_holes', tournamentId: resolvedTournamentId, message: 'Turneringen mangler hulloppsett' });
      return res.status(422).json({ success: false, error: 'Turneringen mangler hulloppsett', code: 'MISSING_HOLE_SETUP' });
    }

    const latestHoleImageByNumber = new Map();
    for (const row of (holeImagesResp.data || [])) {
      const holeNumber = asInt(row?.hole_number);
      if (!holeNumber || latestHoleImageByNumber.has(holeNumber)) continue;
      latestHoleImageByNumber.set(holeNumber, String(row.image_url || '').trim() || null);
    }

    const normalizedScores = (scoresResp.data || []).map((row) => {
      const holeNumber = asInt(row?.hole_number);
      const imageUrl = latestHoleImageByNumber.get(holeNumber) || null;
      return withCanonicalImageField({ ...row, photo_path: imageUrl || row.photo_path || null }, req, 'photo_path');
    });
    routeLog(route, 'scorecard_payload_image_debug', {
      sample: normalizedScores.slice(0, 2).map((row) => ({
        id: row.id,
        hole_number: row.hole_number,
        photo_path: row.photo_path,
        image_url: row.image_url
      })),
      count: normalizedScores.length
    });

    const payload = {
      success: true,
      team,
      tournament: tournamentResp.data || null,
      holes: normalizeHoles(holeRows).map((hole) => ({
        ...hole,
        image_url: latestHoleImageByNumber.get(asInt(hole?.hole_number)) || null
      })),
      scores: normalizedScores,
      claims: (claimsResp.data || []).map((claim) => ({
        ...claim,
        detail: claim?.detail ?? claim?.value ?? null,
        value: claim?.value ?? claim?.detail ?? null
      })),
      hole_sponsors: holeSponsorsResp.data || []
    };
    routeLog(route, 'payload_ready', {
      teamId: payload.team?.id || null,
      tournamentId: payload.tournament?.id || null,
      holes: payload.holes.length,
      scores: payload.scores.length,
      claims: payload.claims.length,
      sponsors: payload.hole_sponsors.length
    });
    timing('success', {
      teamId: payload.team?.id || null,
      tournamentId: payload.tournament?.id || null,
      holes: payload.holes.length,
      scores: payload.scores.length
    });
    return res.json({
      ...payload
    });
  } catch (error) {
    const missingColumn = detectMissingColumn(error);
    if (missingColumn) {
      return res.status(500).json({ success: false, error: `Manglende kolonne: ${missingColumn}`, code: 'SCHEMA_COLUMN_NOT_FOUND', column: missingColumn });
    }
    const missingTable = detectMissingTable(error);
    if (missingTable) {
      return res.status(500).json({ success: false, error: `Manglende tabell: ${missingTable}`, code: 'SCHEMA_TABLE_NOT_FOUND', table: missingTable });
    }
    routeLog(route, 'error', { error: error?.message || String(error) });
    timing('error', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: error?.message || 'Kunne ikke laste scorecard' });
  }
});

app.post('/api/team/submit-score', async (req, res) => {
  const route = '/api/team/submit-score';
  try {
    const holeNumber = asInt(req.body?.hole_number);
    const score = asInt(req.body?.score);
    routeLog(route, 'hit', { payload: { holeNumber, score } });
    const { team, tournamentId } = await requireTeamContext(req);
    if (!team || !tournamentId) return res.status(401).json({ success: false, error: 'Team session mangler. Logg inn på nytt.' });
    if (team.locked) return res.status(400).json({ success: false, error: 'Resultatkort er låst' });
    if (!holeNumber || !score) return res.status(400).json({ success: false, error: 'hole_number og score er påkrevd' });

    const payload = { tournament_id: tournamentId, team_id: team.id, hole_number: holeNumber, score };
    const data = await saveScoreCompat(payload);

    routeLog(route, 'db_action', { action: 'save_score', teamId: team.id, holeNumber });
    return res.json({ success: true, score: data });
  } catch (error) {
    routeLog(route, 'error', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: error?.message || 'Kunne ikke lagre score' });
  }
});

app.post('/api/team/upload-photo/:holeNum', upload.single('photo'), async (req, res) => {
  const route = '/api/team/upload-photo/:holeNum';
  try {
    const holeNum = asInt(req.params.holeNum);
    routeLog(route, 'hit', { payload: { holeNum, hasFile: !!req.file } });
    const { team, tournamentId } = await requireTeamContext(req);
    if (!team || !tournamentId) return res.status(401).json({ success: false, error: 'Team session mangler. Logg inn på nytt.' });
    if (!holeNum) return res.status(400).json({ success: false, error: 'Ugyldig hullnummer' });
    if (!req.file) return res.status(400).json({ success: false, error: 'Mangler bildefil' });

    const extension = path.extname(req.file.originalname || '').toLowerCase() || '.jpg';
    const safeExt = /^[.][a-z0-9]+$/.test(extension) ? extension : '.jpg';
    const storagePath = buildTournamentStoragePath({
      tournamentId,
      teamId: team.id,
      holeNumber: holeNum,
      extension: safeExt
    });
    const { error: uploadError } = await supabase.storage.from(HOLE_IMAGE_BUCKET)
      .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype || 'image/jpeg', upsert: false });
    if (uploadError) {
      if (isMissingBucketError(uploadError)) {
        return res.status(500).json(buildBucketMissingError(HOLE_IMAGE_BUCKET));
      }
      throw uploadError;
    }
    const { data: publicData } = supabase.storage.from(HOLE_IMAGE_BUCKET).getPublicUrl(storagePath);
    const imageUrl = publicData?.publicUrl || null;
    routeLog(route, 'upload_photo_url_debug', { storagePath, publicUrl: imageUrl });

    const holeImagePayload = {
      tournament_id: tournamentId,
      team_id: team.id,
      hole_number: holeNum,
      image_url: imageUrl
    };
    const { data, error: holeImageInsertError } = await supabase
      .from('hole_images')
      .insert(holeImagePayload)
      .select('*')
      .single();
    if (holeImageInsertError) throw holeImageInsertError;
    const dbLoggedRow = {
      id: data?.id || null,
      tournament_id: data?.tournament_id || tournamentId,
      team_id: data?.team_id || team.id,
      hole_number: data?.hole_number || holeNum,
      image_url: data?.image_url || imageUrl
    };
    routeLog(route, 'upload_photo_db_row_debug', dbLoggedRow);
    routeLog(route, 'db_action', { action: 'upload_hole_image', holeImageId: data?.id, storagePath });
    return res.json({
      success: true,
      image_url: data?.image_url || imageUrl
    });
  } catch (error) {
    if (isMissingBucketError(error)) {
      return res.status(500).json(buildBucketMissingError(HOLE_IMAGE_BUCKET));
    }
    routeLog(route, 'error', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: error?.message || 'Kunne ikke laste opp bilde' });
  }
});

app.post('/api/team/lock-scorecard', async (req, res) => {
  const route = '/api/team/lock-scorecard';
  try {
    routeLog(route, 'hit');
    const { team } = await requireTeamContext(req);
    if (!team) return res.status(401).json({ success: false, error: 'Team session mangler. Logg inn på nytt.' });
    const { data, error } = await supabase.from('teams').update({ locked: true }).eq('id', team.id).select('*').single();
    if (error) throw error;
    routeLog(route, 'db_action', { action: 'lock_scorecard', teamId: team.id });
    return res.json({ success: true, team: data });
  } catch (error) {
    routeLog(route, 'error', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: error?.message || 'Kunne ikke låse scorecard' });
  }
});

app.post('/api/team/claim-award', async (req, res) => {
  const route = '/api/team/claim-award';
  let logContext = {};
  try {
    const rawValue = String(req.body?.value ?? req.body?.detail ?? req.body?.distance ?? '').trim();
    const parsedDistance = req.body?.distance === undefined || req.body?.distance === null || req.body?.distance === ''
      ? null
      : Number(req.body.distance);
    const roundId = asInt(req.body?.round_id ?? req.body?.roundId);
    const imageUrl = String(req.body?.image_url ?? req.body?.imageUrl ?? '').trim() || null;
    const payload = {
      hole_number: asInt(req.body?.hole_number),
      award_type: String(req.body?.award_type || '').trim(),
      player_name: String(req.body?.player_name || '').trim(),
      round_id: roundId || null,
      distance: Number.isFinite(parsedDistance) ? parsedDistance : null,
      image_url: imageUrl,
      detail: rawValue || null,
      value: rawValue || null
    };
    routeLog(route, 'hit', { payload });
    const { team, tournamentId } = await requireTeamContext(req);
    if (!team || !tournamentId) return res.status(401).json({ success: false, error: 'Team session mangler. Logg inn på nytt.' });
    if (!payload.hole_number || !payload.award_type || !payload.player_name) {
      return res.status(400).json({ success: false, error: 'hole_number, award_type og player_name er påkrevd' });
    }
    const fallbackRoundId = asInt(req.body?.hole_round_id ?? req.body?.score_round_id);
    let resolvedRoundId = payload.round_id || fallbackRoundId || null;
    if (!resolvedRoundId) {
      const { data: roundsData, error: roundLookupError } = await supabase
        .from('rounds')
        .select('id')
        .eq('tournament_id', tournamentId)
        .order('round_order', { ascending: true })
        .limit(1);
      if (roundLookupError) throw roundLookupError;
      resolvedRoundId = Array.isArray(roundsData) && roundsData[0]?.id ? Number(roundsData[0].id) : null;
    }
    if (!resolvedRoundId) {
      return res.status(400).json({ success: false, error: 'Kunne ikke finne round_id for turneringen.' });
    }
    const awardClaimInsert = {
      tournament_id: tournamentId,
      round_id: resolvedRoundId,
      hole_number: payload.hole_number,
      award_type: payload.award_type,
      team_id: team.id,
      player_name: payload.player_name,
      value: payload.value,
      detail: payload.detail,
      claimed_at: new Date().toISOString()
    };
    logContext = {
      teamId: team.id,
      tournamentId,
      awardClaimInsert
    };
    const data = await saveAwardClaimCompat(awardClaimInsert);
    routeLog(route, 'db_action', { action: 'insert_award_claim', claimId: data?.id, teamId: team.id });
    return res.json({ success: true, claim: data });
  } catch (error) {
    const missingColumn = detectMissingColumn(error);
    if (missingColumn) {
      routeLog(route, 'error', {
        error: error?.message || String(error),
        code: error?.code || null,
        details: error?.details || null,
        hint: error?.hint || null,
        ...logContext
      });
      return res.status(500).json({ success: false, error: `Manglende kolonne i award_claims: ${missingColumn}`, code: 'SCHEMA_COLUMN_NOT_FOUND', table: 'award_claims', column: missingColumn });
    }
    if (isMissingTableError(error, 'award_claims')) {
      routeLog(route, 'error', {
        error: error?.message || String(error),
        code: error?.code || null,
        details: error?.details || null,
        hint: error?.hint || null,
        ...logContext
      });
      return res.status(500).json({ success: false, error: 'Manglende tabell: award_claims', code: 'SCHEMA_TABLE_NOT_FOUND', table: 'award_claims' });
    }
    routeLog(route, 'error', {
      error: error?.message || String(error),
      code: error?.code || null,
      details: error?.details || null,
      hint: error?.hint || null,
      ...logContext
    });
    return res.status(500).json({ success: false, error: error?.message || 'Kunne ikke melde inn kandidat' });
  }
});

app.get('/api/chat/messages', async (req, res) => {
  const route = '/api/chat/messages';
  const timing = createRouteTimer(route);
  try {
    const { team, tournamentId } = await requireTeamContext(req);
    routeLog(route, 'hit', { payload: { tournamentId, hasTeam: !!team } });
    if (!team || !tournamentId) return res.status(401).json({ success: false, error: 'Team session mangler. Logg inn på nytt.' });
    if (!isValidEntityId(team.id)) {
      routeLog(route, 'invalid_team_id', { field: 'team_id', value: team.id });
      return res.status(400).json({ success: false, error: 'Ugyldig team_id format.' });
    }
    if (!isValidEntityId(tournamentId)) {
      routeLog(route, 'invalid_tournament_id', { field: 'tournament_id', value: tournamentId });
      return res.status(400).json({ success: false, error: 'Ugyldig tournament_id format.' });
    }
    const privateChat = String(req.query?.private || '').toLowerCase();
    const teamFilter = privateChat === '1' || privateChat === 'true' ? team.id : null;
    const { rows, missingOptionalColumn } = await selectChatMessagesCompat({ tournamentId, teamId: teamFilter, req });
    routeLog(route, 'db_action', {
      action: 'fetch_chat_messages',
      count: rows?.length || 0,
      tournamentId,
      filteredByTeam: !!teamFilter,
      missingOptionalColumn: missingOptionalColumn || null
    });
    timing('success', { tournamentId, teamId: team.id, count: rows?.length || 0, filteredByTeam: !!teamFilter });
    return res.json({ success: true, messages: rows || [] });
  } catch (error) {
    const missingColumn = detectMissingColumn(error);
    if (missingColumn) {
      return res.status(500).json({ success: false, error: `Manglende kolonne i chat_messages: ${missingColumn}`, code: 'SCHEMA_COLUMN_NOT_FOUND', table: 'chat_messages', column: missingColumn });
    }
    if (isMissingTableError(error, 'chat_messages')) {
      return res.status(500).json({ success: false, error: 'Manglende tabell: chat_messages', code: 'SCHEMA_TABLE_NOT_FOUND', table: 'chat_messages' });
    }
    routeLog(route, 'error', { error: error?.message || String(error) });
    timing('error', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: error?.message || 'Kunne ikke hente chat' });
  }
});

app.post('/api/chat/send', upload.single('image'), async (req, res) => {
  const route = '/api/chat/send';
  try {
    const message = String(req.body?.message || '').trim();
    const note = String(req.body?.note || '').trim() || null;
    routeLog(route, 'hit', { payload: { messageLength: message.length, hasImage: !!req.file } });
    const { team, tournamentId } = await requireTeamContext(req);
    if (!team || !tournamentId) return res.status(401).json({ success: false, error: 'Team session mangler. Logg inn på nytt.' });
    if (!message && !req.file) return res.status(400).json({ success: false, error: 'Melding eller bilde må sendes' });

    let imagePath = null;
    if (req.file) {
      const extension = path.extname(req.file.originalname || '').toLowerCase() || '.jpg';
      const safeExt = /^[.][a-z0-9]+$/.test(extension) ? extension : '.jpg';
      const storagePath = buildTournamentStoragePath({
        tournamentId,
        teamId: team.id,
        holeNumber: 'chat',
        extension: safeExt
      });
      const { error: uploadError } = await supabase.storage.from(MEDIA_BUCKET)
        .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype || 'image/jpeg', upsert: false });
      if (uploadError) {
        if (isMissingBucketError(uploadError)) {
          return res.status(500).json(buildBucketMissingError());
        }
        throw uploadError;
      }
      const { data: publicData } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(storagePath);
      imagePath = publicData?.publicUrl || null;
      routeLog(route, 'chat_image_url_debug', { storagePath, publicUrl: imagePath });
    }

    const payload = { tournament_id: tournamentId, team_id: team.id, team_name: team.team_name, message: message || null, note, image_path: imagePath };
    const data = await insertChatMessageCompat(payload);
    routeLog(route, 'db_action', { action: 'insert_chat_message', messageId: data?.id, teamId: team.id, tournamentId });
    return res.json({ success: true, message: mapChatRowForResponse(data, req) });
  } catch (error) {
    const missingColumn = detectMissingColumn(error);
    if (missingColumn) {
      return res.status(500).json({ success: false, error: `Manglende kolonne i chat_messages: ${missingColumn}`, code: 'SCHEMA_COLUMN_NOT_FOUND', table: 'chat_messages', column: missingColumn });
    }
    if (isMissingTableError(error, 'chat_messages')) {
      return res.status(500).json({ success: false, error: 'Manglende tabell: chat_messages', code: 'SCHEMA_TABLE_NOT_FOUND', table: 'chat_messages' });
    }
    routeLog(route, 'error', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: error?.message || 'Kunne ikke sende melding' });
  }
});

app.get('/api/gallery', async (req, res) => {
  const route = '/api/gallery';
  try {
    const requestedTournamentId = asInt(req.query?.tournament_id);
    const teamFromCookie = requestedTournamentId ? null : await resolveTeamFromCookie(req);
    const tournamentId = requestedTournamentId || asInt(teamFromCookie?.tournament_id) || await resolveTournamentId(null);
    routeLog(route, 'hit', { payload: { tournamentId } });
    if (!tournamentId) return res.json({ success: true, photos: [] });
    const holeImagesResp = await supabase.from('hole_images')
      .select('id, team_id, hole_number, image_url, created_at')
      .eq('tournament_id', tournamentId)
      .not('image_url', 'is', null)
      .order('created_at', { ascending: false });
    if (holeImagesResp.error) throw holeImagesResp.error;

    const teamIds = [...new Set((holeImagesResp.data || []).map((row) => row.team_id).filter(Boolean))];
    let teamsById = {};
    if (teamIds.length) {
      const teamsResp = await supabase.from('teams').select('id, name, team_name').in('id', teamIds);
      if (teamsResp.error) throw teamsResp.error;
      teamsById = Object.fromEntries((teamsResp.data || []).map((team) => [team.id, normalizeTeamRow(team)]));
    }
    const photos = (holeImagesResp.data || []).map((row) => ({
      id: `score-${row.id}`,
      photo_ref: `score-${row.id}`,
      image_url: row.image_url,
      hole_number: row.hole_number,
      team_name: teamsById[row.team_id]?.team_name || 'Lag',
      created_at: row.created_at,
      votes: 0,
      voted: false,
      source: 'score',
      tournament_id: tournamentId
    })).filter((row) => !!row.image_url);
    routeLog(route, 'image_debug', {
      stored_image_path: 'hole_images.image_url',
      resolved_public_url: photos[0]?.image_url || null,
      frontend_src_used: photos[0]?.image_url || null,
      count: photos.length
    });
    routeLog(route, 'gallery_payload_image_debug', {
      sample: photos.slice(0, 3).map((row) => ({
        photo_ref: row.photo_ref,
        source: row.source,
        tournament_id: row.tournament_id,
        image_url: row.image_url
      })),
      count: photos.length
    });
    routeLog(route, 'db_action', { action: 'fetch_gallery_public', count: photos.length, tournamentId });
    return res.json({ success: true, photos });
  } catch (error) {
    routeLog(route, 'error', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: error?.message || 'Kunne ikke hente galleri' });
  }
});

app.post('/api/gallery/vote', async (req, res) => {
  routeLog('/api/gallery/vote', 'hit', { payload: req.body || {} });
  return res.json({ success: true });
});

app.get('/api/legacy', async (_req, res) => {
  const route = '/api/legacy';
  try {
    routeLog(route, 'hit');
    const { data, error } = await supabase.from('legacy_entries').select('*').order('year', { ascending: false });
    if (error) throw error;
    routeLog(route, 'db_action', { action: 'fetch_legacy_public', count: data?.length || 0 });
    return res.json({ success: true, legacy: data || [] });
  } catch (error) {
    routeLog(route, 'error', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: error?.message || 'Kunne ikke hente historikk' });
  }
});

app.get('/api/sponsors', async (req, res) => {
  const route = '/api/sponsors';
  try {
    const placement = String(req.query?.placement || '').trim() || null;
    const tournamentId = asInt(req.query?.tournament_id) || await resolveTournamentId(null);
    routeLog(route, 'hit', { payload: { placement, tournamentId } });
    if (!tournamentId) return res.json({ success: true, sponsors: [] });
    let query = supabase.from('sponsors').select('*').eq('tournament_id', tournamentId).eq('is_enabled', true);
    if (placement) query = query.eq('placement', placement);
    const { data, error } = await query.order('spot_number', { ascending: true }).order('hole_number', { ascending: true });
    if (error) throw error;
    routeLog(route, 'db_action', { action: 'fetch_sponsors', count: data?.length || 0, tournamentId });
    return res.json({ success: true, sponsors: data || [] });
  } catch (error) {
    routeLog(route, 'error', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: error?.message || 'Kunne ikke hente sponsorer' });
  }
});

app.get('/api/coin-back', async (_req, res) => {
  const route = '/api/coin-back';
  try {
    routeLog(route, 'hit');
    const { data, error } = await supabase
      .from('coin_back_images')
      .select('*')
      .order('created_at', { ascending: false });
    if (error && error.code !== '42P01') throw error;
    const photos = data || [];
    const active = photos.find((row) => row.is_active && row.photo_path) || photos[0] || null;
    routeLog(route, 'db_action', { action: 'fetch_coin_back', count: photos.length });
    return res.json({ success: true, photo_path: active?.photo_path || null, focal_point: active?.focal_point || '50% 50%', photos });
  } catch (error) {
    routeLog(route, 'error', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: error?.message || 'Kunne ikke hente coin back' });
  }
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
      photo_path: resolveImageUrl(row.photo_path, req),
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
    return res.json({
      success: true,
      photos: (data || []).map((row) => ({
        ...row,
        photo_path: resolveImageUrl(row.photo_path || row.storage_path, req)
      }))
    });
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
    const storagePath = buildTournamentStoragePath({
      tournamentId,
      teamId: 0,
      holeNumber: 0,
      extension: safeExt
    });

    const { error: storageError } = await supabase
      .storage
      .from(MEDIA_BUCKET)
      .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype || 'image/jpeg', upsert: false });
    if (storageError) throw storageError;

    const { data: publicData } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(storagePath);
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
    if (isMissingBucketError(error)) {
      return res.status(500).json(buildBucketMissingError());
    }
    routeLog(route, 'error', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: error?.message || 'Kunne ikke laste opp galleri-bilde' });
  }
});

app.get('/admin/tournament/:id/gallery', (req, res) => forwardTo(req, res, 'GET', `/api/admin/tournament/${req.params.id}/gallery`));
app.post('/admin/tournament/:id/gallery', (req, res) => forwardTo(req, res, 'POST', `/api/admin/tournament/${req.params.id}/gallery`));

app.post('/api/admin/tournament/:id/rebuild-photo-db', async (req, res) => {
  const route = '/api/admin/tournament/:id/rebuild-photo-db';
  try {
    const tournamentId = asInt(req.params.id);
    routeLog(route, 'hit', { payload: { tournamentId } });
    if (!tournamentId) return res.status(400).json({ success: false, error: 'Invalid tournament id' });
    routeLog(route, 'db_action', { action: 'rebuild_photo_db_noop', tournamentId });
    return res.json({ success: true, normalized_scores: 0, normalized_gallery: 0, synced_score_captions: 0 });
  } catch (error) {
    routeLog(route, 'error', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: error?.message || 'Kunne ikke rebuild photo db' });
  }
});

app.put('/api/admin/photo/:id/publish', async (req, res) => {
  const route = '/api/admin/photo/:id/publish';
  try {
    const scoreId = asInt(req.params.id);
    routeLog(route, 'hit', { payload: { scoreId, is_published: !!req.body?.is_published } });
    if (!scoreId) return res.status(400).json({ success: false, error: 'Invalid photo id' });
    routeLog(route, 'db_action', { action: 'score_publish_toggle_noop', scoreId });
    return res.json({ success: true });
  } catch (error) {
    routeLog(route, 'error', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: error?.message || 'Kunne ikke oppdatere publisering' });
  }
});

app.delete('/api/admin/photo/:id', async (req, res) => {
  const route = '/api/admin/photo/:id:DELETE';
  try {
    const scoreId = asInt(req.params.id);
    routeLog(route, 'hit', { payload: { scoreId } });
    if (!scoreId) return res.status(400).json({ success: false, error: 'Invalid photo id' });
    const { error } = await supabase.from('scores').update({ photo_path: null }).eq('id', scoreId);
    if (error) throw error;
    routeLog(route, 'db_action', { action: 'clear_score_photo', scoreId });
    return res.json({ success: true });
  } catch (error) {
    routeLog(route, 'error', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: error?.message || 'Kunne ikke slette bilde' });
  }
});

app.get('/api/admin/photo/:id/download', async (req, res) => {
  const route = '/api/admin/photo/:id/download';
  try {
    const scoreId = asInt(req.params.id);
    routeLog(route, 'hit', { payload: { scoreId } });
    if (!scoreId) return res.status(400).json({ success: false, error: 'Invalid photo id' });
    const { data, error } = await supabase.from('scores').select('photo_path').eq('id', scoreId).maybeSingle();
    if (error) throw error;
    if (!data?.photo_path) return res.status(404).json({ success: false, error: 'Bilde ikke funnet' });
    return res.redirect(data.photo_path);
  } catch (error) {
    routeLog(route, 'error', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: error?.message || 'Kunne ikke laste ned bilde' });
  }
});

app.put('/api/admin/gallery/:id/publish', async (req, res) => {
  const route = '/api/admin/gallery/:id/publish';
  try {
    const galleryId = asInt(req.params.id);
    const isPublished = !!req.body?.is_published;
    routeLog(route, 'hit', { payload: { galleryId, isPublished } });
    if (!galleryId) return res.status(400).json({ success: false, error: 'Invalid gallery id' });
    const { data, error } = await supabase
      .from('tournament_gallery_images')
      .update({ is_published: isPublished })
      .eq('id', galleryId)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    routeLog(route, 'db_action', { action: 'update_gallery_publish', galleryId, isPublished });
    return res.json({ success: true, photo: data });
  } catch (error) {
    routeLog(route, 'error', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: error?.message || 'Kunne ikke oppdatere galleri-bilde' });
  }
});

app.delete('/api/admin/gallery/:id', async (req, res) => {
  const route = '/api/admin/gallery/:id:DELETE';
  try {
    const galleryId = asInt(req.params.id);
    routeLog(route, 'hit', { payload: { galleryId } });
    if (!galleryId) return res.status(400).json({ success: false, error: 'Invalid gallery id' });
    const { error } = await supabase.from('tournament_gallery_images').delete().eq('id', galleryId);
    if (error) throw error;
    routeLog(route, 'db_action', { action: 'delete_gallery_image', galleryId });
    return res.json({ success: true });
  } catch (error) {
    routeLog(route, 'error', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: error?.message || 'Kunne ikke slette galleri-bilde' });
  }
});

app.get('/api/admin/gallery/:id/download', async (req, res) => {
  const route = '/api/admin/gallery/:id/download';
  try {
    const galleryId = asInt(req.params.id);
    routeLog(route, 'hit', { payload: { galleryId } });
    if (!galleryId) return res.status(400).json({ success: false, error: 'Invalid gallery id' });
    const { data, error } = await supabase.from('tournament_gallery_images').select('photo_path').eq('id', galleryId).maybeSingle();
    if (error) throw error;
    if (!data?.photo_path) return res.status(404).json({ success: false, error: 'Bilde ikke funnet' });
    return res.redirect(data.photo_path);
  } catch (error) {
    routeLog(route, 'error', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: error?.message || 'Kunne ikke laste ned bilde' });
  }
});

app.get('/api/admin/tournament/:id/sponsors', async (req, res) => {
  const route = '/api/admin/tournament/:id/sponsors';
  try {
    const tournamentId = asInt(req.params.id);
    routeLog(route, 'hit', { payload: { tournamentId } });
    if (!tournamentId) return res.status(400).json({ success: false, error: 'Invalid tournament id' });
    const { data, error } = await supabase.from('sponsors').select('*').eq('tournament_id', tournamentId);
    if (error) throw error;
    const rows = data || [];
    const home = rows.filter((row) => row.placement === 'home').sort((a, b) => (a.spot_number || 0) - (b.spot_number || 0));
    const hole = rows.filter((row) => row.placement === 'hole').sort((a, b) => (a.hole_number || 0) - (b.hole_number || 0));
    routeLog(route, 'db_action', { action: 'fetch_sponsors_admin', count: rows.length, tournamentId });
    return res.json({ success: true, home, hole, sponsors: rows });
  } catch (error) {
    routeLog(route, 'error', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: error?.message || 'Kunne ikke hente sponsorer' });
  }
});

app.post('/api/admin/tournament/:id/sponsors', async (req, res) => {
  const route = '/api/admin/tournament/:id/sponsors:POST';
  try {
    const tournamentId = asInt(req.params.id);
    const sponsors = Array.isArray(req.body?.sponsors) ? req.body.sponsors : [];
    routeLog(route, 'hit', { payload: { tournamentId, sponsorCount: sponsors.length } });
    if (!tournamentId) return res.status(400).json({ success: false, error: 'Invalid tournament id' });
    await supabase.from('sponsors').delete().eq('tournament_id', tournamentId);
    if (sponsors.length) {
      const payload = sponsors.map((row) => ({
        tournament_id: tournamentId,
        placement: row.placement === 'hole' ? 'hole' : 'home',
        spot_number: asInt(row.spot_number),
        hole_number: asInt(row.hole_number),
        sponsor_name: String(row.sponsor_name || '').trim() || null,
        description: String(row.description || '').trim() || null,
        logo_path: String(row.logo_path || '').trim() || null,
        is_enabled: !!row.is_enabled
      }));
      const { error } = await supabase.from('sponsors').insert(payload);
      if (error) throw error;
    }
    routeLog(route, 'db_action', { action: 'replace_sponsors', tournamentId, sponsorCount: sponsors.length });
    return res.json({ success: true });
  } catch (error) {
    routeLog(route, 'error', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: error?.message || 'Kunne ikke lagre sponsorer' });
  }
});

app.post('/api/admin/tournament/:id/sponsor-logo', upload.single('logo'), async (req, res) => {
  const route = '/api/admin/tournament/:id/sponsor-logo';
  try {
    const tournamentId = asInt(req.params.id);
    routeLog(route, 'hit', { payload: { tournamentId, hasFile: !!req.file } });
    if (!tournamentId) return res.status(400).json({ success: false, error: 'Invalid tournament id' });
    if (!req.file) return res.status(400).json({ success: false, error: 'Mangler bildefil (logo)' });
    const extension = path.extname(req.file.originalname || '').toLowerCase() || '.png';
    const safeExt = /^[.][a-z0-9]+$/.test(extension) ? extension : '.png';
    const storagePath = `sponsors/tournament-${tournamentId}/${Date.now()}-${crypto.randomUUID()}${safeExt}`;
    const { error: storageError } = await supabase.storage
      .from(MEDIA_BUCKET)
      .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype || 'image/png', upsert: false });
    if (storageError) throw storageError;
    const { data: publicData } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(storagePath);
    routeLog(route, 'db_action', { action: 'upload_sponsor_logo', storagePath });
    return res.json({ success: true, logo_path: publicData?.publicUrl || null, storage_path: storagePath });
  } catch (error) {
    if (isMissingBucketError(error)) {
      return res.status(500).json({ success: false, error: `Supabase Storage bucket mangler: ${MEDIA_BUCKET}`, code: 'STORAGE_BUCKET_NOT_FOUND', bucket: MEDIA_BUCKET });
    }
    routeLog(route, 'error', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: error?.message || 'Kunne ikke laste opp sponsorlogo' });
  }
});

app.get('/api/admin/tournament/:id/award-claims', async (req, res) => {
  const route = '/api/admin/tournament/:id/award-claims';
  try {
    const tournamentId = asInt(req.params.id);
    routeLog(route, 'hit', { payload: { tournamentId } });
    if (!tournamentId) return res.status(400).json({ success: false, error: 'Invalid tournament id' });
    const { data, error } = await supabase.from('award_claims').select('*').eq('tournament_id', tournamentId).order('claimed_at', { ascending: false });
    if (error) throw error;
    routeLog(route, 'db_action', { action: 'fetch_award_claims', count: data?.length || 0, tournamentId });
    return res.json({ success: true, claims: data || [] });
  } catch (error) {
    routeLog(route, 'error', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: error?.message || 'Kunne ikke hente kandidater' });
  }
});

app.get('/api/admin/tournament/:id/awards', async (req, res) => {
  const route = '/api/admin/tournament/:id/awards';
  try {
    const tournamentId = asInt(req.params.id);
    routeLog(route, 'hit', { payload: { tournamentId } });
    if (!tournamentId) return res.status(400).json({ success: false, error: 'Invalid tournament id' });
    const { data, error } = await supabase.from('awards').select('*').eq('tournament_id', tournamentId).order('created_at', { ascending: false });
    if (error) throw error;
    routeLog(route, 'db_action', { action: 'fetch_awards', count: data?.length || 0, tournamentId });
    return res.json({ success: true, awards: data || [] });
  } catch (error) {
    routeLog(route, 'error', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: error?.message || 'Kunne ikke hente utmerkelser' });
  }
});

app.post('/api/admin/award', async (req, res) => {
  const route = '/api/admin/award';
  try {
    const payload = {
      tournament_id: asInt(req.body?.tournament_id),
      team_id: asInt(req.body?.team_id),
      award_type: String(req.body?.award_type || '').trim(),
      player_name: String(req.body?.player_name || '').trim(),
      hole_number: asInt(req.body?.hole_number),
      detail: String(req.body?.detail || '').trim() || null
    };
    routeLog(route, 'hit', { payload });
    if (!payload.tournament_id || !payload.team_id || !payload.award_type || !payload.player_name) {
      return res.status(400).json({ success: false, error: 'tournament_id, team_id, award_type og player_name er påkrevd' });
    }
    const { data: team, error: teamError } = await supabase.from('teams').select('id,name,team_name').eq('id', payload.team_id).maybeSingle();
    if (teamError) throw teamError;
    const { data, error } = await supabase.from('awards').insert({ ...payload, team_name: normalizeTeamRow(team || {}).team_name }).select('*').single();
    if (error) throw error;
    routeLog(route, 'db_action', { action: 'insert_award', awardId: data?.id });
    return res.json({ success: true, award: data });
  } catch (error) {
    routeLog(route, 'error', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: error?.message || 'Kunne ikke lagre utmerkelse' });
  }
});

app.delete('/api/admin/award/:id', async (req, res) => {
  const route = '/api/admin/award/:id';
  try {
    const awardId = asInt(req.params.id);
    routeLog(route, 'hit', { payload: { awardId } });
    if (!awardId) return res.status(400).json({ success: false, error: 'Invalid award id' });
    const { error } = await supabase.from('awards').delete().eq('id', awardId);
    if (error) throw error;
    routeLog(route, 'db_action', { action: 'delete_award', awardId });
    return res.json({ success: true });
  } catch (error) {
    routeLog(route, 'error', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: error?.message || 'Kunne ikke slette utmerkelse' });
  }
});

app.get('/api/admin/coin-back', async (_req, res) => forwardTo(_req, res, 'GET', '/api/coin-back'));

app.post('/api/admin/coin-back', upload.single('photo'), async (req, res) => {
  const route = '/api/admin/coin-back';
  try {
    routeLog(route, 'hit', { payload: { hasFile: !!req.file } });
    if (!req.file) return res.status(400).json({ success: false, error: 'Mangler bildefil (photo)' });
    const extension = path.extname(req.file.originalname || '').toLowerCase() || '.png';
    const safeExt = /^[.][a-z0-9]+$/.test(extension) ? extension : '.png';
    const storagePath = `coin-back/${Date.now()}-${crypto.randomUUID()}${safeExt}`;
    const { error: storageError } = await supabase.storage.from(MEDIA_BUCKET)
      .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype || 'image/png', upsert: false });
    if (storageError) throw storageError;
    const { data: publicData } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(storagePath);
    const photoPath = publicData?.publicUrl || null;
    const { data, error } = await supabase
      .from('coin_back_images')
      .insert({ photo_path: photoPath, storage_path: storagePath, focal_point: '50% 50%', is_active: false })
      .select('*')
      .single();
    if (error) throw error;
    routeLog(route, 'db_action', { action: 'insert_coin_back', imageId: data?.id, storagePath });
    return res.json({ success: true, image: data });
  } catch (error) {
    if (isMissingBucketError(error)) {
      return res.status(500).json({ success: false, error: `Supabase Storage bucket mangler: ${MEDIA_BUCKET}`, code: 'STORAGE_BUCKET_NOT_FOUND', bucket: MEDIA_BUCKET });
    }
    routeLog(route, 'error', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: error?.message || 'Kunne ikke laste opp myntbakside' });
  }
});

app.put('/api/admin/coin-back/:id/active', async (req, res) => {
  const route = '/api/admin/coin-back/:id/active';
  try {
    const imageId = asInt(req.params.id);
    const isActive = !!req.body?.is_active;
    routeLog(route, 'hit', { payload: { imageId, isActive } });
    if (!imageId) return res.status(400).json({ success: false, error: 'Invalid image id' });
    if (isActive) await supabase.from('coin_back_images').update({ is_active: false }).neq('id', imageId);
    const { data, error } = await supabase.from('coin_back_images').update({ is_active: isActive }).eq('id', imageId).select('*').maybeSingle();
    if (error) throw error;
    routeLog(route, 'db_action', { action: 'toggle_coin_back_active', imageId, isActive });
    return res.json({ success: true, image: data });
  } catch (error) {
    routeLog(route, 'error', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: error?.message || 'Kunne ikke oppdatere aktiv status' });
  }
});

app.put('/api/admin/coin-back/focus', async (req, res) => {
  const route = '/api/admin/coin-back/focus';
  try {
    const imageId = asInt(req.body?.image_id);
    const focalPoint = String(req.body?.focal_point || '').trim();
    routeLog(route, 'hit', { payload: { imageId, focalPoint } });
    if (!imageId || !focalPoint) return res.status(400).json({ success: false, error: 'image_id og focal_point er påkrevd' });
    const { data, error } = await supabase.from('coin_back_images').update({ focal_point: focalPoint }).eq('id', imageId).select('*').maybeSingle();
    if (error) throw error;
    routeLog(route, 'db_action', { action: 'update_coin_back_focus', imageId });
    return res.json({ success: true, image: data });
  } catch (error) {
    routeLog(route, 'error', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: error?.message || 'Kunne ikke lagre fokuspunkt' });
  }
});

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

app.post('/api/admin/legacy/:id/photo', upload.single('photo'), async (req, res) => {
  const route = '/api/admin/legacy/:id/photo';
  try {
    const legacyId = asInt(req.params.id);
    routeLog(route, 'hit', { payload: { legacyId, hasFile: !!req.file } });
    if (!legacyId) return res.status(400).json({ success: false, error: 'Invalid legacy id' });
    if (!req.file) return res.status(400).json({ success: false, error: 'Mangler bildefil (photo)' });
    const extension = path.extname(req.file.originalname || '').toLowerCase() || '.jpg';
    const safeExt = /^[.][a-z0-9]+$/.test(extension) ? extension : '.jpg';
    const storagePath = `legacy/${legacyId}/${Date.now()}-${crypto.randomUUID()}${safeExt}`;
    const { error: storageError } = await supabase.storage.from(MEDIA_BUCKET)
      .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype || 'image/jpeg', upsert: false });
    if (storageError) throw storageError;
    const { data: publicData } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(storagePath);
    const { data, error } = await supabase
      .from('legacy_entries')
      .update({ winner_photo: publicData?.publicUrl || null })
      .eq('id', legacyId)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    routeLog(route, 'db_action', { action: 'update_legacy_photo', legacyId, storagePath });
    return res.json({ success: true, legacy: data });
  } catch (error) {
    if (isMissingBucketError(error)) {
      return res.status(500).json({ success: false, error: `Supabase Storage bucket mangler: ${MEDIA_BUCKET}`, code: 'STORAGE_BUCKET_NOT_FOUND', bucket: MEDIA_BUCKET });
    }
    routeLog(route, 'error', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: error?.message || 'Kunne ikke lagre vinnerbilde' });
  }
});

app.put('/api/admin/legacy/:id/photo-focus', async (req, res) => {
  const route = '/api/admin/legacy/:id/photo-focus';
  try {
    const legacyId = asInt(req.params.id);
    const focus = String(req.body?.focus || '').trim();
    routeLog(route, 'hit', { payload: { legacyId, focus } });
    if (!legacyId || !focus) return res.status(400).json({ success: false, error: 'legacy id og focus er påkrevd' });
    const { data, error } = await supabase.from('legacy_entries').update({ winner_photo_focus: focus }).eq('id', legacyId).select('*').maybeSingle();
    if (error) throw error;
    routeLog(route, 'db_action', { action: 'update_legacy_photo_focus', legacyId });
    return res.json({ success: true, legacy: data });
  } catch (error) {
    routeLog(route, 'error', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: error?.message || 'Kunne ikke oppdatere fokuspunkt' });
  }
});

app.get('/admin/legacy', (req, res) => forwardTo(req, res, 'GET', '/api/admin/legacy'));
app.post('/admin/legacy', (req, res) => forwardTo(req, res, 'POST', '/api/admin/legacy'));
app.post('/chat/send', (req, res) => forwardTo(req, res, 'POST', '/api/chat/send'));
app.get('/chat/messages', (req, res) => forwardTo(req, res, 'GET', '/api/chat/messages'));

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
