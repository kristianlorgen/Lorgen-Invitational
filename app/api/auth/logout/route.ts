import { clearAdminSession } from '@/lib/adminSession';
import { fail, ok } from '@/lib/apiResponse';
import { clearTeamSession } from '@/lib/teamSession';

export async function POST() {
  try {
    await Promise.all([clearAdminSession(), clearTeamSession()]);
    return ok({ loggedOut: true });
  } catch (error) {
    return fail('Uventet serverfeil', 500, error);
  }
}
