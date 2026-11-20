/* pitch.js: the pitch used by My team and manager pages. Full-width grass in perspective, white markings,
   cards with name, opponent, price and xEO, and a grey bench strip. */
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

  // Rows from goalkeeper to forward. top is the card's top edge as a % of the pitch height.
  // scale gives depth: rows nearer the goal sit slightly smaller.
  const ROWS = [
    { type: 1, top: 2.3, scale: 0.93 },
    { type: 2, top: 26.5, scale: 0.97 },
    { type: 3, top: 51, scale: 1 },
    { type: 4, top: 75, scale: 1.03 },
  ];

  // Markings on a 1080 x 1095 canvas, matched to the reference.
  const MARKINGS = `
    <svg viewBox="0 0 1080 1095" preserveAspectRatio="none" aria-hidden="true">
      <g fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="6">
        <rect x="50" y="40" width="980" height="1015"/>
        <line x1="50" y1="935" x2="1030" y2="935"/>
        <circle cx="540" cy="935" r="150"/>
        <rect x="210" y="40" width="660" height="265"/>
        <rect x="352" y="40" width="376" height="98"/>
        <rect x="425" y="-4" width="230" height="44" fill="rgba(255,255,255,0.08)"/>
      </g>
      <g fill="rgba(255,255,255,0.95)">
        <circle cx="540" cy="935" r="8"/>
        <circle cx="540" cy="190" r="6"/>
      </g>
    </svg>`;

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

    const rows = ROWS.map((r) => {
      const list = xi.filter((pk) => byId.get(pk.element)?.element_type === r.type);
      if (!list.length) return "";
      return `<div class="pv-row" style="top:${r.top}%;transform:scale(${r.scale})">
        <div class="pv-cells" style="grid-template-columns:repeat(${list.length},1fr)">
          ${list.map((pk) => card(pk, false)).join("")}
        </div>
      </div>`;
    }).join("");

    const chip = picks.active_chip ? (CHIPS[picks.active_chip] ?? picks.active_chip) : "No chip";

    el.innerHTML = `
      <div class="pv">
        <div class="pv-field">
          <div class="pv-grass">${MARKINGS}</div>
          <div class="pv-chip"><span aria-hidden="true">◎</span>${esc(chip)}</div>
          ${rows}
        </div>
        <div class="pv-bench">
          <div class="pv-cells" style="grid-template-columns:repeat(4,1fr)">
            ${bench.map((pk) => card(pk, true)).join("")}
          </div>
        </div>
      </div>`;
  }

  window.PITCH = { render };
})();
