/* my-team.js: My team. Banner, deadline, the squad in a Fixtures view and a List view, side filters,
   summary tiles, and the Rank Gains, Popular transfers, Threats and gameweek summary cards.
   The List view has a dropdown; each option sets its own columns. Page key: team-view. */
(() => {
  if (document.body.dataset.page !== "team-view") return;

  const $ = (id) => document.getElementById(id);
  const set = (id, text) => {
    const el = $(id);
    if (el) el.textContent = text;
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const SHIRTS = "https://fantasy.premierleague.com/dist/img/shirts/standard";
  const RISE_NET = 220000;
  const PAGE = 10;
  const LIST_GWS = 6;

  const PILLS = [
    ["all", "All"],
    ["played", "Played"],
    ["playing", "Playing"],
    ["toplay", "To Play"],
    ["didnt", "Didn't Play"],
    ["bench", "In Your Bench"],
  ];

  const LIST_OPTIONS = [
    ["points", "Points"],
    ["price", "Current Price"],
    ["form", "Form"],
    ["own", "Ownership"],
    ["change", "Price Change"],
  ];

  const POS_TITLE = { 1: "Goalkeeper", 2: "Defenders", 3: "Midfielders", 4: "Forwards" };

  // Columns for each dropdown option. "key" reads a value from the row, "fmt" formats it.
  const COLS = {
    points: [
      { label: "Pts", full: "Points", key: "pts", cls: "lp-pts" },
      { label: "MP", full: "Minutes played", key: "minutes" },
      { label: "GS", full: "Goals scored", key: "gs" },
      { label: "A", full: "Assists", key: "a" },
      { label: "CS", full: "Clean sheets", key: "cs" },
      { label: "GC", full: "Goals conceded", key: "gc" },
      { label: "OG", full: "Own goals", key: "og" },
      { label: "PS", full: "Penalties saved", key: "ps" },
      { label: "PM", full: "Penalties missed", key: "pm" },
      { label: "YC", full: "Yellow cards", key: "yc" },
      { label: "RC", full: "Red cards", key: "rc" },
    ],
    price: [
      { label: "CP", full: "Current price", key: "price" },
      { label: "PP", full: "Predicted price", key: "dash" },
      { label: "SP", full: "Selling price", key: "dash" },
      { label: "F", full: "Form", key: "form" },
      { label: "TP", full: "Total points", key: "total" },
      { label: "Fix", full: "Next fixture", key: "fix" },
    ],
    form: [
      { label: "F", full: "Form", key: "form" },
      { label: "GWP", full: "Gameweek points", key: "pts" },
      { label: "TP", full: "Total points", key: "total" },
      { label: "Fix", full: "Next fixture", key: "fix" },
    ],
    own: [
      { label: "Own", full: "Ownership", key: "own" },
      { label: "Trend", full: "Ownership trend", key: "trend" },
      { label: "OP", full: "Overall points", key: "total" },
      { label: "Fix", full: "Next fixture", key: "fix" },
    ],
    change: [
      { label: "Progress", full: "Progress towards price change", key: "progress" },
      { label: "Predicted", full: "Predicted progress", key: "predicted" },
      { label: "Status", full: "Status", key: "status" },
      { label: "Trend", full: "Ownership trend", key: "trend" },
      { label: "CP", full: "Current price", key: "price" },
    ],
  };

  let snap = null;
  let session = null;
  let gw = 1;      // gameweek being viewed
  let liveGw = 1;  // current gameweek, the one with live points and xPts
  let me = null;
  let picks = null;
  let sample = null;
  let around = null;
  let byId = new Map();
  let teamById = new Map();
  let posById = new Map();
  let threatFilter = "all";
  let threatShown = PAGE;
  let side = "players";
  let view = "fixtures";      // "fixtures" or "list"
  let listSort = "points";    // dropdown option for the List view
  let listMenuOpen = false;
  let listHelpOpen = false;
  const gwStatsCache = new Map();   // gameweek -> { map: Map(playerId -> stats), error: bool }
  const gwStatsPending = new Map(); // gameweek -> promise while loading
  const filters = { own: 100, price: 16, pos: 0, club: 0, sort: "default", name: "" };

  const readyP = new Promise((resolve) =>
    document.addEventListener("fpl:ready", (e) => resolve(e.detail), { once: true }),
  );

  async function api(path, options = {}) {
    const res = await fetch(`/api${path}`, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function readSession() {
    try {
      return JSON.parse(localStorage.getItem("fpl.session"));
    } catch {
      return null;
    }
  }

  function signOutToLogin() {
    localStorage.removeItem("fpl.session");
    location.assign("/login");
  }

  function setNavCurrent() {
    document.querySelectorAll('nav a[href="/team"]').forEach((a) => a.setAttribute("aria-current", "page"));
  }

  const fmt = (n) => (n === null || n === undefined ? "–" : Number(n).toLocaleString());
  const progressOf = (p) => ((p.transfers_in - p.transfers_out) / RISE_NET) * 100;
  const priceLabel = (v) => `${Number(v).toFixed(1).replace(/\.0$/, "")}m`;
  const money = (tenths) => `£${(tenths / 10).toFixed(1)}m`;

  // ---------- Club state for a gameweek ----------
  function clubStates(g) {
    const seen = new Map();
    for (const f of snap.fixtures) {
      if (f.gw !== g) continue;
      for (const t of [f.home, f.away]) {
        const list = seen.get(t) ?? [];
        list.push(f.finished ? "finished" : f.started ? "started" : "sleep");
        seen.set(t, list);
      }
    }
    const out = new Map();
    for (const [t, list] of seen) {
      if (list.every((s) => s === "finished")) out.set(t, "finished");
      else if (list.some((s) => s !== "sleep")) out.set(t, "started");
      else out.set(t, "sleep");
    }
    return out;
  }

  // ---------- Deadline ----------
  // The next deadline is the earliest one still in the future. This skips a gameweek that has already
  // passed its deadline but is still marked as current. If the snapshot has no future deadline, it falls
  // back to the earliest first kickoff still in the future, since FPL's deadline is the first kickoff.
  function nextDeadlineMs(snapshot, now = Date.now()) {
    let best = null;
    for (const e of snapshot.events) {
      if (!e.deadline_time) continue;
      const ms = Date.parse(e.deadline_time);
      if (Number.isNaN(ms) || ms <= now) continue;
      if (best === null || ms < best) best = ms;
    }
    if (best !== null) return best;

    const firstKick = new Map(); // gameweek -> its first kickoff
    for (const f of snapshot.fixtures) {
      if (f.gw === null || !f.kickoff) continue;
      const ms = Date.parse(f.kickoff);
      if (Number.isNaN(ms)) continue;
      if (!firstKick.has(f.gw) || ms < firstKick.get(f.gw)) firstKick.set(f.gw, ms);
    }
    for (const ms of firstKick.values()) {
      if (ms > now && (best === null || ms < best)) best = ms;
    }
    return best;
  }

  function setupDeadline() {
    const pad = (n) => String(n).padStart(2, "0");

    const tick = () => {
      const target = nextDeadlineMs(snap);
      if (!target) {
        set("dl-label", "Deadline not available");
        return;
      }
      const when = new Date(target)
        .toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
        .replace(",", "");
      set("dl-label", `Deadline ${when}`);

      const ms = target - Date.now();
      set("dl-d", pad(Math.floor(ms / 86400000)));
      set("dl-h", pad(Math.floor((ms % 86400000) / 3600000)));
      set("dl-m", pad(Math.floor((ms % 3600000) / 60000)));
      set("dl-s", pad(Math.floor((ms % 60000) / 1000)));
    };
    tick();
    setInterval(tick, 1000);
  }

  // ---------- Banner ----------
  function renderBanner() {
    set("gw-title", `Gameweek ${gw}`);
    const prev = $("gw-prev");
    if (prev) prev.disabled = gw <= 1;
    const next = $("gw-next");
    if (next) next.disabled = gw >= (snap.events.length || 38);
  }

  // ---------- Summary tiles, under the grid ----------
  function renderTiles() {
    const xi = picks?.picks.filter((x) => x.position <= 11) ?? [];
    const used = picks?.entry_history?.event_transfers ?? 0;
    const cost = picks?.entry_history?.event_transfers_cost ?? 0;
    const free = picks?.entry_history?.free_transfers ?? null;
    const bank = picks?.entry_history?.bank ?? null;

    set("tile-tr", free === null ? "–" : `${used} / ${free}`);
    set("tile-cost", `${cost} pts`);
    set("tile-bank", bank === null ? "–" : `£${(bank / 10).toFixed(1)}m`);

    const xpts = xi.reduce((s, pk) => {
      const p = byId.get(pk.element);
      return s + (p ? Number(p.ep_this ?? 0) * (pk.multiplier ?? 1) : 0);
    }, 0);
    set("tile-xpts", xi.length && gw === liveGw ? xpts.toFixed(1) : "–");
  }

  // ---------- Squad rows after the side filters (unsorted) ----------
  function squadRows() {
    const needle = filters.name.trim().toLowerCase();
    return picks.picks
      .map((pk) => ({ pk, p: byId.get(pk.element), isBench: pk.position > 11 }))
      .filter((r) => r.p)
      .filter(
        ({ p }) =>
          (!filters.pos || p.element_type === filters.pos) &&
          (!filters.club || p.team === filters.club) &&
          (!needle || p.web_name.toLowerCase().includes(needle)) &&
          p.selected_by_percent <= filters.own &&
          p.now_cost / 10 <= filters.price + 1e-9,
      );
  }

  // ---------- Fixtures view ----------
  function fdrClass(d) {
    return d <= 2 ? "fdr-e" : d === 3 ? "fdr-m" : d === 4 ? "fdr-h" : d >= 5 ? "fdr-x" : "fdr-b";
  }

  // "team:gw" -> [{ label, home, diff }] for every club, from the viewed gameweek onwards.
  function fixtureMap(lastGw) {
    const map = new Map();
    const sh = (id) => teamById.get(id)?.short ?? "";
    const add = (team, g, entry) => {
      const k = `${team}:${g}`;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(entry);
    };
    for (const f of snap.fixtures) {
      if (f.gw === null || f.gw < gw || f.gw > lastGw) continue;
      add(f.home, f.gw, { label: sh(f.away), home: true, diff: f.home_difficulty });
      add(f.away, f.gw, { label: sh(f.home), home: false, diff: f.away_difficulty });
    }
    return map;
  }

  // Uppercase when the player's club is at home, lowercase when away.
  function cellFixtures(list) {
    if (!list.length) return `<span class="fx fdr-b">BLANK</span>`;
    return list
      .map((x) => {
        const text = x.home ? x.label.toUpperCase() : x.label.toLowerCase();
        return `<span class="fx ${fdrClass(x.diff)}">${esc(text)}</span>`;
      })
      .join("");
  }

  function xpStrip(xp) {
    if (xp === null || Number.isNaN(xp)) return `<span class="xp xp-none">–</span>`;
    return `<span class="xp ${xp < 2 ? "xp-low" : "xp-mid"}">${xp.toFixed(2)} xPts</span>`;
  }

  function renderFixtures() {
    const lastGw = Math.min(snap.events.length || 38, gw + LIST_GWS - 1);
    const gws = [];
    for (let g = gw; g <= lastGw; g++) gws.push(g);
    const fixtures = fixtureMap(lastGw);

    const sorters = {
      points: (a, b) => b.p.total_points - a.p.total_points,
      price: (a, b) => b.p.now_cost - a.p.now_cost,
      form: (a, b) => b.p.form - a.p.form,
      own: (a, b) => b.p.selected_by_percent - a.p.selected_by_percent,
    };
    const rows = squadRows();
    if (sorters[filters.sort]) rows.sort(sorters[filters.sort]);

    const body = rows.length
      ? rows
          .map(({ pk, p, isBench }) => {
            const t = teamById.get(p.team);
            const gk = p.element_type === 1;
            const img = t?.code
              ? `<img src="${SHIRTS}/shirt_${t.code}${gk ? "_1" : ""}-66.png" alt="" loading="lazy">`
              : "";
            const badge = pk.is_captain
              ? `<span class="mt-cap-s">C</span>`
              : pk.is_vice_captain
                ? `<span class="mt-cap-s is-v">V</span>`
                : "";

            const cells = gws
              .map((g) => {
                const list = fixtures.get(`${p.team}:${g}`) ?? [];
                const xp = g === liveGw && p.ep_this !== undefined && p.ep_this !== null ? Number(p.ep_this) : null;
                return `<td class="mt-cell">${cellFixtures(list)}${xpStrip(xp)}</td>`;
              })
              .join("");

            return `<tr class="${isBench ? "is-bench" : ""}">
              <td class="mt-lname">
                <div class="mt-lplayer">
                  <span class="pl-info" aria-hidden="true">i</span>
                  ${img}
                  <div class="mt-lpname">${esc(p.web_name)}${badge}</div>
                </div>
              </td>
              ${cells}
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="${gws.length + 1}" class="mt-empty">No players match these filters.</td></tr>`;

    $("mt-view").innerHTML = `<div class="mt-list-wrap"><table class="mt-list">
      <thead><tr>
        <th class="mt-lname">Player</th>
        ${gws.map((g) => `<th class="mt-gwh">${g}</th>`).join("")}
      </tr></thead>
      <tbody>${body}</tbody>
    </table></div>`;
  }

  // ---------- List view ----------
  function loadGwStats(g) {
    if (gwStatsCache.has(g)) return Promise.resolve();
    if (!gwStatsPending.has(g)) {
      const p = api(`/gwstats/${g}`)
        .then((d) => gwStatsCache.set(g, { map: new Map(d.elements.map((e) => [e.id, e])), error: false }))
        .catch(() => gwStatsCache.set(g, { map: new Map(), error: true }))
        .finally(() => gwStatsPending.delete(g));
      gwStatsPending.set(g, p);
    }
    return gwStatsPending.get(g);
  }

  // Price change status, using the same thresholds as the Prices page.
  function statusOf(progressPct) {
    const a = Math.abs(progressPct);
    if (a >= 95) return "Likely to change";
    if (a >= 80) return "Possible";
    return "Unlikely to change";
  }

  // The value shown in one column for one player, for the chosen dropdown option.
  function cellValue(col, p, s, pk) {
    const key = col.key;
    if (key === "dash") return "–";
    if (key === "price") return money(p.now_cost);
    if (key === "form") return Number(p.form).toFixed(1);
    if (key === "total") return fmt(p.total_points);
    if (key === "own") return `${Number(p.selected_by_percent).toFixed(1)}%`;
    if (key === "trend") {
      const n = p.transfers_in - p.transfers_out;
      if (!n) return `<span class="lp-trend is-flat">–</span>`;
      return n > 0
        ? `<span class="lp-trend is-up">▲ Up</span>`
        : `<span class="lp-trend is-down">▼ Down</span>`;
    }
    if (key === "progress") {
      const v = progressOf(p);
      return `<span class="lp-pill ${v >= 0 ? "is-up" : "is-down"}">${v >= 0 ? "+" : ""}${v.toFixed(1)}%</span>`;
    }
    if (key === "predicted") {
      const v = progressOf(p);
      return `<span class="lp-pill ${v >= 0 ? "is-up" : "is-down"}">${v >= 0 ? "+" : ""}${v.toFixed(1)}%</span>`;
    }
    if (key === "status") {
      return `<span class="lp-status">${statusOf(progressOf(p))}</span>`;
    }
    if (key === "fix") {
      const list = fixtureUpcoming(p.team);
      return list.length ? esc(list[0]) : "–";
    }
    if (key === "pts") {
      if (!s) return "–";
      return s.pts;
    }
    if (key === "minutes" || key === "gs" || key === "a" || key === "cs" || key === "gc" ||
        key === "og" || key === "ps" || key === "pm" || key === "yc" || key === "rc") {
      return s ? s[key] : "–";
    }
    return "–";
  }

  // Next fixture for a club, as a short label such as "ARS (H)".
  function fixtureUpcoming(teamId) {
    const sh = (id) => teamById.get(id)?.short ?? "";
    const next = snap.fixtures
      .filter((f) => !f.finished && (f.home === teamId || f.away === teamId))
      .sort((a, b) => (a.kickoff ?? "").localeCompare(b.kickoff ?? ""))[0];
    if (!next) return [];
    return next.home === teamId ? [`${sh(next.away)} (H)`] : [`${sh(next.home)} (A)`];
  }

  // Sort within a position group, for the chosen dropdown option. Ties fall back to name.
  function sortListRows(rows, option, stats) {
    const val = {
      points: (r) => stats.get(r.p.id)?.pts ?? -1,
      price: (r) => r.p.now_cost,
      form: (r) => Number(r.p.form),
      own: (r) => r.p.selected_by_percent,
      change: (r) => r.p.cost_change_window,
    }[option] ?? (() => 0);
    rows.sort((a, b) => val(b) - val(a) || a.p.web_name.localeCompare(b.p.web_name));
    return rows;
  }

  function nameCell(pk, p) {
    const t = teamById.get(p.team);
    const gk = p.element_type === 1;
    const img = t?.code
      ? `<img src="${SHIRTS}/shirt_${t.code}${gk ? "_1" : ""}-66.png" alt="" loading="lazy">`
      : "";
    const badge = pk.is_captain
      ? `<span class="lp-cap">C</span>`
      : pk.is_vice_captain
        ? `<span class="lp-cap is-v">V</span>`
        : "";
    const flag =
      p.status === "a"
        ? `<span class="lp-info" aria-hidden="true">i</span>`
        : `<span class="lp-warn" role="img" aria-label="Flagged" title="Flagged">⚠</span>`;
    return `<div class="lp-player">${flag}${img}<div>
      <div class="lp-pname">${esc(p.web_name)}${badge}</div>
      <div class="lp-sub">${esc(t?.short ?? "")} • ${esc(posById.get(p.element_type) ?? "")}</div>
    </div></div>`;
  }

  function renderList() {
    if (!picks) {
      $("mt-view").innerHTML = `<p class="muted">Picks for gameweek ${gw} are not available yet.</p>`;
      return;
    }

    const cols = COLS[listSort] ?? COLS.points;
    const needsStats = listSort === "points" || listSort === "form" || listSort === "change";
    const entry = gwStatsCache.get(gw);

    // Stats are needed for the Points view and for the gameweek points column.
    if (!entry && (listSort === "points" || cols.some((c) => c.key === "pts"))) {
      $("mt-view").innerHTML = `<p class="mt-empty">Loading stats…</p>`;
      loadGwStats(gw).then(() => {
        if (view === "list") renderView();
      });
      return;
    }
    if (entry?.error && listSort === "points") {
      $("mt-view").innerHTML = `<p class="mt-empty">Stats for gameweek ${gw} are not available yet.</p>`;
      return;
    }

    const stats = entry?.map ?? new Map();
    const rows = squadRows();
    const span = cols.length + 1;

    const head = `<tr>
      <th class="lp-name-h">Player</th>
      ${cols.map((c) => `<th class="n"><abbr title="${c.full}">${c.label}</abbr></th>`).join("")}
    </tr>`;

    let body = "";
    for (const type of [1, 2, 3, 4]) {
      const group = sortListRows(rows.filter((r) => r.p.element_type === type), listSort, stats);
      if (!group.length) continue;
      body += `<tr class="lp-group"><th colspan="${span}">${POS_TITLE[type]}</th></tr>`;
      body += group
        .map(({ pk, p }) => {
          const s = stats.get(p.id);
          const cells = cols
            .map((c) => `<td class="n${c.cls ? " " + c.cls : ""}">${cellValue(c, p, s, pk)}</td>`)
            .join("");
          return `<tr><td class="lp-name">${nameCell(pk, p)}</td>${cells}</tr>`;
        })
        .join("");
    }

    if (!body) body = `<tr><td colspan="${span}" class="mt-empty">No players match these filters.</td></tr>`;

    $("mt-view").innerHTML = `<div class="lp-wrap"><table class="lp-table">
      <thead>${head}</thead>
      <tbody>${body}</tbody>
    </table></div>`;
  }

  // ---------- View switch and dropdown ----------
  function renderListControls() {
    const isList = view === "list";
    $("view-fx").classList.toggle("is-on", !isList);
    $("view-pts").classList.toggle("is-on", isList);
    $("view-fx").setAttribute("aria-pressed", String(!isList));
    $("view-pts").setAttribute("aria-pressed", String(isList));

    $("pts-dd").hidden = !isList;
    $("pts-help-btn").hidden = !isList;
    $("pts-help-btn").setAttribute("aria-expanded", String(listHelpOpen));
    $("pts-help-text").hidden = !isList || !listHelpOpen;

    const label = LIST_OPTIONS.find(([k]) => k === listSort)?.[1] ?? "Points";
    const btn = $("pts-dd-btn");
    btn.innerHTML = `${esc(label)} <span aria-hidden="true">${listMenuOpen ? "▴" : "▾"}</span>`;
    btn.setAttribute("aria-expanded", String(listMenuOpen));

    const menu = $("pts-dd-menu");
    menu.hidden = !listMenuOpen;
    menu.innerHTML = LIST_OPTIONS.map(
      ([k, l]) =>
        `<button type="button" class="lp-opt${k === listSort ? " is-on" : ""}" role="option" aria-selected="${k === listSort}" data-sort="${k}">${esc(l)}</button>`,
    ).join("");
  }

  function renderView() {
    renderListControls();
    if (view === "list") renderList();
    else renderFixtures();
  }

  // ---------- Side panel ----------
  function renderSide() {
    document.querySelectorAll("[data-side]").forEach((b) => {
      const on = b.dataset.side === side;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-selected", String(on));
    });

    const playersBox = $("side-players");
    const msg = $("side-msg");
    if (playersBox) playersBox.hidden = side !== "players";
    if (msg) {
      msg.hidden = side === "players";
      msg.textContent =
        side === "watch"
          ? "Your watchlist will appear here. Add players from the Prices page."
          : "The gameweek summary is shown below the squad.";
    }
  }

  function wireSide() {
    document.querySelectorAll("[data-side]").forEach((b) =>
      b.addEventListener("click", () => {
        side = b.dataset.side;
        renderSide();
      }),
    );

    $("own").addEventListener("input", (e) => {
      filters.own = Number(e.target.value);
      set("own-val", `${filters.own}%`);
      renderView();
    });
    $("price").addEventListener("input", (e) => {
      filters.price = Number(e.target.value);
      set("price-val", priceLabel(filters.price));
      renderView();
    });
    $("f-pos").addEventListener("change", (e) => {
      filters.pos = Number(e.target.value);
      renderView();
    });
    $("f-club").addEventListener("change", (e) => {
      filters.club = Number(e.target.value);
      renderView();
    });
    $("f-sort").addEventListener("change", (e) => {
      filters.sort = e.target.value;
      renderView();
    });
    $("f-name").addEventListener("input", (e) => {
      filters.name = e.target.value;
      renderView();
    });
  }

  // Club choices come from the squad, so they change with the gameweek.
  function fillClubs() {
    const sel = $("f-club");
    if (!sel) return;
    const clubs = new Map();
    for (const pk of picks?.picks ?? []) {
      const p = byId.get(pk.element);
      if (p) clubs.set(p.team, teamById.get(p.team)?.name ?? "");
    }
    sel.innerHTML =
      `<option value="0">Select Club</option>` +
      [...clubs.entries()]
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([id, name]) => `<option value="${id}">${esc(name)}</option>`)
        .join("");
    sel.value = clubs.has(filters.club) ? String(filters.club) : "0";
    filters.club = Number(sel.value);
  }

  // ---------- Rank Gains ----------
  function placesPerPoint(rows, myRank) {
    const list = (rows ?? []).filter((r) => r.rank && r.total !== undefined);
    if (list.length >= 2) {
      const ranks = list.map((r) => r.rank);
      const totals = list.map((r) => r.total);
      const dRank = Math.max(...ranks) - Math.min(...ranks);
      const dPts = Math.max(...totals) - Math.min(...totals);
      if (dRank > 0 && dPts > 0) return dRank / dPts;
    }
    return myRank ? myRank / 1500 : 0;
  }

  function eachPtFor(playerId, density) {
    if (!density) return 0;
    const eo = sample?.sampled ? (sample.owned[playerId] ?? 0) + (sample.captain?.[playerId] ?? 0) : 0;
    return Math.round(density * Math.max(0, 1 - Math.min(eo, 100) / 100));
  }

  function renderRankGains() {
    const box = $("rg-body");
    if (!box) return;
    if (!picks) {
      box.innerHTML = `<p class="rg-empty">Picks are not available yet.</p>`;
      return;
    }
    const live = window.FPL?.live?.() ?? new Map();
    const density = placesPerPoint(around?.rows, me?.summary_overall_rank);

    const rows = picks.picks
      .map((pk) => {
        const p = byId.get(pk.element);
        if (!p) return null;
        const each = eachPtFor(p.id, density);
        const base = live.get(p.id)?.p ?? 0;
        const gain = Math.round(base * (pk.multiplier ?? 1) * each);
        return { p, each, base, gain, progress: progressOf(p) };
      })
      .filter(Boolean)
      .sort((a, b) => b.gain - a.gain || a.p.web_name.localeCompare(b.p.web_name));

    box.innerHTML = rows.length ? rows.map(rankRow).join("") : `<p class="rg-empty">No players to show.</p>`;
    box.querySelectorAll("[data-w]").forEach((el) => {
      el.style.width = `${el.dataset.w}%`;
    });
  }

  function rankRow(r) {
    const t = teamById.get(r.p.team);
    const gk = r.p.element_type === 1;
    const img = t?.code ? `<img src="${SHIRTS}/shirt_${t.code}${gk ? "_1" : ""}-66.png" alt="" loading="lazy">` : "";
    const up = r.progress >= 0;
    const width = Math.min(100, Math.abs(r.progress));
    return `<div class="rg-row">
      <div class="rg-shirt">${img}</div>
      <div class="rg-main">
        <div class="rg-name">${esc(r.p.web_name)}</div>
        <div class="rg-each">Each pt: ${r.each ? r.each.toLocaleString() : "–"} <span class="rg-dot" aria-hidden="true"></span></div>
      </div>
      <div class="rg-gainbox">
        <div class="rg-pts">${r.base}</div>
        <div class="rg-gain${r.gain > 0 ? " is-up" : ""}">↗ ${r.gain.toLocaleString()}</div>
      </div>
      <div class="rg-prog">
        <div class="rg-track"><span class="${up ? "is-up" : "is-down"}" data-w="${width.toFixed(1)}"></span></div>
        <div class="rg-plabel ${up ? "up" : "down"}">${Math.abs(r.progress).toFixed(1)}% ${up ? "↑" : "↓"}</div>
      </div>
    </div>`;
  }

  // ---------- Gameweek summary ----------
  function summaryData() {
    const live = window.FPL?.live?.() ?? new Map();
    const xi = picks.picks.filter((x) => x.position <= 11);
    const bench = picks.picks.filter((x) => x.position > 11);
    const liveXi = xi.reduce((s, pk) => s + (live.get(pk.element)?.p ?? 0) * (pk.multiplier ?? 1), 0);
    const benchPts = bench.reduce((s, pk) => s + (live.get(pk.element)?.p ?? 0), 0);
    const rank = me.summary_overall_rank ?? null;
    const prevRank = (around?.rows ?? []).find((r) => r.you)?.rank ?? rank;
    const avgGain = around?.rows?.length ? around.rows.reduce((s, r) => s + (r.gw ?? 0), 0) / around.rows.length : 0;
    const starters = xi
      .map((pk) => {
        const p = byId.get(pk.element);
        if (!p) return null;
        const pts = (live.get(pk.element)?.p ?? 0) * (pk.multiplier ?? 1);
        return { p, pts, gain: pts - avgGain / 2 };
      })
      .filter(Boolean);
    starters.sort((a, b) => b.gain - a.gain);
    const star = starters[0] ?? null;
    const flop = starters.at(-1) ?? null;
    const killer = starters.slice().sort((a, b) => a.gain - b.gain)[0] ?? null;
    const changePct = rank && prevRank ? ((prevRank - rank) / prevRank) * 100 : 0;
    const topPct = rank && snap.totalManagers ? (rank / snap.totalManagers) * 100 : null;
    return {
      liveXi,
      benchPts,
      total: me.summary_overall_points ?? 0,
      rank,
      prevRank,
      ranksGained: prevRank && rank ? prevRank - rank : 0,
      changePct,
      topPct,
      star,
      flop,
      killer,
    };
  }

  function summaryCard(kind, label, icon, pick) {
    const img = pick
      ? (() => {
          const t = teamById.get(pick.p.team);
          const gk = pick.p.element_type === 1;
          return t?.code ? `<img src="${SHIRTS}/shirt_${t.code}${gk ? "_1" : ""}-66.png" alt="" loading="lazy">` : "";
        })()
      : "";
    const figure = pick
      ? kind === "killer"
        ? `Loss: ${pick.pts.toFixed(2)} pts`
        : `Gain: ${pick.pts >= 0 ? "+" : ""}${pick.pts.toFixed(2)} pts`
      : "";
    return `<div class="gs-card is-${kind}">
      <div class="gs-cardhead"><span aria-hidden="true">${icon}</span> ${label}</div>
      <div class="gs-shirt">${img}</div>
      <div class="gs-name">${pick ? esc(pick.p.web_name) : "–"}</div>
      <div class="gs-num">${pick ? pick.pts.toFixed(0) : "–"}</div>
      <div class="gs-fig">${figure}</div>
    </div>`;
  }

  function renderSummary() {
    const box = $("summary-slot");
    if (!box) return;
    if (!picks) {
      box.innerHTML = "";
      return;
    }
    const d = summaryData();
    const tile = (label, value, extra = "") =>
      `<div class="gs-tile${extra}"><div class="gs-label">${label}</div><div class="gs-val">${value}</div></div>`;
    box.innerHTML = `
      <div class="gs-card-wrap">
        <div class="gs-section-title"><span aria-hidden="true">🔢</span> Points gained: ${d.liveXi >= 0 ? "+" : ""}${d.liveXi}</div>
        <div class="gs-grid">
          ${tile("GW live", fmt(d.liveXi))}
          ${tile("Total", fmt(d.total))}
          ${tile("Bench", fmt(d.benchPts))}
          ${tile("Safety", "–")}
          ${tile("Off top 10k", "–")}
          ${tile("Off 3m", "–")}
        </div>
        <div class="gs-section-title"><span aria-hidden="true">🌎</span> Ranks gained: ${d.ranksGained >= 0 ? "+" : ""}${fmt(d.ranksGained)}</div>
        <div class="gs-grid">
          ${tile("Pre-subs", fmt(d.rank))}
          ${tile("Old rank", fmt(d.prevRank))}
          ${tile("Change %", `${d.changePct >= 0 ? "+" : ""}${d.changePct.toFixed(2)}%`, " is-green")}
          ${tile("Post-subs", fmt(d.rank))}
          ${tile("GW rank", fmt(d.rank))}
          ${tile("Rank %", d.topPct === null ? "–" : `Top ${d.topPct.toFixed(1)}%`)}
        </div>
        <div class="gs-cards">
          ${summaryCard("star", "Star", "☆", d.star)}
          ${summaryCard("flop", "Flop", "☹", d.flop)}
          ${summaryCard("killer", "Killer", "☠", d.killer)}
        </div>
      </div>`;
  }

  // ---------- Popular transfers ----------
  function chip(p) {
    if (!p) return `<span class="pt-name">Unknown</span>`;
    const t = teamById.get(p.team);
    const img = t?.code ? `<img src="${SHIRTS}/shirt_${t.code}-66.png" alt="" loading="lazy">` : "";
    return `${img}<span class="pt-name">${esc(p.web_name)}</span>`;
  }

  function renderPopular() {
    const box = $("pop-body");
    if (!box) return;
    if (!sample?.sampled) {
      box.innerHTML = `<p class="meta pt-empty">Popular transfers appear once the top 10k sample has data.</p>`;
      return;
    }
    const rows = sample.transfers ?? [];
    if (!rows.length) {
      box.innerHTML = `<p class="meta pt-empty">Transfers are still being collected for this gameweek.</p>`;
      return;
    }
    box.innerHTML = rows
      .map((t) => {
        const net = t.net ?? 0;
        const cls = net > 0 ? "is-up" : net < 0 ? "is-down" : "is-zero";
        return `<div class="pt-row">
          <span class="pt-pct">${t.pct.toFixed(2)}%</span>
          <span class="pt-from">${chip(byId.get(t.out))}<span class="pt-cnt">${t.outCount ?? ""}</span></span>
          <span class="pt-arrow" aria-hidden="true">→</span>
          <span class="pt-to">${chip(byId.get(t.in))}<span class="pt-cnt">${t.inCount ?? ""}</span></span>
          <span class="pt-num ${cls}">${net > 0 ? "+" : ""}${net}</span>
        </div>`;
      })
      .join("");
  }

  // ---------- Main threats ----------
  function threatRows() {
    if (!sample?.sampled) return null;
    const live = window.FPL?.live?.() ?? new Map();
    const states = clubStates(liveGw);
    const xi = new Set(picks.picks.filter((x) => x.position <= 11).map((x) => x.element));
    const bench = new Set(picks.picks.filter((x) => x.position > 11).map((x) => x.element));
    const rows = [];
    for (const key of Object.keys(sample.owned)) {
      const id = Number(key);
      const p = byId.get(id);
      if (!p) continue;
      const eo = (sample.owned[key] ?? 0) + (sample.captain?.[key] ?? 0);
      const delta = (xi.has(id) ? 100 : 0) - eo;
      if (delta >= 0) continue;
      const d = live.get(id);
      const st = states.get(p.team);
      let status;
      if (st === undefined) status = "didnt";
      else if (st === "finished") status = d && d.m === 0 ? "didnt" : "played";
      else if (st === "started") status = "playing";
      else status = "toplay";
      const pts = d ? d.p : null;
      rows.push({
        p,
        eo,
        delta,
        pts,
        lost: pts === null ? null : (eo / 100) * pts,
        status,
        bench: bench.has(id),
        progress: progressOf(p),
      });
    }
    rows.sort((a, b) => (b.lost ?? -1) - (a.lost ?? -1) || a.delta - b.delta);
    return rows;
  }

  const matchesFilter = (r) => {
    if (threatFilter === "all") return true;
    if (threatFilter === "bench") return r.bench;
    return r.status === threatFilter;
  };

  function threatLine(r) {
    const t = teamById.get(r.p.team);
    const img = t?.code ? `<img class="th-shirt" src="${SHIRTS}/shirt_${t.code}-66.png" alt="" loading="lazy">` : "";
    const up = r.progress >= 0;
    return `<tr>
      <td class="th-namecol"><div class="th-name">${img}<div>
        <div class="th-pname">${esc(r.p.web_name)}</div>
        <div class="th-sub">${esc(t?.short ?? "")} • ${esc(posById.get(r.p.element_type)
