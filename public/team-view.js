/* team-view.js: the team view opened from a mini-league row.
   A field with the points and rank cards at the top, the pitch rows from goalkeeper to forward,
   and a bench labelled by position. Exposes window.TEAMVIEW.render(el, picks, opts). */
(() => {
  const SHIRTS = "https://fantasy.premierleague.com/dist/img/shirts/standard";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const DASH = "–";

  function render(el, picks, opts) {
    const { snap, live = new Map(), hasLive = false, gw, gross = 0, rank = null } = opts;
    const byId = new Map(snap.players.map((p) => [p.id, p]));
    const teamById = new Map(snap.teams.map((t) => [t.id, t]));
    const posShort = new Map(snap.positions.map((p) => [p.id, p.short]));
    const short = (id) => teamById.get(id)?.short ?? "";

    // Per club this gameweek: show points once the club has kicked off, otherwise the opponent.
    const played = new Map();
    const opp = new Map();
    for (const f of snap.fixtures) {
      if (f.gw !== gw) continue;
      const isPlayed = f.started || f.finished;
      played.set(f.home, isPlayed);
      played.set(f.away, isPlayed);
      opp.set(f.home, `${short(f.away)} (H)`);
      opp.set(f.away, `${short(f.home)} (A)`);
    }

    const tile = (pk) => {
      const p = byId.get(pk.element);
      if (!p) return "";
      const t = teamById.get(p.team);
      const gk = p.element_type === 1;
      const img = t?.code
        ? `<img src="${SHIRTS}/shirt_${t.code}${gk ? "_1" : ""}-66.png" alt="" loading="lazy">`
        : "";
      const badge = pk.is_captain
        ? `<span class="tv-badge">C</span>`
        : pk.is_vice_captain
          ? `<span class="tv-badge is-v">V</span>`
          : "";
      const d = live.get(p.id);
      const strip = played.get(p.team)
        ? `<div class="tv-pts">${hasLive ? (d ? d.p : 0) : DASH}</div>`
        : `<div class="tv-opp">${esc(opp.get(p.team) ?? "Blank")}</div>`;
      return `<div class="tv-card">
        <div class="tv-shirt">${img}${badge}</div>
        <div class="tv-name" title="${esc(p.web_name)}">${esc(p.web_name)}</div>
        ${strip}
      </div>`;
    };

    const xi = picks.picks.filter((x) => x.position <= 11);
    const bench = picks.picks.filter((x) => x.position > 11).sort((a, b) => a.position - b.position);

    // Goalkeeper, defenders, midfielders, forwards, from the top of the field down.
    const rows = [1, 2, 3, 4]
      .map((type) => {
        const list = xi.filter((pk) => byId.get(pk.element)?.element_type === type);
        return list.length ? `<div class="tv-row">${list.map(tile).join("")}</div>` : "";
      })
      .join("");

    let outfield = 0;
    const benchHtml = bench
      .map((pk) => {
        const p = byId.get(pk.element);
        if (!p) return "";
        if (p.element_type !== 1) outfield += 1;
        const label = p.element_type === 1 ? "GKP" : `${outfield}. ${posShort.get(p.element_type) ?? ""}`;
        return `<div class="tv-bench-item"><div class="tv-bl">${esc(label)}</div>${tile(pk)}</div>`;
      })
      .join("");

    el.innerHTML = `
      <div class="tv">
        <div class="tv-head">
          <button type="button" class="tv-back" data-tv-back aria-label="Close team">‹</button>
          <span>Gameweek ${gw}</span>
        </div>
        <div class="tv-field">
          <div class="tv-stats">
            <div class="tv-stat tv-stat-white">
              <div class="tv-num">${gross}</div>
              <span class="tv-pill">Points</span>
            </div>
            <div class="tv-stat tv-stat-green">
              <div class="tv-num">${rank === null ? DASH : Number(rank).toLocaleString()}</div>
              <span class="tv-pill">Rank</span>
            </div>
          </div>
          ${rows}
        </div>
        <div class="tv-bench">
          <div class="tv-bench-row">${benchHtml}</div>
        </div>
      </div>`;
  }

  window.TEAMVIEW = { render };
})();
