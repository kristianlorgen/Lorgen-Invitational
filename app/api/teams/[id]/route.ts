import { fail, ok } from '@/lib/apiResponse';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await context.params;
    const id = Number(rawId);

    if (!Number.isInteger(id) || id <= 0) {
      return fail('Invalid team id', 400);
    }

    const { error } = await supabaseAdmin.from('teams').delete().eq('id', id);
    if (error) return fail('Failed to delete team', 500, error.message);

    return ok({ success: true });
  } catch (error) {
    return fail('Unexpected server error', 500, error);
  }
}
