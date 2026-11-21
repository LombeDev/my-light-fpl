/* pitch.js: the pitch used by My team and manager pages, following the LiveFPL layout.
   Each card: shirt, black name bar, opponent for this gameweek (coloured by FDR), price,
   xEO, and the next three fixtures as coloured chips. Bench sits on a grey strip below.
   No inline styles: the Content-Security-Policy in _headers blocks them. */
(() => {
  const SHIRTS = "https://fantasy.premierleague.com/dist/img/shirts/standard";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

  const CHIPS = {
    wildcard: "Wildcard",
    freehit: "Free Hit",
    bboost: "Bench Boost",
    "3xc": "Triple Captain",
    manager: "Assistant Manager",
  };

  // Goalkeeper, defenders, midfielders, forwards.
  const LINES = [1, 2, 3, 4];

  // Pitch markings on a 1000 x 1300 canvas, drawn with the same proportions as the pitch.
  const MARKINGS = `
    <svg viewBox="0 0 1000 1300" preserveAspectRatio="none" aria-hidden="true">
      <g fill="none" stroke="rgba(255,255,255,0.92)" stroke-width="4" vector-effect="non-scaling-stroke">
        <rect x="40" y="30" width="920" height="1240"/>
        <line x1="40" y1="650" x2="960" y2="650"/>
        <circle cx="500" cy="650" r="110"/>
        <rect x="250" y="30" width="500" height="200"/>
        <rect x="380" y="30" width="240" height="75"/>
        <rect x="250" y="1070" width="500" height="200"/>
        <rect x="380" y="1195" width="240" height="75"/>
      </g>
      <circle cx="500" cy="650" r="7" fill="rgba(255,255,255,0.92)"/>
    </svg>`;

  // FDR 1-2 green, 3 neutral, 4 pink, 5 maroon, no rating grey.
  const fdrClass = (d) => (d <= 2 ? "fdr-e" : d === 3 ? "fdr-m" : d === 4 ? "fdr-h" : d >= 5 ? "fdr-x" : "fdr-b");

  // Renders a squad into `el`.
  // opts: { snap, eo (Map of effective ownership in %, or null), live (Map), hasLive (bool), gw }
  function render(el, picks, opts) {
    const { snap, eo = null, live = new Map(), hasLive = false, gw } = opts;
    const byId = new Map(snap.players.map((p) => [p.id, p]));
    const teamById = new Map(snap.teams.map((t) => [t.id, t]));
    const short = (id) => teamById.get(id)?.short ?? "";

    // Upcoming fixtures per club, in kickoff order, for the next-three chips.
    const upcoming = new Map();
    const pushUpcoming = (team, entry) => {
      if (!upcoming.has(team)) upcoming.set(team, []);
      upcoming.get(team).push(entry);
    };
    const open = snap.fixtures
      .filter((f) => !f.finished && f.kickoff)
      .sort((a, b) => a.kickoff.localeCompare(b.kickoff));
    for (const f of open) {
      pushUpcoming(f.home, { code: short(f.away), diff: f.home_difficulty });
      pushUpcoming(f.away, { code: short(f.home), diff: f.away_difficulty });
    }

    // This gameweek's opponent for each club, with venue and difficulty.
    const thisGw = new Map();
    for (const f of snap.fixtures) {
      if (f.gw !== gw) continue;
      thisGw.set(f.home, { label: `${short(f.away)} (H)`, diff: f.home_difficulty });
      thisGw.set(f.away, { label: `${short(f.home)} (A)`, diff: f.away_difficulty });
    }

    const card = (pk) => {
      const p = byId.get(pk.element);
      if (!p) return "";
      const t = teamById.get(p.team);
      const gk = p.element_type === 1;
      const img = t?.code
        ? `<img src="${SHIRTS}/shirt_${t.code}${gk ? "_1" : ""}-66.png" alt="" loading="lazy">`
        : "";

      const now = thisGw.get(p.team);
      const opp = now ? now.label : "Blank";
      const oppCls = now ? fdrClass(now.diff) : "fdr-b";

      const next = (upcoming.get(p.team) ?? []).slice(0, 3);
      const chips = next
        .map((x) => `<span class="pv-chip ${fdrClass(x.diff)}">${esc(x.code)}</span>`)
        .join("");

      const d = live.get(p.id);
      const pts = hasLive ? (d ? d.p : 0) : null;
      const xeo = eo ? Math.round(eo.get(p.id) ?? 0) : null;
      const cap = pk.is_captain ? `<span class="pv-cap">C</span>` : pk.is_vice_captain ? `<span class="pv-cap is-v">V</span>` : "";

      return `<div class="pv-card">
        <div class="pv-shirt">${img}${cap}${pts !== null ? `<span class="pv-pts">${pts}</span>` : ""}</div>
        <div class="pv-name" title="${esc(p.web_name)}">${esc(p.web_name)}</div>
        <div class="pv-opp ${oppCls}">${esc(opp)}</div>
        <div class="pv-price">£${(p.now_cost / 10).toFixed(1)}m</div>
        <div class="pv-eo">xEO: ${xeo === null ? "–" : `${xeo}%`}</div>
        <div class="pv-next">${chips}</div>
      </div>`;
    };

    const xi = picks.picks.filter((x) => x.position <= 11);
    const bench = picks.picks.filter((x) => x.position > 11);

    const rows = LINES.map((type) => {
      const list = xi.filter((pk) => byId.get(pk.element)?.element_type === type);
      if (!list.length) return "";
      return `<div class="pv-row">${list.map(card).join("")}</div>`;
    }).join("");

    const chip = picks.active_chip ? (CHIPS[picks.active_chip] ?? picks.active_chip) : "No Chip";

    el.innerHTML = `
      <div class="pv">
        <div class="pv-field">
          <div class="pv-grass">${MARKINGS}</div>
          <div class="pv-chipbadge">${esc(chip)}</div>
          <div class="pv-rows">${rows}</div>
        </div>
        <div class="pv-bench">
          <div class="pv-row">${bench.map(card).join("")}</div>
        </div>
      </div>`;
  }

  window.PITCH = { render };
})();
