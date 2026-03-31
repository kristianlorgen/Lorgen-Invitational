import { fail, ok } from '@/lib/apiResponse';
import { requireAdmin } from '@/lib/requireAdmin';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    const { id: rawId } = await context.params;
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0) return fail('Invalid legacy id', 400);

    const { error } = await supabaseAdmin.from('legacy_entries').delete().eq('id', id);
    if (error) return fail('Failed to delete legacy entry', 500, error.message);

    return ok({ deleted: true });
  } catch (error) {
    return fail('Unexpected server error', 500, error);
  }
}
