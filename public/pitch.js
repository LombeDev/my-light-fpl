/* pitch.js: the pitch used by My team and manager pages, matching the reference layout.
   Players sit in rows on a lightly tinted pitch background with thin white markings.
   Each card: shirt, status icon, captain or vice badge, name, points box, ownership percentage.
   No inline styles, so the Content-Security-Policy in _headers does not block anything. */
(() => {
  const SHIRTS = "https://fantasy.premierleague.com/dist/img/shirts/standard";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

  // Background only: a few thin markings. Drawn in a 400 x 600 space and scaled to cover the pitch.
  const PITCH_BG = `
    <svg viewBox="0 0 400 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g fill="none" stroke="rgba(255,255,255,0.75)" stroke-width="2" stroke-linecap="round" vector-effect="non-scaling-stroke">
        <rect x="14" y="12" width="372" height="576" rx="12"/>
        <line x1="14" y1="300" x2="386" y2="300"/>
        <circle cx="200" cy="300" r="62"/>
        <rect x="110" y="12" width="180" height="84"/>
        <rect x="150" y="12" width="100" height="30"/>
        <rect x="110" y="504" width="180" height="84"/>
        <rect x="150" y="558" width="100" height="30"/>
      </g>
      <circle cx="200" cy="300" r="3" fill="rgba(255,255,255,0.8)"/>
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

    const xi = picks.picks.filter((x) => x.position <= 11);
    const bench = picks.picks.filter((x) => x.position > 11);

    // One row per line: goalkeeper, defenders, midfielders, forwards.
    const lines = [1, 2, 3, 4]
      .map((type) => {
        const list = xi.filter((pk) => byId.get(pk.element)?.element_type === type);
        return list.length ? `<div class="pv2-line">${list.map(card).join("")}</div>` : "";
      })
      .join("");

    el.innerHTML = `
      <div class="pv2">
        <div class="pv2-field">
          <div class="pv2-bg">${PITCH_BG}</div>
          <div class="pv2-lines">${lines}</div>
        </div>
        <div class="pv2-bench">
          <div class="pv2-bench-title">Substitutes</div>
          <div class="pv2-line">${bench.map(card).join("")}</div>
        </div>
      </div>`;
  }

  window.PITCH = { render };
})();
