const { isAdminAuthenticated } = require('../../lib/adminAuth');

module.exports = async function status(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (isAdminAuthenticated(req)) {
    return res.status(200).json({ type: 'admin' });
  }

  return res.status(200).json({ type: null });
};
