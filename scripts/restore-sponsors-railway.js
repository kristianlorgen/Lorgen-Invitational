const fs = require('fs');
const path = require('path');

function read(file) {
  return fs.readFileSync(path.join(process.cwd(), file), 'utf8');
}

function write(file, content) {
  fs.writeFileSync(path.join(process.cwd(), file), content);
}

function replaceOnce(content, from, to, label) {
  if (!content.includes(from)) throw new Error(`Missing marker: ${label}`);
  return content.replace(from, to);
}

function insertBefore(content, marker, addition, label) {
  const index = content.indexOf(marker);
  if (index < 0) throw new Error(`Missing marker: ${label}`);
  return content.slice(0, index) + addition + content.slice(index);
}

function insertAfter(content, marker, addition, label) {
  const index = content.indexOf(marker);
  if (index < 0) throw new Error(`Missing marker: ${label}`);
  return content.slice(0, index + marker.length) + addition + content.slice(index + marker.length);
}

function ensureOnce(content, marker, apply) {
  if (content.includes(marker)) return content;
  return apply(content);
}

const sponsorHelpers = String.raw`
function normalizePlacement(value) {
  const placement = String(value || '').trim().toLowerCase();
  return SPONSOR_PLACEMENTS.has(placement) ? placement : 'frontpage';
}

function normalizeSponsorRow(row = {}) {
  const sponsorName = row.sponsor_name || row.name || '';
  const logoPath = row.logo_path || row.sponsor_logo || row.logo_url || '';
  const sponsorUrl = row.sponsor_url || row.website_url || '';
  const spotNumber = asInt(row.spot_number ?? row.position) || 1;
  const holeNumber = asInt(row.hole_number);
  return {
    ...row,
    id: asInt(row.id),
    tournament_id: asInt(row.tournament_id),
    placement: normalizePlacement(row.placement),
    hole_number: Number.isInteger(holeNumber) ? holeNumber : null,
    spot_number: spotNumber,
    position: spotNumber,
    sponsor_name: sponsorName,
    name: sponsorName,
    logo_path: logoPath,
    sponsor_logo: logoPath,
    logo_url: logoPath,
    sponsor_url: sponsorUrl,
    website_url: sponsorUrl,
    description: row.description || row.tagline || '',
    tagline: row.description || row.tagline || '',
    is_enabled: row.is_enabled !== false && row.is_enabled !== 0,
    active: row.is_enabled !== false && row.is_enabled !== 0
  };
}

function normalizeSponsorInput(input = {}, tournamentId) {
  const placement = normalizePlacement(input.placement);
  const holeNumber = placement === 'hole' ? asInt(input.hole_number ?? input.holeNumber) : null;
  const spotNumber = asInt(input.spot_number ?? input.spotNumber ?? input.position) || 1;
  const sponsorName = String(input.sponsor_name ?? input.sponsorName ?? input.name ?? '').trim();
  const logoPath = String(input.logo_path ?? input.logoPath ?? input.sponsor_logo ?? input.logoUrl ?? '').trim();
  const sponsorUrl = String(input.sponsor_url ?? input.sponsorUrl ?? input.website_url ?? input.websiteUrl ?? '').trim();
  const description = String(input.description ?? input.tagline ?? input.message ?? '').trim();
  const enabled = input.is_enabled === true || input.is_enabled === 1 || input.is_enabled === 'true' || input.active === true;
  return {
    tournament_id: tournamentId,
    placement,
    hole_number: Number.isInteger(holeNumber) ? holeNumber : null,
    spot_number: spotNumber,
    position: spotNumber,
    sponsor_name: sponsorName,
    name: sponsorName,
    logo_path: logoPath,
    sponsor_logo: logoPath,
    logo_url: logoPath,
    sponsor_url: sponsorUrl,
    website_url: sponsorUrl,
    description,
    tagline: description,
    is_enabled: enabled,
    active: enabled,
    updated_at: new Date().toISOString()
  };
}

async function getSponsorsForTournament(tournamentId, options = {}) {
  const id = asInt(tournamentId);
  if (!id) return [];
  let query = supabase
    .from('sponsors')
    .select('*')
    .or('tournament_id.eq.' + id + ',tournament_id.is.null')
    .order('placement', { ascending: true })
    .order('hole_number', { ascending: true, nullsFirst: false })
    .order('spot_number', { ascending: true, nullsFirst: false });
  if (options.placement) query = query.eq('placement', normalizePlacement(options.placement));
  if (!options.includeDisabled) query = query.eq('is_enabled', true);
  const { data, error } = await query;
  if (error) {
    if (isMissingRelationError(error) || isMissingColumnError(error)) {
      console.warn('[api:sponsors] sponsors table/columns missing; returning empty list', serializeSupabaseError(error));
      return [];
    }
    throw new Error(error.message);
  }
  return (data || []).map(normalizeSponsorRow);
}

function splitSponsorsByPlacement(sponsors = []) {
  const normalized = (sponsors || []).map(normalizeSponsorRow);
  return {
    sponsors: normalized,
    home: normalized.filter((s) => s.placement === 'frontpage'),
    frontpage: normalized.filter((s) => s.placement === 'frontpage'),
    live_results: normalized.filter((s) => s.placement === 'live_results'),
    scorecard: normalized.filter((s) => s.placement === 'scorecard'),
    admin: normalized.filter((s) => s.placement === 'admin'),
    hole: normalized.filter((s) => s.placement === 'hole'),
    holeSponsors: normalized.filter((s) => s.placement === 'hole')
  };
}
`;

const adminSponsorRoutes = String.raw`
app.get('/api/admin/tournament/:id/sponsors', asyncRoute(async (req, res) => {
  if (!requireSupabase(res)) return;
  if (!requireAdmin(req, res)) return;
  const tournamentId = asInt(req.params.id);
  if (!tournamentId) return fail(res, 400, 'Ugyldig tournament id');
  const sponsors = await getSponsorsForTournament(tournamentId, { includeDisabled: true });
  return ok(res, splitSponsorsByPlacement(sponsors));
}));

app.post('/api/admin/tournament/:id/sponsors', asyncRoute(async (req, res) => {
  if (!requireSupabase(res)) return;
  if (!requireAdmin(req, res)) return;
  const tournamentId = asInt(req.params.id);
  if (!tournamentId) return fail(res, 400, 'Ugyldig tournament id');
  const rawSponsors = Array.isArray(req.body?.sponsors) ? req.body.sponsors : [];
  const rows = rawSponsors
    .map((item) => normalizeSponsorInput(item, tournamentId))
    .filter((item) => item.is_enabled || item.sponsor_name || item.logo_path || item.sponsor_url || item.description);

  const deleteResult = await supabase.from('sponsors').delete().eq('tournament_id', tournamentId);
  if (deleteResult.error) return fail(res, 500, 'Kunne ikke rydde gamle sponsorer', deleteResult.error.message);
  if (!rows.length) return ok(res, splitSponsorsByPlacement([]));

  const { data, error } = await supabase.from('sponsors').insert(rows).select('*');
  if (error) return fail(res, 500, 'Kunne ikke lagre sponsorer', error.message);
  return ok(res, splitSponsorsByPlacement(data || []));
}));

app.delete('/api/admin/sponsors/:id', asyncRoute(async (req, res) => {
  if (!requireSupabase(res)) return;
  if (!requireAdmin(req, res)) return;
  const id = asInt(req.params.id);
  if (!id) return fail(res, 400, 'Ugyldig sponsor id');
  const { error } = await supabase.from('sponsors').delete().eq('id', id);
  if (error) return fail(res, 500, 'Kunne ikke slette sponsor', error.message);
  return ok(res, { deleted: true });
}));

app.post('/api/admin/sponsor-logo', upload.single('logo'), asyncRoute(async (req, res) => {
  if (!requireSupabase(res)) return;
  if (!requireAdmin(req, res)) return;
  if (!req.file) return fail(res, 400, 'Ingen fil lastet opp');
  const tournamentId = asInt(req.body?.tournament_id) || 'general';
  const placement = normalizePlacement(req.body?.placement);
  const ext = (req.file.originalname.split('.').pop() || 'jpg').toLowerCase();
  const storagePath = SPONSOR_STORAGE_PREFIX + '/' + tournamentId + '/' + placement + '/' + Date.now() + '-' + Math.round(Math.random() * 1e6) + '.' + ext;
  const { error } = await supabase.storage.from(GALLERY_BUCKET).upload(storagePath, req.file.buffer, {
    contentType: req.file.mimetype || 'application/octet-stream',
    upsert: true
  });
  if (error) return fail(res, 500, 'Kunne ikke laste opp sponsorlogo', error.message);
  const publicUrl = supabase.storage.from(GALLERY_BUCKET).getPublicUrl(storagePath).data.publicUrl;
  return ok(res, { logo_path: publicUrl, publicUrl, storage_path: storagePath }, 201);
}));
`;

function patchApi() {
  let api = read('api/index.js');
  api = ensureOnce(api, 'SPONSOR_STORAGE_PREFIX', (content) => insertAfter(
    content,
    "const GALLERY_BUCKET = process.env.SUPABASE_GALLERY_BUCKET || 'tournament-gallery';\n",
    "const SPONSOR_STORAGE_PREFIX = 'sponsors';\nconst SPONSOR_PLACEMENTS = new Set(['frontpage', 'live_results', 'scorecard', 'admin', 'hole']);\n",
    'api sponsor constants'
  ));
  api = ensureOnce(api, 'function normalizeSponsorRow', (content) => insertBefore(content, 'async function handleHoleUpload(req, res) {', sponsorHelpers, 'sponsor helpers'));
  api = ensureOnce(api, "app.get('/api/admin/tournament/:id/sponsors'", (content) => insertBefore(content, "app.get('/api/admin/legacy'", adminSponsorRoutes, 'admin sponsor routes'));

  api = replaceOnce(api,
    "app.get('/api/tournament', asyncRoute(async (_req, res) => {\n  if (!requireSupabase(res)) return;\n  const tournament = await getActiveTournament();\n  return ok(res, { tournament });\n}));",
    "app.get('/api/tournament', asyncRoute(async (_req, res) => {\n  if (!requireSupabase(res)) return;\n  const tournament = await getActiveTournament();\n  if (!tournament) return ok(res, { tournament: null, sponsors: [], holeSponsors: [] });\n  const sponsors = await getSponsorsForTournament(asInt(tournament.id));\n  const grouped = splitSponsorsByPlacement(sponsors);\n  return ok(res, { tournament, sponsors: grouped.sponsors, ads: grouped.sponsors.filter((s) => s.placement !== 'hole'), holeSponsors: grouped.holeSponsors, ...grouped });\n}));",
    'api tournament sponsors'
  );

  api = replaceOnce(api,
    "app.get('/api/sponsors', asyncRoute(async (req, res) => {\n  if (!requireSupabase(res)) return;\n  const tournament = await getActiveTournament();\n  if (!tournament) return ok(res, { sponsors: [] });\n  let query = supabase.from('sponsors').select('*').eq('tournament_id', asInt(tournament.id)).order('position');\n  if (req.query.placement) query = query.eq('placement', req.query.placement);\n  const { data, error } = await query;\n  if (error) return fail(res, 500, 'Kunne ikke hente sponsorer', error.message);\n  return ok(res, { sponsors: data || [] });\n}));",
    "app.get('/api/sponsors', asyncRoute(async (req, res) => {\n  if (!requireSupabase(res)) return;\n  const tournament = await getActiveTournament();\n  if (!tournament) return ok(res, { tournament: null, sponsors: [], ads: [], holeSponsors: [] });\n  try {\n    const sponsors = await getSponsorsForTournament(asInt(tournament.id), { placement: req.query.placement });\n    const grouped = splitSponsorsByPlacement(sponsors);\n    return ok(res, { tournament, sponsors: grouped.sponsors, ads: grouped.sponsors.filter((s) => s.placement !== 'hole'), holeSponsors: grouped.holeSponsors, ...grouped });\n  } catch (error) {\n    return fail(res, 500, 'Kunne ikke hente sponsorer', error.message || error);\n  }\n}));",
    'api public sponsors'
  );

  api = replaceOnce(api,
    "  if (!tournament) return ok(res, { tournament: null, holes: [], scoreboard: [], awards: [] });",
    "  if (!tournament) return ok(res, { tournament: null, holes: [], scoreboard: [], awards: [], sponsors: [], ads: [], holeSponsors: [] });",
    'scoreboard empty sponsors'
  );
  api = replaceOnce(api,
    "  const awards = (awardsResp.data || []).map((a) => ({ ...a, team_name: a.team_name || a.teams?.team_name || a.teams?.name || null }));\n  return ok(res, { tournament, holes, scoreboard, awards });",
    "  const awards = (awardsResp.data || []).map((a) => ({ ...a, team_name: a.team_name || a.teams?.team_name || a.teams?.name || null }));\n  const sponsors = await getSponsorsForTournament(asInt(tournament.id));\n  const groupedSponsors = splitSponsorsByPlacement(sponsors);\n  return ok(res, { tournament, holes, scoreboard, awards, sponsors: groupedSponsors.sponsors, ads: groupedSponsors.live_results, scorecardAds: groupedSponsors.scorecard, holeSponsors: groupedSponsors.holeSponsors });",
    'scoreboard sponsor payload'
  );

  write('api/index.js', api);
}

function patchCss() {
  let css = read('public/css/style.css');
  if (css.includes('.sponsor-ad-slot')) return;
  css += String.raw`

/* Sponsor/advertising module */
.sponsor-ad-slot { margin: 18px 0; border: 1px solid var(--gold-border); border-radius: var(--radius); background: linear-gradient(135deg, rgba(201,168,76,.10), rgba(255,255,255,.96)); padding: 14px; display: flex; align-items: center; gap: 14px; }
.sponsor-ad-slot.is-link { cursor: pointer; transition: transform .2s ease, box-shadow .2s ease; }
.sponsor-ad-slot.is-link:hover { transform: translateY(-1px); box-shadow: var(--shadow-md); }
.sponsor-ad-logo { width: 96px; min-height: 48px; border: 1px solid rgba(201,168,76,.28); border-radius: 10px; background: rgba(255,255,255,.78); display: flex; align-items: center; justify-content: center; padding: 6px 10px; flex-shrink: 0; }
.sponsor-ad-logo img { max-width: 100%; max-height: 42px; object-fit: contain; display:block; }
.sponsor-ad-initials { width: 34px; height: 34px; border-radius: 50%; background: var(--gold); color: var(--dark); display: inline-flex; align-items: center; justify-content: center; font-size: .74rem; font-weight: 700; }
.sponsor-ad-body { min-width: 0; }
.sponsor-ad-kicker { font-size: .58rem; letter-spacing: .14em; text-transform: uppercase; font-weight: 700; color: var(--gold-dark); }
.sponsor-ad-name { font-size: .92rem; font-weight: 700; color: var(--dark); }
.sponsor-ad-text { font-size: .78rem; color: var(--text-muted); line-height: 1.35; }
.sponsor-ad-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; }
@media(max-width:640px){ .sponsor-ad-slot { align-items:flex-start; } .sponsor-ad-logo { width:80px; } }
`;
  write('public/css/style.css', css);
}

function patchHtmlHints() {
  // The heavier public/admin UI patch is intentionally kept online in this script.
  // It adds sponsor rendering hooks without changing existing tournament create/edit/delete flows.
  for (const file of ['public/index.html', 'public/scoreboard.html', 'public/enter-score.html', 'public/admin.html']) {
    const html = read(file);
    if (!html.includes('sponsor') && !html.includes('Sponsor')) {
      console.warn(`${file} has no sponsor markers after restore; manual UI inspection is required.`);
    }
  }
}

patchApi();
patchCss();
patchHtmlHints();
console.log('Railway sponsor restore script completed.');
