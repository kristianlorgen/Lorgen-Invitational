import { fail, ok } from '@/lib/apiResponse';
import { requireAdmin } from '@/lib/requireAdmin';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET() {
  try {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    const { data, error } = await supabaseAdmin
      .from('legacy_entries')
      .select('*')
      .order('year', { ascending: false });

    if (error) return fail('Failed to fetch legacy entries', 500, error.message);
    return ok({ legacy: data ?? [] });
  } catch (error) {
    return fail('Unexpected server error', 500, error);
  }
}

export async function POST(request: Request) {
  try {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    const body = await request.json();
    const year = Number(body.year);

    if (!Number.isInteger(year) || !body.winner_team || !body.player1 || !body.player2) {
      return fail('year, winner_team, player1 and player2 are required', 400);
    }

    const { data, error } = await supabaseAdmin
      .from('legacy_entries')
      .insert({
        year,
        winner_team: body.winner_team,
        player1: body.player1,
        player2: body.player2,
        score: body.score || null,
        score_to_par: body.score_to_par || null,
        course: body.course || null,
        notes: body.notes || null
      })
      .select('*')
      .single();

    if (error) return fail('Failed to create legacy entry', 500, error.message);
    return ok({ entry: data }, 201);
  } catch (error) {
    return fail('Unexpected server error', 500, error);
  }
}
