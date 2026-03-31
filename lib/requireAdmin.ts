import { fail } from './apiResponse';
import { getAdminSession } from './adminSession';

export async function requireAdmin() {
  const session = await getAdminSession();
  if (!session || session.role !== 'admin') {
    return fail('Unauthorized', 401);
  }

  return null;
}
