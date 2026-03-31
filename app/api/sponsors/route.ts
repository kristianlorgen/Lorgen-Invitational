import { fail, ok } from '@/lib/apiResponse';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const placement = searchParams.get('placement');

    let query = supabaseAdmin
      .from('sponsors')
      .select('*')
      .eq('is_enabled', true)
      .order('spot_number', { ascending: true });

    if (placement) query = query.eq('placement', placement);

    const { data, error } = await query;

    if (error) return fail('Failed to fetch sponsors', 500, error.message);
    return ok({ sponsors: data ?? [] });
  } catch (error) {
    return fail('Unexpected server error', 500, error);
  }
}
