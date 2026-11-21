/* pitch.js: the pitch used by My team and manager pages.
   The goal frame and the pitch lines share one drawing, so the goal stands exactly on the top margin line.
   The advertising board sits above the grass. Then 15 players in a grid of 8 columns.
   No inline styles, so the Content-Security-Policy in _headers does not block anything. */
(() => {
  const SHIRTS = "https://fantasy.premierleague.com/dist/img/shirts/standard";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

  // Half pitch on a 400 x 300 canvas. The top margin line is at y=4, and the goal frame stands on it.
  // Parts above y=0 are drawn outside the grass, over the advertising board.
  const HALF_PITCH = `
    <svg viewBox="0 0 400 300" preserveAspectRatio="none" aria-hidden="true">
      <g fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke">
        <rect x="6" y="4" width="388" height="290" rx="12"/>
        <rect x="90" y="4" width="220" height="80"/>
        <rect x="150" y="4" width="100" height="30"/>
        <line x1="6" y1="294" x2="394" y2="294"/>
        <path d="M170 4 L170 -36 L230 -36 L230 4"/>
      </g>
      <g fill="none" stroke="#ffffff" stroke-width="3" stroke-linejoin="round" vector-effect="non-scaling-stroke">
        <path d="M145 4 L145 -28 L255 -28 L255 4"/>
      </g>
      <circle cx="200" cy="294" r="4" fill="rgba(255,255,255,0.9)"/>
    </svg>`;

  // Renders a squad into `el`.
  // opts: { snap, eo (Map of effective ownership in %, or null), live (Map), hasLive (bool), gw }
  function render(el, picks, opts) {
    const { snap, eo = null, live = new Map(), hasLive = false, gw } = opts;
    const byId = new Map(snap.players.map((p) => [p.id, p]));
    const teamById = new Map(snap.teams.map((t) => [t.id, t]));

    // Match state per club this gameweek: sleeping before kickoff, dice while playing, none once finished.
    const state = new Map();
    for (const f of snap.fixtures) {
      if (f.gw !== gw) continue;
      const s = f.finished ? "" : f.started ? "live" : "sleep";
      state.set(f.home, s);
      state.set(f.away, s);
    }

    const card = (pk) => {
      const p = byId.get(pk.element);
      if (!p) return "";
      const t = teamById.get(p.team);
      const gk = p.element_type === 1;
      const img = t?.code
        ? `<img src="${SHIRTS}/shirt_${t.code}${gk ? "_1" : ""}-66.png" alt="" loading="lazy">`
        : "";

      const st = state.get(p.team);
      const status =
        st === "sleep"
          ? `<span class="pv2-status" aria-label="Not started">😴</span>`
          : st === "live"
            ? `<span class="pv2-status" aria-label="In play">🎲</span>`
            : "";

      const cap = pk.is_captain
        ? `<span class="pv2-cap">C</span>`
        : pk.is_vice_captain
          ? `<span class="pv2-cap is-v">V</span>`
          : "";

      const d = live.get(p.id);
      const pts = hasLive ? (d ? d.p : 0) : null;
      const zero = pts === null || pts === 0 ? " is-zero" : "";
      const xeo = eo ? `${Math.round(eo.get(p.id) ?? 0)}%` : "–";

      return `<div class="pv2-card">
        <div class="pv2-shirt">${img}${status}${cap}</div>
        <div class="pv2-name" title="${esc(p.web_name)}">${esc(p.web_name)}</div>
        <div class="pv2-pts${zero}">${pts === null ? "–" : pts}</div>
        <div class="pv2-eo">${xeo}</div>
      </div>`;
    };

    // Starting XI first in pick order, then the bench, all in one 8-column grid.
    const ordered = [...picks.picks].sort((a, b) => a.position - b.position);

    el.innerHTML = `
      <div class="pv2">
        <div class="pv2-top" aria-hidden="true">
          <div class="pv2-ad">
            <span class="pv2-brand">Fantasy</span>
            <span class="pv2-brand">Fantasy</span>
          </div>
        </div>
        <div class="pv2-field">
          <div class="pv2-bg">${HALF_PITCH}</div>
          <div class="pv2-grid">${ordered.map(card).join("")}</div>
        </div>
      </div>`;
  }

  window.PITCH = { render };
})();
