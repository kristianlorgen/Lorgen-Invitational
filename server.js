const app = require('./api/index');

const PORT = Number(process.env.PORT) || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[api:listen] Server listening on port ${PORT}`);
  });
}

module.exports = app;
