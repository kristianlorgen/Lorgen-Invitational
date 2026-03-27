const { clearAdminAuthCookie } = require('../../lib/adminAuth');

module.exports = async function logout(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  clearAdminAuthCookie(res);
  return res.status(200).json({ success: true });
};
