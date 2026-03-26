function getTournamentFormat(tournament) {
  return tournament?.format || 'scramble';
}

function getTeamSizeForFormat(format) {
  return format === 'scramble' ? 2 : 2;
}

module.exports = {
  getTournamentFormat,
  getTeamSizeForFormat
};
