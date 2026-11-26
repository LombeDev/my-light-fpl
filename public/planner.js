/* planner.js: Fixture difficulty grid. Teams run down the side and gameweeks across.
   Each fixture uses FPL's difficulty rating (1 easiest to 5 hardest). Rank is our own:
   teams are ordered by their average difficulty across the gameweeks shown, easiest first.
   Uppercase means home, lowercase means away. Starts on fpl:ready from app.js. */
(() => {
  if (document.body.dataset.page !== "planner") return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const SHIRTS = "https://fantasy.premierleague.com/dist/img/shirts/standard";
  const SPAN = 10; // most gameweeks shown at once

  const state = { view: "simple", from: 1, to: SPAN, sort: "rank" };
  let snap = null;
  let teamById = new Map();
  let maxGw = 38;
  let currentGw = 1;

  const diffClass = (d) => `fd-d${Math.min(5, Math.max(1, Math.round(d)))}`;

  const shirt = (team) =>
    team?.code ? `<img class="fd-shirt" src="${SHIRTS}/shirt_${team.code}-66.png" alt="" loading="lazy">` : "";

  // Fixtures for each team and gameweek inside the chosen range, keyed "teamId:gw".
  function fixtureIndex() {
    const map = new Map();
    const add = (team, gw, entry) => {
      const key = `${team}:${gw}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(entry);
    };
    for (const f of snap.fixtures) {
      if (f.gw === null || f.gw < state.from || f.gw > state.to) continue;
      add(f.home, f.gw, { opp: f.away, home: true, diff: f.home_difficulty });
      add(f.away, f.gw, { opp: f.home, home: false, diff: f.away_difficulty });
    }
    return map;
  }

  // One row per team, with its rank and its cells, sorted by the chosen column.
  function buildRows(gws) {
    const index = fixtureIndex();
    const rows = snap.teams.map((team) => {
      const cells = gws.map((g) => index.get(`${team.id}:${g}`) ?? []);
      let total = 0;
      let count = 0;
      for (const list of cells) {
        for (const x of list) {
          total += x.diff;
          count += 1;
        }
      }
      return { team, cells, avg: count ? total / count : null, rank: null };
    });

    // Rank: easiest average first. Teams with no fixtures in range are not ranked.
    rows
      .filter((r) => r.avg !== null)
      .sort((a, b) => a.avg - b.avg || a.team.name.localeCompare(b.team.name))
      .forEach((r, i) => {
        r.rank = i + 1;
      });

    if (state.sort === "team") {
      return rows.sort((a, b) => a.team.name.localeCompare(b.team.name));
    }
    return rows.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || a.team.name.localeCompare(b.team.name));
  }

  function cellHtml(list) {
    if (!list.length) {
      return `<td class="fd-cell"><span class="fd-pill fd-blank">–</span></td>`;
    }
    const pills = list
      .map((x) => {
        const short = teamById.get(x.opp)?.short ?? "";
        const label = x.home ? short.toUpperCase() : short.toLowerCase();
        const cls = diffClass(x.diff);
        if (state.view === "detailed") {
          return `<span class="fd-pill ${cls}"><b>${esc(label)}</b><small>${x.home ? "H" : "A"} · ${x.diff}</small></span>`;
        }
        return `<span class="fd-pill ${cls}">${esc(label)}</span>`;
      })
      .join("");
    return `<td class="fd-cell">${pills}</td>`;
  }

  function renderHead(gws) {
    const sortBtn = (key, label) =>
      `<button type="button" class="fd-sort" data-sort="${key}" aria-pressed="${state.sort === key}">${label}${
        state.sort === key ? " ↓" : ""
      }</button>`;
    $("fd-head").innerHTML = `<tr>
      <th scope="col" class="fd-team">${sortBtn("team", "Team")}</th>
      <th scope="col" class="fd-rank">${sortBtn("rank", "Rank")}</th>
      ${gws.map((g) => `<th scope="col" class="fd-gw">GW${g}</th>`).join("")}
    </tr>`;
  }

  function renderBody(gws) {
    const rows = buildRows(gws);
    $("fd-body").innerHTML = rows
      .map((r) => {
        const rank =
          r.rank === null
            ? `<span class="fd-rankno">–</span>`
            : `<span class="fd-rankno">${r.rank}</span><small class="fd-avg">${r.avg.toFixed(2)}</small>`;
        return `<tr>
          <th scope="row" class="fd-team">
            <div class="fd-teamcell">${shirt(r.team)}<span>${esc(r.team.name)}</span></div>
          </th>
          <td class="fd-rank">${rank}</td>
          ${r.cells.map(cellHtml).join("")}
        </tr>`;
      })
      .join("");
  }

  function renderControls() {
    document.querySelectorAll("[data-view]").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.view === state.view));
    });
    $("fd-from").value = String(state.from);
    $("fd-to").value = String(state.to);
  }

  function render() {
    const gws = [];
    for (let g = state.from; g <= state.to; g++) gws.push(g);
    renderControls();
    renderHead(gws);
    renderBody(gws);
    $("fd-note").textContent =
      `Showing gameweeks ${state.from} to ${state.to}. Rank orders teams by average difficulty over these gameweeks, easiest first.`;
  }

  // Keeps the range valid: start before end, and no more than SPAN gameweeks.
  function setFrom(value) {
    state.from = value;
    if (state.to < state.from) state.to = state.from;
    if (state.to > state.from + SPAN - 1) state.to = state.from + SPAN - 1;
  }

  function setTo(value) {
    state.to = value;
    if (state.from > state.to) state.from = state.to;
    if (state.to > state.from + SPAN - 1) state.from = state.to - SPAN + 1;
  }

  function fillRange() {
    const options = [];
    for (let g = 1; g <= maxGw; g++) options.push(`<option value="${g}">GW${g}</option>`);
    $("fd-from").innerHTML = options.join("");
    $("fd-to").innerHTML = options.join("");
  }

  function wire() {
    document.querySelectorAll("[data-view]").forEach((b) =>
      b.addEventListener("click", () => {
        state.view = b.dataset.view;
        render();
      }),
    );

    $("fd-from").addEventListener("change", (e) => {
      setFrom(Number(e.target.value));
      render();
    });
    $("fd-to").addEventListener("change", (e) => {
      setTo(Number(e.target.value));
      render();
    });

    $("fd-head").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-sort]");
      if (!btn) return;
      state.sort = btn.dataset.sort;
      render();
    });
  }

  document.addEventListener("fpl:ready", (e) => {
    if (!e.detail) return;
    snap = e.detail;
    teamById = new Map(snap.teams.map((t) => [t.id, t]));
    maxGw = snap.events.length || 38;
    currentGw = (snap.events.find((ev) => ev.current) ?? snap.events.find((ev) => ev.next))?.id ?? 1;

    state.from = Math.min(currentGw, maxGw);
    state.to = Math.min(maxGw, state.from + SPAN - 1);

    fillRange();
    wire();
    render();
  });
})();
