/* stats.js: season leaderboards with shirts, and double and blank gameweeks. Starts on fpl:ready from app.js. */
(() => {
  if (document.body.dataset.page !== "stats") return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

  // [field, label, formatter]
  const STATS = [
    ["total_points", "Total points", (v) => v],
    ["goals", "Goals", (v) => v],
    ["assists", "Assists", (v) => v],
    ["expected_goals", "Expected goals", (v) => v.toFixed(2)],
    ["expected_assists", "Expected assists", (v) => v.toFixed(2)],
    ["ict", "ICT index", (v) => v.toFixed(1)],
    ["clean_sheets", "Clean sheets", (v) => v],
    ["bonus", "Bonus points", (v) => v],
    ["points_per_million", "Points per £m", (v) => v.toFixed(2)],
    ["form", "Form", (v) => v.toFixed(1)],
  ];

  const MINUTES = [
    [0, "Any minutes"],
    [450, "450+ minutes"],
    [900, "900+ minutes"],
  ];

  document.addEventListener("fpl:ready", (e) => {
    if (e.detail) init(e.detail);
  });

  function init(snap) {
    const F = window.FPL;
    const positions = new Map(snap.positions.map((p) => [p.id, p.short]));
    const statSel = $("stat");
    const posSel = $("pos");
    const minSel = $("mins");

    STATS.forEach(([field, label]) => statSel.append(new Option(label, field)));
    snap.positions.forEach((p) => posSel.append(new Option(p.short, String(p.id))));
    MINUTES.forEach(([value, label]) => minSel.append(new Option(label, String(value))));

    function render() {
      const [field, label, fmt] = STATS.find((s) => s[0] === statSel.value) ?? STATS[0];
      const posId = Number(posSel.value);
      const min = Number(minSel.value);
      $("valh").textContent = label;

      const list = snap.players
        .filter((p) => (!posId || p.element_type === posId) && p.minutes >= min)
        .sort((a, b) => b[field] - a[field])
        .slice(0, 100);

      $("rows").innerHTML = list.length
        ? list
            .map(
              (p, i) => `<tr>
                <td class="n">${i + 1}</td>
                <td>${F.playerHtml(p.id)}</td>
                <td>${F.teamHtml(p.team)}</td>
                <td>${esc(positions.get(p.element_type))}</td>
                <td class="n"><strong>${fmt(p[field])}</strong></td>
                <td class="n">${p.minutes.toLocaleString()}</td>
                <td class="n">${p.goals}</td>
                <td class="n">${p.assists}</td>
                <td class="n">${p.expected_goals.toFixed(2)}</td>
                <td class="n">${p.expected_assists.toFixed(2)}</td>
                <td class="n">${p.ict.toFixed(1)}</td>
                <td class="n">${p.clean_sheets}</td>
                <td class="n">${p.total_points}</td>
              </tr>`,
            )
            .join("")
        : `<tr><td colspan="13">No players match.</td></tr>`;

      $("meta").textContent = `Top ${list.length} · season to date · updated ${new Date(snap.generatedAt).toLocaleString()}`;
    }

    statSel.addEventListener("change", render);
    posSel.addEventListener("change", render);
    minSel.addEventListener("change", render);
    render();
    renderFixtureLoad(snap);
  }

  // Double and blank gameweeks from the fixture list, with squad players affected.
  function renderFixtureLoad(snap) {
    const F = window.FPL;
    const max = snap.events.length || 38;
    const from = F.gw;
    const short = new Map(snap.teams.map((t) => [t.id, t.short]));

    const perTeam = new Map(); // "team:gw" -> number of fixtures
    const gwsWithFixtures = new Set();
    for (const f of snap.fixtures) {
      if (f.gw === null) continue;
      gwsWithFixtures.add(f.gw);
      for (const t of [f.home, f.away]) {
        const k = `${t}:${f.gw}`;
        perTeam.set(k, (perTeam.get(k) ?? 0) + 1);
      }
    }

    const playersByTeam = new Map();
    for (const p of snap.players) {
      playersByTeam.set(p.team, (playersByTeam.get(p.team) ?? 0) + 1);
    }
    const countPlayers = (ids) => ids.reduce((sum, id) => sum + (playersByTeam.get(id) ?? 0), 0);
    const names = (ids) => ids.map((id) => short.get(id)).join(", ") || "–";

    const rows = [];
    for (let g = from; g <= max; g++) {
      if (!gwsWithFixtures.has(g)) continue;
      const dbl = [];
      const blank = [];
      for (const t of snap.teams) {
        const n = perTeam.get(`${t.id}:${g}`) ?? 0;
        if (n >= 2) dbl.push(t.id);
        else if (n === 0) blank.push(t.id);
      }
      if (!dbl.length && !blank.length) continue;

      rows.push(`<tr>
        <td>GW${g}</td>
        <td>${esc(names(dbl))}</td>
        <td>${esc(names(blank))}</td>
        <td class="n">${countPlayers(dbl)}</td>
        <td class="n">${countPlayers(blank)}</td>
      </tr>`);
    }

    const sec = document.createElement("section");
    sec.innerHTML = `
      <h2>Double and blank gameweeks</h2>
      <p class="meta">Player counts include every squad player in the affected teams, for upcoming gameweeks.</p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Gameweek</th><th>Double teams</th><th>Blank teams</th>
              <th class="n">Players in DGW</th><th class="n">Players in BGW</th>
            </tr>
          </thead>
          <tbody>${rows.length ? rows.join("") : `<tr><td colspan="5">No double or blank gameweeks ahead.</td></tr>`}</tbody>
        </table>
      </div>`;
    document.querySelector("main").append(sec);
  }
})();
