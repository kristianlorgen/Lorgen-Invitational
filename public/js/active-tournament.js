(function (global) {
  async function getActiveTournament() {
    try {
      const response = await fetch('/api/active-tournament');
      if (!response.ok) return null;
      const data = await response.json();
      return data && data.tournament ? data.tournament : null;
    } catch (_) {
      return null;
    }
  }

  async function getActiveTournamentId() {
    const tournament = await getActiveTournament();
    return tournament ? tournament.id : null;
  }


  async function getActiveTournamentFormat() {
    const tournament = await getActiveTournament();
    if (!tournament) return null;
    if (global.TournamentFormats) {
      return global.TournamentFormats.normalizeFormat(tournament.format);
    }
    return tournament.format || null;
  }

  async function useTournamentFormat() {
    const format = await getActiveTournamentFormat();
    if (!global.TournamentFormats) return null;
    return global.TournamentFormats.getFormatDefinition(format);
  }

  function resolveTournamentPresentation(tournament) {
    const format = global.TournamentFormats
      ? global.TournamentFormats.getFormatDefinition(tournament?.format)
      : { key: tournament?.format || 'strokeplay', label: tournament?.format || 'Slagspill' };
    return { tournament, format };
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
    useActiveTournament: getActiveTournament,
    getActiveTournamentFormat,
    useTournamentFormat,
    resolveTournamentPresentation,
    renderEmptyTournamentState
  };
})(window);
