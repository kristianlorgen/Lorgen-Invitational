function createDatabase() {
  throw new Error('Local storage not allowed in production');
}

module.exports = createDatabase;
