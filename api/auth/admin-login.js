const { getAdminPassword, setAdminAuthCookie } = require('../../lib/adminAuth');

function readJsonBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch (_) {
      return {};
    }
  }
  return {};
}

module.exports = async function adminLogin(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const adminPassword = getAdminPassword();
  if (!adminPassword) {
    return res.status(500).json({ error: 'ADMIN_PASSWORD mangler i miljøvariabler.' });
  }

  const body = readJsonBody(req);
  const password = String(body.password || '');

  if (!password || password !== adminPassword) {
    return res.status(401).json({ error: 'Ugyldig passord' });
  }

  setAdminAuthCookie(res);
  return res.status(200).json({ success: true, type: 'admin' });
};
