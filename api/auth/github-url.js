module.exports = async function githubUrl(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  return res.status(501).json({ error: 'GitHub-innlogging er ikke aktivert i denne deployen.' });
};
