(() => {
  const path = window.location.pathname;
  let placement = path.includes('scoreboard') ? 'live_results' : path.includes('enter-score') || path.includes('scorecard') ? 'scorecard' : path.includes('admin') ? 'admin' : (path === '/' || path.includes('index') || path.includes('home')) ? 'frontpage' : null;

  const css = `
    .ad-slot { margin: 28px auto; max-width: 1080px; padding: 0 24px; }
    .hero .ad-slot { margin: 24px auto 0; padding: 0; max-width: 760px; }
    .ad-slot__grid { display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px; }
    .hero .ad-slot__grid { grid-template-columns:1fr; }
    .ad-card { border:1px solid var(--gold-border);border-radius:var(--radius);background:var(--white);padding:16px;display:flex;align-items:center;gap:14px;box-shadow:var(--shadow-sm);min-height:96px; }
    .hero .ad-card { background:rgba(255,255,255,.94); }
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
    .hole-sponsor-chip__logo { width:42px;height:28px;object-fit:contain;flex-shrink:0; }
    .hole-sponsor-chip__name { font-size:.84rem;font-weight:800;color:var(--dark);line-height:1.2; }
    .current-hole-sponsor { margin: 0 0 16px; }
    .current-hole-sponsor .ad-card { min-height: 82px; padding: 12px; box-shadow: none; background: linear-gradient(135deg,rgba(201,168,76,.10),#fff); }
    .current-hole-sponsor .ad-card__logo { width: 76px; height: 52px; }
    .current-hole-sponsor .ad-card__name { font-size: 1rem; }
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

  function card(sponsor, eyebrow = 'Annonse') {
    const logo = sponsorLogo(sponsor);
    const name = sponsorName(sponsor);
    const body = `
      <article class="ad-card">
        <div class="ad-card__logo">
          ${logo ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(name)}">` : `<div class="ad-card__fallback">${escapeHtml(initials(name))}</div>`}
        </div>
        <div>
          <div class="ad-card__eyebrow">${escapeHtml(eyebrow)}</div>
          <div class="ad-card__name">${escapeHtml(name)}</div>
          ${sponsor.description ? `<div class="ad-card__desc">${escapeHtml(sponsor.description)}</div>` : ''}
        </div>
      </article>`;
    return sponsor.sponsor_url ? `<a href="${escapeHtml(sponsor.sponsor_url)}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit">${body}</a>` : body;
  }

  function insertAfter(anchor, node) {
    if (!anchor || !anchor.parentNode) return document.body.appendChild(node);
    anchor.parentNode.insertBefore(node, anchor.nextSibling);
  }

  function placementAnchor() {
    if (placement === 'frontpage') return document.querySelector('#hero .hero-actions') || document.getElementById('hero');
    if (placement === 'live_results') return document.querySelector('.page-hero');
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
    if (!placement || placement === 'admin' || document.querySelector(`[data-sponsor-placement="${placement}"]`)) return { tournament_id: null };
    const d = await fetchSponsors(placement);
    const sponsors = (d.sponsors || []).filter(s => s.is_enabled !== false && s.placement === placement);
    if (!sponsors.length) return { tournament_id: d.tournament_id || null };
    const section = document.createElement('section');
    section.className = 'ad-slot';
    section.dataset.sponsorPlacement = placement;
    section.innerHTML = `<div class="ad-slot__grid">${sponsors.map(s => card(s, placement === 'frontpage' ? 'Sponsor' : 'Annonse')).join('')}</div>`;
    insertAfter(placementAnchor(), section);
    return { tournament_id: d.tournament_id || null };
  }

  function activeHoleNumber() {
    const activeDot = document.querySelector('.hole-dot.active');
    const fromDot = Number((activeDot?.textContent || '').trim());
    if (fromDot) return fromDot;
    const cardEl = document.getElementById('singleHoleCard');
    const match = (cardEl?.textContent || '').match(/Hull\s*(\d{1,2})/i);
    return match ? Number(match[1]) : null;
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
    wrapper.innerHTML = card(sponsor, `Hullsponsor hull ${hole}`);
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

    wrapExistingRender();
    const observer = new MutationObserver(() => {
      wrapExistingRender();
      renderCurrentHoleSponsor();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(renderCurrentHoleSponsor, 500);
  }

  async function renderHoleSponsors(tournamentId) {
    if (!['live_results', 'scorecard'].includes(placement)) return;
    const d = await fetchSponsors('hole', tournamentId);
    const sponsors = (d.sponsors || []).filter(s => s.is_enabled !== false && s.hole_number);
    window.__lorgenHoleSponsors = sponsors;
    watchScorecardHoleSponsors();
    if (!sponsors.length || document.querySelector('[data-sponsor-placement="hole"]')) return;
    const section = document.createElement('section');
    section.className = 'hole-sponsors-strip';
    section.dataset.sponsorPlacement = 'hole';
    section.innerHTML = `<div class="section-header" style="margin-bottom:16px"><span class="section-tag">Hullsponsorer</span><h2 class="section-title">Partnere <span>per hull</span></h2></div><div class="hole-sponsors-strip__grid">${sponsors.map(s => {
      const logo = sponsorLogo(s);
      const name = sponsorName(s);
      const chip = `<div class="hole-sponsor-chip"><div class="hole-sponsor-chip__nr">${escapeHtml(s.hole_number)}</div>${logo ? `<img class="hole-sponsor-chip__logo" src="${escapeHtml(logo)}" alt="${escapeHtml(name)}">` : ''}<div class="hole-sponsor-chip__name">${escapeHtml(name)}</div></div>`;
      return s.sponsor_url ? `<a href="${escapeHtml(s.sponsor_url)}" target="_blank" rel="noopener" style="text-decoration:none">${chip}</a>` : chip;
    }).join('')}</div>`;
    const anchor = placement === 'live_results' ? document.getElementById('scorecardSection') : document.querySelector('#scorecardScreen .page-hero') || document.getElementById('scorecardScreen');
    insertAfter(anchor || placementAnchor(), section);
    renderCurrentHoleSponsor();
  }

  document.addEventListener('DOMContentLoaded', async () => {
    addAdminSponsorControls();
    try {
      const context = await renderPlacementAds();
      await renderHoleSponsors(context.tournament_id || null);
    } catch (error) {
      console.warn('Kunne ikke vise sponsorer', error);
    }
  });
})();
