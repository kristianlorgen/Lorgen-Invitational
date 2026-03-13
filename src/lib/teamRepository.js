const db = require('../../database');
const { normalizeTournamentFormat, getFormatDefinition, getTournamentFormatMeta, calculateTeamHandicap } = require('../../lib/tournament-formats');

function normalizeTournament(row) {
  if (!row) return null;
  const format = normalizeTournamentFormat(row.format);
  return {
    ...row,
    format,
    mode: row.mode || row.tournament_mode || (getTournamentFormatMeta(format).isTeamFormat ? 'team' : 'individual'),
    handicap_percent: Number(row.handicap_percent ?? row.handicap_percentage ?? 100),
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

function migrateLegacyTeamPlayers(tournamentId) {
  const teams = db.prepare('SELECT * FROM teams WHERE tournament_id=?').all(tournamentId);
  if (!teams.length) return;
  const hasLinks = db.prepare('SELECT 1 FROM team_players WHERE team_id IN (SELECT id FROM teams WHERE tournament_id=?) LIMIT 1').get(tournamentId);
  if (hasLinks) return;

  const findPlayer = db.prepare('SELECT id, handicap FROM players WHERE tournament_id=? AND lower(name)=lower(?) LIMIT 1');
  const insertPlayer = db.prepare('INSERT INTO players (tournament_id, name, handicap, active, updated_at) VALUES (?,?,?,1,CURRENT_TIMESTAMP)');
  const insertLink = db.prepare('INSERT INTO team_players (team_id, player_id, player_name, handicap, sort_order, updated_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)');

  db.transaction(() => {
    teams.forEach((team) => {
      const legacyPlayers = [
        { name: team.player1, handicap: team.player1_handicap },
        { name: team.player2, handicap: team.player2_handicap },
        { name: team.player3, handicap: team.player3_handicap },
        { name: team.player4, handicap: team.player4_handicap }
      ].map((p) => ({ name: String(p.name || '').trim(), handicap: Number(p.handicap || 0) })).filter((p) => p.name);

      legacyPlayers.forEach((player, index) => {
        const existingPlayer = findPlayer.get(tournamentId, player.name);
        const playerId = existingPlayer?.id || Number(insertPlayer.run(tournamentId, player.name, player.handicap).lastInsertRowid);
        insertLink.run(team.id, playerId, player.name, player.handicap, index + 1);
      });
    });
  })();
}

function enrichTeam(team, players, tournament) {
  const sortedPlayers = players.sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  const handicap_total = sortedPlayers.reduce((sum, p) => sum + Number(p.handicap || 0), 0);
  const handicap_adjusted = calculateTeamHandicap(sortedPlayers, tournament?.format || 'strokeplay', null, tournament);
  const slots = [0, 1, 2, 3].map((idx) => sortedPlayers[idx] || null);

  return {
    ...team,
    name: team.team_name,
    pin: team.pin_code,
    players: sortedPlayers,
    handicap_total,
    handicap_adjusted,
    player1: slots[0]?.player_name || '',
    player2: slots[1]?.player_name || '',
    player3: slots[2]?.player_name || '',
    player4: slots[3]?.player_name || '',
    player1_handicap: Number(slots[0]?.handicap || 0),
    player2_handicap: Number(slots[1]?.handicap || 0),
    player3_handicap: Number(slots[2]?.handicap || 0),
    player4_handicap: Number(slots[3]?.handicap || 0)
  };
}

function getTeamsByTournament(tournamentId) {
  migrateLegacyTeamPlayers(tournamentId);
  const tournament = getTournamentById(tournamentId);
  const teamRows = db.prepare('SELECT * FROM teams WHERE tournament_id=? AND active=1 ORDER BY id ASC').all(tournamentId);
  const links = db.prepare(
    `SELECT tp.id, tp.team_id, tp.player_id, tp.player_name, tp.handicap, tp.sort_order,
            p.name AS linked_player_name, p.handicap AS linked_player_handicap
     FROM team_players tp
     LEFT JOIN players p ON p.id = tp.player_id
     WHERE tp.team_id IN (SELECT id FROM teams WHERE tournament_id=? AND active=1)
     ORDER BY tp.team_id ASC, tp.sort_order ASC, tp.id ASC`
  ).all(tournamentId);

  const playersByTeam = new Map();
  links.forEach((row) => {
    const bucket = playersByTeam.get(row.team_id) || [];
    bucket.push({
      id: row.id,
      team_id: row.team_id,
      player_id: row.player_id,
      player_name: row.linked_player_name || row.player_name,
      handicap: Number(row.linked_player_handicap ?? row.handicap ?? 0),
      sort_order: Number(row.sort_order || 0)
    });
    playersByTeam.set(row.team_id, bucket);
  });

  return teamRows.map((team) => enrichTeam(team, playersByTeam.get(team.id) || [], tournament));
}

function getTeamById(teamId) {
  const team = db.prepare('SELECT * FROM teams WHERE id=? LIMIT 1').get(teamId);
  if (!team) return null;
  return getTeamsByTournament(team.tournament_id).find((row) => Number(row.id) === Number(teamId)) || null;
}

function getTeamWithPlayers(teamId) { return getTeamById(teamId); }

function getAvailablePlayersForTournament(tournamentId) {
  return db.prepare(
    `SELECT p.id, p.tournament_id, p.name, p.handicap, p.active, p.ryder_cup_side, p.created_at, p.updated_at,
            tp.team_id as assigned_team_id, t.team_name as assigned_team_name
     FROM players p
     LEFT JOIN team_players tp ON tp.player_id = p.id
     LEFT JOIN teams t ON t.id = tp.team_id AND t.tournament_id = p.tournament_id AND t.active=1
     WHERE p.tournament_id=? AND p.active=1
     ORDER BY p.name COLLATE NOCASE ASC, p.id ASC`
  ).all(tournamentId);
}

function ensureTeamName(tournamentId, proposedName = '', excludeTeamId = null) {
  const base = String(proposedName || '').trim();
  if (base) return base;
  const rows = excludeTeamId
    ? db.prepare('SELECT team_name FROM teams WHERE tournament_id=? AND id<>?').all(tournamentId, excludeTeamId)
    : db.prepare('SELECT team_name FROM teams WHERE tournament_id=?').all(tournamentId);
  const names = new Set(rows.map((r) => String(r.team_name || '').trim()));
  let idx = 1;
  while (names.has(`Lag ${idx}`)) idx += 1;
  return `Lag ${idx}`;
}

function generateUniquePin(tournamentId) {
  let attempts = 0;
  while (attempts < 10000) {
    const pin = String(1000 + Math.floor(Math.random() * 9000));
    const exists = db.prepare('SELECT 1 FROM teams WHERE tournament_id=? AND pin_code=? LIMIT 1').get(tournamentId, pin);
    if (!exists) return pin;
    attempts += 1;
  }
  throw new Error('Kunne ikke generere unik PIN');
}

function createTeam(tournamentId, payload = {}) {
  const tournament = getTournamentById(tournamentId);
  if (!tournament) throw new Error('Turnering ikke funnet');

  const teamName = ensureTeamName(tournamentId, payload.team_name);
  const pin = /^\d{4}$/.test(String(payload.pin_code || '').trim()) ? normalizePin(payload.pin_code) : generateUniquePin(tournamentId);

  const insert = db.prepare(
    `INSERT INTO teams (tournament_id, team_name, pin_code, player1, player2, player3, player4,
                        player1_handicap, player2_handicap, player3_handicap, player4_handicap,
                        handicap_total, handicap_adjusted, active, created_at, updated_at)
     VALUES (?, ?, ?, '', '', '', '', 0, 0, 0, 0, 0, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  ).run(tournamentId, teamName, pin);

  const teamId = Number(insert.lastInsertRowid);
  if (Array.isArray(payload.playerIds) && payload.playerIds.length) assignPlayersToTeam(teamId, payload.playerIds);
  return getTeamById(teamId);
}

function updateTeam(teamId, payload = {}) {
  const current = db.prepare('SELECT * FROM teams WHERE id=? LIMIT 1').get(teamId);
  if (!current) throw new Error('Lag ikke funnet');

  const teamName = ensureTeamName(current.tournament_id, payload.team_name, teamId);
  const pin = normalizePin(payload.pin_code || current.pin_code);
  if (!/^\d{4}$/.test(pin)) throw new Error('PIN må være nøyaktig 4 siffer');
  const duplicate = db.prepare('SELECT id FROM teams WHERE tournament_id=? AND pin_code=? AND id<>? LIMIT 1').get(current.tournament_id, pin, teamId);
  if (duplicate) throw new Error('PIN allerede i bruk i denne turneringen');

  db.prepare('UPDATE teams SET team_name=?, pin_code=?, active=1, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(teamName, pin, teamId);

  if (Array.isArray(payload.playerIds)) assignPlayersToTeam(teamId, payload.playerIds);
  return getTeamById(teamId);
}

function persistLegacySlots(teamId, players, tournament) {
  const slots = [0, 1, 2, 3].map((idx) => players[idx] || { player_name: '', handicap: 0 });
  const handicapTotal = players.reduce((sum, p) => sum + Number(p.handicap || 0), 0);
  const handicapAdjusted = calculateTeamHandicap(players, tournament?.format || 'strokeplay', null, tournament);
  db.prepare(
    `UPDATE teams
     SET player1=?, player2=?, player3=?, player4=?,
         player1_handicap=?, player2_handicap=?, player3_handicap=?, player4_handicap=?,
         handicap_total=?, handicap_adjusted=?, updated_at=CURRENT_TIMESTAMP
     WHERE id=?`
  ).run(
    slots[0].player_name, slots[1].player_name, slots[2].player_name, slots[3].player_name,
    Number(slots[0].handicap || 0), Number(slots[1].handicap || 0), Number(slots[2].handicap || 0), Number(slots[3].handicap || 0),
    handicapTotal, handicapAdjusted, teamId
  );
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

  const selectPlayers = unique.length
    ? db.prepare(`SELECT id, name, handicap FROM players WHERE tournament_id=? AND active=1 AND id IN (${unique.map(() => '?').join(',')})`).all(team.tournament_id, ...unique)
    : [];
  const sorted = unique.map((id) => selectPlayers.find((p) => Number(p.id) === id)).filter(Boolean);

  db.transaction(() => {
    db.prepare('DELETE FROM team_players WHERE team_id=?').run(teamId);
    if (sorted.length) {
      const unlink = db.prepare('DELETE FROM team_players WHERE player_id=? AND team_id<>?');
      const link = db.prepare('INSERT INTO team_players (team_id, player_id, player_name, handicap, sort_order, updated_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)');
      sorted.forEach((player, index) => {
        unlink.run(player.id, teamId);
        link.run(teamId, player.id, player.name, Number(player.handicap || 0), index + 1);
      });
    }
    persistLegacySlots(teamId, sorted.map((p, i) => ({ player_name: p.name, handicap: Number(p.handicap || 0), sort_order: i + 1 })), tournament);
  })();

  return getTeamById(teamId);
}

function removePlayerFromTeam(teamId, playerId) {
  const team = getTeamById(teamId);
  const remaining = (team?.players || []).filter((p) => Number(p.player_id) !== Number(playerId));
  return assignPlayersToTeam(teamId, remaining.map((p) => p.player_id));
}

function deleteTeam(teamId) {
  db.transaction(() => {
    db.prepare('DELETE FROM scores WHERE team_id=?').run(teamId);
    db.prepare('DELETE FROM team_players WHERE team_id=?').run(teamId);
    db.prepare('DELETE FROM teams WHERE id=?').run(teamId);
  })();
  return { success: true };
}

function generateTeamsAutomatically(tournamentId) {
  const tournament = getTournamentById(tournamentId);
  if (!tournament) throw new Error('Turnering ikke funnet');
  const meta = getTournamentFormatMeta(tournament.format);
  if (!meta.isTeamFormat) throw new Error('Denne spillformen bruker ikke lag');

  const available = getAvailablePlayersForTournament(tournamentId).filter((p) => !p.assigned_team_id);
  if (!available.length || (available.length % meta.teamSize) !== 0) {
    throw new Error('Antall spillere passer ikke med valgt lagstørrelse');
  }

  let createdTeams = 0;
  db.transaction(() => {
    for (let idx = 0; idx < available.length; idx += meta.teamSize) {
      const chunk = available.slice(idx, idx + meta.teamSize);
      const created = createTeam(tournamentId, { team_name: `Lag ${getTeamsByTournament(tournamentId).length + 1}`, playerIds: chunk.map((p) => p.id) });
      createdTeams += created ? 1 : 0;
    }
  })();

  return { createdTeams };
}

const generateTeamsForTournament = generateTeamsAutomatically;

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
  generateUniquePin,
  generateTeamsAutomatically,
  generateTeamsForTournament,
  getAvailablePlayersForTournament
};
