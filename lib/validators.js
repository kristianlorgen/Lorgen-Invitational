function asInt(value) {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isInteger(parsed)) return parsed;
  }
  return null;
}

function asNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const normalized = value.replace(',', '.');
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function validatePin(pin) {
  return typeof pin === 'string' && /^\d{4}$/.test(pin);
}

function canonicalTeamRow(row) {
  return {
    id: Number(row.id),
    tournament_id: Number(row.tournament_id),
    team_name: String(row.team_name),
    player1_name: String(row.player1_name),
    player2_name: String(row.player2_name),
    pin: String(row.pin),
    hcp_player1: Number(row.hcp_player1),
    hcp_player2: Number(row.hcp_player2)
  };
}

function canonicalTournamentRow(row) {
  return {
    id: Number(row.id),
    year: Number(row.year),
    name: String(row.name),
    date: row.date || null,
    course: row.course || null,
    status: row.status || null
  };
}

function canonicalHoleRow(row) {
  return {
    hole_number: Number(row.hole_number),
    par: Number(row.par),
    stroke_index: Number(row.stroke_index),
    requires_photo: Boolean(row.requires_photo),
    is_longest_drive: Boolean(row.is_longest_drive),
    is_nearest_pin: Boolean(row.is_nearest_pin)
  };
}

function buildDefaultHoles(tournamentId) {
  return Array.from({ length: 18 }, (_, index) => ({
    tournament_id: tournamentId,
    hole_number: index + 1,
    par: 4,
    stroke_index: index + 1,
    requires_photo: false,
    is_longest_drive: false,
    is_nearest_pin: false
  }));
}

function validateAndNormalizeHoles(holes, tournamentId) {
  if (!Array.isArray(holes) || holes.length !== 18) {
    throw new Error('holes must contain exactly 18 rows');
  }

  const normalized = holes.map((hole) => {
    const holeNumber = asInt(hole?.hole_number);
    const par = asInt(hole?.par);
    const strokeIndex = asInt(hole?.stroke_index);

    if (!holeNumber || holeNumber < 1 || holeNumber > 18) {
      throw new Error('hole_number must be within 1..18');
    }
    if (!par || par < 3 || par > 6) {
      throw new Error('par must be within 3..6');
    }
    if (!strokeIndex || strokeIndex < 1 || strokeIndex > 18) {
      throw new Error('stroke_index must be within 1..18');
    }

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

  const uniqueHoles = new Set(normalized.map((hole) => hole.hole_number));
  const uniqueStrokeIndexes = new Set(normalized.map((hole) => hole.stroke_index));
  if (uniqueHoles.size !== 18) throw new Error('hole_number must be unique');
  if (uniqueStrokeIndexes.size !== 18) throw new Error('stroke_index must be unique');

  return normalized.sort((a, b) => a.hole_number - b.hole_number);
}

module.exports = {
  asInt,
  asNumber,
  validatePin,
  canonicalTeamRow,
  canonicalTournamentRow,
  canonicalHoleRow,
  buildDefaultHoles,
  validateAndNormalizeHoles
};
