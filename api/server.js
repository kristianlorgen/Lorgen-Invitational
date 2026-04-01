module.exports = function handler(_req, res) {
  res.statusCode = 500;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ error: 'Local storage not allowed in production' }));
};
