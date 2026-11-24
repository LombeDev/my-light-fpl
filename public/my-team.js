/* my-team.js: My team. Banner, deadline, the squad in a Fixtures view and a Points view, side filters,
   summary tiles, and the Rank Gains, Popular transfers, Threats and gameweek summary cards.
   Page key: team-view. Loads after app.js and team-view.js. */
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

  const POINTS_SORTS = [
    ["points", "Points"],
    ["price", "Current Price"],
    ["form", "Form"],
    ["own", "Ownership"],
    ["change", "Price Change"],
  ];

  const POS_TITLE = { 1: "Goalkeeper", 2: "Defenders", 3: "Midfielders", 4: "Forwards" };

  // [column label, full name, key in the gameweek stats]
  const COLS = [
    ["Pts", "Points", "pts"],
    ["MP", "Minutes played", "minutes"],
    ["GS", "Goals scored", "gs"],
    ["A", "Assists", "a"],
    ["CS", "Clean sheets", "cs"],
    ["GC", "Goals conceded", "gc"],
    ["OG", "Own goals", "og"],
    ["PS", "Penalties saved", "ps"],
    ["PM", "Penalties missed", "pm"],
    ["YC", "Yellow cards", "yc"],
    ["RC", "Red cards", "rc"],
  ];

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
  let view = "fixtures";      // "fixtures" or "points"
  let ptsSort = "points";     // sort key for the Points view
  let ptsMenuOpen = false;
  let ptsHelpOpen = false;
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

  // ---------- Points view ----------
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

  // Sort within a position group. Ties fall back to name.
  function sortPointsRows(rows, key, stats) {
    const sorters = {
      points: (a, b) => (stats.get(b.p.id)?.pts ?? -1) - (stats.get(a.p.id)?.pts ?? -1),
      price: (a, b) => b.p.now_cost - a.p.now_cost,
      form: (a, b) => b.p.form - a.p.form,
      own: (a, b) => b.p.selected_by_percent - a.p.selected_by_percent,
      change: (a, b) => b.p.cost_change_window - a.p.cost_change_window,
    };
    const cmp = sorters[key] ?? sorters.points;
    rows.sort((a, b) => cmp(a, b) || a.p.web_name.localeCompare(b.p.web_name));
    return rows;
  }

  function pointsNameCell(pk, p) {
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

  function renderPoints() {
    if (!picks) {
      $("mt-view").innerHTML = `<p class="muted">Picks for gameweek ${gw} are not available yet.</p>`;
      return;
    }

    const entry = gwStatsCache.get(gw);
    if (!entry) {
      $("mt-view").innerHTML = `<p class="mt-empty">Loading stats…</p>`;
      loadGwStats(gw).then(() => {
        if (view === "points") renderView();
      });
      return;
    }
    if (entry.error) {
      $("mt-view").innerHTML = `<p class="mt-empty">Stats for gameweek ${gw} are not available yet.</p>`;
      return;
    }

    const stats = entry.map;
    const rows = squadRows();
    const span = COLS.length + 1;

    const head = `<tr>
      <th class="lp-name-h">Player</th>
      ${COLS.map(([label, full]) => `<th class="n"><abbr title="${full}">${label}</abbr></th>`).join("")}
    </tr>`;

    let body = "";
    for (const type of [1, 2, 3, 4]) {
      const group = sortPointsRows(
        rows.filter((r) => r.p.element_type === type),
        ptsSort,
        stats,
      );
      if (!group.length) continue;
      body += `<tr class="lp-group"><th colspan="${span}">${POS_TITLE[type]}</th></tr>`;
      body += group
        .map(({ pk, p }) => {
          const s = stats.get(p.id);
          const cells = COLS.map(([, , key]) => {
            const v = s ? s[key] : "–";
            return `<td class="n${key === "pts" ? " lp-pts" : ""}">${v}</td>`;
          }).join("");
          return `<tr><td class="lp-name">${pointsNameCell(pk, p)}</td>${cells}</tr>`;
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
  function renderPtsControls() {
    const isPts = view === "points";
    $("view-fx").classList.toggle("is-on", !isPts);
    $("view-pts").classList.toggle("is-on", isPts);
    $("view-fx").setAttribute("aria-pressed", String(!isPts));
    $("view-pts").setAttribute("aria-pressed", String(isPts));

    $("pts-dd").hidden = !isPts;
    $("pts-help-btn").hidden = !isPts;
    $("pts-help-btn").setAttribute("aria-expanded", String(ptsHelpOpen));
    $("pts-help-text").hidden = !isPts || !ptsHelpOpen;

    const label = POINTS_SORTS.find(([k]) => k === ptsSort)?.[1] ?? "Points";
    const btn = $("pts-dd-btn");
    btn.innerHTML = `${esc(label)} <span aria-hidden="true">${ptsMenuOpen ? "▴" : "▾"}</span>`;
    btn.setAttribute("aria-expanded", String(ptsMenuOpen));

    const menu = $("pts-dd-menu");
    menu.hidden = !ptsMenuOpen;
    menu.innerHTML = POINTS_SORTS.map(
      ([k, l]) =>
        `<button type="button" class="lp-opt${k === ptsSort ? " is-on" : ""}" role="option" aria-selected="${k === ptsSort}" data-sort="${k}">${esc(l)}</button>`,
    ).join("");
  }

  function renderView() {
    renderPtsControls();
    if (view === "points") renderPoints();
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
        <div class="th-sub">${esc(t?.short ?? "")} • ${esc(posById.get(r.p.element_type) ?? "")}</div>
      </div></div></td>
      <td class="n down">${r.delta.toFixed(1)}%</td>
      <td class="n">${r.pts === null ? "–" : r.pts}</td>
      <td class="n">${r.lost === null ? "–" : r.lost.toFixed(1)}</td>
      <td class="n"><span class="${up ? "up" : "down"}">${Math.abs(r.progress).toFixed(1)}% ${up ? "↑" : "↓"}</span></td>
    </tr>`;
  }

  function renderThreats() {
    const pills = $("th-pills");
    if (!pills) return;
    pills.innerHTML = PILLS.map(
      ([key, label]) =>
        `<button type="button" class="th-pill${threatFilter === key ? " is-on" : ""}" data-filter="${key}" aria-pressed="${threatFilter === key}"><span class="th-dot" aria-hidden="true"></span>${label}</button>`,
    ).join("");

    const all = threatRows();
    if (all === null) {
      set("th-note", "Threats appear once the top 10k sample has data.");
      $("th-head").innerHTML = "";
      $("th-body").innerHTML = "";
      $("th-more").hidden = true;
      return;
    }
    set("th-note", "");
    $("th-head").innerHTML = `<tr>
      <th class="th-namecol">Player</th>
      <th class="n">EO Δ</th>
      <th class="n">Score</th>
      <th class="n">Pts Lost</th>
      <th class="n">Progress towards price rise/fall</th>
    </tr>`;
    const list = all.filter(matchesFilter);
    const shown = list.slice(0, threatShown);
    $("th-body").innerHTML = shown.length ? shown.map(threatLine).join("") : `<tr><td colspan="5">No players match.</td></tr>`;
    const btn = $("th-more");
    btn.hidden = list.length <= threatShown;
    btn.textContent = `Show more (${Math.max(0, list.length - threatShown)} left)`;
  }

  // ---------- Loading and drawing ----------
  async function loadGw(g) {
    picks = await api(`/picks/${session.entryId}/${g}`).catch(() => null);
  }

  async function loadAll() {
    const auth = { headers: { Authorization: `Bearer ${session.token}` } };
    const [meRes, sampleRes, aroundRes] = await Promise.all([
      api("/me", auth),
      api("/sample").catch(() => null),
      api(`/around/${session.entryId}`).catch(() => null),
    ]);
    me = meRes.entry;
    sample = sampleRes;
    around = aroundRes;
    await loadGw(gw);
    draw();
  }

  function draw() {
    const e = me;
    set(
      "team-meta",
      `${e.name} · ${e.player_first_name} ${e.player_last_name} · ${e.summary_overall_points} pts · rank ${
        e.summary_overall_rank ? Number(e.summary_overall_rank).toLocaleString() : "–"
      }`,
    );
    set("team-note", gw !== liveGw ? "Viewing a past or upcoming gameweek." : "");

    fillClubs();
    renderBanner();
    renderTiles();
    renderView();
    renderSide();
    renderSummary();
    renderRankGains();
    renderPopular();
    renderThreats();
  }

  function wireControls() {
    $("gw-prev").addEventListener("click", async () => {
      gw = Math.max(1, gw - 1);
      await loadGw(gw);
      draw();
    });
    $("gw-next").addEventListener("click", async () => {
      gw = Math.min(snap.events.length || 38, gw + 1);
      await loadGw(gw);
      draw();
    });

    $("view-fx").addEventListener("click", () => {
      view = "fixtures";
      ptsMenuOpen = false;
      renderView();
    });
    $("view-pts").addEventListener("click", () => {
      view = "points";
      renderView();
    });

    $("pts-dd-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      ptsMenuOpen = !ptsMenuOpen;
      renderPtsControls();
    });
    $("pts-dd-menu").addEventListener("click", (e) => {
      const b = e.target.closest("[data-sort]");
      if (!b) return;
      ptsSort = b.dataset.sort;
      ptsMenuOpen = false;
      renderView();
    });
    document.addEventListener("click", (e) => {
      if (ptsMenuOpen && !$("pts-dd").contains(e.target)) {
        ptsMenuOpen = false;
        renderPtsControls();
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && ptsMenuOpen) {
        ptsMenuOpen = false;
        renderPtsControls();
      }
    });

    $("pts-help-btn").addEventListener("click", () => {
      ptsHelpOpen = !ptsHelpOpen;
      renderPtsControls();
    });

    $("th-pills").addEventListener("click", (e) => {
      const b = e.target.closest("[data-filter]");
      if (!b) return;
      threatFilter = b.dataset.filter;
      threatShown = PAGE;
      renderThreats();
    });
    $("th-more").addEventListener("click", () => {
      threatShown += PAGE;
      renderThreats();
    });
  }

  async function init() {
    setNavCurrent();
    session = readSession();
    if (!session) return location.assign("/login");

    wireControls();
    wireSide();
    setupDeadline();

    try {
      await loadAll();
      document.addEventListener("fpl:live", () => {
        if (me) draw();
      });
    } catch (err) {
      if (err.status === 401) return signOutToLogin();
      set("team-note", `Could not load your team. ${esc(err.message)}`);
    }
  }

  readyP.then((s) => {
    snap = s;
    if (!snap) {
      set("team-note", "Could not load data. Try again shortly.");
      return;
    }
    liveGw = (snap.events.find((e) => e.current) ?? snap.events.find((e) => e.next) ?? snap.events[0])?.id ?? 1;
    gw = liveGw;
    byId = new Map(snap.players.map((p) => [p.id, p]));
    teamById = new Map(snap.teams.map((t) => [t.id, t]));
    posById = new Map(snap.positions.map((p) => [p.id, p.short]));

    const pos = $("f-pos");
    if (pos) snap.positions.forEach((p) => pos.append(new Option(p.short, String(p.id))));

    init();
  });
})();
