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
    console.log('CREATE TOURNAMENT BODY:', body);
    const {
      name,
      date,
      course,
      description = '',
      slope_rating = 113,
      year = date ? new Date(date).getFullYear() : undefined,
      status = 'upcoming'
    } = body ?? {};
    const parsedYear = Number(year);
    const slopeRating = Number(slope_rating);
    const parsedDate = typeof date === 'string' ? date : '';
    const parsedDescription = typeof description === 'string' ? description : '';
    const gamedayInfo = typeof body.gameday_info === 'string' ? body.gameday_info : '';

    if (!name || !course) {
      return fail('name and course are required', 400);
    }

    const { data, error } = await supabaseAdmin
      .from('tournaments')
      .insert({
        name,
        course,
        status: status as TournamentStatus,
        ...(Number.isFinite(parsedYear) ? { year: parsedYear } : {}),
        ...(parsedDate ? { date: parsedDate } : {}),
        ...(parsedDescription ? { description: parsedDescription } : {}),
        ...(gamedayInfo ? { gameday_info: gamedayInfo } : {}),
        ...(Number.isFinite(slopeRating) ? { slope_rating: slopeRating } : {})
      })
      .select('*')
      .single();

    if (error) return fail('Failed to create tournament', 500, error.message);
    return ok({ tournament: data }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
