import { fail, ok } from '@/lib/apiResponse';
import { requireAdmin } from '@/lib/requireAdmin';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function PUT(request: Request) {
  try {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    const body = await request.json();
    const focalPoint = typeof body.focal_point === 'string' ? body.focal_point : '50% 50%';

    const { data: activeRows, error: fetchError } = await supabaseAdmin
      .from('coin_back_images')
      .select('id')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1);

    if (fetchError) return fail('Failed to fetch coin back image', 500, fetchError.message);

    const activeId = activeRows?.[0]?.id;
    if (!activeId) return ok({ success: true });

    const { error } = await supabaseAdmin
      .from('coin_back_images')
      .update({ focal_point: focalPoint })
      .eq('id', activeId);

    if (error) return fail('Failed to update focal point', 500, error.message);

    return ok({ success: true });
  } catch (error) {
    return fail('Unexpected server error', 500, error);
  }
}
