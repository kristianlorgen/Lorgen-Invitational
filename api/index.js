const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

const DISK_STORAGE_ERROR = 'Disk storage not allowed on Vercel';

function installDiskWriteGuards() {
  const blockedFsMethods = [
    'appendFile', 'appendFileSync',
    'chmod', 'chmodSync',
    'chown', 'chownSync',
    'copyFile', 'copyFileSync',
    'cp', 'cpSync',
    'createWriteStream',
    'link', 'linkSync',
    'mkdir', 'mkdirSync',
    'mkdtemp', 'mkdtempSync',
    'open', 'openSync',
    'rename', 'renameSync',
    'rm', 'rmSync',
    'rmdir', 'rmdirSync',
    'symlink', 'symlinkSync',
    'truncate', 'truncateSync',
    'unlink', 'unlinkSync',
    'utimes', 'utimesSync',
    'writeFile', 'writeFileSync'
  ];
  for (const name of blockedFsMethods) {
    if (typeof fs[name] === 'function') {
      fs[name] = () => { throw new Error(DISK_STORAGE_ERROR); };
    }
  }
  if (fs.promises) {
    for (const name of blockedFsMethods) {
      if (typeof fs.promises[name] === 'function') {
        fs.promises[name] = async () => { throw new Error(DISK_STORAGE_ERROR); };
      }
    }
  }
}

installDiskWriteGuards();

function nowMs() { return Date.now(); }

app.use((req, res, next) => {
  const start = nowMs();
  res.on('finish', () => {
    const elapsed = nowMs() - start;
    console.log(`[api] ${req.method} ${req.path} -> ${res.statusCode} (${elapsed}ms)`);
  });
  next();
});

function ok(res, data = {}, status = 200) {
  return res.status(status).json({ success: true, ...data });
}

function fail(res, status, error, details) {
  return res.status(status).json({ success: false, error, ...(details ? { details } : {}) });
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  raw.split(';').forEach((entry) => {
    const i = entry.indexOf('=');
    if (i > -1) out[entry.slice(0, i).trim()] = decodeURIComponent(entry.slice(i + 1).trim());
  });
  return out;
}

function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
}

function encode(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

function decode(token) {
  if (!token || typeof token !== 'string') return null;
  const [body, signature] = token.split('.');
  if (!body || !signature || sign(body) !== signature) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!data.exp || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

function setCookie(res, name, value, maxAgeSeconds) {
  const attrs = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Secure',
    `Max-Age=${maxAgeSeconds}`
  ];
  res.append('Set-Cookie', attrs.join('; '));
}

function clearCookie(res, name) {
  res.append('Set-Cookie', `${name}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`);
}

function getTeamSession(req) {
  const cookies = parseCookies(req);
  return decode(cookies.team_session);
}

function getAdminSession(req) {
  const cookies = parseCookies(req);
  return decode(cookies.admin_session);
}

function requireAdmin(req, res) {
  const session = getAdminSession(req);
  if (session?.role === 'admin') return true;
  fail(res, 401, 'Admin authentication required');
  return false;
}

function activeTournamentQuery() {
  return supabase
    .from('tournaments')
    .select('*')
    .or('status.eq.active,status.eq.upcoming')
    .order('date', { ascending: true })
    .limit(1)
    .maybeSingle();
}

function asInt(v) {
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function asyncRoute(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      console.error(`[api:error] ${req.method} ${req.path}`, error);
      fail(res, 500, 'Uventet serverfeil');
    }
  };
}

app.post('/api/auth/admin-login', asyncRoute(async (req, res) => {
  if (!ADMIN_PASSWORD) return fail(res, 500, 'ADMIN_PASSWORD er ikke satt');
  if (req.body?.password !== ADMIN_PASSWORD) return fail(res, 401, 'Ugyldig innlogging');
  const payload = { role: 'admin', exp: Date.now() + 8 * 60 * 60 * 1000 };
  setCookie(res, 'admin_session', encode(payload), 8 * 60 * 60);
  ok(res, { authenticated: true, role: 'admin' });
}));

app.post('/api/auth/team-login', asyncRoute(async (req, res) => {
  const pin = String(req.body?.pin || '').trim();
  if (!/^\d{4}$/.test(pin)) return fail(res, 400, 'PIN må være nøyaktig 4 siffer');

  const { data: team, error } = await supabase
    .from('teams')
    .select('id,tournament_id,name,pin,pin_code')
    .or(`pin.eq.${pin},pin_code.eq.${pin}`)
    .limit(1)
    .maybeSingle();

  if (error) return fail(res, 500, 'Kunne ikke sjekke PIN', error.message);
  if (!team) return fail(res, 401, 'Ugyldig PIN');

  const payload = {
    type: 'team',
    team_id: String(team.id),
    tournament_id: String(team.tournament_id),
    pin,
    exp: Date.now() + 12 * 60 * 60 * 1000
  };

  setCookie(res, 'team_session', encode(payload), 12 * 60 * 60);
  ok(res, { authenticated: true, type: 'team', team_id: team.id, tournament_id: team.tournament_id, pin });
}));

app.post('/api/auth/logout', asyncRoute(async (_req, res) => {
  clearCookie(res, 'admin_session');
  clearCookie(res, 'team_session');
  ok(res, { loggedOut: true });
}));

app.get('/api/auth/status', asyncRoute(async (req, res) => {
  const admin = getAdminSession(req);
  if (admin?.role === 'admin') return ok(res, { authenticated: true, type: 'admin', role: 'admin' });

  const team = getTeamSession(req);
  if (team?.team_id && team?.tournament_id) {
    return ok(res, {
      authenticated: true,
      type: 'team',
      team_id: team.team_id,
      tournament_id: team.tournament_id,
      pin: team.pin
    });
  }
  return fail(res, 401, 'Ikke logget inn');
}));

app.get('/api/admin/tournaments', asyncRoute(async (_req, res) => {
  if (!requireAdmin(_req, res)) return;
  const { data, error } = await supabase.from('tournaments').select('*').order('created_at', { ascending: false });
  if (error) return fail(res, 500, 'Kunne ikke hente turneringer', error.message);
  ok(res, { tournaments: data || [] });
}));

app.post(['/api/admin/tournaments', '/api/admin/tournament'], asyncRoute(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const body = req.body || {};
  if (!body.name || !body.course) return fail(res, 400, 'name og course er påkrevd');
  const payload = {
    name: body.name,
    course: body.course,
    status: body.status || 'upcoming',
    ...(asInt(body.year) ? { year: asInt(body.year) } : {}),
    ...(body.date ? { date: body.date } : {}),
    ...(typeof body.description === 'string' ? { description: body.description } : {}),
    ...(Number.isFinite(Number(body.slope_rating)) ? { slope_rating: Number(body.slope_rating) } : {})
  };
  const { data, error } = await supabase.from('tournaments').insert(payload).select('*').single();
  if (error) return fail(res, 500, 'Kunne ikke opprette turnering', error.message);
  ok(res, { tournament: data }, 201);
}));

app.put('/api/admin/tournament/:id', asyncRoute(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = asInt(req.params.id);
  if (!id) return fail(res, 400, 'Ugyldig turnerings-ID');
  const { data, error } = await supabase.from('tournaments').update(req.body || {}).eq('id', id).select('*').single();
  if (error) return fail(res, 500, 'Kunne ikke oppdatere turnering', error.message);
  ok(res, { tournament: data });
}));

app.delete('/api/admin/tournament/:id', asyncRoute(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = asInt(req.params.id);
  if (!id) return fail(res, 400, 'Ugyldig turnerings-ID');
  const { error } = await supabase.from('tournaments').delete().eq('id', id);
  if (error) return fail(res, 500, 'Kunne ikke slette turnering', error.message);
  ok(res, { success: true });
}));

app.get('/api/teams', asyncRoute(async (req, res) => {
  const tournamentId = asInt(req.query.tournament_id || req.query.tournamentId);
  if (!tournamentId) return fail(res, 400, 'tournament_id er påkrevd');
  const { data, error } = await supabase.from('teams').select('*').eq('tournament_id', tournamentId).order('id');
  if (error) return fail(res, 500, 'Kunne ikke hente lag', error.message);
  ok(res, { teams: data || [] });
}));

app.post('/api/teams', asyncRoute(async (req, res) => {
  const body = req.body || {};
  const tournamentId = asInt(body.tournament_id);
  const teamName = body.name || body.team_name;
  if (!tournamentId || !teamName) return fail(res, 400, 'tournament_id og name/team_name er påkrevd');
  const insert = {
    tournament_id: tournamentId,
    name: String(teamName),
    pin_code: body.pin_code || body.pin || null,
    player1_hcp: asInt(body.player1_hcp ?? body.player1_handicap),
    player2_hcp: asInt(body.player2_hcp ?? body.player2_handicap)
  };
  const { data, error } = await supabase.from('teams').insert(insert).select('*').single();
  if (error) return fail(res, 500, 'Kunne ikke opprette lag', error.message);
  ok(res, { team: data }, 201);
}));

app.delete('/api/teams/:id', asyncRoute(async (req, res) => {
  const id = asInt(req.params.id);
  if (!id) return fail(res, 400, 'Ugyldig lag-ID');
  const { error } = await supabase.from('teams').delete().eq('id', id);
  if (error) return fail(res, 500, 'Kunne ikke slette lag', error.message);
  ok(res, { success: true });
}));

app.get('/api/team/scorecard', asyncRoute(async (req, res) => {
  const session = getTeamSession(req);
  if (!session?.team_id || !session?.tournament_id) return fail(res, 401, 'Ikke logget inn');

  const [teamResp, scoreResp] = await Promise.all([
    supabase.from('teams').select('*').eq('id', Number(session.team_id)).maybeSingle(),
    supabase.from('scores').select('*').eq('team_id', Number(session.team_id)).order('hole_number', { ascending: true })
  ]);
  if (teamResp.error) return fail(res, 500, 'Kunne ikke hente lag', teamResp.error.message);
  if (scoreResp.error) return fail(res, 500, 'Kunne ikke hente scorekort', scoreResp.error.message);
  ok(res, { team: teamResp.data, scores: scoreResp.data || [] });
}));

app.post('/api/team/submit-score', asyncRoute(async (req, res) => {
  const session = getTeamSession(req);
  if (!session?.team_id || !session?.tournament_id) return fail(res, 401, 'Ikke logget inn');

  const holeNumber = asInt(req.body?.hole_number);
  const score = asInt(req.body?.score);
  if (!holeNumber || !score) return fail(res, 400, 'hole_number og score er påkrevd');

  const { data, error } = await supabase
    .from('scores')
    .upsert({
      team_id: Number(session.team_id),
      tournament_id: Number(session.tournament_id),
      hole_number: holeNumber,
      score,
      submitted_at: new Date().toISOString()
    }, { onConflict: 'team_id,tournament_id,hole_number' })
    .select('*')
    .single();

  if (error) return fail(res, 500, 'Kunne ikke lagre score', error.message);
  ok(res, { score: data });
}));

app.post('/api/team/claim-award', asyncRoute(async (req, res) => {
  const session = getTeamSession(req);
  if (!session?.team_id || !session?.tournament_id) return fail(res, 401, 'Ikke logget inn');
  const payload = {
    tournament_id: Number(session.tournament_id),
    team_id: Number(session.team_id),
    hole_number: asInt(req.body?.hole_number) || 0,
    award_type: String(req.body?.award_type || ''),
    player_name: req.body?.player_name || null,
    detail: req.body?.detail || req.body?.value || null,
    claimed_at: new Date().toISOString()
  };
  if (!payload.award_type) return fail(res, 400, 'award_type er påkrevd');
  const { data, error } = await supabase.from('award_claims').insert(payload).select('*').single();
  if (error) return fail(res, 500, 'Kunne ikke registrere utmerkelse', error.message);
  ok(res, { claim: data }, 201);
}));

app.get('/api/chat/messages', asyncRoute(async (req, res) => {
  const session = getTeamSession(req);
  if (!session?.tournament_id) return fail(res, 401, 'Ikke logget inn');
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('tournament_id', Number(session.tournament_id))
    .order('created_at', { ascending: true })
    .limit(100);
  if (error) return fail(res, 500, 'Kunne ikke hente chat', error.message);
  ok(res, { messages: data || [] });
}));

app.post('/api/chat/send', upload.single('image'), asyncRoute(async (req, res) => {
  const session = getTeamSession(req);
  if (!session?.team_id || !session?.tournament_id) return fail(res, 401, 'Ikke logget inn');

  let imagePath = null;
  if (req.file) {
    const ext = (req.file.originalname.split('.').pop() || 'jpg').toLowerCase();
    const storagePath = `chat/${session.tournament_id}/${session.team_id}/${Date.now()}-${Math.round(Math.random() * 1e6)}.${ext}`;
    const uploadResult = await supabase.storage.from('tournament-gallery').upload(storagePath, req.file.buffer, {
      contentType: req.file.mimetype || 'application/octet-stream', upsert: true
    });
    if (uploadResult.error) return fail(res, 500, 'Kunne ikke laste opp bilde', uploadResult.error.message);
    imagePath = supabase.storage.from('tournament-gallery').getPublicUrl(storagePath).data.publicUrl;
  }

  const teamName = req.body?.team_name || null;
  const message = req.body?.message ? String(req.body.message) : null;
  if (!message && !imagePath) return fail(res, 400, 'Melding eller bilde er påkrevd');

  const { data, error } = await supabase.from('chat_messages').insert({
    tournament_id: Number(session.tournament_id),
    team_id: Number(session.team_id),
    team_name: teamName,
    message,
    image_path: imagePath,
    created_at: new Date().toISOString()
  }).select('*').single();

  if (error) return fail(res, 500, 'Kunne ikke sende chatmelding', error.message);
  ok(res, { message: data }, 201);
}));

app.post('/api/team/birdie-shot', asyncRoute(async (req, res) => {
  const session = getTeamSession(req);
  if (!session?.team_id || !session?.tournament_id) return fail(res, 401, 'Ikke logget inn');
  const note = req.body?.note ? String(req.body.note) : 'Birdie shoutout!';
  const { data, error } = await supabase.from('chat_messages').insert({
    tournament_id: Number(session.tournament_id),
    team_id: Number(session.team_id),
    team_name: req.body?.team_name || null,
    note,
    message: `⛳ ${note}`,
    created_at: new Date().toISOString()
  }).select('*').single();
  if (error) return fail(res, 500, 'Kunne ikke sende birdie shoutout', error.message);
  ok(res, { shoutout: data }, 201);
}));

app.get('/api/gallery', asyncRoute(async (_req, res) => {
  const { data, error } = await supabase
    .from('tournament_gallery_images')
    .select('*')
    .eq('is_published', true)
    .order('uploaded_at', { ascending: false })
    .limit(50);
  if (error) return fail(res, 500, 'Kunne ikke hente galleri', error.message);
  ok(res, { photos: data || [] });
}));

async function handleHoleUpload(req, res) {
  const session = getTeamSession(req);
  if (!session?.team_id || !session?.tournament_id) return fail(res, 401, 'Ikke logget inn');
  const holeNumber = asInt(req.params.holeNum || req.body?.hole_number);
  if (!holeNumber) return fail(res, 400, 'hole_number er påkrevd');
  if (!req.file) return fail(res, 400, 'Ingen fil lastet opp');

  const ext = (req.file.originalname.split('.').pop() || 'jpg').toLowerCase();
  const storagePath = `holes/${session.tournament_id}/${session.team_id}/hole-${holeNumber}-${Date.now()}.${ext}`;
  const uploadResult = await supabase.storage.from('tournament-gallery').upload(storagePath, req.file.buffer, {
    contentType: req.file.mimetype || 'application/octet-stream', upsert: true
  });
  if (uploadResult.error) return fail(res, 500, 'Kunne ikke laste opp bilde', uploadResult.error.message);

  const publicUrl = supabase.storage.from('tournament-gallery').getPublicUrl(storagePath).data.publicUrl;

  const { data, error } = await supabase.from('hole_images').insert({
    tournament_id: Number(session.tournament_id),
    team_id: Number(session.team_id),
    hole_number: holeNumber,
    photo_path: publicUrl,
    storage_path: storagePath,
    created_at: new Date().toISOString()
  }).select('*').single();

  if (error) return fail(res, 500, 'Kunne ikke lagre bilde', error.message);
  ok(res, { image: data, photo_path: publicUrl }, 201);
}

app.post('/api/upload/hole-photo', upload.single('photo'), asyncRoute(handleHoleUpload));
app.post('/api/team/upload-photo/:holeNum', upload.single('photo'), asyncRoute(handleHoleUpload));

app.all('/api/*rest', (req, res) => fail(res, 404, 'API route not found'));

module.exports = app;
module.exports.default = (req, res) => app(req, res);
