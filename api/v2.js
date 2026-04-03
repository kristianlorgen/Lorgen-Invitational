function asInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function canonicalError(error, stackHint, status = 400) {
  return { status, body: { success: false, error, stackHint } };
}

function canonicalSuccess(data, status = 200) {
  return { status, body: { success: true, data } };
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

function toCanonicalTournament(row = {}) {
  return {
    id: asInt(row.id),
    year: asInt(row.year),
    name: String(row.name || ''),
    date: row.date || null,
    course: row.course || null,
    description: row.description || null,
    slope_rating: row.slope_rating == null ? null : Number(row.slope_rating),
    status: row.status || null
  };
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
    throw new Error('holes must contain exactly 18 rows');
  }

  const normalized = holesPayload.map((hole) => {
    const holeNumber = asInt(hole?.hole_number);
    const par = asInt(hole?.par);
    const strokeIndex = asInt(hole?.stroke_index);

    if (!holeNumber || holeNumber < 1 || holeNumber > 18) throw new Error('invalid hole_number');
    if (!par || par < 3 || par > 6) throw new Error('invalid par');
    if (!strokeIndex || strokeIndex < 1 || strokeIndex > 18) throw new Error('invalid stroke_index');

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
    throw new Error('hole_number must be unique from 1..18');
  }

  return normalized.sort((a, b) => a.hole_number - b.hole_number);
}

function mapTeamToCanonical(row = {}) {
  const hcpPlayer1 = Number(row.hcp_player1);
  const hcpPlayer2 = Number(row.hcp_player2);

  return {
    id: asInt(row.id),
    tournament_id: asInt(row.tournament_id),
    team_name: String(row.team_name || ''),
    player1_name: String(row.player1_name || ''),
    player2_name: String(row.player2_name || ''),
    pin: String(row.pin || ''),
    hcp_player1: Number.isFinite(hcpPlayer1) ? hcpPlayer1 : 0,
    hcp_player2: Number.isFinite(hcpPlayer2) ? hcpPlayer2 : 0
  };
}

function normalizeScoreRows(scoreRows = []) {
  const unique = new Map();
  for (const row of (Array.isArray(scoreRows) ? scoreRows : [])) {
    const holeNumber = asInt(row.hole_number);
    const gross = asInt(row.gross_score ?? row.strokes ?? row.score);
    if (!holeNumber || holeNumber < 1 || holeNumber > 18) continue;
    if (!gross || gross < 1) continue;
    unique.set(holeNumber, {
      hole_number: holeNumber,
      gross_score: gross,
      submitted_at: row.submitted_at || row.updated_at || null
    });
  }
  return Array.from(unique.values()).sort((a, b) => a.hole_number - b.hole_number);
}

function buildScorecardData(teamRow, holeRows, scoreRows) {
  const team = mapTeamToCanonical(teamRow);
  const canonicalHoles = (Array.isArray(holeRows) ? holeRows : []).map(toCanonicalHole).sort((a, b) => a.hole_number - b.hole_number);
  const submittedScores = normalizeScoreRows(scoreRows);
  const scoreMap = new Map(submittedScores.map((row) => [row.hole_number, row]));

  const completedHoles = canonicalHoles
    .filter((hole) => scoreMap.has(hole.hole_number))
    .length;

  const requiredPlayableHoles = canonicalHoles.length;
  const isRoundComplete = requiredPlayableHoles > 0 && completedHoles === requiredPlayableHoles;

  return {
    team,
    holes: canonicalHoles,
    submitted_scores: submittedScores,
    completed_holes: completedHoles,
    is_round_complete: isRoundComplete
  };
}

module.exports = {
  asInt,
  canonicalError,
  canonicalSuccess,
  buildDefaultHoles,
  toCanonicalTournament,
  toCanonicalHole,
  normalizeHolePayload,
  mapTeamToCanonical,
  normalizeScoreRows,
  buildScorecardData
};
