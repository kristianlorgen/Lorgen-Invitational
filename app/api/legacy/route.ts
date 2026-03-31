import { fail, ok } from '@/lib/apiResponse';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET() {
  try {
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
