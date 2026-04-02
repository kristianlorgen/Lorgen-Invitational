function asInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function defaultHole(tournamentId, holeNumber) {
  return {
    tournament_id: tournamentId,
    hole_number: holeNumber,
    par: 4,
    stroke_index: holeNumber,
    requires_photo: false,
    is_longest_drive: false,
    is_nearest_pin: false
  };
}

function buildDefaultHoles(tournamentId) {
  return Array.from({ length: 18 }, (_, index) => defaultHole(tournamentId, index + 1));
}

function toCanonicalHole(row = {}) {
  return {
    hole_number: asInt(row.hole_number) || 1,
    par: asInt(row.par) || 4,
    stroke_index: asInt(row.stroke_index) || 1,
    requires_photo: Boolean(row.requires_photo),
    is_longest_drive: Boolean(row.is_longest_drive),
    is_nearest_pin: Boolean(row.is_nearest_pin)
  };
}

function normalizeHolePayload(tournamentId, holesPayload) {
  if (!Array.isArray(holesPayload) || holesPayload.length !== 18) {
    throw new Error('Må sende nøyaktig 18 hull');
  }

  const normalized = holesPayload.map((hole) => {
    const holeNumber = asInt(hole?.hole_number);
    const par = asInt(hole?.par);
    const strokeIndex = asInt(hole?.stroke_index);

    if (!holeNumber || holeNumber < 1 || holeNumber > 18) throw new Error('Ugyldig hole_number');
    if (!par || par < 3 || par > 6) throw new Error('Ugyldig par');
    if (!strokeIndex || strokeIndex < 1 || strokeIndex > 18) throw new Error('Ugyldig stroke_index');

    return {
      tournament_id: tournamentId,
      hole_number: holeNumber,
      par,
      stroke_index: strokeIndex,
      requires_photo: hole.requires_photo === true,
      is_longest_drive: hole.is_longest_drive === true,
      is_nearest_pin: hole.is_nearest_pin === true
    };
  });

  const uniqueHoleNumbers = new Set(normalized.map((hole) => hole.hole_number));
  if (uniqueHoleNumbers.size !== 18) {
    throw new Error('Hullene må være unike fra 1-18');
  }

  return normalized.sort((a, b) => a.hole_number - b.hole_number);
}

function mapTeamToCanonical(row = {}) {
  return {
    id: asInt(row.id),
    tournament_id: asInt(row.tournament_id),
    team_name: String(row.team_name || ''),
    player1_name: String(row.player1_name || ''),
    player2_name: String(row.player2_name || ''),
    pin: String(row.pin || ''),
    hcp_player1: asInt(row.hcp_player1) || 0,
    hcp_player2: asInt(row.hcp_player2) || 0,
    created_at: row.created_at || null,
    locked: Boolean(row.locked)
  };
}

function buildScorecardData(teamRow, holeRows, scoreRows) {
  const team = mapTeamToCanonical(teamRow);
  const holeMap = new Map((holeRows || []).map((row) => [asInt(row.hole_number), toCanonicalHole(row)]));
  const scoreMap = new Map((scoreRows || []).map((row) => [asInt(row.hole_number), asInt(row.strokes)]));

  const holes = Array.from({ length: 18 }, (_, index) => {
    const holeNumber = index + 1;
    const hole = holeMap.get(holeNumber) || defaultHole(team.tournament_id, holeNumber);
    const strokes = scoreMap.get(holeNumber);
    const completed = Number.isInteger(strokes) && strokes > 0;

    return {
      hole_number: holeNumber,
      par: hole.par,
      stroke_index: hole.stroke_index,
      requires_photo: hole.requires_photo,
      is_longest_drive: hole.is_longest_drive,
      is_nearest_pin: hole.is_nearest_pin,
      strokes: completed ? strokes : null,
      completed
    };
  });

  const completedHoles = holes.filter((hole) => hole.completed).length;
  const totalHoles = 18;

  return {
    team: {
      id: team.id,
      team_name: team.team_name,
      player1_name: team.player1_name,
      player2_name: team.player2_name,
      pin: team.pin
    },
    holes,
    completed_holes: completedHoles,
    total_holes: totalHoles,
    is_round_complete: Boolean(team.locked) || completedHoles === totalHoles
  };
}

module.exports = {
  asInt,
  buildDefaultHoles,
  toCanonicalHole,
  normalizeHolePayload,
  mapTeamToCanonical,
  buildScorecardData
};
