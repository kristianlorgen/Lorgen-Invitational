const { ok, fail, methodNotAllowed, readJsonBody } = require('../../../lib/json');
const { getSupabaseAdmin } = require('../../../lib/supabaseAdmin');
const { asInt, asNumber, validatePin, canonicalTeamRow } = require('../../../lib/validators');

const CANONICAL_TEAM_COLUMNS = 'id, tournament_id, team_name, player1_name, player2_name, pin, hcp_player1, hcp_player2';

async function getTeams(req, res) {
  const tournamentId = asInt(req.query?.tournament_id);
  if (!tournamentId) return fail(res, 400, 'tournament_id must be an integer');

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('teams')
    .select(CANONICAL_TEAM_COLUMNS)
    .eq('tournament_id', tournamentId)
    .order('id', { ascending: true });

  if (error) return fail(res, 500, error.message);

  return ok(res, (data || []).map(canonicalTeamRow));
}

async function createTeam(req, res) {
  const body = await readJsonBody(req);
  const tournamentId = asInt(body.tournament_id);
  const teamName = String(body.team_name || '').trim();
  const player1Name = String(body.player1_name || '').trim();
  const player2Name = String(body.player2_name || '').trim();
  const pin = String(body.pin || '').trim();
  const hcpPlayer1 = asNumber(body.hcp_player1);
  const hcpPlayer2 = asNumber(body.hcp_player2);

  if (!tournamentId) return fail(res, 400, 'tournament_id must be an integer');
  if (!teamName || !player1Name || !player2Name) return fail(res, 400, 'Missing required team fields');
  if (!validatePin(pin)) return fail(res, 400, 'pin must be exactly 4 digits');
  if (hcpPlayer1 === null || hcpPlayer2 === null) return fail(res, 400, 'hcp_player1 and hcp_player2 must be numbers');

  const supabase = getSupabaseAdmin();
  const payload = {
    tournament_id: tournamentId,
    team_name: teamName,
    player1_name: player1Name,
    player2_name: player2Name,
    pin,
    hcp_player1: hcpPlayer1,
    hcp_player2: hcpPlayer2
  };

  const { data, error } = await supabase
    .from('teams')
    .insert(payload)
    .select(CANONICAL_TEAM_COLUMNS)
    .single();

  if (error) return fail(res, 500, error.message);

  return ok(res, canonicalTeamRow(data), 201);
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') return await getTeams(req, res);
    if (req.method === 'POST') return await createTeam(req, res);
    return methodNotAllowed(res, ['GET', 'POST']);
  } catch (error) {
    return fail(res, 500, error.message || 'Unexpected server error');
  }
};
