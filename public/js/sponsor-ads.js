(() => {
  const path = window.location.pathname;
  let placement = path.includes('scoreboard') ? 'live_results' : path.includes('enter-score') || path.includes('scorecard') ? 'scorecard' : path.includes('admin') ? 'admin' : (path === '/' || path.includes('index') || path.includes('home')) ? 'frontpage' : null;

  const css = `
    .ad-slot { margin: 40px auto; max-width: 1280px; padding: 0 24px; }
    .ad-slot__label { margin: 0 0 18px; text-align:center; font-size:.68rem; font-weight:800; letter-spacing:.32em; text-transform:uppercase; color:var(--text-muted); }
    .ad-slot__grid { display:flex; justify-content:center; flex-wrap:wrap; gap:32px; }
    .sponsor-display-card { width:min(440px, calc(100vw - 48px)); border:1px solid var(--gold-border); border-radius:12px; background:var(--white); box-shadow:var(--shadow-sm); padding:28px 24px; display:flex; flex-direction:column; align-items:center; gap:20px; text-align:center; }
    .sponsor-display-card__logo { width:min(260px, 100%); height:320px; background:var(--gold-pale); border:1px solid var(--gold-border); display:flex; align-items:center; justify-content:center; overflow:hidden; }
    .sponsor-display-card__logo img { width:100%; height:100%; object-fit:cover; display:block; }
    .sponsor-display-card__fallback { font-weight:800; color:var(--gold-dark); font-size:1.9rem; }
    .sponsor-display-card__name { font-weight:800; color:var(--dark); font-size:1.35rem; line-height:1.18; }
    .sponsor-display-card__desc { font-size:.95rem; color:var(--text-muted); line-height:1.4; margin-top:8px; }
    .current-hole-sponsor { margin: 0 0 18px; }
    .current-hole-sponsor__link { text-decoration:none; color:inherit; display:block; }
    .current-hole-sponsor__card { border:1px solid var(--gold-border); background:var(--gold-pale); border-radius:var(--radius-sm); padding:10px; display:flex; align-items:center; gap:12px; }
    .current-hole-sponsor__logo { width:72px; height:72px; background:var(--white); border:1px solid var(--gold-border); display:flex; align-items:center; justify-content:center; overflow:hidden; flex-shrink:0; }
    .current-hole-sponsor__logo img { width:100%; height:100%; object-fit:cover; display:block; }
    .current-hole-sponsor__fallback { font-size:.95rem; font-weight:800; color:var(--gold-dark); }
    .current-hole-sponsor__label { font-size:.62rem; font-weight:800; letter-spacing:.12em; color:var(--text-muted); text-transform:uppercase; margin-bottom:4px; }
    .current-hole-sponsor__name { font-size:.9rem; font-weight:800; color:var(--dark); line-height:1.2; }
    .current-hole-sponsor__desc { font-size:.72rem; color:var(--text-muted); line-height:1.3; margin-top:3px; }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  function initials(name) {
    return String(name || 'Sponsor').split(' ').map(x => x[0]).filter(Boolean).slice(0,2).join('').toUpperCase();
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
  }

  function sponsorLogo(sponsor) {
    return sponsor.logo_path || sponsor.sponsor_logo || sponsor.logo_url || '';
  }

  function sponsorName(sponsor) {
    return sponsor.sponsor_name || sponsor.name || 'Sponsor';
  }

  function displayCard(sponsor) {
    const logo = sponsorLogo(sponsor);
    const name = sponsorName(sponsor);
    const body = `
      <article class="sponsor-display-card">
        <div class="sponsor-display-card__logo">
          ${logo ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(name)}">` : `<div class="sponsor-display-card__fallback">${escapeHtml(initials(name))}</div>`}
        </div>
        <div>
          <div class="sponsor-display-card__name">${escapeHtml(name)}</div>
          ${sponsor.description ? `<div class="sponsor-display-card__desc">${escapeHtml(sponsor.description)}</div>` : ''}
        </div>
      </article>`;
    return sponsor.sponsor_url ? `<a href="${escapeHtml(sponsor.sponsor_url)}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit">${body}</a>` : body;
  }

  function currentHoleCard(sponsor) {
    const logo = sponsorLogo(sponsor);
    const name = sponsorName(sponsor);
    const body = `
      <div class="current-hole-sponsor__card">
        <div class="current-hole-sponsor__logo">
          ${logo ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(name)}">` : `<div class="current-hole-sponsor__fallback">${escapeHtml(initials(name))}</div>`}
        </div>
        <div>
          <div class="current-hole-sponsor__label">Hullsponsor</div>
          <div class="current-hole-sponsor__name">${escapeHtml(name)}</div>
          ${sponsor.description ? `<div class="current-hole-sponsor__desc">${escapeHtml(sponsor.description)}</div>` : ''}
        </div>
      </div>`;
    return sponsor.sponsor_url ? `<a class="current-hole-sponsor__link" href="${escapeHtml(sponsor.sponsor_url)}" target="_blank" rel="noopener">${body}</a>` : body;
  }

  function insertAfter(anchor, node) {
    if (!anchor || !anchor.parentNode) return document.body.appendChild(node);
    anchor.parentNode.insertBefore(node, anchor.nextSibling);
  }

  function placementAnchor() {
    if (placement === 'frontpage') return document.querySelector('#hero .hero-actions') || document.getElementById('hero');
    if (placement === 'live_results') return document.getElementById('noTournamentState') || document.querySelector('.page-hero');
    if (placement === 'scorecard') return document.querySelector('#scorecardScreen .page-hero') || document.getElementById('scorecardScreen') || document.querySelector('.page-hero') || document.body.firstElementChild;
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

  async function fetchSponsors(targetPlacement, tournamentId = null) {
    const params = new URLSearchParams({ placement: targetPlacement });
    if (tournamentId) params.set('tournament_id', tournamentId);
    const r = await fetch(`/api/sponsors?${params.toString()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`Sponsor API ${r.status}`);
    return r.json();
  }

  async function renderPlacementAds() {
    if (!placement && document.getElementById('hero')) placement = 'frontpage';
    if (!placement || placement === 'admin' || document.querySelector(`[data-sponsor-placement="${placement}"], [data-server-sponsor-placement="${placement}"]`)) return { tournament_id: null };
    const d = await fetchSponsors(placement);
    const sponsors = (d.sponsors || []).filter(s => s.is_enabled !== false && s.placement === placement);
    if (!sponsors.length) return { tournament_id: d.tournament_id || null };
    const section = document.createElement('section');
    section.className = 'ad-slot';
    section.dataset.sponsorPlacement = placement;
    section.innerHTML = `<div class="ad-slot__label">Sponsorer</div><div class="ad-slot__grid">${sponsors.map(displayCard).join('')}</div>`;
    insertAfter(placementAnchor(), section);
    return { tournament_id: d.tournament_id || null };
  }

  function activeHoleNumber() {
    const activeDot = document.querySelector('.hole-dot.active');
    const fromDot = Number((activeDot?.textContent || '').trim());
    if (fromDot) return fromDot;
    const cardEl = document.getElementById('singleHoleCard');
    const label = cardEl?.querySelector('[style*="font-size:2.2rem"]');
    const fromCard = Number((label?.textContent || '').trim());
    return fromCard || null;
  }

  function renderCurrentHoleSponsor() {
    if (placement !== 'scorecard') return;
    const cardEl = document.getElementById('singleHoleCard');
    if (!cardEl || !window.__lorgenHoleSponsors) return;
    cardEl.querySelector('.current-hole-sponsor')?.remove();
    const hole = activeHoleNumber();
    const sponsor = window.__lorgenHoleSponsors.find(s => Number(s.hole_number) === Number(hole));
    if (!sponsor) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'current-hole-sponsor';
    wrapper.innerHTML = currentHoleCard(sponsor);
    const scoreStepper = cardEl.querySelector('.score-stepper');
    if (scoreStepper) cardEl.insertBefore(wrapper, scoreStepper);
    else cardEl.appendChild(wrapper);
  }

  function watchScorecardHoleSponsors() {
    if (placement !== 'scorecard') return;
    const wrapExistingRender = () => {
      if (typeof window.renderCurrentHole !== 'function' || window.renderCurrentHole.__sponsorWrapped) return false;
      const originalRenderCurrentHole = window.renderCurrentHole;
      window.renderCurrentHole = function(...args) {
        const result = originalRenderCurrentHole.apply(this, args);
        setTimeout(renderCurrentHoleSponsor, 0);
        return result;
      };
      window.renderCurrentHole.__sponsorWrapped = true;
      return true;
    };

    if (wrapExistingRender()) {
      setTimeout(renderCurrentHoleSponsor, 0);
      return;
    }

    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (wrapExistingRender() || attempts > 40) {
        clearInterval(timer);
        setTimeout(renderCurrentHoleSponsor, 0);
      }
    }, 250);
  }

  async function loadScorecardHoleSponsors(tournamentId) {
    if (placement !== 'scorecard') return;
    const d = await fetchSponsors('hole', tournamentId);
    window.__lorgenHoleSponsors = (d.sponsors || []).filter(s => s.is_enabled !== false && s.hole_number);
    watchScorecardHoleSponsors();
  }

  document.addEventListener('DOMContentLoaded', async () => {
    addAdminSponsorControls();
    try {
      const context = await renderPlacementAds();
      await loadScorecardHoleSponsors(context.tournament_id || null);
    } catch (error) {
      console.warn('Kunne ikke vise sponsorer', error);
    }
  });
})();
