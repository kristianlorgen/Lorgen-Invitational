const TOURNAMENT_FORMATS = {
  stableford: { key: 'stableford', label: 'Stableford', leaderboardMode: 'points_desc' },
  strokeplay: { key: 'strokeplay', label: 'Slagspill', leaderboardMode: 'strokes_asc' },
  texas_scramble: { key: 'texas_scramble', label: 'Texas Scramble', leaderboardMode: 'strokes_asc' },
  greensome: { key: 'greensome', label: 'Greensome', leaderboardMode: 'strokes_asc' },
  foursome: { key: 'foursome', label: 'Foursome', leaderboardMode: 'strokes_asc' },
  fourball: { key: 'fourball', label: 'Bestball / Four-ball', leaderboardMode: 'strokes_asc' },
  matchplay: { key: 'matchplay', label: 'Matchspill', leaderboardMode: 'matchplay_status' }
};

const LEGACY_FORMAT_MAP = {
  '2-mann scramble': 'texas_scramble',
  '2 man scramble': 'texas_scramble',
  'scramble': 'texas_scramble',
  'texas scramble': 'texas_scramble',
  'slagspill': 'strokeplay',
  'stroke play': 'strokeplay',
  'bestball': 'fourball',
  'four-ball': 'fourball'
};

function normalizeTournamentFormat(format) {
  const raw = String(format || '').trim().toLowerCase();
  if (!raw) return 'strokeplay';
  if (TOURNAMENT_FORMATS[raw]) return raw;
  if (LEGACY_FORMAT_MAP[raw]) return LEGACY_FORMAT_MAP[raw];
  return 'strokeplay';
}

function getFormatDefinition(format) {
  const key = normalizeTournamentFormat(format);
  return TOURNAMENT_FORMATS[key] || TOURNAMENT_FORMATS.strokeplay;
}

module.exports = {
  TOURNAMENT_FORMATS,
  normalizeTournamentFormat,
  getFormatDefinition
};
