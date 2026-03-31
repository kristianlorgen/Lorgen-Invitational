import { fail, ok } from '@/lib/apiResponse';
import { requireAdmin } from '@/lib/requireAdmin';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET() {
  try {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    const { data, error } = await supabaseAdmin
      .from('courses')
      .select('*')
      .order('name', { ascending: true });

    if (error) return fail('Failed to fetch courses', 500, error.message);
    return ok({ courses: data ?? [] });
  } catch (error) {
    return fail('Unexpected server error', 500, error);
  }
}

export async function POST(request: Request) {
  try {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    const body = await request.json();
    if (!body.name) return fail('name is required', 400);

    const { data, error } = await supabaseAdmin
      .from('courses')
      .insert({
        name: body.name,
        slope_rating: Number(body.slope_rating) || 113,
        location: body.location || '',
        notes: body.notes || ''
      })
      .select('*')
      .single();

    if (error) return fail('Failed to create course', 500, error.message);
    return ok({ course: data }, 201);
  } catch (error) {
    return fail('Unexpected server error', 500, error);
  }
}
