const path = require('path');
const { ok, fail, methodNotAllowed, readJsonBody } = require(path.join(__dirname, '..', '..', '..', '..', 'lib', 'json'));
const { getSupabaseAdmin } = require(path.join(__dirname, '..', '..', '..', '..', 'lib', 'supabaseAdmin'));
const {
  asInt,
  canonicalHoleRow,
  buildDefaultHoles,
  validateAndNormalizeHoles
} = require(path.join(__dirname, '..', '..', '..', '..', 'lib', 'validators'));

const HOLE_COLUMNS = 'hole_number, par, stroke_index, requires_photo, is_longest_drive, is_nearest_pin';

async function readCanonicalHoles(supabase, tournamentId) {
  const { data, error } = await supabase
    .from('tournament_holes')
    .select(HOLE_COLUMNS)
    .eq('tournament_id', tournamentId)
    .order('hole_number', { ascending: true });

  if (error) throw error;
  return (data || []).map(canonicalHoleRow);
}

async function ensure18Holes(supabase, tournamentId) {
  const existing = await readCanonicalHoles(supabase, tournamentId);
  if (existing.length === 18) return existing;

  const defaults = buildDefaultHoles(tournamentId);
  const { error } = await supabase
    .from('tournament_holes')
    .upsert(defaults, { onConflict: 'tournament_id,hole_number' });

  if (error) throw error;

  return readCanonicalHoles(supabase, tournamentId);
}

module.exports = async function handler(req, res) {
  try {
    const tournamentId = asInt(req.query?.id);
    if (!tournamentId) return fail(res, 400, 'Invalid tournament id', 'v2_tournament_holes_invalid_id');

    const supabase = getSupabaseAdmin();

    if (req.method === 'GET') {
      const holes = await ensure18Holes(supabase, tournamentId);
      if (holes.length !== 18) return fail(res, 500, 'Failed to produce 18 holes', 'v2_tournament_holes_get_count');
      return ok(res, holes);
    }

    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const normalized = validateAndNormalizeHoles(body.holes, tournamentId);

      const { error } = await supabase
        .from('tournament_holes')
        .upsert(normalized, { onConflict: 'tournament_id,hole_number' });

      if (error) return fail(res, 500, error.message, 'v2_tournament_holes_post_upsert');

      const refetched = await readCanonicalHoles(supabase, tournamentId);
      if (refetched.length !== 18) {
        return fail(res, 500, 'Expected 18 canonical holes after save', 'v2_tournament_holes_post_refetch_count');
      }

      return ok(res, refetched);
    }

    return methodNotAllowed(res, ['GET', 'POST'], 'v2_tournament_holes_method');
  } catch (err) {
    console.error('FATAL:', err);
    return fail(res, 500, err.message || 'Server crash', 'v2_tournament_holes_crash');
  }
};
