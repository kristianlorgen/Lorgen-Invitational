const path = require('path');
const { ok, fail, methodNotAllowed } = require(path.join(__dirname, '..', '..', '..', 'lib', 'json'));
const { getSupabaseAdmin } = require(path.join(__dirname, '..', '..', '..', 'lib', 'supabaseAdmin'));
const { canonicalTournamentRow } = require(path.join(__dirname, '..', '..', '..', 'lib', 'validators'));

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'], 'v2_tournaments_active_method');

    console.log('ENV CHECK:', {
      url: !!process.env.SUPABASE_URL,
      key: !!process.env.SUPABASE_SERVICE_ROLE_KEY
    });

    let data;
    try {
      const supabase = getSupabaseAdmin();
      const activeResult = await supabase
        .from('tournaments')
        .select('id, year, name, date, course, status')
        .eq('status', 'active')
        .order('year', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (activeResult.error) {
        console.error('ACTIVE TOURNAMENT QUERY ERROR:', activeResult.error);
        return fail(res, 500, activeResult.error.message, 'v2_tournaments_active_query');
      }

      data = activeResult.data;
      if (!data) {
        const fallback = await supabase
          .from('tournaments')
          .select('id, year, name, date, course, status')
          .order('year', { ascending: false })
          .order('id', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (fallback.error) {
          console.error('ACTIVE TOURNAMENT FALLBACK QUERY ERROR:', fallback.error);
          return fail(res, 500, fallback.error.message, 'v2_tournaments_active_fallback');
        }
        if (!fallback.data) return fail(res, 404, 'No tournament found', 'v2_tournaments_active_missing');
        data = fallback.data;
      }
    } catch (error) {
      console.error('SUPABASE ACTIVE ROUTE ERROR:', error);
      return fail(res, 500, error.message || 'Supabase failure', 'v2_tournaments_active_supabase');
    }

    return ok(res, canonicalTournamentRow(data));
  } catch (err) {
    console.error('FATAL:', err);
    return fail(res, 500, err.message || 'Server crash', 'v2_tournaments_active_crash');
  }
};
