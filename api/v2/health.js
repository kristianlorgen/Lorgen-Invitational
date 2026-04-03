const { ok, fail, methodNotAllowed } = require('../../lib/json');
const { getSupabaseAdmin } = require('../../lib/supabaseAdmin');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET'], 'v2_health_method');

  try {
    getSupabaseAdmin();
    return ok(res, { status: 'ok' });
  } catch (error) {
    return fail(res, 503, error.message || 'Service unavailable', 'v2_health_get');
  }
};
