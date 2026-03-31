import { fail, ok } from '@/lib/apiResponse';
import { getAdminSession } from '@/lib/adminSession';

export async function GET() {
  try {
    const session = await getAdminSession();
    if (!session) return fail('Unauthorized', 401);

    return ok({ authenticated: true, role: session.role });
  } catch (error) {
    return fail('Unexpected server error', 500, error);
  }
}
