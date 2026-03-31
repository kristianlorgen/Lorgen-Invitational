import { fail, ok } from '@/lib/apiResponse';
import { requireAdmin } from '@/lib/requireAdmin';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { TournamentStatus } from '@/lib/types';

export async function GET() {
  try {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    const { data, error } = await supabaseAdmin
      .from('tournaments')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) return fail('Failed to fetch tournaments', 500, error.message);
    return ok({ tournaments: data ?? [] });
  } catch (error) {
    return fail('Unexpected server error', 500, error);
  }
}

export async function POST(request: Request) {
  try {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    const body = await request.json();
    const status = (body.status ?? 'upcoming') as TournamentStatus;

    if (!body.name || !body.course) {
      return fail('name and course are required', 400);
    }

    const { data, error } = await supabaseAdmin
      .from('tournaments')
      .insert({ name: body.name, course: body.course, status })
      .select('*')
      .single();

    if (error) return fail('Failed to create tournament', 500, error.message);
    return ok({ tournament: data }, 201);
  } catch (error) {
    return fail('Unexpected server error', 500, error);
  }
}
