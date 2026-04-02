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

function toCanonicalHoleRow(row = {}) {
  return {
    hole_number: asInt(row.hole_number) || 1,
    par: asInt(row.par) || 4,
    stroke_index: asInt(row.stroke_index) || 1,
    requires_photo: Boolean(row.requires_photo),
    is_longest_drive: Boolean(row.is_longest_drive),
    is_nearest_pin: Boolean(row.is_nearest_pin)
  };
}

async function ensureCanonicalTournamentHoles(tournamentId) {
  const defaults = buildDefaultHoles(tournamentId);
  const { error: seedError } = await supabase
    .from('tournament_holes')
    .upsert(defaults, { onConflict: 'tournament_id,hole_number' });
  if (seedError) throw new Error(`Kunne ikke initialisere tournament_holes: ${seedError.message}`);

  const { data, error } = await supabase
    .from('tournament_holes')
    .select('hole_number,par,stroke_index,requires_photo,is_longest_drive,is_nearest_pin')
    .eq('tournament_id', tournamentId)
    .order('hole_number', { ascending: true });
  if (error) throw new Error(`Kunne ikke hente tournament_holes: ${error.message}`);
  return (data || []).map(toCanonicalHoleRow);
}

function mapTeamRowToCanonical(row = {}) {
  return {
    id: asInt(row.id),
    tournament_id: asInt(row.tournament_id),
    team_name: row.team_name || row.name || '',
    player1_name: row.player1_name || row.player1 || '',
    player2_name: row.player2_name || row.player2 || '',
    pin: row.pin || row.pin_code || '',
    hcp_player1: asInt(row.hcp_player1 ?? row.player1_hcp ?? row.player1_handicap) || 0,
    hcp_player2: asInt(row.hcp_player2 ?? row.player2_hcp ?? row.player2_handicap) || 0,
    created_at: row.created_at || null,
    locked: Boolean(row.locked)
  };
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

function parseHoleBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'ja', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'nei', 'off', ''].includes(normalized)) return false;
  }
  if (typeof value === 'number') return value !== 0;
  return fallback;
}

const TOURNAMENT_HOLE_BOOLEAN_ALIASES = {
  longestDrive: ['is_longest_drive', 'longest_drive', 'ld'],
  nearestPin: ['is_nearest_pin', 'nearest_pin', 'is_closest_to_pin', 'closest_to_pin', 'nf'],
  requiresPhoto: ['requires_photo', 'photo_required', 'requiresPhoto']
};

function pickFirstDefinedValue(obj = {}, keys = []) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined && obj[key] !== null) {
      return obj[key];
    }
  }
  return undefined;
}

function canonicalizeTournamentHoleInput(hole = {}, tournamentId, fallbackHoleNumber = null) {
  const holeNumber = asInt(
    pickFirstDefinedValue(hole, ['hole_number', 'hole', 'number', 'nr'])
  ) || fallbackHoleNumber;
  const par = asInt(pickFirstDefinedValue(hole, ['par'])) || 4;
  const strokeIndex = asInt(pickFirstDefinedValue(hole, ['stroke_index', 'strokeIndex', 'si', 'SI', 'stroke']));

  return {
    tournament_id: tournamentId,
    hole_number: holeNumber,
    par,
    stroke_index: strokeIndex || holeNumber,
    requires_photo: parseHoleBoolean(pickFirstDefinedValue(hole, TOURNAMENT_HOLE_BOOLEAN_ALIASES.requiresPhoto)),
    is_longest_drive: parseHoleBoolean(pickFirstDefinedValue(hole, TOURNAMENT_HOLE_BOOLEAN_ALIASES.longestDrive)),
    is_nearest_pin: parseHoleBoolean(pickFirstDefinedValue(hole, TOURNAMENT_HOLE_BOOLEAN_ALIASES.nearestPin))
  };
}

function getCanonicalHoleFlags(hole = {}) {
  const isLongestDrive = parseHoleBoolean(
    hole.is_longest_drive
    ?? hole.longest_drive
    ?? hole.longestDrive
    ?? hole.ld
  );

  const isNearestPin = parseHoleBoolean(
    hole.is_nearest_pin
    ?? hole.is_closest_to_pin
    ?? hole.nearest_pin
    ?? hole.closest_to_pin
    ?? hole.nf
  );

  return { isLongestDrive, isNearestPin };
}

function normalizeAdminHoleCards(rawHoles, ownerId, ownerKey) {
  const list = Array.isArray(rawHoles) ? rawHoles : [];
  const fallbackList = list.length ? list : Array.from({ length: 18 }, (_, index) => ({ hole_number: index + 1 }));
  return fallbackList.map((hole, index) => {
    const holeNumber = asInt(hole?.hole_number ?? hole?.hole ?? hole?.number ?? hole?.nr) || (index + 1);
    const par = asInt(hole?.par);
    const strokeIndex = asInt(
      hole?.stroke_index
      ?? hole?.strokeIndex
      ?? hole?.si
      ?? hole?.SI
      ?? hole?.stroke
    );
    const { isLongestDrive, isNearestPin } = getCanonicalHoleFlags(hole);
    return {
      owner_id: ownerId,
      owner_key: ownerKey,
      hole_number: holeNumber,
      par: Number.isInteger(par) ? par : 4,
      stroke_index: Number.isInteger(strokeIndex) ? strokeIndex : holeNumber,
      requires_photo: parseHoleBoolean(hole?.requires_photo ?? hole?.photo_required ?? hole?.requiresPhoto),
      is_longest_drive: isLongestDrive,
      is_nearest_pin: isNearestPin
    };
  });
}

function pickFirstExisting(columns, candidates = []) {
  const normalized = new Set((columns || []).map((column) => String(column).toLowerCase()));
  const lookup = new Map((columns || []).map((column) => [String(column).toLowerCase(), column]));
  for (const candidate of candidates) {
    const key = String(candidate).toLowerCase();
    if (normalized.has(key)) return lookup.get(key);
  }
  return null;
}

function mapNormalizedHoleToDb(normalizedHole, mapping) {
  const { isLongestDrive, isNearestPin } = getCanonicalHoleFlags(normalizedHole);
  const row = {};
  const skippedFields = [];
  const supportMatrix = [
    ['hole_number', mapping.holeNumberColumn],
    ['par', mapping.parColumn],
    ['stroke_index', mapping.strokeIndexColumn],
    ['requires_photo', mapping.requiresPhotoColumn],
    ['is_longest_drive', mapping.longestDriveColumn],
    ['is_nearest_pin', mapping.nearestPinColumn]
  ];

  if (mapping.ownerIdColumn) {
    row[mapping.ownerIdColumn] = normalizedHole.owner_id;
  }
  if (mapping.ownerKeyColumn) {
    row[mapping.ownerKeyColumn] = normalizedHole.owner_key;
  }
  if (!mapping.ownerIdColumn && mapping.ownerColumn) {
    row[mapping.ownerColumn] = normalizedHole.owner_id;
  }
  for (const [sourceKey, destinationColumn] of supportMatrix) {
    if (!destinationColumn) {
      skippedFields.push(sourceKey);
      continue;
    }
    if (sourceKey === 'is_longest_drive') {
      row[destinationColumn] = isLongestDrive;
      continue;
    }
    if (sourceKey === 'is_nearest_pin') {
      row[destinationColumn] = isNearestPin;
      continue;
    }
    row[destinationColumn] = normalizedHole[sourceKey];
  }
  return { row, skippedFields };
}

function normalizeHoleFromDbRow(row = {}, mapping = {}, ownerId = null, ownerKey = 'tournament') {
  const ownerColumn = mapping.ownerIdColumn || mapping.ownerColumn || (ownerKey === 'course' ? 'course_id' : 'tournament_id');
  const ownerKeyColumn = mapping.ownerKeyColumn || 'owner_key';
  const holeNumberColumn = mapping.holeNumberColumn || 'hole_number';
  const parColumn = mapping.parColumn || 'par';
  const strokeIndexColumn = mapping.strokeIndexColumn || 'stroke_index';
  const requiresPhotoColumn = mapping.requiresPhotoColumn || 'requires_photo';
  const longestDriveColumn = mapping.longestDriveColumn || 'is_longest_drive';
  const nearestPinColumn = mapping.nearestPinColumn || 'is_nearest_pin';

  const holeNumber = asInt(row[holeNumberColumn] ?? row.hole_number ?? row.hole ?? row.number);
  const par = asInt(row[parColumn] ?? row.par);
  const strokeIndex = asInt(row[strokeIndexColumn] ?? row.stroke_index ?? row.si);
  const requiresPhoto = parseHoleBoolean(row[requiresPhotoColumn] ?? row.requires_photo ?? row.photo_required);
  const isLongestDrive = parseHoleBoolean(
    row[longestDriveColumn]
    ?? row.is_longest_drive
    ?? row.longest_drive
    ?? row.longestDrive
    ?? row.ld
  );
  const isNearestPin = parseHoleBoolean(
    row[nearestPinColumn]
    ?? row.is_nearest_pin
    ?? row.is_closest_to_pin
    ?? row.nearest_pin
    ?? row.closest_to_pin
    ?? row.nf
  );

  return {
    owner_id: asInt(row[ownerColumn]) || ownerId || null,
    owner_key: String(row[ownerKeyColumn] || ownerKey),
    hole_number: Number.isInteger(holeNumber) ? holeNumber : null,
    par: Number.isInteger(par) ? par : 4,
    stroke_index: Number.isInteger(strokeIndex) ? strokeIndex : (Number.isInteger(holeNumber) ? holeNumber : 1),
    requires_photo: requiresPhoto,
    longest_drive: isLongestDrive,
    nearest_pin: isNearestPin,
    is_longest_drive: isLongestDrive,
    is_nearest_pin: isNearestPin,
    is_closest_to_pin: isNearestPin
  };
}

function getHoleRowDebugIdentity(row = {}, mapping = {}) {
  const ownerIdColumn = mapping.ownerIdColumn || null;
  const ownerKeyColumn = mapping.ownerKeyColumn || null;
  const ownerColumn = mapping.ownerColumn || null;
  return {
    id: asInt(row.id) || null,
    owner_id: ownerIdColumn ? asInt(row[ownerIdColumn]) : (asInt(row.owner_id) || null),
    owner_key: ownerKeyColumn ? String(row[ownerKeyColumn] || '') : String(row.owner_key || ''),
    tournament_id: asInt(row.tournament_id) || null,
    course_id: asInt(row.course_id) || null,
    owner_column: ownerColumn ? asInt(row[ownerColumn]) : null
  };
}

function isTournamentOwnedHoleRow(row = {}, mapping = {}, tournamentId) {
  const debugIdentity = getHoleRowDebugIdentity(row, mapping);
  const expectedTournamentId = asInt(tournamentId);
  const ownerIdColumn = mapping.ownerIdColumn || null;
  const ownerKeyColumn = mapping.ownerKeyColumn || null;
  const ownerColumn = mapping.ownerColumn || null;

  const matchesOwnerIdColumn = ownerIdColumn ? asInt(row[ownerIdColumn]) === expectedTournamentId : false;
  const matchesTournamentId = asInt(row.tournament_id) === expectedTournamentId;
  const matchesOwnerColumn = ownerColumn ? asInt(row[ownerColumn]) === expectedTournamentId : false;

  const rowOwnerKeyRaw = ownerKeyColumn ? row[ownerKeyColumn] : row.owner_key;
  const rowOwnerKey = String(rowOwnerKeyRaw || '').trim().toLowerCase();
  const ownerKeySupportsTournament = !rowOwnerKey || rowOwnerKey === 'tournament';

  const matchesTournamentIdentity = matchesOwnerIdColumn || matchesTournamentId || matchesOwnerColumn;
  const isTournamentOwned = matchesTournamentIdentity && ownerKeySupportsTournament;

  return {
    isTournamentOwned,
    debugIdentity,
    reason: isTournamentOwned
      ? 'matches tournament owner identity'
      : 'does not match tournament owner identity'
  };
}

function mergeTournamentHoleRows(rawRows, mapping, tournamentId, routeTag = 'unknown') {
  const rows = Array.isArray(rawRows) ? rawRows : [];
  const grouped = new Map();

  for (const row of rows) {
    const normalized = normalizeHoleFromDbRow(row, mapping, tournamentId, 'tournament');
    const holeNumber = asInt(normalized.hole_number);
    if (!Number.isInteger(holeNumber) || holeNumber < 1 || holeNumber > 18) continue;
    if (!grouped.has(holeNumber)) grouped.set(holeNumber, []);
    grouped.get(holeNumber).push({ raw: row, normalized });
  }

  const mergedHoles = [];
  for (let holeNumber = 1; holeNumber <= 18; holeNumber += 1) {
    const holeRows = grouped.get(holeNumber) || [];
    if (!holeRows.length) {
      mergedHoles.push(normalizeHoleInput({ hole_number: holeNumber }, tournamentId, holeNumber));
      continue;
    }

    const withOwnership = holeRows.map((entry) => ({
      ...entry,
      ownership: isTournamentOwnedHoleRow(entry.raw, mapping, tournamentId)
    }));
    const tournamentOwnedRows = withOwnership.filter((entry) => entry.ownership.isTournamentOwned);
    const consideredRows = tournamentOwnedRows.length ? tournamentOwnedRows : withOwnership;
    const winner = consideredRows[0];

    const mergedFlags = consideredRows.reduce((acc, entry) => ({
      requires_photo: acc.requires_photo || parseHoleBoolean(entry.normalized.requires_photo),
      is_longest_drive: acc.is_longest_drive || parseHoleBoolean(entry.normalized.is_longest_drive ?? entry.normalized.longest_drive),
      is_nearest_pin: acc.is_nearest_pin || parseHoleBoolean(entry.normalized.is_nearest_pin ?? entry.normalized.nearest_pin)
    }), {
      requires_photo: false,
      is_longest_drive: false,
      is_nearest_pin: false
    });

    mergedHoles.push({
      owner_id: tournamentId,
      owner_key: 'tournament',
      hole_number: holeNumber,
      par: winner.normalized.par,
      stroke_index: winner.normalized.stroke_index,
      requires_photo: mergedFlags.requires_photo,
      longest_drive: mergedFlags.is_longest_drive,
      nearest_pin: mergedFlags.is_nearest_pin,
      is_longest_drive: mergedFlags.is_longest_drive,
      is_nearest_pin: mergedFlags.is_nearest_pin,
      is_closest_to_pin: mergedFlags.is_nearest_pin
    });

    if (holeNumber === 1 || holeNumber === 2) {
      const rawRowsDebug = holeRows.map((entry) => ({
        hole_number: holeNumber,
        flags: {
          requires_photo: entry.normalized.requires_photo,
          is_longest_drive: entry.normalized.is_longest_drive,
          is_nearest_pin: entry.normalized.is_nearest_pin
        },
        ...getHoleRowDebugIdentity(entry.raw, mapping)
      }));
      console.log(`[api:admin-holes:merge:${routeTag}] hole ${holeNumber} raw rows before merge`, rawRowsDebug);
      console.log(`[api:admin-holes:merge:${routeTag}] hole ${holeNumber} grouped rows`, withOwnership.map((entry) => ({
        ...entry.ownership.debugIdentity,
        ownership_reason: entry.ownership.reason,
        considered_for_merge: consideredRows.includes(entry),
        flags: {
          requires_photo: entry.normalized.requires_photo,
          is_longest_drive: entry.normalized.is_longest_drive,
          is_nearest_pin: entry.normalized.is_nearest_pin
        }
      })));
      console.log(`[api:admin-holes:merge:${routeTag}] hole ${holeNumber} winner`, {
        winner: getHoleRowDebugIdentity(winner.raw, mapping),
        reason: tournamentOwnedRows.length
          ? 'tournament-owned rows exist, fallback rows ignored'
          : 'no tournament-owned row found, fallback rows used'
      });
      console.log(`[api:admin-holes:merge:${routeTag}] hole ${holeNumber} final merged row`, {
        hole_number: holeNumber,
        requires_photo: mergedFlags.requires_photo,
        is_longest_drive: mergedFlags.is_longest_drive,
        is_nearest_pin: mergedFlags.is_nearest_pin
      });
    }
  }

  return mergedHoles;
}

function buildHoleDbMapping(columns, options = {}) {
  const ownerType = options.ownerType || 'tournament';
  const ownerColumnCandidates = ownerType === 'course'
    ? ['course_id', 'course_template_id', 'courseid']
    : ['tournament_id', 'tournamentid'];
  const ownerIdColumn = pickFirstExisting(columns, ['owner_id']);
  const ownerKeyColumn = pickFirstExisting(columns, ['owner_key']);
  return {
    ownerColumn: pickFirstExisting(columns, ownerColumnCandidates),
    ownerIdColumn,
    ownerKeyColumn,
    holeNumberColumn: pickFirstExisting(columns, ['hole_number', 'hole', 'holenumber']),
    parColumn: pickFirstExisting(columns, ['par']),
    strokeIndexColumn: pickFirstExisting(columns, ['stroke_index', 'si', 'strokeindex']),
    requiresPhotoColumn: pickFirstExisting(columns, ['requires_photo', 'photo_required', 'photo_required_for_hole']),
    longestDriveColumn: pickFirstExisting(columns, ['is_longest_drive', 'longest_drive', 'longestDrive', 'ld', 'longest_drive_hole']),
    nearestPinColumn: pickFirstExisting(columns, ['is_nearest_pin', 'is_closest_to_pin', 'nearest_pin', 'closest_to_pin', 'nf'])
  };
}

function getHoleOwnerFilter(mapping, ownerId, ownerKey) {
  if (mapping.ownerIdColumn && mapping.ownerKeyColumn) {
    return { [mapping.ownerIdColumn]: ownerId, [mapping.ownerKeyColumn]: ownerKey };
  }
  if (mapping.ownerIdColumn) {
    return { [mapping.ownerIdColumn]: ownerId };
  }
  if (mapping.ownerColumn) {
    return { [mapping.ownerColumn]: ownerId };
  }
  return {};
}

function getHoleOnConflictColumns(mapping) {
  const columns = [];
  if (mapping.ownerIdColumn) columns.push(mapping.ownerIdColumn);
  if (mapping.ownerKeyColumn) columns.push(mapping.ownerKeyColumn);
  if (mapping.holeNumberColumn) columns.push(mapping.holeNumberColumn);

  if (!columns.length || (!mapping.ownerIdColumn && mapping.ownerColumn)) {
    if (!mapping.ownerIdColumn && mapping.ownerColumn && !columns.includes(mapping.ownerColumn)) {
      columns.unshift(mapping.ownerColumn);
    }
    if (mapping.holeNumberColumn && !columns.includes(mapping.holeNumberColumn)) {
      columns.push(mapping.holeNumberColumn);
    }
  }
  return columns.filter(Boolean).join(',');
}

function getTournamentOwnedOnConflictColumns(mapping) {
  if (mapping.ownerColumn && mapping.holeNumberColumn) {
    return [mapping.ownerColumn, mapping.holeNumberColumn].filter(Boolean).join(',');
  }
  const columns = [];
  if (mapping.ownerIdColumn) columns.push(mapping.ownerIdColumn);
  if (mapping.ownerKeyColumn) columns.push(mapping.ownerKeyColumn);
  if (mapping.holeNumberColumn) columns.push(mapping.holeNumberColumn);
  return columns.filter(Boolean).join(',');
}

function mapCanonicalTournamentHoleToDbRow(canonicalHole, mapping, holesColumns) {
  const row = {};
  const hasColumn = (columnName) => Boolean(columnName && holesColumns.includes(columnName));

  if (mapping.ownerColumn) row[mapping.ownerColumn] = canonicalHole.tournament_id;
  if (mapping.ownerIdColumn) row[mapping.ownerIdColumn] = canonicalHole.tournament_id;
  if (mapping.ownerKeyColumn) row[mapping.ownerKeyColumn] = 'tournament';
  if (mapping.holeNumberColumn) row[mapping.holeNumberColumn] = canonicalHole.hole_number;
  if (mapping.parColumn) row[mapping.parColumn] = canonicalHole.par;
  if (mapping.strokeIndexColumn) row[mapping.strokeIndexColumn] = canonicalHole.stroke_index;
  if (mapping.requiresPhotoColumn) row[mapping.requiresPhotoColumn] = canonicalHole.requires_photo;
  if (mapping.longestDriveColumn) row[mapping.longestDriveColumn] = canonicalHole.is_longest_drive;
  if (mapping.nearestPinColumn) row[mapping.nearestPinColumn] = canonicalHole.is_nearest_pin;

  // Write canonical booleans to every supported alias column so no fallback/default
  // path can flip true -> false during read/response normalization.
  if (hasColumn('requires_photo')) row.requires_photo = canonicalHole.requires_photo;
  if (hasColumn('photo_required')) row.photo_required = canonicalHole.requires_photo;

  if (hasColumn('is_longest_drive')) row.is_longest_drive = canonicalHole.is_longest_drive;
  if (hasColumn('longest_drive')) row.longest_drive = canonicalHole.is_longest_drive;
  if (hasColumn('ld')) row.ld = canonicalHole.is_longest_drive;

  if (hasColumn('is_nearest_pin')) row.is_nearest_pin = canonicalHole.is_nearest_pin;
  if (hasColumn('nearest_pin')) row.nearest_pin = canonicalHole.is_nearest_pin;
  if (hasColumn('is_closest_to_pin')) row.is_closest_to_pin = canonicalHole.is_nearest_pin;
  if (hasColumn('closest_to_pin')) row.closest_to_pin = canonicalHole.is_nearest_pin;
  if (hasColumn('nf')) row.nf = canonicalHole.is_nearest_pin;
  return row;
}

async function fetchTournamentOwnedHoleRows(tournamentId, holesColumns, mapping) {
  const rowMap = new Map();
  const fetches = [];

  if (mapping.ownerColumn) {
    let ownerColumnQuery = supabase
      .from('holes')
      .select(holesColumns.join(','))
      .eq(mapping.ownerColumn, tournamentId);
    if (mapping.ownerKeyColumn) ownerColumnQuery = ownerColumnQuery.eq(mapping.ownerKeyColumn, 'tournament');
    fetches.push(ownerColumnQuery.order(mapping.holeNumberColumn, { ascending: true }));
  }
  if (mapping.ownerIdColumn) {
    let query = supabase
      .from('holes')
      .select(holesColumns.join(','))
      .eq(mapping.ownerIdColumn, tournamentId);
    if (mapping.ownerKeyColumn) query = query.eq(mapping.ownerKeyColumn, 'tournament');
    fetches.push(query.order(mapping.holeNumberColumn, { ascending: true }));
  }

  if (!fetches.length) return [];
  const results = await Promise.all(fetches);
  for (const result of results) {
    if (result.error) throw new Error(result.error.message);
    for (const row of (result.data || [])) {
      const ownership = isTournamentOwnedHoleRow(row, mapping, tournamentId);
      if (!ownership.isTournamentOwned) continue;
      const holeNumber = asInt(row[mapping.holeNumberColumn] ?? row.hole_number);
      if (!Number.isInteger(holeNumber) || holeNumber < 1 || holeNumber > 18) continue;
      const key = `hole:${holeNumber}:id:${asInt(row.id) || 'noid'}:${JSON.stringify(ownership.debugIdentity)}`;
      rowMap.set(key, row);
    }
  }
  return [...rowMap.values()];
}

async function discoverCourseHolesStore() {
  const candidateTables = [
    'course_holes',
    'courses_holes',
    'course_template_holes',
    'course_templates_holes',
    'holes_templates',
    'holes_template',
    'holes'
  ];
  for (const tableName of candidateTables) {
    const columns = await fetchTableColumns(tableName);
    if (!columns.length) continue;
    const mapping = buildHoleDbMapping(columns, { ownerType: 'course' });
    if ((mapping.ownerColumn || mapping.ownerIdColumn) && mapping.holeNumberColumn) {
      return { tableName, columns, mapping, mode: 'rows' };
    }
  }

  const coursesColumns = await fetchTableColumns('courses');
  if (coursesColumns.length) {
    const jsonColumn = pickFirstExisting(coursesColumns, ['holes', 'holes_json', 'hole_config', 'hole_configuration', 'hole_template']);
    if (jsonColumn) {
      return { tableName: 'courses', columns: coursesColumns, jsonColumn, mode: 'json' };
    }
  }
  return null;
}

async function getActiveTournament() {
  const { data } = await supabase.from('tournaments').select('*').in('status', ['active', 'upcoming']).order('status', { ascending: true }).order('id').limit(1).maybeSingle();
  return data || null;
}

async function ensureTournamentHoles(tournamentId) {
  const holesColumns = await fetchTableColumns('holes');
  const mapping = buildHoleDbMapping(holesColumns, { ownerType: 'tournament' });
  const hasOwnerColumns = Boolean(mapping.ownerColumn || mapping.ownerIdColumn);
  if (!hasOwnerColumns || !mapping.holeNumberColumn) {
    throw new Error('public.holes mangler nødvendige owner/hole-felter for lasting');
  }
  const data = await fetchTournamentOwnedHoleRows(tournamentId, holesColumns, mapping);

  if ((data || []).length > 0) return data;

  const fallbackHoles = normalizeAdminHoleCards(buildDefaultHoles(tournamentId), tournamentId, 'tournament');
  const fallbackInsertPayload = fallbackHoles.map((hole) => {
    const { row } = mapNormalizedHoleToDb(hole, mapping);
    if (!mapping.longestDriveColumn && holesColumns.includes('is_longest_drive')) row.is_longest_drive = false;
    if (!mapping.nearestPinColumn && holesColumns.includes('is_nearest_pin')) row.is_nearest_pin = false;
    return row;
  });

  if (fallbackInsertPayload.some((row) => !Object.prototype.hasOwnProperty.call(row, mapping.holeNumberColumn))) {
    throw new Error('public.holes støtter ikke påkrevd hole_number-felt for standardhull');
  }

  const onConflict = getTournamentOwnedOnConflictColumns(mapping);
  const { error: insertError } = await supabase
    .from('holes')
    .upsert(fallbackInsertPayload, { onConflict });
  if (insertError) throw new Error(insertError.message);

  const created = await fetchTournamentOwnedHoleRows(tournamentId, holesColumns, mapping);
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
  const teams = (data || []).map(mapTeamRowToCanonical);
  return ok(res, { teams, data: teams });
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
  if (!tournamentId) return fail(res, 400, 'Ugyldig turnerings-ID');
  const holes = await ensureCanonicalTournamentHoles(tournamentId);
  return ok(res, { data: holes });
}));

app.post('/api/admin/tournament/:id/holes', asyncRoute(async (req, res) => {
  if (!requireSupabase(res)) return;
  if (!requireAdmin(req, res)) return;
  const tournamentId = asInt(req.params.id);
  if (!tournamentId) return fail(res, 400, 'Ugyldig turnerings-ID');

  const requestedHoles = Array.isArray(req.body?.holes) ? req.body.holes : null;
  if (!requestedHoles || requestedHoles.length !== 18) {
    return fail(res, 400, 'holes må inneholde nøyaktig 18 hull');
  }

  const canonicalHoles = requestedHoles.map((hole) => toCanonicalHoleRow(hole));
  const numbers = canonicalHoles.map((hole) => hole.hole_number);
  if (new Set(numbers).size !== 18 || numbers.some((n) => n < 1 || n > 18)) {
    return fail(res, 400, 'hole_number må være unike verdier 1..18');
  }

  const payload = canonicalHoles.map((hole) => ({ ...hole, tournament_id: tournamentId }));
  const { error } = await supabase.from('tournament_holes').upsert(payload, { onConflict: 'tournament_id,hole_number' });
  if (error) return fail(res, 500, 'Kunne ikke lagre hull', error.message);

  const holes = await ensureCanonicalTournamentHoles(tournamentId);
  return ok(res, { data: holes });
}));

app.get('/api/admin/course/:id/holes', asyncRoute(async (req, res) => {
  if (!requireSupabase(res)) return;
  if (!requireAdmin(req, res)) return;
  const courseId = asInt(req.params.id);
  if (!courseId) return fail(res, 400, 'Ugyldig bane-ID');

  const store = await discoverCourseHolesStore();
  if (!store) {
    return res.status(500).json({
      success: false,
      error: 'Fant ingen lagringsmodell for bane-hull',
      stackHint: 'admin_course_holes_load',
      debug: {
        routeUsed: '/api/admin/course/:id/holes'
      }
    });
  }

  if (store.mode === 'json') {
    const { data, error } = await supabase
      .from('courses')
      .select(`id,${store.jsonColumn}`)
      .eq('id', courseId)
      .maybeSingle();
    if (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
        stackHint: 'admin_course_holes_load',
        debug: {
          routeUsed: '/api/admin/course/:id/holes',
          discoveredTableName: store.tableName,
          discoveredLiveColumns: store.columns
        }
      });
    }
    const holes = Array.isArray(data?.[store.jsonColumn]) ? data[store.jsonColumn] : [];
    return res.status(200).json({
      success: true,
      data: holes,
      holes,
      debug: {
        routeUsed: '/api/admin/course/:id/holes',
        discoveredTableName: store.tableName,
        discoveredLiveColumns: store.columns
      }
    });
  }

  const { data, error } = await supabase
    .from(store.tableName)
    .select(store.columns.join(','))
    .match(getHoleOwnerFilter(store.mapping, courseId, 'course'))
    .order(store.mapping.holeNumberColumn, { ascending: true });
  if (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
      stackHint: 'admin_course_holes_load',
      debug: {
        routeUsed: '/api/admin/course/:id/holes',
        discoveredTableName: store.tableName,
        discoveredLiveColumns: store.columns
      }
    });
  }
  return res.status(200).json({
    success: true,
    data: data || [],
    holes: data || [],
    debug: {
      routeUsed: '/api/admin/course/:id/holes',
      discoveredTableName: store.tableName,
      discoveredLiveColumns: store.columns
    }
  });
}));

app.post('/api/admin/course/:id/holes', asyncRoute(async (req, res) => {
  if (!requireSupabase(res)) return;
  if (!requireAdmin(req, res)) return;
  const courseId = asInt(req.params.id);
  if (!courseId) return fail(res, 400, 'Ugyldig bane-ID');
  const requestedHoles = Array.isArray(req.body?.holes) ? req.body.holes : null;
  if (!requestedHoles) return fail(res, 400, 'holes må være en liste');

  const store = await discoverCourseHolesStore();
  if (!store) {
    return res.status(500).json({
      success: false,
      error: 'Fant ingen lagringsmodell for bane-hull',
      stackHint: 'admin_course_holes_save',
      debug: {
        routeUsed: '/api/admin/course/:id/holes'
      }
    });
  }

  const normalizedHoles = normalizeAdminHoleCards(requestedHoles, courseId, 'course');
  const skippedFieldSet = new Set();

  if (store.mode === 'json') {
    const { error } = await supabase
      .from('courses')
      .update({ [store.jsonColumn]: normalizedHoles })
      .eq('id', courseId);
    if (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
        stackHint: 'admin_course_holes_save',
        debug: {
          routeUsed: '/api/admin/course/:id/holes',
          discoveredTableName: store.tableName,
          discoveredLiveColumns: store.columns,
          normalizedIncomingPayload: normalizedHoles,
          finalPersistedPayload: [{ id: courseId, [store.jsonColumn]: normalizedHoles }],
          skippedUnsupportedFields: []
        }
      });
    }
    const { data } = await supabase.from('courses').select(`id,${store.jsonColumn}`).eq('id', courseId).maybeSingle();
    const holes = Array.isArray(data?.[store.jsonColumn]) ? data[store.jsonColumn] : [];
    return res.status(200).json({
      success: true,
      data: holes,
      holes,
      debug: {
        routeUsed: '/api/admin/course/:id/holes',
        discoveredTableName: store.tableName,
        discoveredLiveColumns: store.columns,
        normalizedIncomingPayload: normalizedHoles,
        finalPersistedPayload: [{ id: courseId, [store.jsonColumn]: normalizedHoles }],
        skippedUnsupportedFields: [],
        insertUpdateResultCount: 1
      }
    });
  }

  const persistedPayload = normalizedHoles.map((hole) => {
    const { row, skippedFields } = mapNormalizedHoleToDb(hole, store.mapping);
    skippedFields.forEach((field) => skippedFieldSet.add(field));
    return row;
  });

  const onConflict = getHoleOnConflictColumns(store.mapping);
  const { error } = await supabase
    .from(store.tableName)
    .upsert(persistedPayload, { onConflict });
  if (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
      stackHint: 'admin_course_holes_save',
      debug: {
        routeUsed: '/api/admin/course/:id/holes',
        discoveredTableName: store.tableName,
        discoveredLiveColumns: store.columns,
        normalizedIncomingPayload: normalizedHoles,
        finalPersistedPayload: persistedPayload,
        skippedUnsupportedFields: [...skippedFieldSet]
      }
    });
  }

  const { data, error: fetchError } = await supabase
    .from(store.tableName)
    .select(store.columns.join(','))
    .match(getHoleOwnerFilter(store.mapping, courseId, 'course'))
    .order(store.mapping.holeNumberColumn, { ascending: true });
  if (fetchError) {
    return res.status(500).json({
      success: false,
      error: fetchError.message,
      stackHint: 'admin_course_holes_save',
      debug: {
        routeUsed: '/api/admin/course/:id/holes',
        discoveredTableName: store.tableName,
        discoveredLiveColumns: store.columns,
        normalizedIncomingPayload: normalizedHoles,
        finalPersistedPayload: persistedPayload,
        skippedUnsupportedFields: [...skippedFieldSet]
      }
    });
  }

  return res.status(200).json({
    success: true,
    data: data || [],
    holes: data || [],
    debug: {
      routeUsed: '/api/admin/course/:id/holes',
      discoveredTableName: store.tableName,
      discoveredLiveColumns: store.columns,
      normalizedIncomingPayload: normalizedHoles,
      finalPersistedPayload: persistedPayload,
      skippedUnsupportedFields: [...skippedFieldSet],
      insertUpdateResultCount: persistedPayload.length
    }
  });
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

app.get('/api/admin/team', asyncRoute(async (req, res) => {
  if (!requireSupabase(res)) return;
  if (!requireAdmin(req, res)) return;
  const tournamentId = asInt(req.query.tournament_id);
  if (!tournamentId) return fail(res, 400, 'tournament_id er påkrevd');
  const { data, error } = await supabase.from('teams').select('*').eq('tournament_id', tournamentId).order('id');
  if (error) return fail(res, 500, 'Kunne ikke hente lag', error.message);
  return ok(res, { data: (data || []).map(mapTeamRowToCanonical) });
}));

app.put('/api/admin/team/:id', asyncRoute(async (req, res) => {
  if (!requireSupabase(res)) return;
  if (!requireAdmin(req, res)) return;
  const id = asInt(req.params.id); if (!id) return fail(res, 400, 'Ugyldig lag-ID');
  const b = req.body || {};
  const updates = {
    team_name: b.team_name,
    name: b.team_name,
    player1_name: b.player1_name,
    player1: b.player1_name,
    player2_name: b.player2_name,
    player2: b.player2_name,
    pin: b.pin,
    pin_code: b.pin,
    hcp_player1: asInt(b.hcp_player1) || 0,
    player1_hcp: asInt(b.hcp_player1) || 0,
    player1_handicap: asInt(b.hcp_player1) || 0,
    hcp_player2: asInt(b.hcp_player2) || 0,
    player2_hcp: asInt(b.hcp_player2) || 0,
    player2_handicap: asInt(b.hcp_player2) || 0
  };
  const { data, error } = await supabase.from('teams').update(updates).eq('id', id).select('*').single();
  if (error) return fail(res, 500, 'Kunne ikke oppdatere lag', error.message);
  return ok(res, { data: mapTeamRowToCanonical(data) });
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
  const teams = (data || []).map(mapTeamRowToCanonical);
  return ok(res, { teams, data: teams });
}));

app.post(['/api/teams', '/api/admin/team'], asyncRoute(async (req, res) => {
  if (!requireSupabase(res)) return;
  if (req.path.includes('/api/admin/') && !requireAdmin(req, res)) return;

  const b = (req.body && typeof req.body === 'object') ? req.body : {};
  const tournamentId = asInt(b.tournament_id);
  if (!tournamentId) return fail(res, 400, 'tournament_id er påkrevd');

  const team_name = String(b.team_name || '').trim();
  const player1_name = String(b.player1_name || '').trim();
  const player2_name = String(b.player2_name || '').trim();
  const pin = String(b.pin ?? '').trim();
  const hcp_player1 = asInt(b.hcp_player1) || 0;
  const hcp_player2 = asInt(b.hcp_player2) || 0;

  if (!team_name || !player1_name || !player2_name) return fail(res, 400, 'team_name, player1_name og player2_name er påkrevd');
  if (!/^\d{4}$/.test(pin)) return fail(res, 400, 'PIN må være nøyaktig 4 siffer');

  const insert = {
    tournament_id: tournamentId,
    team_name,
    name: team_name,
    player1_name,
    player1: player1_name,
    player2_name,
    player2: player2_name,
    pin,
    pin_code: pin,
    hcp_player1,
    player1_hcp: hcp_player1,
    player1_handicap: hcp_player1,
    hcp_player2,
    player2_hcp: hcp_player2,
    player2_handicap: hcp_player2
  };

  const { data, error } = await supabase.from('teams').insert(insert).select('*').single();
  if (error) return fail(res, 500, 'Kunne ikke opprette lag', error.message);
  return ok(res, { data: mapTeamRowToCanonical(data) }, 201);
}));

async function buildCanonicalScorecard(tournamentId, teamId) {
  const [teamResp, holesResp, scoresResp] = await Promise.all([
    supabase.from('teams').select('*').eq('id', teamId).maybeSingle(),
    supabase.from('tournament_holes').select('*').eq('tournament_id', tournamentId).order('hole_number', { ascending: true }),
    supabase.from('scores').select('*').eq('tournament_id', tournamentId).eq('team_id', teamId).order('hole_number', { ascending: true })
  ]);
  if (teamResp.error) throw new Error(teamResp.error.message);
  if (holesResp.error) throw new Error(holesResp.error.message);
  if (scoresResp.error) throw new Error(scoresResp.error.message);

  await ensureCanonicalTournamentHoles(tournamentId);
  const holesMap = new Map((holesResp.data || []).map((row) => [asInt(row.hole_number), toCanonicalHoleRow(row)]));
  const scoreMap = new Map((scoresResp.data || []).map((row) => [asInt(row.hole_number || row.hole), row]));

  const holes = Array.from({ length: 18 }, (_, idx) => {
    const holeNumber = idx + 1;
    const holeCfg = holesMap.get(holeNumber) || { hole_number: holeNumber, par: 4, stroke_index: holeNumber, requires_photo: false, is_longest_drive: false, is_nearest_pin: false };
    const score = scoreMap.get(holeNumber) || null;
    const strokes = asInt(score?.strokes ?? score?.score ?? null);
    return {
      ...holeCfg,
      strokes: Number.isInteger(strokes) && strokes > 0 ? strokes : null,
      completed: Number.isInteger(strokes) && strokes > 0
    };
  });

  const completedHoles = holes.filter((h) => h.completed).length;
  const totalHoles = holes.length;
  const team = mapTeamRowToCanonical(teamResp.data || {});

  return {
    team: {
      id: team.id,
      team_name: team.team_name,
      player1_name: team.player1_name,
      player2_name: team.player2_name,
      pin: team.pin
    },
    holes,
    is_round_complete: Boolean(team.locked) || (totalHoles > 0 && completedHoles === totalHoles),
    completed_holes: completedHoles,
    total_holes: totalHoles
  };
}

app.get('/api/scorecard/:tournamentId/:teamId', asyncRoute(async (req, res) => {
  if (!requireSupabase(res)) return;
  const tournamentId = asInt(req.params.tournamentId);
  const teamId = asInt(req.params.teamId);
  if (!tournamentId || !teamId) return fail(res, 400, 'Ugyldig tournamentId/teamId');
  const data = await buildCanonicalScorecard(tournamentId, teamId);
  return ok(res, { data });
}));

app.post('/api/scorecard/:tournamentId/:teamId', asyncRoute(async (req, res) => {
  if (!requireSupabase(res)) return;
  const tournamentId = asInt(req.params.tournamentId);
  const teamId = asInt(req.params.teamId);
  if (!tournamentId || !teamId) return fail(res, 400, 'Ugyldig tournamentId/teamId');

  const rows = Array.isArray(req.body?.holes) ? req.body.holes : [];
  const upsertRows = rows
    .map((row) => ({
      tournament_id: tournamentId,
      team_id: teamId,
      hole_number: asInt(row.hole_number),
      hole: asInt(row.hole_number),
      strokes: asInt(row.strokes),
      score: asInt(row.strokes),
      points: asInt(row.points),
      net_score: asInt(row.net_score),
      gross_score: asInt(row.gross_score)
    }))
    .filter((row) => row.hole_number >= 1 && row.hole_number <= 18 && Number.isInteger(row.strokes) && row.strokes > 0);

  if (upsertRows.length) {
    const { error } = await supabase.from('scores').upsert(upsertRows, { onConflict: 'team_id,tournament_id,hole_number' });
    if (error) return fail(res, 500, 'Kunne ikke lagre scorekort', error.message);
  }

  if (req.body?.lock_round === true) {
    const { error } = await supabase.from('teams').update({ locked: true }).eq('id', teamId);
    if (error) return fail(res, 500, 'Kunne ikke låse runden', error.message);
  }

  const data = await buildCanonicalScorecard(tournamentId, teamId);
  return ok(res, { data });
}));

app.get('/api/team/scorecard', asyncRoute(async (req, res) => {
  if (!requireSupabase(res)) return;
  const session = getTeamSession(req);
  if (!session?.team_id) return fail(res, 401, 'Ikke logget inn');

  const data = await buildCanonicalScorecard(asInt(session.tournament_id), asInt(session.team_id));
  const { data: claims } = await supabase.from('award_claims').select('*').eq('team_id', asInt(session.team_id));
  const scores = data.holes.filter((h) => h.strokes !== null).map((h) => ({ hole_number: h.hole_number, strokes: h.strokes, score: h.strokes }));

  return ok(res, {
    team: data.team,
    holes: data.holes,
    scores,
    claims: claims || [],
    completion_debug: {
      totalHoles: data.total_holes,
      holesWithValidScore: data.completed_holes,
      completionThreshold: data.total_holes,
      isRoundComplete: data.is_round_complete
    },
    is_round_complete: data.is_round_complete,
    completed_holes: data.completed_holes,
    total_holes: data.total_holes
  });
}));

app.post('/api/team/submit-score', asyncRoute(async (req, res) => {
  if (!requireSupabase(res)) return;
  const session = getTeamSession(req);
  if (!session?.team_id) return fail(res, 401, 'Ikke logget inn');
  const teamId = asInt(session.team_id); const tournamentId = asInt(session.tournament_id);
  const holeNumber = asInt(req.body?.hole_number); const score = asInt(req.body?.score);
  if (!holeNumber || !score) return fail(res, 400, 'hole_number og score er påkrevd');
  const payload = { team_id: teamId, tournament_id: tournamentId, hole_number: holeNumber, hole: holeNumber, score, strokes: score };
  const { data, error } = await supabase.from('scores').upsert(payload, { onConflict: 'team_id,tournament_id,hole_number' }).select('*').single();
  if (error) return fail(res, 500, 'Kunne ikke lagre score', error.message);
  return ok(res, { data: { hole_number: holeNumber, strokes: score, raw: data } });
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

app.post('/api/admin/uploads/coin-back', upload.single('photo'), asyncRoute(async (req, res) => {
  if (!requireSupabase(res)) return;
  if (!requireAdmin(req, res)) return;
  if (!req.file) return fail(res, 400, 'Ingen fil lastet opp');

  const extension = (req.file.originalname.split('.').pop() || 'jpg').toLowerCase();
  const filePath = `coin-back/back-${Date.now()}-${Math.round(Math.random() * 1e6)}.${extension}`;

  const uploadResult = await supabase.storage.from('tournament-gallery').upload(filePath, req.file.buffer, {
    contentType: req.file.mimetype || 'application/octet-stream',
    upsert: true
  });

  if (uploadResult.error) return fail(res, 500, uploadResult.error.message);

  const publicUrl = supabase.storage.from('tournament-gallery').getPublicUrl(filePath).data.publicUrl;

  const { data: activeRow, error: activeError } = await supabase
    .from('coin_back_images')
    .select('focal_point')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activeError) return fail(res, 500, activeError.message);

  const focalPoint = activeRow?.focal_point || '50% 50%';

  const deactivate = await supabase.from('coin_back_images').update({ is_active: false }).eq('is_active', true);
  if (deactivate.error) return fail(res, 500, deactivate.error.message);

  const insert = await supabase
    .from('coin_back_images')
    .insert({ photo_path: publicUrl, focal_point: focalPoint, is_active: true })
    .select('*')
    .single();

  if (insert.error) return fail(res, 500, insert.error.message);

  return ok(res, {
    data: {
      path: filePath,
      public_url: insert.data?.photo_path || publicUrl
    }
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
