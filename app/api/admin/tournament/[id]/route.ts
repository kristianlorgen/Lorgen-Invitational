import { fail, ok } from '@/lib/apiResponse';
import { requireAdmin } from '@/lib/requireAdmin';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { TournamentStatus } from '@/lib/types';

function parseId(value: string) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    const { id: rawId } = await context.params;
    const id = parseId(rawId);
    if (!id) return fail('Invalid tournament id', 400);

    const body = await request.json();
    const updates: {
      name?: string;
      course?: string;
      status?: TournamentStatus;
      date?: string;
      year?: number;
      description?: string;
      slope_rating?: number;
      gameday_info?: string;
    } = {};

    if (typeof body.name === 'string') updates.name = body.name;
    if (typeof body.course === 'string') updates.course = body.course;
    if (typeof body.status === 'string') updates.status = body.status;
    if (typeof body.date === 'string') updates.date = body.date;
    if (typeof body.description === 'string') updates.description = body.description;
    if (typeof body.gameday_info === 'string') updates.gameday_info = body.gameday_info;
    if (Number.isFinite(Number(body.year))) updates.year = Number(body.year);
    if (Number.isFinite(Number(body.slope_rating))) updates.slope_rating = Number(body.slope_rating);

    const { data, error } = await supabaseAdmin
      .from('tournaments')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (error) return fail('Failed to update tournament', 500, error.message);
    return ok({ tournament: data });
  } catch (error) {
    return fail('Unexpected server error', 500, error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    const { id: rawId } = await context.params;
    const id = parseId(rawId);
    if (!id) return fail('Invalid tournament id', 400);

    const { error } = await supabaseAdmin.from('tournaments').delete().eq('id', id);
    if (error) return fail('Failed to delete tournament', 500, error.message);

    return ok({ success: true });
  } catch (error) {
    return fail('Unexpected server error', 500, error);
  }
}
