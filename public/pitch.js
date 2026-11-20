/* pitch.js: the pitch used by My team and manager pages. Rows stack in a flex column, so cards never overlap.
   Each card shows the shirt, name, opponent (coloured by FDR), price and xEO, in that order. */
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

  // Pitch markings. The grass is stretched to fit, so these only need to be proportional.
  const MARKINGS = `
    <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
      <g fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="5" vector-effect="non-scaling-stroke">
        <rect x="40" y="40" width="920" height="920"/>
        <line x1="40" y1="500" x2="960" y2="500"/>
        <ellipse cx="500" cy="500" rx="110" ry="110"/>
        <rect x="230" y="40" width="540" height="170"/>
        <rect x="360" y="40" width="280" height="60"/>
        <rect x="230" y="790" width="540" height="170"/>
        <rect x="360" y="900" width="280" height="60"/>
      </g>
    </svg>`;

  // Colour for the opponent bar, from FPL's FDR scale.
  const fdrClass = (d) => (d <= 2 ? "fdr-e" : d === 3 ? "fdr-m" : d === 4 ? "fdr-h" : "fdr-x");

  // Renders a squad into `el`.
  // opts: { snap, eo (Map of effective ownership in %, or null), live (Map), hasLive (bool), gw }
  function render(el, picks, opts) {
    const { snap, eo = null, live = new Map(), hasLive = false, gw } = opts;
    const byId = new Map(snap.players.map((p) => [p.id, p]));
    const teamById = new Map(snap.teams.map((t) => [t.id, t]));
    const short = (id) => teamById.get(id)?.short ?? "";

    // This gameweek's fixtures for each club, seen from that club's side.
    const fixtures = new Map();
    const add = (team, entry) => {
      if (!fixtures.has(team)) fixtures.set(team, []);
      fixtures.get(team).push(entry);
    };
    for (const f of snap.fixtures) {
      if (f.gw !== gw) continue;
      const inPlay = f.started && !f.finished;
      add(f.home, { label: `${short(f.away)} (H)`, diff: f.home_difficulty, inPlay });
      add(f.away, { label: `${short(f.home)} (A)`, diff: f.away_difficulty, inPlay });
    }

    const card = (pk, bench) => {
      const p = byId.get(pk.element);
      if (!p) return "";
      const t = teamById.get(p.team);
      const gk = p.element_type === 1;
      const img = t?.code
        ? `<img src="${SHIRTS}/shirt_${t.code}${gk ? "_1" : ""}-66.png" alt="" loading="lazy">`
        : "";

      const games = fixtures.get(p.team) ?? [];
      const opp = games.length ? games.map((g) => g.label).join(" · ") : "Blank";
      const cls = games.length ? fdrClass(games[0].diff) : "fdr-b";
      const inPlay = games.some((g) => g.inPlay);

      const d = live.get(p.id);
      const pts = hasLive ? (d ? d.p : 0) : null;
      const xeo = eo ? Math.round(eo.get(p.id) ?? 0) : null;
      const cap = pk.is_captain ? "C" : pk.is_vice_captain ? "V" : "";

      return `<div class="pv-card${bench ? " is-bench" : ""}">
        <div class="pv-shirt">
          ${img}
          ${cap ? `<span class="pv-cap">${cap}</span>` : ""}
          ${pts !== null ? `<span class="pv-pts">${pts}</span>` : ""}
        </div>
        <div class="pv-name" title="${esc(p.web_name)}">${esc(p.web_name)}</div>
        <div class="pv-opp ${cls}">${esc(opp)}</div>
        <div class="pv-price">£${(p.now_cost / 10).toFixed(1)}m</div>
        <div class="pv-eo">xEO: ${xeo === null ? "–" : `${xeo}%`}${
          inPlay ? ` <span class="pv-dice" aria-label="In play">🎲</span>` : ""
        }</div>
      </div>`;
    };

    const xi = picks.picks.filter((x) => x.position <= 11);
    const bench = picks.picks.filter((x) => x.position > 11);

    const rows = LINES.map((type) => {
      const list = xi.filter((pk) => byId.get(pk.element)?.element_type === type);
      if (!list.length) return "";
      return `<div class="pv-row">${list.map((pk) => card(pk, false)).join("")}</div>`;
    }).join("");

    const chip = picks.active_chip ? (CHIPS[picks.active_chip] ?? picks.active_chip) : "No chip";

    el.innerHTML = `
      <div class="pv">
        <div class="pv-field">
          <div class="pv-grass">${MARKINGS}</div>
          <div class="pv-chip"><span aria-hidden="true">◎</span>${esc(chip)}</div>
          <div class="pv-rows">${rows}</div>
        </div>
        <div class="pv-bench">
          <div class="pv-row">${bench.map((pk) => card(pk, true)).join("")}</div>
        </div>
      </div>`;
  }

  window.PITCH = { render };
})();
