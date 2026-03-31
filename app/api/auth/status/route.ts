import { fail, ok } from '@/lib/apiResponse';
import { getAdminSession } from '@/lib/adminSession';
import { getTeamSession } from '@/lib/teamSession';

export async function GET() {
  try {
    const admin = await getAdminSession();
    if (admin?.role === 'admin') {
      return ok({ authenticated: true, type: 'admin', role: 'admin' });
    }

    const team = await getTeamSession();
    if (team?.team_id && team?.tournament_id) {
      return ok({
        authenticated: true,
        type: 'team',
        team_id: team.team_id,
        tournament_id: team.tournament_id,
        pin: team.pin
      });
    }

    return fail('Ikke logget inn', 401);
  } catch (error) {
    return fail('Uventet serverfeil', 500, error);
  }
}
