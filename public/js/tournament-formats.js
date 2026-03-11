(function (global) {
  const DEFINITIONS = {
    stableford: {
      key: 'stableford', label: 'Stableford', teamBased: false,
      scoreEntryLabel: 'Slag', scoreDisplay: 'Poeng', leaderboardColumns: ['Plass', 'Navn/Lag', 'Poeng', 'Hull'],
      sorter: (a, b) => (b.stableford_points || 0) - (a.stableford_points || 0)
    },
    strokeplay: {
      key: 'strokeplay', label: 'Slagspill', teamBased: false,
      scoreEntryLabel: 'Slag', scoreDisplay: 'Total', leaderboardColumns: ['Plass', 'Navn/Lag', 'Total', 'Vs par', 'Hull'],
      sorter: (a, b) => (a.to_par || 0) - (b.to_par || 0)
    },
    texas_scramble: { key: 'texas_scramble', label: 'Texas Scramble', teamBased: true, scoreEntryLabel: 'Lagets slag', scoreDisplay: 'Lagscore', leaderboardColumns: ['Plass', 'Lag', 'Total', 'Vs par', 'Hull'], sorter: (a,b)=>(a.to_par||0)-(b.to_par||0)},
    greensome: { key: 'greensome', label: 'Greensome', teamBased: true, scoreEntryLabel: 'Parets slag', scoreDisplay: 'Parscore', leaderboardColumns: ['Plass', 'Par', 'Total', 'Vs par', 'Hull'], sorter: (a,b)=>(a.to_par||0)-(b.to_par||0)},
    foursome: { key: 'foursome', label: 'Foursome', teamBased: true, scoreEntryLabel: 'Parets slag', scoreDisplay: 'Parscore', leaderboardColumns: ['Plass', 'Par', 'Total', 'Vs par', 'Hull'], sorter: (a,b)=>(a.to_par||0)-(b.to_par||0)},
    fourball: { key: 'fourball', label: 'Bestball / Four-ball', teamBased: true, scoreEntryLabel: 'Spillerscore (bestball)', scoreDisplay: 'Bestball', leaderboardColumns: ['Plass', 'Lag', 'Total', 'Vs par', 'Hull'], sorter: (a,b)=>(a.to_par||0)-(b.to_par||0)},
    matchplay: { key: 'matchplay', label: 'Matchspill', teamBased: true, scoreEntryLabel: 'Hullvinner', scoreDisplay: 'Matchstatus', leaderboardColumns: ['Match', 'Status', 'Hull', 'Leder'], sorter: (a,b)=>a.team_name.localeCompare(b.team_name,'nb') }
  };

  const LEGACY_MAP = { '2-mann scramble': 'texas_scramble', 'texas scramble': 'texas_scramble', 'scramble': 'texas_scramble', 'slagspill': 'strokeplay', 'four-ball': 'fourball', 'bestball': 'fourball' };

  function normalizeFormat(format) {
    const raw = String(format || '').trim().toLowerCase();
    if (!raw) return 'strokeplay';
    return DEFINITIONS[raw] ? raw : (LEGACY_MAP[raw] || 'strokeplay');
  }

  function getFormatDefinition(format) {
    const key = normalizeFormat(format);
    return DEFINITIONS[key] || DEFINITIONS.strokeplay;
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

  global.TournamentFormats = { normalizeFormat, getFormatDefinition, calculateHoleResult, calculateRoundResult, buildLeaderboard };
})(window);
