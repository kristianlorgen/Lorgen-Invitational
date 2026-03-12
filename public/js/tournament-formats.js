(function (global) {
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

  const DEFINITIONS = {
    stableford: {
      key: 'stableford', label: 'Stableford', teamBased: false, participantMode: 'individual', teamSize: 1,
      scoreEntryLabel: 'Slag', scoreDisplay: 'Poeng', leaderboardColumns: ['Plass', 'Navn/Lag', 'Poeng', 'Hull'],
      adminSections: [ADMIN_SECTIONS.TOURNAMENT_INFO, ADMIN_SECTIONS.PLAYERS, ADMIN_SECTIONS.COURSE_AND_HOLES, ADMIN_SECTIONS.GAMEDAY, ADMIN_SECTIONS.SPONSORS, ADMIN_SECTIONS.CONTROL_PANEL],
      handicap: { method: 'percentage', handicapPercentage: 100 },
      sorter: (a, b) => (b.stableford_points || 0) - (a.stableford_points || 0)
    },
    strokeplay: {
      key: 'strokeplay', label: 'Slagspill', teamBased: false, participantMode: 'individual', teamSize: 1,
      scoreEntryLabel: 'Slag', scoreDisplay: 'Total', leaderboardColumns: ['Plass', 'Navn/Lag', 'Total', 'Vs par', 'Hull'],
      adminSections: [ADMIN_SECTIONS.TOURNAMENT_INFO, ADMIN_SECTIONS.PLAYERS, ADMIN_SECTIONS.COURSE_AND_HOLES, ADMIN_SECTIONS.GAMEDAY, ADMIN_SECTIONS.SPONSORS, ADMIN_SECTIONS.CONTROL_PANEL],
      handicap: { method: 'percentage', handicapPercentage: 100 },
      sorter: (a, b) => (a.to_par || 0) - (b.to_par || 0)
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
      key: 'scramble2', label: '2-manns Scramble', teamBased: true, participantMode: 'team', teamSize: 2,
      scoreEntryLabel: 'Lagets slag', scoreDisplay: 'Lagscore', leaderboardColumns: ['Plass', 'Lag', 'Total', 'Vs par', 'Hull'],
      adminSections: [ADMIN_SECTIONS.TOURNAMENT_INFO, ADMIN_SECTIONS.TEAMS, ADMIN_SECTIONS.COURSE_AND_HOLES, ADMIN_SECTIONS.GAMEDAY, ADMIN_SECTIONS.SPONSORS, ADMIN_SECTIONS.CONTROL_PANEL],
      handicap: { method: 'weighted', weights: [35, 15], label: '35/15' },
      sorter: (a,b)=>(a.to_par||0)-(b.to_par||0)
    },
    texas_scramble_4: {
      key: 'scramble4', label: 'Texas Scramble', teamBased: true, participantMode: 'team', teamSize: 4,
      scoreEntryLabel: 'Lagets slag', scoreDisplay: 'Lagscore', leaderboardColumns: ['Plass', 'Lag', 'Total', 'Vs par', 'Hull'],
      adminSections: [ADMIN_SECTIONS.TOURNAMENT_INFO, ADMIN_SECTIONS.TEAMS, ADMIN_SECTIONS.COURSE_AND_HOLES, ADMIN_SECTIONS.GAMEDAY, ADMIN_SECTIONS.SPONSORS, ADMIN_SECTIONS.CONTROL_PANEL],
      handicap: { method: 'weighted', weights: [25, 20, 15, 10], label: '25/20/15/10' },
      sorter: (a,b)=>(a.to_par||0)-(b.to_par||0)
    },
    greensome: { key: 'greensome', label: 'Greensome', teamBased: true, participantMode: 'pair', teamSize: 2, scoreEntryLabel: 'Parets slag', scoreDisplay: 'Parscore', leaderboardColumns: ['Plass', 'Par', 'Total', 'Vs par', 'Hull'], adminSections: [ADMIN_SECTIONS.TOURNAMENT_INFO, ADMIN_SECTIONS.TEAMS, ADMIN_SECTIONS.COURSE_AND_HOLES, ADMIN_SECTIONS.GAMEDAY, ADMIN_SECTIONS.SPONSORS, ADMIN_SECTIONS.CONTROL_PANEL], handicap: { method: 'percentage', handicapPercentage: 60 }, sorter: (a,b)=>(a.to_par||0)-(b.to_par||0)},
    foursome: { key: 'foursome', label: 'Foursome', teamBased: true, participantMode: 'pair', teamSize: 2, scoreEntryLabel: 'Parets slag', scoreDisplay: 'Parscore', leaderboardColumns: ['Plass', 'Par', 'Total', 'Vs par', 'Hull'], adminSections: [ADMIN_SECTIONS.TOURNAMENT_INFO, ADMIN_SECTIONS.TEAMS, ADMIN_SECTIONS.COURSE_AND_HOLES, ADMIN_SECTIONS.GAMEDAY, ADMIN_SECTIONS.SPONSORS, ADMIN_SECTIONS.CONTROL_PANEL], handicap: { method: 'percentage', handicapPercentage: 50 }, sorter: (a,b)=>(a.to_par||0)-(b.to_par||0)},
    fourball: { key: 'fourball', label: 'Bestball / Four-ball', teamBased: true, participantMode: 'pair', teamSize: 2, scoreEntryLabel: 'Spillerscore (bestball)', scoreDisplay: 'Bestball', leaderboardColumns: ['Plass', 'Lag', 'Total', 'Vs par', 'Hull'], adminSections: [ADMIN_SECTIONS.TOURNAMENT_INFO, ADMIN_SECTIONS.TEAMS, ADMIN_SECTIONS.COURSE_AND_HOLES, ADMIN_SECTIONS.GAMEDAY, ADMIN_SECTIONS.SPONSORS, ADMIN_SECTIONS.CONTROL_PANEL], handicap: { method: 'percentage', handicapPercentage: 90 }, sorter: (a,b)=>(a.to_par||0)-(b.to_par||0)},
    matchplay: { key: 'matchplay', label: 'Matchspill', teamBased: false, participantMode: 'individual', teamSize: 1, scoreEntryLabel: 'Hullvinner', scoreDisplay: 'Matchstatus', leaderboardColumns: ['Match', 'Status', 'Hull', 'Leder'], adminSections: [ADMIN_SECTIONS.TOURNAMENT_INFO, ADMIN_SECTIONS.PLAYERS, ADMIN_SECTIONS.COURSE_AND_HOLES, ADMIN_SECTIONS.GAMEDAY, ADMIN_SECTIONS.SPONSORS, ADMIN_SECTIONS.CONTROL_PANEL], handicap: { method: 'percentage', handicapPercentage: 100 }, sorter: (a,b)=>a.team_name.localeCompare(b.team_name,'nb') },
    ryder_cup: { key: 'ryder_cup', label: 'Ryder Cup', teamBased: true, participantMode: 'cup', teamSize: 2, scoreEntryLabel: 'Matchpoeng', scoreDisplay: 'Cup-score', leaderboardColumns: ['Lag', 'Poeng'], handicap: { method: 'percentage', handicapPercentage: 100 }, sorter: (a,b)=>(b.points||0)-(a.points||0) }
  };

  const LEGACY_MAP = { '2-mann scramble': 'scramble2', '2-man scramble': 'scramble2', 'texas scramble': 'scramble4', 'scramble': 'scramble2', 'slagspill': 'strokeplay', 'four-ball': 'fourball',
  'scramble2': 'scramble2',
  'scramble3': 'scramble3',
  'scramble4': 'scramble4',
  'bestball2': 'bestball2',
  'texas_scramble': 'scramble2',
  'texas_scramble_4': 'scramble4', 'bestball': 'fourball' };

  function normalizeFormat(format) {
    const raw = String(format || '').trim().toLowerCase();
    if (!raw) return 'strokeplay';
    return DEFINITIONS[raw] ? raw : (LEGACY_MAP[raw] || 'strokeplay');
  }

  function getFormatDefinition(format) {
    const key = normalizeFormat(format);
    return DEFINITIONS[key] || DEFINITIONS.strokeplay;
  }

  function resolveAdminSectionsForTournament(format, options = {}) {
    const def = getFormatDefinition(format);
    const sections = new Set(def.adminSections || []);
    if (options.usesStages) sections.add(ADMIN_SECTIONS.STAGES);
    return Array.from(sections);
  }


  function resolveAdminSectionsForTournamentFormats(format, options = {}) {
    return resolveAdminSectionsForTournament(format, options);
  }

  function resolveHandicapConfig(format, stage = null, tournament = null) {
    const def = getFormatDefinition(format || stage?.format || tournament?.format);
    const defaults = def.handicap || { method: 'percentage', handicapPercentage: 100 };
    const stagePercentage = Number(stage?.handicap_percentage);
    const tournamentPercentage = Number(tournament?.handicap_percentage);
    const handicapPercentage = Number.isFinite(stagePercentage) ? stagePercentage : (Number.isFinite(tournamentPercentage) ? tournamentPercentage : Number(defaults.handicapPercentage || 100));
    const settings = stage?.settings?.handicap || tournament?.format_settings?.handicap || {};
    return { ...defaults, ...settings, handicapPercentage: Math.max(0, Math.min(100, handicapPercentage)) };
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

  function calculateHoleResult(format, input, context = {}) {
    const def = getFormatDefinition(format);
    if (def.key === 'stableford') {
      const diff = (input.score || 0) - (context.par || 4);
      const points = diff <= -3 ? 5 : diff === -2 ? 4 : diff === -1 ? 3 : diff === 0 ? 2 : diff === 1 ? 1 : 0;
      return { points, score: input.score || 0 };
    }
    return { score: input.score || 0 };
  }

  function calculateRoundResult(format, scores = [], context = {}) {
    const def = getFormatDefinition(format);
    if (def.key === 'stableford') {
      const points = scores.reduce((sum, s) => sum + (s.points || 0), 0);
      return { points };
    }
    const total = scores.reduce((sum, s) => sum + (s.score || 0), 0);
    return { total };
  }

  function buildLeaderboard(format, data = []) {
    const def = getFormatDefinition(format);
    return [...data].sort(def.sorter);
  }

  global.TournamentFormats = { normalizeFormat, getFormatDefinition, resolveAdminSectionsForTournament, resolveAdminSectionsForTournamentFormats, resolveHandicapConfig, calculatePlayingHandicap, calculateTeamHandicap, calculateHoleResult, calculateRoundResult, buildLeaderboard };
})(window);
