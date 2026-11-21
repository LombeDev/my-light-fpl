/* pitch.js: the pitch used by My team and manager pages.
   The pitch is one SVG: a grass trapezoid narrowing toward the far goal, thick round markings,
   a goal with net at each end, and rows placed by class so no inline styles are needed. */
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

  // Pitch geometry in SVG units. The viewBox is 400 wide and 640 tall.
  // The pitch runs from y=60 (far goal line) to y=600 (near goal line), narrowing toward the top.
  const TOP_Y = 60;
  const BOTTOM_Y = 600;
  const TOP_L = 70;
  const TOP_R = 330;
  const MID_Y = (TOP_Y + BOTTOM_Y) / 2; // 330, the halfway line and centre circle

  // Left and right edges of the pitch at a given height, so stripes and lines follow the perspective.
  const edgeAt = (y) => {
    const t = (y - TOP_Y) / (BOTTOM_Y - TOP_Y);
    return { l: TOP_L - TOP_L * t, r: TOP_R + TOP_L * t };
  };

  // Alternating grass stripes between the two goal lines.
  function stripes() {
    const count = 10;
    const step = (BOTTOM_Y - TOP_Y) / count;
    let out = "";
    for (let i = 0; i < count; i++) {
      const y0 = TOP_Y + i * step;
      const y1 = y0 + step;
      const a = edgeAt(y0);
      const b = edgeAt(y1);
      const fill = i % 2 === 0 ? "#4fa865" : "#44975a";
      out += `<polygon points="${a.l},${y0} ${a.r},${y0} ${b.r},${y1} ${b.l},${y1}" fill="${fill}"/>`;
    }
    return out;
  }

  // Every line uses thick round strokes that stay the same width at any size.
  const LINE = `fill="none" stroke="#ffffff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"`;

  const MARKINGS = `
    <path d="M70 60 L330 60 L400 600 L0 600 Z" ${LINE}/>
    <path d="M35 330 L365 330" ${LINE}/>
    <ellipse cx="200" cy="330" rx="100" ry="45" ${LINE}/>
    <circle cx="200" cy="330" r="5" fill="#ffffff"/>
    <path d="M120 60 L108 210 L292 210 L280 60" ${LINE}/>
    <path d="M160 60 L158 110 L242 110 L240 60" ${LINE}/>
    <circle cx="200" cy="150" r="4" fill="#ffffff"/>
    <path d="M89 450 L77 600 L323 600 L311 450" ${LINE}/>
    <path d="M154 600 L155 560 L245 560 L246 600" ${LINE}/>
    <circle cx="200" cy="520" r="4" fill="#ffffff"/>
  `;

  // Goals: a net pattern with a white frame, at the far end (top) and near end (bottom).
  const GOALS = `
    <path d="M160 60 L162 20 L238 20 L240 60 Z" fill="url(#pvNet)"/>
    <path d="M160 60 L162 20 L238 20 L240 60" ${LINE}/>
    <path d="M170 600 L172 630 L228 630 L230 600 Z" fill="url(#pvNet)"/>
    <path d="M170 600 L172 630 L228 630 L230 600" ${LINE}/>
  `;

  const NET = `
    <defs>
      <pattern id="pvNet" width="8" height="8" patternUnits="userSpaceOnUse">
        <path d="M0 0 L8 8 M8 0 L0 8" stroke="rgba(255,255,255,0.7)" stroke-width="1"/>
      </pattern>
    </defs>
  `;

  const PITCH_SVG = `
    <svg class="pv-svg" viewBox="0 0 400 640" preserveAspectRatio="none" aria-hidden="true">
      ${NET}
      ${stripes()}
      ${MARKINGS}
      ${GOALS}
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
      const cap = pk.is_captain
        ? `<span class="pv-cap">C</span>`
        : pk.is_vice_captain
          ? `<span class="pv-cap">V</span>`
          : "";

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

    // Each outfield line has its own class, so its position and perspective scale come from CSS.
    const LINE_CLASS = { 1: "r-gk", 2: "r-def", 3: "r-mid", 4: "r-fwd" };
    const rows = [1, 2, 3, 4]
      .map((type) => {
        const list = xi.filter((pk) => byId.get(pk.element)?.element_type === type);
        if (!list.length) return "";
        return `<div class="pv-row ${LINE_CLASS[type]}">${list.map(card).join("")}</div>`;
      })
      .join("");

    const chip = picks.active_chip ? (CHIPS[picks.active_chip] ?? picks.active_chip) : "No Chip";

    el.innerHTML = `
      <div class="pv">
        <div class="pv-field">
          ${PITCH_SVG}
          <div class="pv-chipbadge">${esc(chip)}</div>
          <div class="pv-rows">${rows}</div>
        </div>
        <div class="pv-bench">
          <div class="pv-row pv-bench-row">${bench.map(card).join("")}</div>
        </div>
      </div>`;
  }

  window.PITCH = { render };
})();
