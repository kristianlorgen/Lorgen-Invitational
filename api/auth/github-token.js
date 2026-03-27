module.exports = async function githubToken(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  return res.status(501).json({ error: 'GitHub-innlogging er ikke aktivert i denne deployen.' });
};
