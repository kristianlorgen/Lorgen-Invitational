const { ok, fail, methodNotAllowed, readJsonBody } = require('../../../../lib/json');
const { getSupabaseAdmin } = require('../../../../lib/supabaseAdmin');
const {
  asInt,
  canonicalHoleRow,
  buildDefaultHoles,
  validateAndNormalizeHoles
} = require('../../../../lib/validators');

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
  const tournamentId = asInt(req.query?.id);
  if (!tournamentId) return fail(res, 400, 'Invalid tournament id');

  try {
    const supabase = getSupabaseAdmin();

    if (req.method === 'GET') {
      const holes = await ensure18Holes(supabase, tournamentId);
      if (holes.length !== 18) return fail(res, 500, 'Failed to produce 18 holes');
      return ok(res, holes);
    }

    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const normalized = validateAndNormalizeHoles(body.holes, tournamentId);

      const { error } = await supabase
        .from('tournament_holes')
        .upsert(normalized, { onConflict: 'tournament_id,hole_number' });

      if (error) return fail(res, 500, error.message);

      const refetched = await readCanonicalHoles(supabase, tournamentId);
      if (refetched.length !== 18) {
        return fail(res, 500, 'Expected 18 canonical holes after save');
      }

      return ok(res, refetched);
    }

    return methodNotAllowed(res, ['GET', 'POST']);
  } catch (error) {
    return fail(res, 500, error.message || 'Unexpected server error');
  }
};
