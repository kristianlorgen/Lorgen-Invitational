import { fail, ok } from '@/lib/apiResponse';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('tournaments')
      .select('*')
      .or('status.eq.active,status.eq.upcoming')
      .order('date', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) return fail('Failed to fetch tournament', 500, error.message);
    return ok({ tournament: data ?? null });
  } catch (error) {
    return fail('Unexpected server error', 500, error);
  }
}
