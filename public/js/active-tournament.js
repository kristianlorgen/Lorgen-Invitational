(function (global) {
  async function getActiveTournamentContext() {
    try {
      const response = await fetch('/api/active-tournament-stage');
      if (!response.ok) return { tournament: null, stage: null, stages: [] };
      const data = await response.json();
      return {
        tournament: data?.tournament || null,
        stage: data?.stage || data?.activeStage || null,
        stages: Array.isArray(data?.stages) ? data.stages : []
      };
    } catch (_) {
      return { tournament: null, stage: null, stages: [] };
    }
  }

  async function getActiveTournament() {
    const ctx = await getActiveTournamentContext();
    return ctx.tournament;
  }

  async function getActiveTournamentId() {
    const tournament = await getActiveTournament();
    return tournament ? tournament.id : null;
  }

  async function getActiveStage(tournamentId) {
    const ctx = await getActiveTournamentContext();
    if (!ctx.stage) return null;
    if (tournamentId && ctx.stage.tournament_id !== tournamentId) return null;
    return ctx.stage;
  }

  async function getActiveTournamentAndStage() {
    const ctx = await getActiveTournamentContext();
    return { tournament: ctx.tournament, activeStage: ctx.stage, stages: ctx.stages };
  }

  async function getActiveTournamentFormat() {
    const ctx = await getActiveTournamentContext();
    const formatRaw = ctx.stage?.format || ctx.tournament?.format;
    if (!formatRaw) return null;
    if (global.TournamentFormats) return global.TournamentFormats.normalizeFormat(formatRaw);
    return formatRaw;
  }

  async function useActiveStage() { return getActiveStage(); }

  async function useTournamentFormat() {
    const format = await getActiveTournamentFormat();
    if (!global.TournamentFormats) return null;
    return global.TournamentFormats.getFormatDefinition(format);
  }

  function resolveTournamentPresentation(tournament, activeStage = null) {
    const effectiveFormat = activeStage?.format || tournament?.format;
    const format = global.TournamentFormats
      ? global.TournamentFormats.getFormatDefinition(effectiveFormat)
      : { key: effectiveFormat || 'strokeplay', label: effectiveFormat || 'Slagspill' };
    return { tournament, activeStage, format };
  }

  function renderEmptyTournamentState(container, options = {}) {
    if (!container) return;
    const icon = options.icon || '🏌️';
    const title = options.title || 'Ingen aktiv turnering valgt ennå.';
    const description = options.description || 'Kom tilbake senere for live resultater og turneringsinformasjon.';
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon">${icon}</div>
        <h2 class="empty-state__title">${title}</h2>
        <p class="empty-state__description">${description}</p>
      </div>`;
  }

  global.ActiveTournament = {
    getActiveTournament,
    getActiveTournamentId,
    getActiveStage,
    getActiveTournamentAndStage,
    useActiveStage,
    useActiveTournament: getActiveTournament,
    getActiveTournamentFormat,
    useTournamentFormat,
    resolveTournamentPresentation,
    renderEmptyTournamentState
  };
})(window);
