(() => {
  const path = window.location.pathname;
  const placement = path.includes('scoreboard') ? 'live_results' : path.includes('enter-score') ? 'scorecard' : path.includes('admin') ? 'admin' : path === '/' ? 'frontpage' : null;

  const css = `
    .ad-slot { margin: 28px auto; max-width: 1080px; padding: 0 24px; }
    .ad-slot__grid { display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px; }
    .ad-card { border:1px solid var(--gold-border);border-radius:var(--radius);background:var(--white);padding:16px;display:flex;align-items:center;gap:14px;box-shadow:var(--shadow-sm);min-height:96px; }
    .ad-card:hover { box-shadow:var(--shadow); }
    .ad-card__logo { width:96px;height:64px;border-radius:8px;background:var(--gold-pale);border:1px solid var(--gold-border);display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;padding:8px; }
    .ad-card__logo img { width:100%;height:100%;object-fit:contain; }
    .ad-card__fallback { font-weight:800;color:var(--gold-dark);font-size:1rem;text-align:center; }
    .ad-card__eyebrow { font-size:.64rem;text-transform:uppercase;letter-spacing:.16em;color:var(--gold-dark);font-weight:800;margin-bottom:3px; }
    .ad-card__name { font-family:var(--font-heading);font-size:1.1rem;color:var(--dark);font-weight:700;line-height:1.2; }
    .ad-card__desc { font-size:.78rem;color:var(--text-muted);line-height:1.35;margin-top:3px; }
    .hole-sponsors-strip { margin:28px auto;max-width:1080px;padding:0 24px; }
    .hole-sponsors-strip__grid { display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px; }
    .hole-sponsor-chip { border:1px solid var(--gold-border);background:linear-gradient(135deg,rgba(201,168,76,.12),#fff);border-radius:var(--radius);padding:10px;display:flex;gap:10px;align-items:center; }
    .hole-sponsor-chip__nr { width:34px;height:34px;border-radius:50%;background:var(--gold);color:var(--dark);font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:.78rem; }
    .hole-sponsor-chip__name { font-size:.84rem;font-weight:800;color:var(--dark);line-height:1.2; }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  function initials(name) {
    return String(name || 'Sponsor').split(' ').map(x => x[0]).filter(Boolean).slice(0,2).join('').toUpperCase();
  }

  function card(sponsor, eyebrow = 'Annonse') {
    const body = `
      <article class="ad-card">
        <div class="ad-card__logo">
          ${sponsor.logo_path ? `<img src="${sponsor.logo_path}" alt="${sponsor.sponsor_name || 'Sponsor'}">` : `<div class="ad-card__fallback">${initials(sponsor.sponsor_name)}</div>`}
        </div>
        <div>
          <div class="ad-card__eyebrow">${eyebrow}</div>
          <div class="ad-card__name">${sponsor.sponsor_name || 'Sponsor'}</div>
          ${sponsor.description ? `<div class="ad-card__desc">${sponsor.description}</div>` : ''}
        </div>
      </article>`;
    return sponsor.sponsor_url ? `<a href="${sponsor.sponsor_url}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit">${body}</a>` : body;
  }

  function insertAfter(anchor, node) {
    if (!anchor || !anchor.parentNode) return document.body.appendChild(node);
    anchor.parentNode.insertBefore(node, anchor.nextSibling);
  }

  function placementAnchor() {
    if (placement === 'frontpage') return document.getElementById('hero');
    if (placement === 'live_results') return document.querySelector('.page-hero');
    if (placement === 'scorecard') return document.getElementById('scorecardScreen') || document.querySelector('.page-hero') || document.body.firstElementChild;
    if (placement === 'admin') return document.querySelector('#panel-dashboard .dash-hero') || document.querySelector('#adminPanel .admin-content');
    return null;
  }

  function addAdminSponsorControls() {
    if (!path.includes('admin') || path.includes('sponsor-admin')) return;

    const turneringSection = Array.from(document.querySelectorAll('.sidebar-section')).find(section => {
      const label = section.querySelector('.sidebar-label');
      return label && label.textContent.trim().toLowerCase() === 'turnering';
    });

    if (turneringSection && !turneringSection.querySelector('[data-sponsor-admin-link]')) {
      const link = document.createElement('div');
      link.className = 'sidebar-link';
      link.dataset.sponsorAdminLink = 'true';
      link.onclick = () => { window.location.href = '/sponsor-admin'; };
      link.innerHTML = '<i class="fas fa-handshake"></i> Sponsorer';
      turneringSection.appendChild(link);
    }

    const dashboardActions = document.querySelector('#panel-dashboard .card + div[style*="margin-top:20px"]');
    if (dashboardActions && !dashboardActions.querySelector('[data-sponsor-admin-button]')) {
      const button = document.createElement('a');
      button.href = '/sponsor-admin';
      button.className = 'btn btn--dark btn--sm';
      button.dataset.sponsorAdminButton = 'true';
      button.innerHTML = '<i class="fas fa-handshake"></i> Sponsorer';
      dashboardActions.appendChild(button);
    }
  }

  async function activeTournamentId() {
    try {
      const r = await fetch('/api/tournament');
      const d = await r.json();
      return d?.tournament?.id || null;
    } catch (_) {
      return null;
    }
  }

  async function renderPlacementAds(tournamentId) {
    if (!placement || placement === 'admin') return;
    const query = tournamentId ? `&tournament_id=${tournamentId}` : '';
    const r = await fetch(`/api/sponsors?placement=${placement}${query}`);
    const d = await r.json();
    const sponsors = (d.sponsors || []).filter(s => s.is_enabled !== false && s.placement === placement);
    if (!sponsors.length) return;
    const section = document.createElement('section');
    section.className = 'ad-slot';
    section.innerHTML = `<div class="ad-slot__grid">${sponsors.map(s => card(s, placement === 'frontpage' ? 'Sponsor' : 'Annonse')).join('')}</div>`;
    insertAfter(placementAnchor(), section);
  }

  async function renderHoleSponsors(tournamentId) {
    if (!tournamentId || !['live_results', 'scorecard'].includes(placement)) return;
    const r = await fetch(`/api/sponsors?placement=hole&tournament_id=${tournamentId}`);
    const d = await r.json();
    const sponsors = (d.sponsors || []).filter(s => s.is_enabled !== false && s.hole_number);
    if (!sponsors.length) return;
    const section = document.createElement('section');
    section.className = 'hole-sponsors-strip';
    section.innerHTML = `<div class="section-header" style="margin-bottom:16px"><span class="section-tag">Hullsponsorer</span><h2 class="section-title">Partnere <span>per hull</span></h2></div><div class="hole-sponsors-strip__grid">${sponsors.map(s => {
      const chip = `<div class="hole-sponsor-chip"><div class="hole-sponsor-chip__nr">${s.hole_number}</div><div class="hole-sponsor-chip__name">${s.sponsor_name || 'Sponsor'}</div></div>`;
      return s.sponsor_url ? `<a href="${s.sponsor_url}" target="_blank" rel="noopener" style="text-decoration:none">${chip}</a>` : chip;
    }).join('')}</div>`;
    const anchor = placement === 'live_results' ? document.getElementById('scorecardSection') : document.getElementById('scorecardScreen');
    insertAfter(anchor || placementAnchor(), section);
  }

  document.addEventListener('DOMContentLoaded', async () => {
    addAdminSponsorControls();
    const tournamentId = await activeTournamentId();
    await renderPlacementAds(tournamentId);
    await renderHoleSponsors(tournamentId);
  });
})();
