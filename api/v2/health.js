const path = require('path');
const { ok, fail, methodNotAllowed } = require(path.join(__dirname, '..', '..', 'lib', 'json'));
const { getSupabaseAdmin } = require(path.join(__dirname, '..', '..', 'lib', 'supabaseAdmin'));

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'], 'v2_health_method');

    getSupabaseAdmin();
    return ok(res, { status: 'ok' });
  } catch (err) {
    console.error('FATAL:', err);
    return fail(res, 503, err.message || 'Service unavailable', 'v2_health_crash');
  }
};
