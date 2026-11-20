/* pitch.js: the pitch view used by My team and manager pages, so both look the same. */
(() => {
  const SHIRTS = "https://fantasy.premierleague.com/dist/img/shirts/standard";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const LINES = [1, 2, 3, 4]; // element types from goalkeeper to forward
  const ICON = { sleep: "😴", live: "🎲" };

  // Renders a squad into `el`.
  // opts: { snap, eo (Map of effective ownership, or null), live (Map), hasLive (bool), gw }
  function render(el, picks, opts) {
    const { snap, eo = null, live = new Map(), hasLive = false, gw } = opts;
    const byId = new Map(snap.players.map((p) => [p.id, p]));
    const teamById = new Map(snap.teams.map((t) => [t.id, t]));

    // Match state for each club this gameweek: sleeping before kickoff, dice while playing, none once finished.
    const state = new Map();
    for (const f of snap.fixtures) {
      if (f.gw !== gw) continue;
      const s = f.finished ? "" : f.started ? "live" : "sleep";
      state.set(f.home, s);
      state.set(f.away, s);
    }

    const card = (pk, bench) => {
      const p = byId.get(pk.element);
      if (!p) return "";
      const t = teamById.get(p.team);
      const gk = p.element_type === 1;
      const img = t?.code
        ? `<img src="${SHIRTS}/shirt_${t.code}${gk ? "_1" : ""}-66.png" alt="" loading="lazy">`
        : "";
      const st = state.get(p.team);
      const icon = ICON[st] ? `<span class="pc-icon">${ICON[st]}</span>` : "";
      const badge = pk.is_captain
        ? `<span class="pc-badge c">C</span>`
        : pk.is_vice_captain
          ? `<span class="pc-badge v">V</span>`
          : "";

      const d = live.get(p.id);
      const pts = hasLive ? (d ? d.p : 0) : null;
      const ptsCls = bench || pts === null || pts === 0 ? "zero" : "";
      const own = eo ? `${Math.round(eo.get(p.id) ?? 0)}%` : "–";

      return `<div class="pc${bench ? " pc-b" : ""}">
        <div class="pc-shirt">${img}${icon}${badge}</div>
        <div class="pc-name" title="${esc(p.web_name)}">${esc(p.web_name)}</div>
        <div class="pc-pts ${ptsCls}">${pts === null ? "–" : pts}</div>
        <div class="pc-eo">${own}</div>
      </div>`;
    };

    const xi = picks.picks.filter((x) => x.position <= 11);
    const bench = picks.picks.filter((x) => x.position > 11);

    const lines = LINES.map((type) =>
      xi
        .filter((pk) => byId.get(pk.element)?.element_type === type)
        .map((pk) => card(pk, false))
        .join(""),
    );

    el.innerHTML = `
      <div class="pitch">
        ${lines.map((html) => `<div class="pc-row">${html}</div>`).join("")}
      </div>
      <div class="pc-bench">
        <div class="pc-bench-title">Bench</div>
        <div class="pc-row">${bench.map((pk) => card(pk, true)).join("")}</div>
      </div>`;
  }

  window.PITCH = { render };
})();
