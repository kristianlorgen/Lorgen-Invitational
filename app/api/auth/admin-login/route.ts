import { createAdminSession } from '@/lib/adminSession';
import { fail, ok } from '@/lib/apiResponse';
import { env } from '@/lib/env';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!env.adminPassword) {
      return fail('ADMIN_PASSWORD is not configured', 500);
    }

    if (body.password !== env.adminPassword) {
      return fail('Invalid credentials', 401);
    }

    await createAdminSession();
    return ok({ authenticated: true });
  } catch (error) {
    return fail('Unexpected server error', 500, error);
  }
}
