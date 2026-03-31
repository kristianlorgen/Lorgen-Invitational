import { fail, ok } from '@/lib/apiResponse';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tournamentId = Number(searchParams.get('tournament_id'));

    if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
      return fail('Valid tournament_id query param is required', 400);
    }

    const { data, error } = await supabaseAdmin
      .from('teams')
      .select('*')
      .eq('tournament_id', tournamentId)
      .order('id', { ascending: true });

    if (error) return fail('Failed to fetch teams', 500, error.message);
    return ok({ teams: data ?? [] });
  } catch (error) {
    return fail('Unexpected server error', 500, error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const tournamentId = Number(body.tournament_id);

    if (!Number.isInteger(tournamentId) || !body.name) {
      return fail('tournament_id and name are required', 400);
    }

    const { data, error } = await supabaseAdmin
      .from('teams')
      .insert({
        tournament_id: tournamentId,
        name: body.name,
        player1_hcp: Number.isInteger(body.player1_hcp) ? body.player1_hcp : null,
        player2_hcp: Number.isInteger(body.player2_hcp) ? body.player2_hcp : null,
        pin_code: typeof body.pin_code === 'string' ? body.pin_code : null
      })
      .select('*')
      .single();

    if (error) return fail('Failed to add team', 500, error.message);
    return ok({ team: data }, 201);
  } catch (error) {
    return fail('Unexpected server error', 500, error);
  }
}
