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
    renderEmptyTournamentState
  };
})(window);
