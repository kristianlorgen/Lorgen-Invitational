const { ok, fail, methodNotAllowed } = require('../../../lib/json');
const { getSupabaseAdmin } = require('../../../lib/supabaseAdmin');
const { canonicalTournamentRow } = require('../../../lib/validators');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('tournaments')
      .select('id, year, name, date, course, status')
      .eq('status', 'active')
      .order('year', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return fail(res, 500, error.message);

    if (!data) {
      const fallback = await supabase
        .from('tournaments')
        .select('id, year, name, date, course, status')
        .order('year', { ascending: false })
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (fallback.error) return fail(res, 500, fallback.error.message);
      if (!fallback.data) return fail(res, 404, 'No tournament found');
      return ok(res, canonicalTournamentRow(fallback.data));
    }

    return ok(res, canonicalTournamentRow(data));
  } catch (error) {
    return fail(res, 500, error.message || 'Unexpected server error');
  }
};
