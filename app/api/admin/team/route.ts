import { fail, ok } from '@/lib/apiResponse';
import { requireAdmin } from '@/lib/requireAdmin';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

type LegacyTeam = {
  id: number;
  tournament_id: number;
  name: string;
  pin_code: string | null;
  player1_hcp: number | null;
  player2_hcp: number | null;
};

function asInt(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function toLegacyTeam(team: LegacyTeam) {
  return {
    ...team,
    team_name: team.name,
    player1: '',
    player2: '',
    player1_handicap: team.player1_hcp ?? 0,
    player2_handicap: team.player2_hcp ?? 0
  };
}

export async function POST(request: Request) {
  try {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    const body = await request.json();
    const tournamentId = asInt(body.tournament_id);

    if (!tournamentId || !body.team_name || !body.pin_code) {
      return fail('tournament_id, team_name and pin_code are required', 400);
    }

    const player1Hcp = asInt(body.player1_handicap);
    const player2Hcp = asInt(body.player2_handicap);

    const { data, error } = await supabaseAdmin
      .from('teams')
      .insert({
        tournament_id: tournamentId,
        name: String(body.team_name),
        pin_code: String(body.pin_code),
        player1_hcp: player1Hcp,
        player2_hcp: player2Hcp
      })
      .select('*')
      .single();

    if (error) return fail('Failed to add team', 500, error.message);
    return ok({ team: toLegacyTeam(data as LegacyTeam) }, 201);
  } catch (error) {
    return fail('Unexpected server error', 500, error);
  }
}
