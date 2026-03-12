const ADMIN_SECTIONS = {
  TOURNAMENT_INFO: 'tournament',
  PLAYERS: 'players',
  COURSE_AND_HOLES: 'holes',
  GAMEDAY: 'gameday',
  SPONSORS: 'sponsors',
  CONTROL_PANEL: 'control-panel',
  TEAMS: 'teams',
  PAIRINGS: 'pairings',
  MATCHES: 'matches',
  STAGES: 'stages',
  PAIR_SETUP: 'pair-setup'
};

const TOURNAMENT_FORMATS = {
  stableford: {
    key: 'stableford', label: 'Stableford', leaderboardMode: 'points_desc', participantMode: 'individual', teamSize: 1,
    adminSections: [ADMIN_SECTIONS.TOURNAMENT_INFO, ADMIN_SECTIONS.PLAYERS, ADMIN_SECTIONS.COURSE_AND_HOLES, ADMIN_SECTIONS.GAMEDAY, ADMIN_SECTIONS.SPONSORS, ADMIN_SECTIONS.CONTROL_PANEL],
    handicap: { method: 'percentage', handicapPercentage: 100 }
  },
  strokeplay: {
    key: 'strokeplay', label: 'Slagspill', leaderboardMode: 'strokes_asc', participantMode: 'individual', teamSize: 1,
    adminSections: [ADMIN_SECTIONS.TOURNAMENT_INFO, ADMIN_SECTIONS.PLAYERS, ADMIN_SECTIONS.COURSE_AND_HOLES, ADMIN_SECTIONS.GAMEDAY, ADMIN_SECTIONS.SPONSORS, ADMIN_SECTIONS.CONTROL_PANEL],
    handicap: { method: 'percentage', handicapPercentage: 100 }
  },
  scramble2: {
    key: 'scramble2', label: '2-manns Scramble', leaderboardMode: 'strokes_asc', participantMode: 'team', teamSize: 2,
    adminSections: [ADMIN_SECTIONS.TOURNAMENT_INFO, ADMIN_SECTIONS.TEAMS, ADMIN_SECTIONS.COURSE_AND_HOLES, ADMIN_SECTIONS.GAMEDAY, ADMIN_SECTIONS.SPONSORS, ADMIN_SECTIONS.CONTROL_PANEL],
    handicap: { method: 'percentage', handicapPercentage: 25 }
  },
  scramble3: {
    key: 'scramble3', label: '3-manns Scramble', leaderboardMode: 'strokes_asc', participantMode: 'team', teamSize: 3,
    adminSections: [ADMIN_SECTIONS.TOURNAMENT_INFO, ADMIN_SECTIONS.TEAMS, ADMIN_SECTIONS.COURSE_AND_HOLES, ADMIN_SECTIONS.GAMEDAY, ADMIN_SECTIONS.SPONSORS, ADMIN_SECTIONS.CONTROL_PANEL],
    handicap: { method: 'percentage', handicapPercentage: 20 }
  },
  scramble4: {
    key: 'scramble4', label: '4-manns Scramble', leaderboardMode: 'strokes_asc', participantMode: 'team', teamSize: 4,
    adminSections: [ADMIN_SECTIONS.TOURNAMENT_INFO, ADMIN_SECTIONS.TEAMS, ADMIN_SECTIONS.COURSE_AND_HOLES, ADMIN_SECTIONS.GAMEDAY, ADMIN_SECTIONS.SPONSORS, ADMIN_SECTIONS.CONTROL_PANEL],
    handicap: { method: 'percentage', handicapPercentage: 10 }
  },
  bestball2: {
    key: 'bestball2', label: '2-ball bestball', leaderboardMode: 'strokes_asc', participantMode: 'team', teamSize: 2,
    adminSections: [ADMIN_SECTIONS.TOURNAMENT_INFO, ADMIN_SECTIONS.TEAMS, ADMIN_SECTIONS.COURSE_AND_HOLES, ADMIN_SECTIONS.GAMEDAY, ADMIN_SECTIONS.SPONSORS, ADMIN_SECTIONS.CONTROL_PANEL],
    handicap: { method: 'percentage', handicapPercentage: 85 }
  },
  texas_scramble: {
    key: 'scramble2', label: '2-manns Scramble', leaderboardMode: 'strokes_asc', participantMode: 'team', teamSize: 2,
    adminSections: [ADMIN_SECTIONS.TOURNAMENT_INFO, ADMIN_SECTIONS.TEAMS, ADMIN_SECTIONS.COURSE_AND_HOLES, ADMIN_SECTIONS.GAMEDAY, ADMIN_SECTIONS.SPONSORS, ADMIN_SECTIONS.CONTROL_PANEL],
    handicap: { method: 'weighted', weights: [35, 15], label: '35/15' }
  },
  texas_scramble_4: {
    key: 'scramble4', label: 'Texas Scramble (4-manns)', leaderboardMode: 'strokes_asc', participantMode: 'team', teamSize: 4,
    adminSections: [ADMIN_SECTIONS.TOURNAMENT_INFO, ADMIN_SECTIONS.TEAMS, ADMIN_SECTIONS.COURSE_AND_HOLES, ADMIN_SECTIONS.GAMEDAY, ADMIN_SECTIONS.SPONSORS, ADMIN_SECTIONS.CONTROL_PANEL],
    handicap: { method: 'weighted', weights: [25, 20, 15, 10], label: '25/20/15/10' }
  },
  greensome: {
    key: 'greensome', label: 'Greensome', leaderboardMode: 'strokes_asc', participantMode: 'pair', teamSize: 2,
    adminSections: [ADMIN_SECTIONS.TOURNAMENT_INFO, ADMIN_SECTIONS.TEAMS, ADMIN_SECTIONS.COURSE_AND_HOLES, ADMIN_SECTIONS.GAMEDAY, ADMIN_SECTIONS.SPONSORS, ADMIN_SECTIONS.CONTROL_PANEL],
    handicap: { method: 'percentage', handicapPercentage: 60 }
  },
  foursome: {
    key: 'foursome', label: 'Foursome', leaderboardMode: 'strokes_asc', participantMode: 'pair', teamSize: 2,
    adminSections: [ADMIN_SECTIONS.TOURNAMENT_INFO, ADMIN_SECTIONS.TEAMS, ADMIN_SECTIONS.COURSE_AND_HOLES, ADMIN_SECTIONS.GAMEDAY, ADMIN_SECTIONS.SPONSORS, ADMIN_SECTIONS.CONTROL_PANEL],
    handicap: { method: 'percentage', handicapPercentage: 50 }
  },
  fourball: {
    key: 'fourball', label: 'Bestball / Four-ball', leaderboardMode: 'strokes_asc', participantMode: 'pair', teamSize: 2,
    adminSections: [ADMIN_SECTIONS.TOURNAMENT_INFO, ADMIN_SECTIONS.TEAMS, ADMIN_SECTIONS.COURSE_AND_HOLES, ADMIN_SECTIONS.GAMEDAY, ADMIN_SECTIONS.SPONSORS, ADMIN_SECTIONS.CONTROL_PANEL],
    handicap: { method: 'percentage', handicapPercentage: 90 }
  },
  matchplay: {
    key: 'matchplay', label: 'Matchspill', leaderboardMode: 'matchplay_status', participantMode: 'individual', teamSize: 1,
    adminSections: [ADMIN_SECTIONS.TOURNAMENT_INFO, ADMIN_SECTIONS.PLAYERS, ADMIN_SECTIONS.COURSE_AND_HOLES, ADMIN_SECTIONS.GAMEDAY, ADMIN_SECTIONS.SPONSORS, ADMIN_SECTIONS.CONTROL_PANEL],
    handicap: { method: 'percentage', handicapPercentage: 100 }
  },
  ryder_cup: {
    key: 'ryder_cup', label: 'Ryder Cup', leaderboardMode: 'matchplay_status', participantMode: 'cup', teamSize: 2,
    adminSections: [ADMIN_SECTIONS.TOURNAMENT_INFO, ADMIN_SECTIONS.TEAMS, ADMIN_SECTIONS.PLAYERS, ADMIN_SECTIONS.STAGES, ADMIN_SECTIONS.PAIRINGS, ADMIN_SECTIONS.MATCHES, ADMIN_SECTIONS.CONTROL_PANEL],
    handicap: { method: 'percentage', handicapPercentage: 100 }
  }
};

const formatHandicapDefaults = Object.fromEntries(Object.entries(TOURNAMENT_FORMATS).map(([key, def]) => [key, def.handicap]));

const LEGACY_FORMAT_MAP = {
  '2-mann scramble': 'scramble2',
  '2 man scramble': 'scramble2',
  '2-man scramble': 'scramble2',
  'scramble': 'scramble2',
  'texas scramble': 'scramble4',
  'slagspill': 'strokeplay',
  'stroke play': 'strokeplay',
  'bestball': 'fourball',
  'four-ball': 'fourball',
  'scramble2': 'scramble2',
  'scramble3': 'scramble3',
  'scramble4': 'scramble4',
  'bestball2': 'bestball2',
  'texas_scramble': 'scramble2',
  'texas_scramble_4': 'scramble4'
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

function getTournamentFormatMeta(format) {
  const def = getFormatDefinition(format);
  return {
    formatKey: def.key,
    displayName: def.label,
    teamSize: Number(def.teamSize || 1),
    isTeamFormat: Number(def.teamSize || 1) > 1
  };
}

function resolveAdminSectionsForTournament(format, { usesStages = false } = {}) {
  const def = getFormatDefinition(format);
  const sections = new Set(def.adminSections || []);
  if (usesStages) sections.add(ADMIN_SECTIONS.STAGES);
  return Array.from(sections);
}

function resolveAdminSectionsForTournamentFormats(format, options = {}) {
  return resolveAdminSectionsForTournament(format, options);
}

function resolveHandicapConfig(format, stage = null, tournament = null) {
  const key = normalizeTournamentFormat(format || stage?.format || tournament?.format);
  const defaults = formatHandicapDefaults[key] || { method: 'percentage', handicapPercentage: 100 };
  const stagePercentage = Number(stage?.handicap_percentage);
  const tournamentPercentage = Number(tournament?.handicap_percentage);
  const handicapPercentage = Number.isFinite(stagePercentage)
    ? stagePercentage
    : (Number.isFinite(tournamentPercentage) ? tournamentPercentage : Number(defaults.handicapPercentage || 100));
  const settings = stage?.settings?.handicap || tournament?.format_settings?.handicap || {};
  return {
    ...defaults,
    ...settings,
    handicapPercentage: Math.max(0, Math.min(100, handicapPercentage))
  };
}

function calculatePlayingHandicap(player, stage = null, tournament = null) {
  const cfg = resolveHandicapConfig(stage?.format || tournament?.format, stage, tournament);
  if (cfg.method !== 'percentage') return 0;
  const courseHandicap = Number(player?.courseHandicap ?? player?.handicap ?? 0);
  return Math.round(courseHandicap * (cfg.handicapPercentage / 100));
}

function calculateTeamHandicap(players = [], format, stage = null, tournament = null) {
  const cfg = resolveHandicapConfig(format, stage, tournament);
  const h = players.map((p) => Number(p?.courseHandicap ?? p?.handicap ?? 0)).sort((a, b) => a - b);
  if (!h.length) return 0;
  if (cfg.method === 'weighted') {
    const weights = Array.isArray(cfg.weights) ? cfg.weights : [];
    return Math.round(h.reduce((sum, value, idx) => sum + (value * ((weights[idx] || 0) / 100)), 0));
  }
  const total = h.reduce((sum, v) => sum + v, 0);
  return Math.round(total * (Number(cfg.handicapPercentage || 0) / 100));
}

function validateTeamSizeForFormat(format, count) {
  const required = getTournamentFormatMeta(format).teamSize;
  if (!required || required <= 1) return { valid: true, required };
  return { valid: Number(count) === required, required };
}

module.exports = {
  ADMIN_SECTIONS,
  TOURNAMENT_FORMATS,
  formatHandicapDefaults,
  normalizeTournamentFormat,
  getFormatDefinition,
  getTournamentFormatMeta,
  resolveAdminSectionsForTournament,
  resolveAdminSectionsForTournamentFormats,
  resolveHandicapConfig,
  calculatePlayingHandicap,
  calculateTeamHandicap,
  validateTeamSizeForFormat
};
