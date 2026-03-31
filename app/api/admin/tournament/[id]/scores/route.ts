import { fail, ok } from '@/lib/apiResponse';
import { requireAdmin } from '@/lib/requireAdmin';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    const { id: rawId } = await context.params;
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0) return fail('Invalid tournament id', 400);

    const { data, error } = await supabaseAdmin
      .from('scores')
      .select('*')
      .eq('tournament_id', id)
      .order('created_at', { ascending: false });

    if (error) return fail('Failed to fetch scores', 500, error.message);
    return ok({ scores: data ?? [] });
  } catch (error) {
    return fail('Unexpected server error', 500, error);
  }
}
