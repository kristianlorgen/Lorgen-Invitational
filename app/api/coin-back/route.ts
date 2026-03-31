import { fail, ok } from '@/lib/apiResponse';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('coin_back_images')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) return fail('Failed to fetch coin back images', 500, error.message);

    const photos = data ?? [];
    const active = photos.find((p) => p.is_active && p.photo_path) ?? photos[0] ?? null;

    return ok({
      photos,
      photo_path: active?.photo_path ?? null,
      focal_point: active?.focal_point ?? '50% 50%'
    });
  } catch (error) {
    return fail('Unexpected server error', 500, error);
  }
}
