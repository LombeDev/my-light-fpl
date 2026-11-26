/* stats.js: FPL player stats. A sortable table with All, Watchlist and My Team lists, filters, columns,
   pins, compare and saved views.
   Recent points and minutes come from /api/gwstats. Upcoming fixtures come from the snapshot.
   xPts next is FPL's ep_this for the current gameweek. xPts 5GW and xPts 5/£m are our own estimates:
   expected points weighted by each fixture's difficulty. */
(() => {
  if (document.body.dataset.page !== "stats") return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const SHIRTS = "https://fantasy.premierleague.com/dist/img/shirts/standard";
  const PAGE = 25;
  const PREV = 5; // finished gameweeks shown in Prev 5
  const AHEAD = 5; // upcoming gameweeks used for Next 5 and the estimates
  const COMPARE_MAX = 4;
  const KEY_VIEW = "fpl.stats.view";
  const KEY_WATCH = "fpl.stats.watch";
  const KEY_PIN = "fpl.stats.pin";
  const KEY_SESSION = "fpl.session";
  const POS = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };
  const STATUS = {
    a: ["Fit", "fit"],
    d: ["Doubtful", "flag"],
    i: ["Injured", "flag"],
    s: ["Suspended", "flag"],
    u: ["Unavailable", "flag"],
    n: ["Not in squad", "flag"],
  };
  const TAB_LABEL = { all: "All", watch: "Watchlist", mine: "My Team" };

  // One entry per column. "sort" gives a number for sorting. "num" right-aligns the value.
  const COLUMNS = [
    { key: "status", label: "Status", full: "Availability", num: false, sort: null },
    { key: "price", label: "Price", full: "Current price", num: true, sort: (r) => r.p.now_cost },
    { key: "own", label: "Own %", full: "Ownership", num: true, sort: (r) => r.own },
    { key: "xnext", label: "xPts next", full: "Expected points, current gameweek (FPL)", num: true, sort: (r) => r.xnext },
    { key: "x5", label: "xPts 5GW", full: "Estimated expected points over the next five gameweeks (our estimate)", num: true, sort: (r) => r.x5 },
    { key: "x5m", label: "xPts 5/£m", full: "Estimated five-gameweek expected points per £1m (our estimate)", num: true, sort: (r) => r.x5m },
    { key: "pts", label: "Pts", full: "Total points this season", num: true, sort: (r) => r.pts },
    { key: "prev", label: "Prev 5 pts", full: "Points in the last five finished gameweeks", num: false, sort: null },
    { key: "nailed", label: "Minutes %", full: "Share of 90 minutes played in each recent gameweek", num: false, sort: null },
    { key: "next5", label: "Next 5", full: "Opponents for the next five gameweeks", num: false, sort: null },
    { key: "fdr5", label: "Avg FDR 5", full: "Average fixture difficulty over the next five gameweeks", num: true, sort: (r) => r.fdr, asc: true },
  ];

  const state = {
    tab: "all",
    sort: { key: "pts", dir: -1 },
    cols: COLUMNS.map((c) => c.key),
    filters: { status: "all", pos: 0, team: 0, pmin: 38, pmax: 158, omin: 0, omax: 100 },
    limit: PAGE,
  };

  let snap = null;
  let teamById = new Map();
  let liveGw = 1;
  let nextGw = 1;
  let last5 = [];
  let upcoming = new Map(); // team id -> [{ gw, diff, home, opp, kick }]
  let rows = [];            // one prepared row per player
  let history = new Map();  // gameweek -> Map(player id -> live stats), or null if unavailable
  let mineIds;              // undefined while loading, false when not logged in, Set when loaded
  let mineError = null;
  let watch = [];
  let pinned = [];
  const compare = new Set();
  let toastTimer = null;

  // ---------- Storage ----------
  const readJSON = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  };

  const writeJSON = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage may be blocked. The page still works for this visit.
    }
  };

  // ---------- Helpers ----------
  const money = (tenths) => `£${(tenths / 10).toFixed(1)}m`;
  const ownershipPct = (p) => {
    const v = Number(p.selected_by_percent);
    return Number.isFinite(v) ? v : 0;
  };
  const clampDiff = (d) => Math.min(5, Math.max(1, Math.round(Number(d)) || 3));
  const ptsBand = (n) => (n <= 0 ? 0 : n <= 2 ? 1 : n <= 5 ? 2 : n <= 9 ? 3 : 4);
  const minBand = (m) => (m >= 90 ? 4 : m >= 60 ? 3 : m >= 30 ? 2 : m > 0 ? 1 : 0);
  const activeCols = () => COLUMNS.filter((c) => state.cols.includes(c.key));

  function toast(text) {
    const t = $("ps-toast");
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      t.hidden = true;
    }, 3500);
  }

  // ---------- Data ----------
  // Fixtures in the next AHEAD gameweeks, per team, in order.
  function buildUpcoming() {
    upcoming = new Map();
    const add = (team, entry) => {
      if (!upcoming.has(team)) upcoming.set(team, []);
      upcoming.get(team).push(entry);
    };
    for (const f of snap.fixtures) {
      if (f.gw === null || f.gw < nextGw || f.gw > nextGw + AHEAD - 1) continue;
      add(f.home, { gw: f.gw, diff: clampDiff(f.home_difficulty), home: true, opp: f.away, kick: f.kickoff });
      add(f.away, { gw: f.gw, diff: clampDiff(f.away_difficulty), home: false, opp: f.home, kick: f.kickoff });
    }
    for (const list of upcoming.values()) {
      list.sort((a, b) => a.gw - b.gw || (a.kick ?? "~").localeCompare(b.kick ?? "~"));
    }
  }

  async function loadHistory(gws) {
    await Promise.all(
      gws.map(async (g) => {
        if (history.has(g)) return;
        try {
          const res = await fetch(`/api/gwstats/${g}`);
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !Array.isArray(data.elements)) throw new Error("unavailable");
          history.set(g, new Map(data.elements.map((el) => [el.id, el])));
        } catch {
          history.set(g, null);
        }
      }),
    );
  }

  async function loadMine() {
    const s = readJSON(KEY_SESSION, null);
    if (!s || !s.entryId) {
      mineIds = false;
      renderAll();
      return;
    }
    try {
      const res = await fetch(`/api/picks/${s.entryId}/${liveGw}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not load your team.");
      mineIds = new Set((data.picks ?? []).map((pk) => pk.element));
      mineError = null;
    } catch (err) {
      mineIds = undefined;
      mineError = err.message;
    }
    renderAll();
  }

  // Builds one row per player. Run again whenever the history arrives.
  function prepare() {
    rows = snap.players.map((p) => {
      const fx = upcoming.get(p.team) ?? [];
      const xnext = Number(p.ep_this) || 0;
      const x5 = fx.reduce((sum, f) => sum + (xnext * (6 - f.diff)) / 3, 0);
      const price = p.now_cost / 10;
      const fdrAvg = fx.length ? fx.reduce((sum, f) => sum + f.diff, 0) / fx.length : null;
      const prev = last5.map((g) => {
        const h = history.get(g);
        if (h === undefined) return { g, state: "loading" };
        if (h === null) return { g, state: "missing" };
        const e = h.get(p.id);
        return { g, state: "ok", pts: e ? e.pts : 0, minutes: e ? e.minutes : 0 };
      });
      return {
        p,
        team: teamById.get(p.team),
        fx,
        xnext,
        x5,
        x5m: price > 0 ? x5 / price : 0,
        fdr: fdrAvg ?? 99,
        fdrAvg,
        pts: p.total_points,
        own: ownershipPct(p),
        prev,
      };
    });
  }

  // ---------- Filtering and sorting ----------
  function passes(r) {
    const f = state.filters;
    const id = r.p.id;
    if (state.tab === "watch" && !watch.includes(id)) return false;
    if (state.tab === "mine" && !(mineIds instanceof Set && mineIds.has(id))) return false;
    if (f.pos && r.p.element_type !== f.pos) return false;
    if (f.team && r.p.team !== f.team) return false;
    if (f.status === "fit" && r.p.status !== "a") return false;
    if (f.status === "flag" && r.p.status === "a") return false;
    if (r.p.now_cost < f.pmin || r.p.now_cost > f.pmax) return false;
    if (r.own < f.omin || r.own > f.omax) return false;
    return true;
  }

  function visibleRows() {
    const col = COLUMNS.find((c) => c.key === state.sort.key);
    const value = (r) => (col?.sort ? col.sort(r) : 0);
    return rows
      .filter(passes)
      .sort((a, b) => {
        const pa = pinned.includes(a.p.id) ? 1 : 0;
        const pb = pinned.includes(b.p.id) ? 1 : 0;
        if (pa !== pb) return pb - pa;
        const d = (value(a) - value(b)) * state.sort.dir;
        return d || a.p.web_name.localeCompare(b.p.web_name);
      });
  }

  // ---------- Cells ----------
  const CELL = {
    status: (r) => {
      const [label, cls] = STATUS[r.p.status] ?? STATUS.n;
      return `<span class="ps-status ps-st-${cls}">${label}</span>`;
    },
    price: (r) => money(r.p.now_cost),
    own: (r) => `${r.own.toFixed(1)}%`,
    xnext: (r) => (r.xnext ? r.xnext.toFixed(1) : "–"),
    x5: (r) => (r.fx.length ? r.x5.toFixed(1) : "–"),
    x5m: (r) => (r.fx.length && r.x5m ? r.x5m.toFixed(2) : "–"),
    pts: (r) => String(r.pts),
    prev: (r) =>
      r.prev
        .map((c) => {
          if (c.state === "loading") return `<span class="ps-chip ps-b0 ps-na">…</span>`;
          if (c.state === "missing") return `<span class="ps-chip ps-b0 ps-na">–</span>`;
          return `<span class="ps-chip ps-b${ptsBand(c.pts)}">${c.pts}<small>GW${c.g}</small></span>`;
        })
        .join("") || `<span class="ps-na">No finished gameweeks yet</span>`,
    nailed: (r) =>
      r.prev
        .map((c) => {
          if (c.state === "loading") return `<span class="ps-chip ps-b0 ps-na">…</span>`;
          if (c.state === "missing") return `<span class="ps-chip ps-b0 ps-na">–</span>`;
          const pct = Math.min(100, Math.round((c.minutes / 90) * 100));
          return `<span class="ps-chip ps-b${minBand(pct)}">${pct}%<small>GW${c.g}</small></span>`;
        })
        .join("") || `<span class="ps-na">–</span>`,
    next5: (r) =>
      r.fx.length
        ? r.fx
            .map((f) => {
              const short = teamById.get(f.opp)?.short ?? "";
              const label = f.home ? short.toUpperCase() : short.toLowerCase();
              return `<span class="ps-fx ps-d${f.diff}">${esc(label)}</span>`;
            })
            .join("")
        : `<span class="ps-fx ps-blank">Blank</span>`,
    fdr5: (r) => (r.fdrAvg === null ? "–" : `<span class="ps-fx ps-d${clampDiff(Math.round(r.fdrAvg))}">${r.fdrAvg.toFixed(2)}</span>`),
  };

  function playerCell(r) {
    const id = r.p.id;
    const name = esc(r.p.web_name);
    const isPinned = pinned.includes(id);
    const isWatch = watch.includes(id);
    const isCmp = compare.has(id);
    const img = r.team?.code
      ? `<img class="ps-shirt" src="${SHIRTS}/shirt_${r.team.code}${r.p.element_type === 1 ? "_1" : ""}-66.png" alt="" loading="lazy">`
      : "";
    return `<td class="ps-namecol">
      <div class="ps-player">
        <div class="ps-icons">
          <button type="button" class="ps-ico ${isPinned ? "is-on" : ""}" data-pin="${id}" aria-pressed="${isPinned}" aria-label="${isPinned ? "Unpin" : "Pin"} ${name}" title="${isPinned ? "Unpin" : "Pin to top"}">📌</button>
          <button type="button" class="ps-ico ${isWatch ? "is-on" : ""}" data-star="${id}" aria-pressed="${isWatch}" aria-label="${isWatch ? "Remove" : "Add"} ${name} ${isWatch ? "from" : "to"} watchlist" title="${isWatch ? "Remove from watchlist" : "Add to watchlist"}">${isWatch ? "★" : "☆"}</button>
          <button type="button" class="ps-ico ${isCmp ? "is-on" : ""}" data-cmp="${id}" aria-pressed="${isCmp}" aria-label="${isCmp ? "Remove" : "Compare"} ${name}" title="${isCmp ? "Remove from compare" : "Add to compare"}">${isCmp ? "◉" : "◯"}</button>
        </div>
        ${img}
        <div>
          <div class="ps-pname">${name}</div>
          <div class="ps-psub">${esc(r.team?.short ?? "")} · ${POS[r.p.element_type] ?? ""}</div>
        </div>
      </div>
    </td>`;
  }

  function rowHtml(r) {
    const cells = activeCols()
      .map((c) => `<td class="${c.num ? "n" : ""}">${CELL[c.key](r)}</td>`)
      .join("");
    return `<tr class="${pinned.includes(r.p.id) ? "is-pinned" : ""}">${playerCell(r)}${cells}</tr>`;
  }

  // ---------- Rendering ----------
  function renderHead() {
    const cols = activeCols()
      .map((c) => {
        if (!c.sort) return `<th scope="col" title="${esc(c.full)}">${esc(c.label)}</th>`;
        const active = state.sort.key === c.key;
        const aria = active ? (state.sort.dir > 0 ? "ascending" : "descending") : "none";
        const arrow = active ? (state.sort.dir > 0 ? " ▲" : " ▼") : "";
        return `<th scope="col" aria-sort="${aria}" class="${c.num ? "n" : ""}" title="${esc(c.full)}">
          <button type="button" class="ps-sort ${active ? "is-active" : ""}" data-sort="${c.key}">${esc(c.label)}${arrow}</button>
        </th>`;
      })
      .join("");
    $("ps-head").innerHTML = `<tr><th scope="col" class="ps-namecol">Player</th>${cols}</tr>`;
  }

  function emptyMessage() {
    if (state.tab === "mine") {
      if (mineIds === false) return `Log in to see your team. <a href="/login">Log in</a>`;
      if (mineError) return esc(mineError);
      if (mineIds === undefined) return "Loading your team…";
    }
    if (state.tab === "watch" && !watch.length) {
      return "Press the star next to a player to add them to your watchlist.";
    }
    return "No players match these filters. Try widening the filters.";
  }

  function renderCompare() {
    const box = $("ps-compare");
    box.hidden = compare.size === 0;
    if (!compare.size) return;
    const list = rows
      .filter((r) => compare.has(r.p.id))
      .map((r) => `${esc(r.p.web_name)} (${r.pts} pts, ${money(r.p.now_cost)}, ${r.own.toFixed(1)}%)`)
      .join(" · ");
    $("ps-compare-list").innerHTML = list;
  }

  function renderTable() {
    renderHead();
    const list = visibleRows();
    const shown = list.slice(0, state.limit);
    const span = activeCols().length + 1;

    $("ps-body").innerHTML = shown.length
      ? shown.map(rowHtml).join("")
      : `<tr><td colspan="${span}" class="ps-empty">${emptyMessage()}</td></tr>`;

    const more = $("ps-more");
    more.hidden = list.length <= state.limit;
    more.textContent = `Show more (${Math.max(0, list.length - state.limit)} left)`;

    $("ps-count-all").textContent = String(rows.length);
    $("ps-count-watch").textContent = String(watch.length);
    $("ps-count-mine").textContent = mineIds instanceof Set ? String(mineIds.size) : "–";

    document.querySelectorAll(".ps-tab").forEach((b) => {
      b.setAttribute("aria-selected", String(b.dataset.tab === state.tab));
    });

    renderCompare();
    $("ps-note").textContent =
      "xPts next is FPL's expected points for the current gameweek. xPts 5GW and xPts 5/£m are our estimates, weighted by fixture difficulty. Minutes % is the share of 90 minutes played in each recent gameweek.";
  }

  function renderAll() {
    renderTable();
  }

  // ---------- Filter and column controls ----------
  function fillFilterOptions() {
    const pos = $("ps-f-pos");
    pos.innerHTML = `<option value="0">All positions</option>` +
      Object.entries(POS).map(([id, label]) => `<option value="${id}">${label}</option>`).join("");

    const team = $("ps-f-team");
    team.innerHTML = `<option value="0">All clubs</option>` +
      [...snap.teams]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((t) => `<option value="${t.id}">${esc(t.name)}</option>`)
        .join("");
  }

  function syncFilterControls() {
    const f = state.filters;
    $("ps-f-status").value = f.status;
    $("ps-f-pos").value = String(f.pos);
    $("ps-f-team").value = String(f.team);
    $("ps-f-pmin").value = String(f.pmin);
    $("ps-f-pmax").value = String(f.pmax);
    $("ps-f-omin").value = String(f.omin);
    $("ps-f-omax").value = String(f.omax);
    $("ps-f-price-l").textContent = `£${(f.pmin / 10).toFixed(1)} – £${(f.pmax / 10).toFixed(1)}`;
    $("ps-f-own-l").textContent = `${f.omin}% – ${f.omax}%`;
  }

  function renderColumnList() {
    $("ps-col-list").innerHTML = COLUMNS.map(
      (c) => `<label class="ps-col">
        <input type="checkbox" data-col="${c.key}" ${state.cols.includes(c.key) ? "checked" : ""}>
        <span>${esc(c.full)}</span>
      </label>`,
    ).join("");
  }

  function togglePanel(panelId, btnId) {
    const panel = $(panelId);
    const open = panel.hidden;
    panel.hidden = !open;
    $(btnId).setAttribute("aria-expanded", String(open));
  }

  // ---------- Actions ----------
  function togglePin(id) {
    pinned = pinned.includes(id) ? pinned.filter((x) => x !== id) : [...pinned, id];
    writeJSON(KEY_PIN, pinned);
    renderTable();
  }

  function toggleWatch(id) {
    watch = watch.includes(id) ? watch.filter((x) => x !== id) : [...watch, id];
    writeJSON(KEY_WATCH, watch);
    renderTable();
  }

  function toggleCompare(id) {
    if (compare.has(id)) {
      compare.delete(id);
    } else if (compare.size >= COMPARE_MAX) {
      toast(`You can compare up to ${COMPARE_MAX} players. Remove one first.`);
      return;
    } else {
      compare.add(id);
    }
    renderTable();
  }

  function saveView() {
    writeJSON(KEY_VIEW, { tab: state.tab, sort: state.sort, cols: state.cols, filters: state.filters });
    toast("View saved. It will open with these settings next time.");
  }

  function loadView() {
    const v = readJSON(KEY_VIEW, null);
    if (!v || typeof v !== "object") return;
    if (TAB_LABEL[v.tab]) state.tab = v.tab;
    if (v.sort && COLUMNS.some((c) => c.key === v.sort.key && c.sort)) {
      state.sort = { key: v.sort.key, dir: v.sort.dir === 1 ? 1 : -1 };
    }
    if (Array.isArray(v.cols)) state.cols = COLUMNS.map((c) => c.key).filter((k) => v.cols.includes(k));
    if (v.filters && typeof v.filters === "object") state.filters = { ...state.filters, ...v.filters };
  }

  // ---------- Wiring ----------
  function wire() {
    document.querySelectorAll(".ps-tab").forEach((b) =>
      b.addEventListener("click", () => {
        state.tab = b.dataset.tab;
        state.limit = PAGE;
        renderTable();
      }),
    );

    $("ps-head").addEventListener("click", (e) => {
      const b = e.target.closest("[data-sort]");
      if (!b) return;
      const key = b.dataset.sort;
      const col = COLUMNS.find((c) => c.key === key);
      if (state.sort.key === key) {
        state.sort.dir = -state.sort.dir;
      } else {
        state.sort = { key, dir: col?.asc ? 1 : -1 };
      }
      renderTable();
    });

    $("ps-body").addEventListener("click", (e) => {
      const pin = e.target.closest("[data-pin]");
      if (pin) return togglePin(Number(pin.dataset.pin));
      const star = e.target.closest("[data-star]");
      if (star) return toggleWatch(Number(star.dataset.star));
      const cmp = e.target.closest("[data-cmp]");
      if (cmp) return toggleCompare(Number(cmp.dataset.cmp));
    });

    $("ps-more").addEventListener("click", () => {
      state.limit += PAGE;
      renderTable();
    });

    $("ps-filters-btn").addEventListener("click", () => togglePanel("ps-filters-panel", "ps-filters-btn"));
    $("ps-columns-btn").addEventListener("click", () => togglePanel("ps-columns-panel", "ps-columns-btn"));
    $("ps-save-btn").addEventListener("click", saveView);

    $("ps-f-status").addEventListener("change", (e) => {
      state.filters.status = e.target.value;
      state.limit = PAGE;
      renderTable();
    });
    $("ps-f-pos").addEventListener("change", (e) => {
      state.filters.pos = Number(e.target.value);
      state.limit = PAGE;
      renderTable();
    });
    $("ps-f-team").addEventListener("change", (e) => {
      state.filters.team = Number(e.target.value);
      state.limit = PAGE;
      renderTable();
    });

    const pmin = $("ps-f-pmin");
    const pmax = $("ps-f-pmax");
    const omin = $("ps-f-omin");
    const omax = $("ps-f-omax");
    const onPrice = () => {
      let lo = Number(pmin.value);
      let hi = Number(pmax.value);
      if (lo > hi) [lo, hi] = [hi, lo];
      state.filters.pmin = lo;
      state.filters.pmax = hi;
      state.limit = PAGE;
      syncFilterControls();
      renderTable();
    };
    const onOwn = () => {
      let lo = Number(omin.value);
      let hi = Number(omax.value);
      if (lo > hi) [lo, hi] = [hi, lo];
      state.filters.omin = lo;
      state.filters.omax = hi;
      state.limit = PAGE;
      syncFilterControls();
      renderTable();
    };
    pmin.addEventListener("input", onPrice);
    pmax.addEventListener("input", onPrice);
    omin.addEventListener("input", onOwn);
    omax.addEventListener("input", onOwn);

    $("ps-f-reset").addEventListener("click", () => {
      state.filters = { status: "all", pos: 0, team: 0, pmin: 38, pmax: 158, omin: 0, omax: 100 };
      state.limit = PAGE;
      syncFilterControls();
      renderTable();
    });

    $("ps-col-list").addEventListener("change", (e) => {
      const key = e.target.dataset.col;
      if (!key) return;
      const on = new Set(state.cols);
      if (e.target.checked) on.add(key);
      else on.delete(key);
      state.cols = COLUMNS.map((c) => c.key).filter((k) => on.has(k));
      renderTable();
    });
    $("ps-cols-all").addEventListener("click", () => {
      state.cols = COLUMNS.map((c) => c.key);
      renderColumnList();
      renderTable();
    });

    $("ps-compare-clear").addEventListener("click", () => {
      compare.clear();
      renderTable();
    });
  }

  document.addEventListener("fpl:ready", (e) => {
    if (!e.detail) return;
    snap = e.detail;
    teamById = new Map(snap.teams.map((t) => [t.id, t]));

    const current = snap.events.find((ev) => ev.current) ?? snap.events.find((ev) => ev.next);
    liveGw = current?.id ?? 1;
    nextGw = snap.events.find((ev) => !ev.finished)?.id ?? liveGw;
    last5 = snap.events
      .filter((ev) => ev.finished)
      .map((ev) => ev.id)
      .sort((a, b) => a - b)
      .slice(-PREV);

    watch = readJSON(KEY_WATCH, []);
    pinned = readJSON(KEY_PIN, []);

    buildUpcoming();
    loadView();
    fillFilterOptions();
    syncFilterControls();
    renderColumnList();
    wire();

    prepare();
    renderAll();

    loadHistory(last5).then(() => {
      prepare();
      renderAll();
    });
    loadMine();
  });
})();
