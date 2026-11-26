/* planner.js: FPL fixture difficulty grid. Teams run down the side, gameweeks run across.
   Each fixture uses FPL's difficulty (1 easiest to 5 hardest). Uppercase means home, lowercase away
   in the simple view. Rank is our own: teams are ordered by average difficulty over the gameweeks shown.
   Starts on fpl:ready from app.js. */
(() => {
  if (document.body.dataset.page !== "planner") return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const SHIRTS = "https://fantasy.premierleague.com/dist/img/shirts/standard";
  const SPAN = 10; // most gameweeks shown at once

  const state = { view: "detailed", from: 1, to: SPAN, sort: "rank", deadlines: true, ko: true };
  let snap = null;
  let teamById = new Map();
  let eventById = new Map();
  let maxGw = 38;

  const clampDiff = (d) => Math.min(5, Math.max(1, Math.round(Number(d)) || 3));

  // "Sun 29 Nov 6:30 pm" or "Sun 29 Nov", in the visitor's time zone.
  function fmtDate(iso, withTime) {
    if (!iso) return "TBC";
    const opts = { weekday: "short", day: "numeric", month: "short" };
    if (withTime) Object.assign(opts, { hour: "numeric", minute: "2-digit" });
    return new Date(iso).toLocaleString("en-GB", opts).replace(/,/g, "");
  }

  function fmtTime(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" });
  }

  // "team:gw" -> fixtures for that team in that gameweek, sorted by kickoff.
  function fixtureIndex(from, to) {
    const map = new Map();
    const add = (team, gw, entry) => {
      const key = `${team}:${gw}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(entry);
    };
    for (const f of snap.fixtures) {
      if (f.gw === null || f.gw < from || f.gw > to) continue;
      add(f.home, f.gw, { opp: f.away, home: true, diff: f.home_difficulty, kick: f.kickoff });
      add(f.away, f.gw, { opp: f.home, home: false, diff: f.away_difficulty, kick: f.kickoff });
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.kick ?? "~").localeCompare(b.kick ?? "~"));
    }
    return map;
  }

  // One row per team, with its cells and average difficulty. Rank 1 is the easiest average.
  function buildRows(gws, index) {
    const rows = snap.teams.map((team) => {
      let total = 0;
      let count = 0;
      const cells = gws.map((g) => {
        const list = index.get(`${team.id}:${g}`) ?? [];
        for (const x of list) {
          total += clampDiff(x.diff);
          count += 1;
        }
        return list;
      });
      return { team, cells, avg: count ? total / count : null, rank: null };
    });

    rows
      .filter((r) => r.avg !== null)
      .sort((a, b) => a.avg - b.avg || a.team.name.localeCompare(b.team.name))
      .forEach((r, i) => {
        r.rank = i + 1;
      });

    if (state.sort === "team") {
      rows.sort((a, b) => a.team.name.localeCompare(b.team.name));
    } else {
      rows.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || a.team.name.localeCompare(b.team.name));
    }
    return rows;
  }

  // One fixture block. Simple shows the opponent, Detailed adds difficulty, venue and the date.
  function pill(x) {
    const cls = `fx-d${clampDiff(x.diff)}`;
    const short = teamById.get(x.opp)?.short ?? "";

    if (state.view === "simple") {
      const label = x.home ? short.toUpperCase() : short.toLowerCase();
      const time = state.ko && x.kick ? `<small>${esc(fmtTime(x.kick))}</small>` : "";
      return `<div class="fx-pill ${cls}"><b>${esc(label)}</b>${time}</div>`;
    }

    const label = short.toUpperCase();
    const when = fmtDate(x.kick, state.ko);
    return `<div class="fx-pill ${cls}"><b>${esc(label)}(${clampDiff(x.diff)},${x.home ? "H" : "A"})</b><small>${esc(when)}</small></div>`;
  }

  function cell(list) {
    if (!list.length) {
      return `<td class="fx-cell"><div class="fx-stack"><div class="fx-pill fx-blank">Blank</div></div></td>`;
    }
    return `<td class="fx-cell"><div class="fx-stack">${list.map(pill).join("")}</div></td>`;
  }

  function shirt(team) {
    return team?.code
      ? `<img class="fx-shirt" src="${SHIRTS}/shirt_${team.code}-66.png" alt="" loading="lazy">`
      : "";
  }

  function headHtml(gws) {
    const sortBtn = (key, label) =>
      `<button type="button" class="fx-sort" data-sort="${key}">${label}${state.sort === key ? " ▲" : ""}</button>`;

    const gwCols = gws
      .map((g) => {
        const ev = eventById.get(g);
        const dl =
          state.deadlines && ev?.deadline_time
            ? `<span class="fx-gwdl">${esc(fmtDate(ev.deadline_time, true))}</span>`
            : "";
        return `<th scope="col" class="fx-gw"><span class="fx-gwname">GW ${g}</span>${dl}</th>`;
      })
      .join("");

    return `<tr>
      <th scope="col" class="fx-team">${sortBtn("team", "Team")}</th>
      <th scope="col" class="fx-rank">${sortBtn("rank", "Rank")}</th>
      ${gwCols}
    </tr>`;
  }

  function bodyHtml(rows) {
    return rows
      .map((r) => {
        const rankCls = r.rank !== null && r.rank <= 10 ? "fx-rank-hi" : "fx-rank-lo";
        const rankText = r.rank === null ? "–" : String(r.rank);
        const title = r.avg === null ? "" : `Average difficulty ${r.avg.toFixed(2)}`;
        return `<tr>
          <th scope="row" class="fx-team">
            <div class="fx-teamcell">${shirt(r.team)}<span>${esc(r.team.short)}</span></div>
          </th>
          <td class="fx-rank ${rankCls}" title="${esc(title)}"><span class="fx-rankno">${rankText}</span></td>
          ${r.cells.map(cell).join("")}
        </tr>`;
      })
      .join("");
  }

  function syncControls() {
    document.querySelectorAll("[data-view]").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.view === state.view));
    });
    $("fx-deadlines").checked = state.deadlines;
    $("fx-ko").checked = state.ko;
    $("fx-from").value = String(state.from);
    $("fx-to").value = String(state.to);
  }

  function render() {
    const gws = [];
    for (let g = state.from; g <= state.to; g++) gws.push(g);
    const rows = buildRows(gws, fixtureIndex(state.from, state.to));

    $("fx-table").classList.toggle("is-simple", state.view === "simple");
    $("fx-head").innerHTML = headHtml(gws);
    $("fx-body").innerHTML = bodyHtml(rows);
    syncControls();
    $("fx-note").textContent =
      `Gameweeks ${state.from} to ${state.to}. Rank 1 has the easiest fixtures on average over these gameweeks.`;
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
    for (let g = 1; g <= maxGw; g++) options.push(`<option value="${g}">GW ${g}</option>`);
    $("fx-from").innerHTML = options.join("");
    $("fx-to").innerHTML = options.join("");
  }

  function wire() {
    document.querySelectorAll("[data-view]").forEach((b) =>
      b.addEventListener("click", () => {
        state.view = b.dataset.view;
        render();
      }),
    );

    $("fx-deadlines").addEventListener("change", (e) => {
      state.deadlines = e.target.checked;
      render();
    });
    $("fx-ko").addEventListener("change", (e) => {
      state.ko = e.target.checked;
      render();
    });

    $("fx-from").addEventListener("change", (e) => {
      setFrom(Number(e.target.value));
      render();
    });
    $("fx-to").addEventListener("change", (e) => {
      setTo(Number(e.target.value));
      render();
    });

    $("fx-head").addEventListener("click", (e) => {
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
    eventById = new Map(snap.events.map((ev) => [ev.id, ev]));
    maxGw = snap.events.length || 38;

    const current =
      (snap.events.find((ev) => ev.current) ?? snap.events.find((ev) => ev.next))?.id ?? 1;
    state.from = Math.min(current, maxGw);
    state.to = Math.min(maxGw, state.from + SPAN - 1);

    fillRange();
    wire();
    render();
  });
})();
