import { fail, ok } from '@/lib/apiResponse';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('tournament_gallery_images')
      .select('*')
      .eq('is_published', true)
      .order('uploaded_at', { ascending: false })
      .limit(24);

    if (error) return fail('Failed to fetch gallery', 500, error.message);
    return ok({ photos: data ?? [] });
  } catch (error) {
    return fail('Unexpected server error', 500, error);
  }
}
