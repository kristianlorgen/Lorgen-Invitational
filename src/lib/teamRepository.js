const db = require('../../database');
const { normalizeTournamentFormat, getFormatDefinition, getTournamentFormatMeta } = require('../../lib/tournament-formats');

function normalizeTournament(row) {
  if (!row) return null;
  const format = normalizeTournamentFormat(row.format);
  return {
    ...row,
    format,
    format_label: getFormatDefinition(format).label
  };
}

function normalizePin(pin) {
  return String(pin || '').replace(/\D/g, '').slice(0, 4).padStart(4, '0');
}

function getTournamentById(tournamentId) {
  const row = db.prepare('SELECT * FROM tournaments WHERE id=? LIMIT 1').get(tournamentId);
  return normalizeTournament(row);
}

function getActiveTournament() {
  const explicit = db.prepare("SELECT value FROM site_settings WHERE key='activeTournamentId' LIMIT 1").get();
  const explicitId = parseInt(explicit?.value || '', 10);
  if (Number.isFinite(explicitId)) {
    const tournament = getTournamentById(explicitId);
    if (tournament && tournament.status !== 'archived') return tournament;
  }
  const fallback = db.prepare("SELECT * FROM tournaments WHERE active=1 ORDER BY updated_at DESC, id DESC LIMIT 1").get();
  return normalizeTournament(fallback);
}

function hydrateTeams(teamRows, tournamentId) {
  const links = db.prepare(
    `SELECT tp.*, p.name AS linked_player_name, p.handicap AS linked_player_handicap, p.tournament_id AS player_tournament_id
     FROM team_players tp
     LEFT JOIN players p ON p.id = tp.player_id
     WHERE tp.team_id IN (SELECT id FROM teams WHERE tournament_id=?)
     ORDER BY tp.team_id ASC, tp.sort_order ASC, tp.id ASC`
  ).all(tournamentId);

  const playersByTeam = new Map();
  links.forEach((row) => {
    const bucket = playersByTeam.get(row.team_id) || [];
    bucket.push({
      id: row.id,
      player_id: row.player_id,
      player_name: row.linked_player_name || row.player_name,
      handicap: row.linked_player_handicap ?? row.handicap ?? 0,
      sort_order: row.sort_order
    });
    playersByTeam.set(row.team_id, bucket);
  });

  return teamRows.map((team) => {
    const linksForTeam = playersByTeam.get(team.id) || [];
    const fallbackPlayers = [
      { player_name: team.player1, handicap: team.player1_handicap, sort_order: 1 },
      { player_name: team.player2, handicap: team.player2_handicap, sort_order: 2 },
      { player_name: team.player3, handicap: team.player3_handicap, sort_order: 3 },
      { player_name: team.player4, handicap: team.player4_handicap, sort_order: 4 }
    ].filter((p) => String(p.player_name || '').trim());
    const players = linksForTeam.length ? linksForTeam : fallbackPlayers;
    const handicap_total = players.reduce((sum, p) => sum + Number(p.handicap || 0), 0);
    return { ...team, players, handicap_total, handicap_adjusted: handicap_total };
  });
}

function getTeamsByTournament(tournamentId) {
  const teamRows = db.prepare('SELECT * FROM teams WHERE tournament_id=? AND active=1 ORDER BY team_name COLLATE NOCASE ASC, id ASC').all(tournamentId);
  return hydrateTeams(teamRows, tournamentId);
}

function getTeamById(teamId) {
  const team = db.prepare('SELECT * FROM teams WHERE id=? LIMIT 1').get(teamId);
  if (!team) return null;
  return hydrateTeams([team], team.tournament_id)[0] || null;
}

function getTeamWithPlayers(teamId) { return getTeamById(teamId); }

function getAvailablePlayersForTournament(tournamentId) {
  return db.prepare('SELECT id, tournament_id, name, handicap, active, ryder_cup_side, created_at, updated_at FROM players WHERE tournament_id=? AND active=1 ORDER BY name COLLATE NOCASE ASC, id ASC').all(tournamentId);
}

function ensurePlayer(tournamentId, player) {
  const name = String(player?.name || '').trim();
  if (!name) return null;
  const handicap = Number(player?.handicap || 0);
  const found = db.prepare('SELECT id FROM players WHERE tournament_id=? AND lower(name)=lower(?) LIMIT 1').get(tournamentId, name);
  if (found?.id) {
    db.prepare('UPDATE players SET handicap=?, active=1, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(handicap, found.id);
    return found.id;
  }
  const inserted = db.prepare('INSERT INTO players (tournament_id, name, handicap, active, updated_at) VALUES (?,?,?,1,CURRENT_TIMESTAMP)').run(tournamentId, name, handicap);
  return Number(inserted.lastInsertRowid);
}

function assignPlayersToTeam(teamId, playerIds = []) {
  const team = db.prepare('SELECT id, tournament_id FROM teams WHERE id=? LIMIT 1').get(teamId);
  if (!team) throw new Error('Lag ikke funnet');
  const tournament = getTournamentById(team.tournament_id);
  const meta = getTournamentFormatMeta(tournament?.format || 'strokeplay');

  const unique = [...new Set(playerIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  if (meta.isTeamFormat && unique.length > Number(meta.teamSize || 0)) {
    throw new Error(`Formatet krever maks ${meta.teamSize} spillere per lag`);
  }

  const players = unique.length
    ? db.prepare(`SELECT id, name, handicap FROM players WHERE tournament_id=? AND active=1 AND id IN (${unique.map(() => '?').join(',')})`).all(team.tournament_id, ...unique)
    : [];

  db.transaction(() => {
    db.prepare('DELETE FROM team_players WHERE team_id=?').run(teamId);
    const insertLink = db.prepare('INSERT INTO team_players (team_id, player_id, player_name, handicap, sort_order, updated_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)');
    players.forEach((player, index) => {
      insertLink.run(teamId, player.id, player.name, Number(player.handicap || 0), index + 1);
    });

    const slots = [0, 1, 2, 3].map((idx) => players[idx] || { name: '', handicap: 0 });
    db.prepare('UPDATE teams SET player1=?, player2=?, player3=?, player4=?, player1_handicap=?, player2_handicap=?, player3_handicap=?, player4_handicap=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .run(slots[0].name, slots[1].name, slots[2].name, slots[3].name, Number(slots[0].handicap || 0), Number(slots[1].handicap || 0), Number(slots[2].handicap || 0), Number(slots[3].handicap || 0), teamId);
  })();

  return getTeamById(teamId);
}

function removePlayerFromTeam(teamId, playerId) {
  const team = getTeamById(teamId);
  const remaining = (team?.players || []).filter((p) => Number(p.player_id) !== Number(playerId));
  return assignPlayersToTeam(teamId, remaining.map((p) => p.player_id).filter(Boolean));
}

function createTeam(tournamentId, payload = {}) {
  const tournament = getTournamentById(tournamentId);
  if (!tournament) throw new Error('Turnering ikke funnet');
  const existingNames = db.prepare('SELECT team_name FROM teams WHERE tournament_id=?').all(tournamentId).map((r) => String(r.team_name || ''));
  let i = 1;
  while (existingNames.includes(`Lag ${i}`)) i += 1;
  const team_name = String(payload.team_name || '').trim() || `Lag ${i}`;
  let pin = normalizePin(payload.pin_code);
  if (!/^\d{4}$/.test(pin)) {
    do { pin = String(Math.floor(1000 + Math.random() * 9000)); }
    while (db.prepare('SELECT 1 FROM teams WHERE tournament_id=? AND pin_code=? LIMIT 1').get(tournamentId, pin));
  }
  if (db.prepare('SELECT 1 FROM teams WHERE tournament_id=? AND pin_code=? LIMIT 1').get(tournamentId, pin)) {
    throw new Error('PIN allerede i bruk i denne turneringen');
  }

  const insert = db.prepare('INSERT INTO teams (tournament_id, team_name, player1, player2, player3, player4, pin_code, player1_handicap, player2_handicap, player3_handicap, player4_handicap, active) VALUES (?,?,?,?,?,?,?,?,?,?,?,1)')
    .run(tournamentId, team_name, '', '', '', '', pin, 0, 0, 0, 0);
  const teamId = Number(insert.lastInsertRowid);

  const playerList = Array.isArray(payload.players) ? payload.players : [];
  if (playerList.length) {
    const ids = playerList.map((p) => ensurePlayer(tournamentId, p)).filter(Boolean);
    assignPlayersToTeam(teamId, ids);
  }
  return getTeamById(teamId);
}

function updateTeam(teamId, payload = {}) {
  const current = db.prepare('SELECT * FROM teams WHERE id=? LIMIT 1').get(teamId);
  if (!current) throw new Error('Lag ikke funnet');
  const team_name = String(payload.team_name || current.team_name || '').trim() || current.team_name;
  const pin = normalizePin(payload.pin_code || current.pin_code);
  if (!/^\d{4}$/.test(pin)) throw new Error('PIN må være nøyaktig 4 siffer');
  const duplicate = db.prepare('SELECT id FROM teams WHERE tournament_id=? AND pin_code=? AND id<>? LIMIT 1').get(current.tournament_id, pin, teamId);
  if (duplicate) throw new Error('PIN allerede i bruk i denne turneringen');

  db.prepare('UPDATE teams SET team_name=?, pin_code=?, active=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(team_name, pin, payload.active === 0 ? 0 : 1, teamId);

  if (Array.isArray(payload.players)) {
    const ids = payload.players.map((p) => ensurePlayer(current.tournament_id, p)).filter(Boolean);
    assignPlayersToTeam(teamId, ids);
  }
  return getTeamById(teamId);
}

function deleteTeam(teamId) {
  db.transaction(() => {
    db.prepare('DELETE FROM scores WHERE team_id=?').run(teamId);
    db.prepare('DELETE FROM team_players WHERE team_id=?').run(teamId);
    db.prepare('DELETE FROM teams WHERE id=?').run(teamId);
  })();
  return { success: true };
}

function generateTeamsForTournament(tournamentId) {
  const tournament = getTournamentById(tournamentId);
  if (!tournament) throw new Error('Turnering ikke funnet');
  const meta = getTournamentFormatMeta(tournament.format);
  if (!meta.isTeamFormat) throw new Error('Denne spillformen bruker ikke lag');
  const players = getAvailablePlayersForTournament(tournamentId);
  if (!players.length || (players.length % meta.teamSize) !== 0) throw new Error('Antall spillere passer ikke med valgt lagstørrelse');

  const existing = getTeamsByTournament(tournamentId);
  if (existing.length) throw new Error('Slett eksisterende lag før automatisk generering');

  let createdTeams = 0;
  for (let idx = 0; idx < players.length; idx += meta.teamSize) {
    const chunk = players.slice(idx, idx + meta.teamSize);
    createTeam(tournamentId, {
      team_name: `Lag ${createdTeams + 1}`,
      players: chunk.map((p) => ({ name: p.name, handicap: p.handicap }))
    });
    createdTeams += 1;
  }
  return { createdTeams };
}

module.exports = {
  getTournamentById,
  getActiveTournament,
  getTeamsByTournament,
  getTeamById,
  getTeamWithPlayers,
  createTeam,
  updateTeam,
  deleteTeam,
  assignPlayersToTeam,
  removePlayerFromTeam,
  generateTeamsForTournament,
  getAvailablePlayersForTournament
};
