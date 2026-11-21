/* pitch.js: the pitch used by My team and manager pages, matching the official FPL pitch view.
   Smaller cards with the shirt above the name and opponent bars, a grass pitch with markings,
   and a bench panel with position labels. */
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

  // Goalkeeper at the top, then defenders, midfielders and forwards.
  const LINES = [1, 2, 3, 4];

  // Pitch markings. The viewBox has the same proportions as the pitch, so nothing distorts.
  const MARKINGS = `
    <svg viewBox="0 0 1000 1450" preserveAspectRatio="none" aria-hidden="true">
      <g fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="5" vector-effect="non-scaling-stroke">
        <rect x="30" y="30" width="940" height="1390"/>
        <line x1="30" y1="725" x2="970" y2="725"/>
        <circle cx="500" cy="725" r="120"/>
        <rect x="220" y="30" width="560" height="230"/>
        <rect x="370" y="30" width="260" height="90"/>
        <rect x="220" y="1190" width="560" height="230"/>
        <rect x="370" y="1330" width="260" height="90"/>
        <path d="M380 260 A130 130 0 0 0 620 260"/>
        <path d="M380 1190 A130 130 0 0 1 620 1190"/>
      </g>
      <circle cx="500" cy="725" r="7" fill="rgba(255,255,255,0.9)"/>
    </svg>`;

  // Renders a squad into `el`.
  // opts: { snap, live (Map of live deltas), hasLive (bool), gw }
  function render(el, picks, opts) {
    const { snap, live = new Map(), hasLive = false, gw } = opts;
    const byId = new Map(snap.players.map((p) => [p.id, p]));
    const teamById = new Map(snap.teams.map((t) => [t.id, t]));
    const posById = new Map(snap.positions.map((p) => [p.id, p.short]));
    const short = (id) => teamById.get(id)?.short ?? "";

    // This gameweek's opponents for each club, with venue.
    const fixtures = new Map();
    const add = (team, text) => {
      if (!fixtures.has(team)) fixtures.set(team, []);
      fixtures.get(team).push(text);
    };
    for (const f of snap.fixtures) {
      if (f.gw !== gw) continue;
      add(f.home, `${short(f.away)} (H)`);
      add(f.away, `${short(f.home)} (A)`);
    }

    const card = (pk) => {
      const p = byId.get(pk.element);
      if (!p) return "";
      const t = teamById.get(p.team);
      const gk = p.element_type === 1;
      const img = t?.code
        ? `<img src="${SHIRTS}/shirt_${t.code}${gk ? "_1" : ""}-66.png" alt="" loading="lazy">`
        : "";

      const games = fixtures.get(p.team) ?? [];
      const opp = games.length ? games.join(" · ") : "Blank";

      const d = live.get(p.id);
      const pts = hasLive ? (d ? d.p : 0) : null;

      const cap = pk.is_captain
        ? `<span class="pv-cap">C</span>`
        : pk.is_vice_captain
          ? `<span class="pv-cap is-v">V</span>`
          : "";

      return `<div class="pv-card">
        <div class="pv-shirt">
          ${img}
          ${cap}
          ${pts !== null ? `<span class="pv-pts">${pts}</span>` : ""}
        </div>
        <div class="pv-name" title="${esc(p.web_name)}">${esc(p.web_name)}</div>
        <div class="pv-opp" title="${esc(opp)}">${esc(opp)}</div>
      </div>`;
    };

    const xi = picks.picks.filter((x) => x.position <= 11);
    const bench = picks.picks.filter((x) => x.position > 11);

    const rows = LINES.map((type) => {
      const list = xi.filter((pk) => byId.get(pk.element)?.element_type === type);
      if (!list.length) return "";
      return `<div class="pv-row">${list.map(card).join("")}</div>`;
    }).join("");

    // Bench labels: GKP for the goalkeeper, then 1., 2., 3. with the position of each outfield sub.
    let outfield = 0;
    const benchHtml = bench
      .map((pk) => {
        const p = byId.get(pk.element);
        if (!p) return "";
        let label;
        if (p.element_type === 1) {
          label = "GKP";
        } else {
          outfield += 1;
          label = `${outfield}. ${posById.get(p.element_type) ?? ""}`;
        }
        return `<div class="pv-slot">
          <div class="pv-slot-label">${esc(label)}</div>
          ${card(pk)}
        </div>`;
      })
      .join("");

    const chip = picks.active_chip ? (CHIPS[picks.active_chip] ?? picks.active_chip) : "No chip";

    el.innerHTML = `
      <div class="pv">
        <div class="pv-inner">
          <div class="pv-field">
            <div class="pv-grass">${MARKINGS}</div>
            <div class="pv-chip">${esc(chip)}</div>
            <div class="pv-rows">${rows}</div>
          </div>
          <div class="pv-bench">
            <div class="pv-row">${benchHtml}</div>
          </div>
          <div class="pv-subs-title">Substitutes</div>
        </div>
      </div>`;
  }

  window.PITCH = { render };
})();
