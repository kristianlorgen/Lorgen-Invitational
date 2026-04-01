const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: true }));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SESSION_SECRET = process.env.SESSION_SECRET || process.env.AUTH_SECRET || 'dev-secret';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const GALLERY_BUCKET = process.env.SUPABASE_GALLERY_BUCKET || 'tournament-gallery';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

function ok(res, data = {}, status = 200) { return res.status(status).json({ success: true, ...data }); }
function fail(res, status, error, details) {
  return res.status(status).json({ success: false, error, ...(details ? { details } : {}) });
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

async function getActiveTournament() {
  const { data } = await supabase.from('tournaments').select('*').in('status', ['active', 'upcoming']).order('status', { ascending: true }).order('id').limit(1).maybeSingle();
  return data || null;
}

app.post('/api/auth/admin-login', asyncRoute(async (req, res) => {
  if (!ADMIN_PASSWORD) return fail(res, 500, 'ADMIN_PASSWORD er ikke satt');
  if (String(req.body?.password || '') !== ADMIN_PASSWORD) return fail(res, 401, 'Ugyldig innlogging');
  setCookie(res, 'admin_session', encode({ role: 'admin', exp: Date.now() + (8 * 60 * 60 * 1000) }), 8 * 60 * 60);
  return ok(res, { authenticated: true, type: 'admin', role: 'admin' });
}));

app.post('/api/auth/team-login', asyncRoute(async (req, res) => {
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

app.get('/api/auth/status', asyncRoute(async (req, res) => {
  const admin = getAdminSession(req);
  if (admin?.role === 'admin') return ok(res, { authenticated: true, type: 'admin', role: 'admin' });
  return fail(res, 401, 'Ikke logget inn');
}));

app.get('/api/admin/tournaments', asyncRoute(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { data, error } = await supabase.from('tournaments').select('*').order('id', { ascending: false });
  if (error) return fail(res, 500, 'Kunne ikke hente turneringer', error.message);
  return ok(res, { tournaments: data || [] });
}));

app.post(['/api/admin/tournaments', '/api/admin/tournament'], asyncRoute(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const body = req.body || {};
  if (!body.name || !body.course) return fail(res, 400, 'name og course er påkrevd');
  const payload = {
    name: String(body.name), course: String(body.course), status: body.status || 'upcoming',
    year: asInt(body.year), date: body.date || null, description: body.description || '', slope_rating: Number(body.slope_rating || 113)
  };
  const { data, error } = await supabase.from('tournaments').insert(payload).select('*').single();
  if (error) return fail(res, 500, 'Kunne ikke opprette turnering', error.message);
  return ok(res, { tournament: data }, 201);
}));

app.put('/api/admin/tournament/:id', asyncRoute(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = asInt(req.params.id); if (!id) return fail(res, 400, 'Ugyldig turnerings-ID');
  const { data, error } = await supabase.from('tournaments').update(req.body || {}).eq('id', id).select('*').single();
  if (error) return fail(res, 500, 'Kunne ikke oppdatere turnering', error.message);
  return ok(res, { tournament: data });
}));

app.delete('/api/admin/tournament/:id', asyncRoute(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = asInt(req.params.id); if (!id) return fail(res, 400, 'Ugyldig turnerings-ID');
  const { error } = await supabase.from('tournaments').delete().eq('id', id);
  if (error) return fail(res, 500, 'Kunne ikke slette turnering', error.message);
  return ok(res, { deleted: true });
}));

app.get('/api/admin/tournament/:id/teams', asyncRoute(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const tournamentId = asInt(req.params.id); if (!tournamentId) return fail(res, 400, 'Ugyldig turnerings-ID');
  const { data, error } = await supabase.from('teams').select('*').eq('tournament_id', tournamentId).order('id');
  if (error) return fail(res, 500, 'Kunne ikke hente lag', error.message);
  return ok(res, { teams: (data || []).map((t) => ({ ...t, team_name: t.team_name || t.name })) });
}));

app.get('/api/admin/tournament/:id/scores', asyncRoute(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const tournamentId = asInt(req.params.id); if (!tournamentId) return fail(res, 400, 'Ugyldig turnerings-ID');
  const { data, error } = await supabase.from('scores').select('*').eq('tournament_id', tournamentId).order('hole_number');
  if (error) return fail(res, 500, 'Kunne ikke hente score', error.message);
  return ok(res, { scores: data || [] });
}));

app.post(['/api/teams', '/api/admin/team'], asyncRoute(async (req, res) => {
  if (req.path.includes('/api/admin/') && !requireAdmin(req, res)) return;
  const b = req.body || {};
  const tournamentId = asInt(b.tournament_id);
  if (!tournamentId) return fail(res, 400, 'tournament_id er påkrevd');
  const payload = {
    tournament_id: tournamentId,
    name: b.name || b.team_name || null,
    team_name: b.team_name || b.name || null,
    player1: b.player1 || null,
    player2: b.player2 || null,
    pin_code: String(b.pin_code || b.pin || ''),
    player1_hcp: asInt(b.player1_hcp ?? b.player1_handicap),
    player2_hcp: asInt(b.player2_hcp ?? b.player2_handicap),
    player1_handicap: asInt(b.player1_handicap ?? b.player1_hcp),
    player2_handicap: asInt(b.player2_handicap ?? b.player2_hcp)
  };
  if (!payload.team_name || !payload.pin_code) return fail(res, 400, 'team_name og pin_code er påkrevd');
  const { data, error } = await supabase.from('teams').insert(payload).select('*').single();
  if (error) return fail(res, 500, 'Kunne ikke opprette lag', error.message);
  return ok(res, { team: data }, 201);
}));

app.put('/api/admin/team/:id', asyncRoute(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = asInt(req.params.id); if (!id) return fail(res, 400, 'Ugyldig lag-ID');
  const { data, error } = await supabase.from('teams').update(req.body || {}).eq('id', id).select('*').single();
  if (error) return fail(res, 500, 'Kunne ikke oppdatere lag', error.message);
  return ok(res, { team: data });
}));

app.delete(['/api/teams/:id', '/api/admin/team/:id'], asyncRoute(async (req, res) => {
  if (req.path.includes('/api/admin/') && !requireAdmin(req, res)) return;
  const id = asInt(req.params.id); if (!id) return fail(res, 400, 'Ugyldig lag-ID');
  const { error } = await supabase.from('teams').delete().eq('id', id);
  if (error) return fail(res, 500, 'Kunne ikke slette lag', error.message);
  return ok(res, { deleted: true });
}));

app.get('/api/teams', asyncRoute(async (req, res) => {
  const tournamentId = asInt(req.query.tournament_id || req.query.tournamentId);
  if (!tournamentId) return fail(res, 400, 'tournament_id er påkrevd');
  const { data, error } = await supabase.from('teams').select('*').eq('tournament_id', tournamentId).order('id');
  if (error) return fail(res, 500, 'Kunne ikke hente lag', error.message);
  return ok(res, { teams: data || [] });
}));

app.get('/api/team/scorecard', asyncRoute(async (req, res) => {
  const session = getTeamSession(req);
  if (!session?.team_id) return fail(res, 401, 'Ikke logget inn');
  const teamId = asInt(session.team_id); const tournamentId = asInt(session.tournament_id);

  const [teamResp, holeResp, scoreResp, claimResp] = await Promise.all([
    supabase.from('teams').select('*').eq('id', teamId).maybeSingle(),
    supabase.from('holes').select('*').eq('tournament_id', tournamentId).order('hole_number'),
    supabase.from('scores').select('*').eq('team_id', teamId),
    supabase.from('award_claims').select('*').eq('team_id', teamId)
  ]);
  if (teamResp.error || holeResp.error || scoreResp.error || claimResp.error) return fail(res, 500, 'Kunne ikke hente scorekort');

  const { data: tournament } = await supabase.from('tournaments').select('*').eq('id', tournamentId).maybeSingle();
  const scores = (scoreResp.data || []).map((s) => ({ ...s, hole_number: s.hole_number || s.hole, score: s.score || s.strokes }));
  return ok(res, { team: teamResp.data, tournament, holes: holeResp.data || [], scores, claims: claimResp.data || [] });
}));

app.post('/api/team/submit-score', asyncRoute(async (req, res) => {
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
  const session = getTeamSession(req);
  if (!session?.team_id) return fail(res, 401, 'Ikke logget inn');
  const { data, error } = await supabase.from('scores').select('*').eq('team_id', asInt(session.team_id)).order('hole_number');
  if (error) return fail(res, 500, 'Kunne ikke hente fullstendig scorekort', error.message);
  return ok(res, { scores: data || [] });
}));

app.post('/api/team/lock-scorecard', asyncRoute(async (req, res) => {
  const session = getTeamSession(req);
  if (!session?.team_id) return fail(res, 401, 'Ikke logget inn');
  const { data, error } = await supabase.from('teams').update({ locked: true }).eq('id', asInt(session.team_id)).select('*').single();
  if (error) return fail(res, 500, 'Kunne ikke låse scorekort', error.message);
  return ok(res, { team: data });
}));

app.post('/api/team/claim-award', asyncRoute(async (req, res) => {
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
  const session = getTeamSession(req);
  if (!session?.tournament_id) return fail(res, 401, 'Ikke logget inn');
  const { data, error } = await supabase.from('chat_messages').select('*').eq('tournament_id', asInt(session.tournament_id)).order('id').limit(100);
  if (error) return fail(res, 500, 'Kunne ikke hente chat', error.message);
  return ok(res, { messages: data || [] });
}));

app.post('/api/chat/send', upload.single('image'), asyncRoute(async (req, res) => {
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
  const session = getTeamSession(req);
  if (!session?.team_id) return fail(res, 401, 'Ikke logget inn');
  const { data: team } = await supabase.from('teams').select('*').eq('id', asInt(session.team_id)).maybeSingle();
  const message = `⛳ ${req.body?.note || 'Alle spillere må ta birdie shots! 🥃'}`;
  const { data, error } = await supabase.from('chat_messages').insert({
    tournament_id: asInt(session.tournament_id), team_id: asInt(session.team_id),
    team_name: team?.team_name || team?.name || 'Lag', message, event_type: 'birdie_shot', created_at: new Date().toISOString()
  }).select('*').single();
  if (error) return fail(res, 500, 'Kunne ikke sende birdie shoutout', error.message);
  return ok(res, { shoutout: data }, 201);
}));

app.get('/api/gallery', asyncRoute(async (req, res) => {
  const tournamentId = asInt(req.query.tournament_id);
  let query = supabase.from('tournament_gallery_images').select('*').order('uploaded_at', { ascending: false }).limit(200);
  if (tournamentId) query = query.eq('tournament_id', tournamentId);
  const { data, error } = await query;
  if (error) return fail(res, 500, 'Kunne ikke hente galleri', error.message);
  return ok(res, { photos: data || [] });
}));

async function handleHoleUpload(req, res) {
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
  const tournament = await getActiveTournament();
  return ok(res, { tournament });
}));
app.get('/api/sponsors', asyncRoute(async (req, res) => {
  const tournament = await getActiveTournament();
  if (!tournament) return ok(res, { sponsors: [] });
  let query = supabase.from('sponsors').select('*').eq('tournament_id', asInt(tournament.id)).order('position');
  if (req.query.placement) query = query.eq('placement', req.query.placement);
  const { data, error } = await query;
  if (error) return fail(res, 500, 'Kunne ikke hente sponsorer', error.message);
  return ok(res, { sponsors: data || [] });
}));
app.get('/api/legacy', asyncRoute(async (_req, res) => {
  const { data, error } = await supabase.from('legacy').select('*').order('year', { ascending: false });
  if (error) return fail(res, 500, 'Kunne ikke hente historikk', error.message);
  return ok(res, { legacy: data || [] });
}));
app.get('/api/admin/legacy', asyncRoute(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { data, error } = await supabase.from('legacy').select('*').order('year', { ascending: false });
  if (error) return fail(res, 500, 'Kunne ikke hente historikk', error.message);
  return ok(res, { legacy: data || [] });
}));
app.get('/api/coin-back', asyncRoute(async (_req, res) => {
  const { data, error } = await supabase.from('site_assets').select('*').eq('key', 'coin_back').maybeSingle();
  if (error) return ok(res, { coin_back: null });
  return ok(res, { coin_back: data?.value || null });
}));
app.get('/api/scoreboard', asyncRoute(async (_req, res) => {
  const tournament = await getActiveTournament();
  if (!tournament) return ok(res, { tournament: null, holes: [], scoreboard: [], awards: [] });

  const [teamsResp, holesResp, scoreResp, awardsResp] = await Promise.all([
    supabase.from('teams').select('*').eq('tournament_id', asInt(tournament.id)).order('id'),
    supabase.from('holes').select('*').eq('tournament_id', asInt(tournament.id)).order('hole_number'),
    supabase.from('scores').select('*').eq('tournament_id', asInt(tournament.id)),
    supabase.from('awards').select('*,teams(team_name,name)').eq('tournament_id', asInt(tournament.id)),
  ]);
  if (teamsResp.error || holesResp.error || scoreResp.error || awardsResp.error) return fail(res, 500, 'Kunne ikke hente scoreboard');

  const teams = teamsResp.data || [];
  const holes = holesResp.data || [];
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

module.exports = app;
module.exports.default = (req, res) => app(req, res);
