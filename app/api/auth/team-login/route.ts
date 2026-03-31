import { createTeamSession } from '@/lib/teamSession';
import { fail, ok } from '@/lib/apiResponse';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

type TeamRow = {
  id: number | string;
  tournament_id: number | string;
  pin?: string | null;
  pin_code?: string | null;
};

function normalizePin(raw: unknown) {
  return String(raw ?? '').trim();
}

function asStringId(value: number | string | null | undefined) {
  return value == null ? '' : String(value);
}

async function findTeamByPin(pin: string): Promise<TeamRow | null> {
  const attempts: Array<() => Promise<TeamRow | null>> = [
    async () => {
      const { data, error } = await supabaseAdmin
        .from('teams')
        .select('id,tournament_id,pin,pin_code')
        .or(`pin.eq.${pin},pin_code.eq.${pin}`)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as TeamRow | null) ?? null;
    },
    async () => {
      const { data, error } = await supabaseAdmin
        .from('teams')
        .select('id,tournament_id,pin')
        .eq('pin', pin)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as TeamRow | null) ?? null;
    },
    async () => {
      const { data, error } = await supabaseAdmin
        .from('teams')
        .select('id,tournament_id,pin_code')
        .eq('pin_code', pin)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as TeamRow | null) ?? null;
    }
  ];

  for (const attempt of attempts) {
    try {
      const result = await attempt();
      if (result) return result;
    } catch {
      // Try next shape for schema compatibility.
    }
  }

  return null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const pin = normalizePin(body?.pin);

    if (!/^\d{4}$/.test(pin)) {
      return fail('PIN må være nøyaktig 4 siffer', 400);
    }

    const team = await findTeamByPin(pin);
    if (!team) {
      return fail('Ugyldig PIN', 401);
    }

    const teamId = asStringId(team.id);
    const tournamentId = asStringId(team.tournament_id);

    if (!teamId || !tournamentId) {
      return fail('Kunne ikke opprette lagøkt', 500);
    }

    await createTeamSession({ team_id: teamId, tournament_id: tournamentId, pin });

    return ok({ type: 'team', team_id: teamId, tournament_id: tournamentId, pin });
  } catch (error) {
    return fail('Uventet serverfeil', 500, error);
  }
}
