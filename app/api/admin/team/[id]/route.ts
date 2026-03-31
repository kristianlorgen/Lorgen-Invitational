import { fail, ok } from '@/lib/apiResponse';
import { requireAdmin } from '@/lib/requireAdmin';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

function asInt(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    const { id: rawId } = await context.params;
    const id = asInt(rawId);
    if (!id) return fail('Invalid team id', 400);

    const body = await request.json();
    if (!body.team_name || !body.pin_code) {
      return fail('team_name and pin_code are required', 400);
    }

    const player1Hcp = asInt(body.player1_handicap);
    const player2Hcp = asInt(body.player2_handicap);

    const { data, error } = await supabaseAdmin
      .from('teams')
      .update({
        name: String(body.team_name),
        pin_code: String(body.pin_code),
        player1_hcp: player1Hcp,
        player2_hcp: player2Hcp
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) return fail('Failed to update team', 500, error.message);

    return ok({
      team: {
        ...data,
        team_name: data.name,
        player1: '',
        player2: '',
        player1_handicap: data.player1_hcp ?? 0,
        player2_handicap: data.player2_hcp ?? 0
      }
    });
  } catch (error) {
    return fail('Unexpected server error', 500, error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    const { id: rawId } = await context.params;
    const id = asInt(rawId);
    if (!id) return fail('Invalid team id', 400);

    const { error } = await supabaseAdmin.from('teams').delete().eq('id', id);
    if (error) return fail('Failed to delete team', 500, error.message);

    return ok({ deleted: true });
  } catch (error) {
    return fail('Unexpected server error', 500, error);
  }
}
