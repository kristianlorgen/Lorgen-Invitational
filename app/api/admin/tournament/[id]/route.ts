import { fail, ok } from '@/lib/apiResponse';
import { requireAdmin } from '@/lib/requireAdmin';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { TournamentStatus } from '@/lib/types';
import { PostgrestError } from '@supabase/supabase-js';

function parseId(value: string) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const unauthorized = await requireAdmin();
    if (unauthorized) return unauthorized;

    const { id: rawId } = await context.params;
    const id = parseId(rawId);
    if (!id) return fail('Invalid tournament id', 400);

    const body = await request.json();
    const updates: {
      name?: string;
      course?: string;
      status?: TournamentStatus;
      date?: string;
      year?: number;
      description?: string;
      slope_rating?: number;
      gameday_info?: string;
    } = {};

    if (typeof body.name === 'string') updates.name = body.name;
    if (typeof body.course === 'string') updates.course = body.course;
    if (typeof body.status === 'string') updates.status = body.status;
    if (typeof body.date === 'string') updates.date = body.date;
    if (typeof body.description === 'string') updates.description = body.description;
    if (typeof body.gameday_info === 'string') updates.gameday_info = body.gameday_info;
    if (Number.isFinite(Number(body.year))) updates.year = Number(body.year);
    if (Number.isFinite(Number(body.slope_rating))) updates.slope_rating = Number(body.slope_rating);

    const { data, error } = await supabaseAdmin
      .from('tournaments')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (error) return fail('Failed to update tournament', 500, error.message);
    return ok({ tournament: data });
  } catch (error) {
    return fail('Unexpected server error', 500, error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    console.info('DELETE tournament route hit');
    const unauthorized = await requireAdmin();
    console.info('[admin.deleteTournament] auth result', { isAuthorized: !unauthorized });
    if (unauthorized) return unauthorized;

    const { id: rawId } = await context.params;
    const id = parseId(rawId);
    if (!id) return fail('Invalid tournament id', 400);
    console.info('[admin.deleteTournament] tournament id', { id });

    const isMissingTableError = (error: PostgrestError | null) =>
      Boolean(error && (error.code === '42P01' || /does not exist/i.test(error.message || '')));

    const safeDeleteByTournament = async (table: string) => {
      console.info('[admin.deleteTournament] db delete start', { table, id });
      const { error } = await supabaseAdmin.from(table).delete().eq('tournament_id', id);
      if (isMissingTableError(error)) {
        console.info('[admin.deleteTournament] db delete skipped missing table', { table });
        return;
      }
      if (error) {
        console.error('[admin.deleteTournament] db delete failure', { table, id, error });
        throw new Error(`${table}: ${error.message}`);
      }
      console.info('[admin.deleteTournament] db delete success', { table, id });
    };

    const { data: teams, error: teamsError } = await supabaseAdmin
      .from('teams')
      .select('id')
      .eq('tournament_id', id);
    if (teamsError && !isMissingTableError(teamsError)) {
      console.error('[admin.deleteTournament] team lookup failure', { id, error: teamsError });
      throw new Error(`teams lookup: ${teamsError.message}`);
    }
    const teamIds = (teams ?? []).map((team) => team.id).filter((teamId) => Number.isInteger(Number(teamId)));

    if (teamIds.length > 0) {
      console.info('[admin.deleteTournament] db delete start', { table: 'scores', id, teamIds: teamIds.length });
      const { error: scoresByTeamError } = await supabaseAdmin.from('scores').delete().in('team_id', teamIds);
      if (scoresByTeamError && !isMissingTableError(scoresByTeamError)) {
        console.error('[admin.deleteTournament] db delete failure', { table: 'scores', id, error: scoresByTeamError });
        throw new Error(`scores (team_id): ${scoresByTeamError.message}`);
      }
      console.info('[admin.deleteTournament] db delete success', { table: 'scores', id, mode: 'team_id' });
    }

    await safeDeleteByTournament('scores');
    await safeDeleteByTournament('award_claims');
    await safeDeleteByTournament('holes');
    await safeDeleteByTournament('players');
    await safeDeleteByTournament('teams');
    await safeDeleteByTournament('rounds');
    await safeDeleteByTournament('hole_images');
    await safeDeleteByTournament('tournament_gallery_images');
    await safeDeleteByTournament('gallery_photos');
    await safeDeleteByTournament('photo_votes');
    await safeDeleteByTournament('chat_messages');
    await safeDeleteByTournament('sponsors');
    await safeDeleteByTournament('awards');
    await safeDeleteByTournament('tournament_holes');

    console.info('[admin.deleteTournament] db delete start', { table: 'tournaments', id });
    const { error } = await supabaseAdmin.from('tournaments').delete().eq('id', id);
    if (error) {
      console.error('[admin.deleteTournament] db delete failure', { table: 'tournaments', id, error });
      return fail('Failed to delete tournament', 500, error.message);
    }
    console.info('[admin.deleteTournament] db delete success', { table: 'tournaments', id });

    return ok({ success: true });
  } catch (error) {
    console.error('[admin.deleteTournament] exact error', error);
    return fail('Unexpected server error', 500, error);
  }
}
