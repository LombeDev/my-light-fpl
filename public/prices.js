/* prices.js: the Prices page, laid out like the official FPL price change table.
   Once the server has rebuilt its transfer windows, progress comes only from the server, so players
   who have already changed are not shown with stale figures. Before that, the local estimate is used.
   Status uses predicted progress: 95% or more is "Likely", 100% or more is "Very likely".
   Ten players per page. Past changes and locks come from /api/prices/events. Starts on fpl:ready from app.js. */
(() => {
  if (document.body.dataset.page !== "prices") return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const SHIRTS = "https://fantasy.premierleague.com/dist/img/shirts/standard";
  const money = (tenths) => `£${(tenths / 10).toFixed(1)}m`;
  const signed1Pct = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;
  const TABLE_PAGE = 10;
  const PAST_PAGE = 25;
  const EVENTS_EVERY_MS = 5 * 60_000;
  const PROGRESS_EVERY_MS = 5 * 60_000;

  const OWN_FLOOR = 1.7;       // players below this ownership are left out of the general table
  const PRICE_HOUR_UTC = 0;    // 00:00 UTC = 02:00 CAT, the official change time
  const SAMPLE_MIN = 15;       // progress is sampled every 15 minutes
  const GW_MAX_STEPS = 3;      // at most £0.3m of movement per gameweek

  // Ownership tiers: [minOwnershipPct, riseThresholdNet, fallThresholdNet]
  const OWN_TIERS = [
    [50.0, 340000, 310000],
    [30.0, 275000, 250000],
    [15.0, 220000, 195000],
    [5.0, 165000, 145000],
    [1.7, 125000, 110000],
    [0.0, 90000, 85000],
  ];

  const STATUS = {
    vlr: "Very likely to rise",
    lr: "Likely to rise",
    u: "Unlikely to change",
    ld: "Likely to drop",
    vld: "Very likely to drop",
  };

  const KEY_PROG = "fpl.progress";
  const KEY_WATCH = "fpl.watch";
  const KEY_BASE = "fpl.baseline";
  const KEY_META = "fpl.priceMeta";

  let snap = null;
  let teamById = new Map();
  let posById = new Map();
  let byId = new Map();
  let rates = {};              // player id -> progress change per hour (percentage points)
  let watch = [];
  let mine = new Set();
  let locks = new Map();       // player id -> lock end time in ms
  let serverProgress = null;   // player id -> progress %, counted since each player's last price change
  let serverReady = false;     // true once the server has sent rebuilt windows
  let tablePage = 1;
  const state = { tab: "table", sub: "all", list: "risers", pct: true };

  let events = [];
  let eventsLoaded = false;
  let eventsError = null;
  const past = { filter: "all", limit: PAST_PAGE };

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
      // Ignore storage quota or restricted mode errors
    }
  };

  // ---------- Price model (fallback only, used until the server's figures are ready) ----------
  const ownershipPct = (p) => {
    const v = Number(p.selected_by_percent);
    return Number.isFinite(v) ? v : 0;
  };

  function effectiveNetTransfers(p) {
    const rawNet = (Number(p.transfers_in) || 0) - (Number(p.transfers_out) || 0);
    if (!rawNet) return 0;
    const own = Math.max(0.5, ownershipPct(p));
    const chipDiscount = own > 25 ? 0.92 : 0.95;
    return rawNet * chipDiscount;
  }

  function tierThresholds(p) {
    const own = ownershipPct(p);
    for (const [minOwn, riseNet, fallNet] of OWN_TIERS) {
      if (own >= minOwn) return { riseNet, fallNet };
    }
    return { riseNet: 90000, fallNet: 85000 };
  }

  function flagInfo(p) {
    const status = String(p.status ?? "a").toLowerCase();
    const chance = p.chance_of_playing_next_round;
    const hasChance = typeof chance === "number" && Number.isFinite(chance);

    if (status === "i") return { code: "INJ", riseMult: 1.0, fallMult: 1.25 };
    if (status === "s") return { code: "SUSP", riseMult: 1.05, fallMult: 1.15 };
    if (status === "u") return { code: "UNAV", riseMult: 1.05, fallMult: 1.2 };
    if (status === "d" || (hasChance && chance < 75)) return { code: "DOUBT", riseMult: 1.0, fallMult: 1.1 };
    return { code: "", riseMult: 1.0, fallMult: 1.0 };
  }

  function effectiveThreshold(p, dir) {
    const { riseNet, fallNet } = tierThresholds(p);
    const fl = flagInfo(p);
    return dir > 0 ? riseNet * fl.riseMult : fallNet * fl.fallMult;
  }

  function isGwCapped(p, dir) {
    const gwChange = Number(p.cost_change_event);
    if (!Number.isFinite(gwChange)) return false;
    return dir > 0 ? gwChange >= GW_MAX_STEPS : gwChange <= -GW_MAX_STEPS;
  }

  // True while a player is in their one-week lock after a red-to-none flag change.
  const isLocked = (p) => (locks.get(p.id) ?? 0) > Date.now();

  const numberFrom = (fields) => {
    for (const val of fields) {
      if (typeof val === "number" && Number.isFinite(val)) return val;
      if (typeof val === "string" && val.trim() !== "" && Number.isFinite(Number(val))) return Number(val);
    }
    return null;
  };

  const readOfficialProgress = (p) =>
    numberFrom([p.price_progress, p.change_progress, p.progress_pct, p.price_change_progress, p.progress]);
  const readOfficialPredictedProgress = (p) =>
    numberFrom([p.predicted_progress, p.price_predicted_progress, p.projected_progress]);
  const readOfficialRate = (p) => numberFrom([p.rate_per_hour, p.hourly_progress, p.progress_per_hour]);

  // Positive = rising progress, negative = falling progress.
  // Once the server's figures are ready, they are the only source, so a player the server does not
  // return shows no progress. Before that, the local estimate is used.
  function signedProgress(p) {
    if (isLocked(p)) return 0;
    if (serverReady) return serverProgress[p.id] ?? 0;

    const official = readOfficialProgress(p);
    if (official !== null) return official;

    const n = effectiveNetTransfers(p);
    if (!n) return 0;

    const dir = n > 0 ? 1 : -1;
    if (isGwCapped(p, dir)) return 0;

    const threshold = effectiveThreshold(p, dir);
    const gwSteps = Number(p.cost_change_event) || 0;
    const remainingNet = n - gwSteps * threshold;
    if (Math.sign(remainingNet) !== dir) return 0;

    return (remainingNet / threshold) * 100;
  }

  function nextChange(now) {
    const d = new Date(now);
    const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), PRICE_HOUR_UTC);
    return t > now ? t : t + 86400000;
  }

  const hoursToChange = (now) => (nextChange(now) - now) / 3600000;

  // Status is set by predicted progress, as on the official site.
  function statusFor(pred) {
    const a = Math.abs(pred);
    if (a < 95) return "u";
    if (pred > 0) return a >= 100 ? "vlr" : "lr";
    return a >= 100 ? "vld" : "ld";
  }

  // Predicted progress at the next change: the official value if we have one, otherwise a
  // projection from the hourly rate. Locked players stay at zero.
  function projectedFor(p, sp, now) {
    if (isLocked(p)) return 0;
    const official = readOfficialPredictedProgress(p);
    if (official !== null) return official;
    const r = readOfficialRate(p) ?? rates[p.id];
    if (!Math.sign(sp) || r === undefined) return sp;
    return sp + r * hoursToChange(now);
  }

  function syncPriceMeta(now) {
    const eventId = snap.event ?? snap.gameweek ?? null;
    const prev = readJSON(KEY_META, null);
    const progState = readJSON(KEY_PROG, { t: now, p: {}, rate: {} });
    const costs = {};
    const gwChanged = Boolean(prev && eventId !== null && prev.event !== null && prev.event !== eventId);

    for (const p of snap.players) {
      costs[p.id] = p.now_cost;
      const costChanged = prev?.costs && prev.costs[p.id] !== undefined && prev.costs[p.id] !== p.now_cost;

      if (costChanged) {
        progState.p[p.id] = signedProgress(p);
        progState.rate[p.id] = 0;
      } else if (gwChanged && progState.p[p.id] !== undefined) {
        progState.p[p.id] = progState.p[p.id] * 0.65;
      }
    }

    writeJSON(KEY_PROG, progState);
    writeJSON(KEY_META, { event: eventId, costs, updatedAt: now });
  }

  function updateRates(now) {
    const cur = {};
    for (const p of snap.players) cur[p.id] = signedProgress(p);

    const st = readJSON(KEY_PROG, null);
    if (!st || !st.t || !st.p) {
      writeJSON(KEY_PROG, { t: now, p: cur, rate: {} });
      rates = {};
      return;
    }

    const elapsedMs = now - st.t;
    if (elapsedMs >= SAMPLE_MIN * 60000) {
      const dt = elapsedMs / 3600000;
      const nextRate = { ...(st.rate ?? {}) };
      const nextSample = { ...(st.p ?? {}) };
      let anyChange = false;

      for (const id in cur) {
        const prevVal = st.p[id];
        if (prevVal === undefined) {
          nextSample[id] = cur[id];
          anyChange = true;
          continue;
        }
        const delta = cur[id] - prevVal;
        if (Math.abs(delta) > 1e-6) {
          const instRate = delta / dt;
          nextRate[id] = nextRate[id] !== undefined ? nextRate[id] * 0.4 + instRate * 0.6 : instRate;
          nextSample[id] = cur[id];
          anyChange = true;
        } else if (nextRate[id] === undefined) {
          nextRate[id] = 0;
        }
      }

      if (anyChange) writeJSON(KEY_PROG, { t: now, p: nextSample, rate: nextRate });
      rates = nextRate;
    } else {
      rates = st.rate ?? {};
    }
  }

  // ---------- Shared pieces ----------
  const shirt = (p) => {
    const t = teamById.get(p.team);
    const gk = p.element_type === 1;
    return t?.code
      ? `<img class="pshirt" src="${SHIRTS}/shirt_${t.code}${gk ? "_1" : ""}-66.png" alt="" loading="lazy">`
      : "";
  };

  const starButton = (id) => {
    const watching = watch.includes(id);
    return `<button class="star" type="button" data-watch="${id}" aria-pressed="${watching}" aria-label="${
      watching ? "Remove from watchlist" : "Add to watchlist"
    }">${watching ? "★" : "☆"}</button>`;
  };

  // Info icon for fit players, warning icon for flagged players.
  const flagIcon = (p) => {
    const fl = flagInfo(p);
    return fl.code
      ? `<span class="fl-warn" role="img" aria-label="${esc(fl.code)}" title="${esc(fl.code)}">!</span>`
      : `<span class="fl-info" aria-hidden="true">i</span>`;
  };

  const flagBadge = (p) => {
    const fl = flagInfo(p);
    return fl.code ? ` <span class="badge flag-${fl.code.toLowerCase()}">${esc(fl.code)}</span>` : "";
  };

  const nameCell = (p, withStar) => `<div class="pl">${shirt(p)}<div>
      <div class="pname">${esc(p.web_name)}${flagBadge(p)}</div>
      <div class="small muted">${esc(posById.get(p.element_type))} ${money(p.now_cost)} · ${ownershipPct(p).toFixed(1)}%</div>
    </div>${withStar ? starButton(p.id) : ""}</div>`;

  // ---------- Table tab ----------
  function tableItems(now) {
    const dirWant = state.list === "risers" ? 1 : -1;
    const pos = Number($("pos").value);
    const team = Number($("team").value);
    const needle = $("q").value.trim().toLowerCase();

    let items = snap.players
      .map((p) => {
        const sp = signedProgress(p);
        return { p, sp, pred: projectedFor(p, sp, now) };
      })
      .filter((x) => Math.sign(x.sp) === dirWant);

    if (!needle && state.sub === "all") items = items.filter((x) => ownershipPct(x.p) >= OWN_FLOOR);
    if (state.sub === "mine") items = items.filter((x) => mine.has(x.p.id));
    if (state.sub === "watch") items = items.filter((x) => watch.includes(x.p.id));
    if (pos) items = items.filter((x) => x.p.element_type === pos);
    if (team) items = items.filter((x) => x.p.team === team);
    if (needle) items = items.filter((x) => x.p.web_name.toLowerCase().includes(needle));

    return items.sort((a, b) => Math.abs(b.sp) - Math.abs(a.sp));
  }

  function setupTableHead() {
    const tbl = $("rows").closest("table");
    if (!tbl) return;
    let thead = tbl.querySelector("thead");
    if (!thead) {
      thead = document.createElement("thead");
      tbl.prepend(thead);
    }
    thead.innerHTML = `<tr>
      <th>Player</th>
      <th>Status</th>
      <th class="n">Progress</th>
      <th class="n">Predicted progress</th>
      <th>Ownership trend</th>
      <th class="n">Current price</th>
      <th class="n">Purchase price</th>
      <th class="n">Selling price</th>
    </tr>`;
  }

  function renderPager(total) {
    const pages = Math.max(1, Math.ceil(total / TABLE_PAGE));
    tablePage = Math.min(Math.max(1, tablePage), pages);

    let bar = document.getElementById("tbl-pager");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "tbl-pager";
      bar.className = "pager";
      bar.innerHTML = `<button type="button" id="tbl-prev">← Previous</button>
        <span id="tbl-pos"></span>
        <button type="button" id="tbl-next">Next →</button>`;
      $("rows").closest(".table-wrap").after(bar);
      $("tbl-prev").addEventListener("click", () => {
        tablePage -= 1;
        renderTable(Date.now());
      });
      $("tbl-next").addEventListener("click", () => {
        tablePage += 1;
        renderTable(Date.now());
      });
    }
    bar.hidden = state.tab !== "table";
    $("tbl-prev").disabled = tablePage <= 1;
    $("tbl-next").disabled = tablePage >= pages;
    $("tbl-pos").textContent = `${tablePage} of ${pages}`;
  }

  function trendCell(p) {
    const n = p.transfers_in - p.transfers_out;
    if (!n) return `<span class="muted">–</span>`;
    return n > 0 ? `<span class="trend up">▲ Up</span>` : `<span class="trend down">▼ Down</span>`;
  }

  function renderTable(now) {
    setupTableHead();
    const all = tableItems(now);
    renderPager(all.length);

    const start = (tablePage - 1) * TABLE_PAGE;
    const items = all.slice(start, start + TABLE_PAGE);
    const emptyText =
      state.sub === "mine" && !mine.size
        ? "Set your team first, by importing your squad in the Planner."
        : state.sub === "watch" && !watch.length
          ? "Press the star next to a player to add them here."
          : serverReady
            ? "No players are close to a change in this list right now."
            : "Progress is still being calculated. It will appear after the next log.";

    $("rows").innerHTML = items.length
      ? items
          .map(({ p, sp, pred }) => {
            const st = statusFor(pred);
            const locked = isLocked(p) ? `<div class="small muted">Price locked for a week</div>` : "";
            return `<tr>
              <td><div class="pl">${flagIcon(p)}${shirt(p)}<div>
                <div class="pname">${esc(p.web_name)}</div>
                <div class="small muted">${esc(teamById.get(p.team)?.name ?? "")} · ${esc(posById.get(p.element_type) ?? "")}</div>
              </div></div></td>
              <td><span class="stpill st-${st}">${STATUS[st]}</span></td>
              <td class="n"><span class="pg ${sp >= 0 ? "is-up" : "is-down"}">${signed1Pct(sp)}</span>${locked}</td>
              <td class="n"><span class="pg ${pred >= 0 ? "is-up" : "is-down"}">${signed1Pct(pred)}</span></td>
              <td>${trendCell(p)}</td>
              <td class="n">${money(p.now_cost)}</td>
              <td class="n">–</td>
              <td class="n">–</td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="8">${esc(emptyText)}</td></tr>`;

    $("table-note").textContent =
      "Progress is our estimate from transfers since each player's last price change. Status follows the official rule: 95% is likely, 100% is very likely.";
  }

  // ---------- Summary tab ----------
  function renderSummary(now) {
    const groups = { rise: [], riseMaybe: [], fall: [], fallMaybe: [] };
    for (const p of snap.players) {
      if (ownershipPct(p) < OWN_FLOOR) continue;
      const sp = signedProgress(p);
      const pred = projectedFor(p, sp, now);
      const a = Math.abs(pred);
      if (a < 95) continue;
      const key = pred > 0 ? (a >= 100 ? "rise" : "riseMaybe") : a >= 100 ? "fall" : "fallMaybe";
      groups[key].push({ p, pred, a });
    }
    for (const g of Object.values(groups)) g.sort((x, y) => y.a - x.a);

    const row = ({ p, pred }) => {
      const n = Math.round(effectiveNetTransfers(p));
      const netStr = `${n >= 0 ? "+" : "−"}${Math.abs(n).toLocaleString()} net`;
      const value = state.pct ? `<span class="${pred > 0 ? "up" : "down"}">${signed1Pct(pred)}</span>` : netStr;
      return `<div class="sumrow">
        <div class="pl">${shirt(p)}<span class="pname">${esc(p.web_name)}${flagBadge(p)}</span></div>
        <div class="val"><div>${money(p.now_cost)}</div><div class="small">${value}</div></div>
      </div>`;
    };

    const list = (items) => (items.length ? items.map(row).join("") : `<div class="sumrow muted">None</div>`);

    $("summary").innerHTML = `
      <div>
        <div class="sumhead rise">Predicted rises (${groups.rise.length})</div>
        <div class="sumlist">${list(groups.rise)}</div>
        <div class="sub-h">Likely (95%+) (${groups.riseMaybe.length})</div>
        <div class="sumlist">${list(groups.riseMaybe)}</div>
      </div>
      <div>
        <div class="sumhead fall">Predicted falls (${groups.fall.length})</div>
        <div class="sumlist">${list(groups.fall)}</div>
        <div class="sub-h">Likely (95%+) (${groups.fallMaybe.length})</div>
        <div class="sumlist">${list(groups.fallMaybe)}</div>
      </div>`;
  }

  // ---------- Trends tab ----------
  function renderTrends() {
    const top = snap.players
      .map((p) => ({
        p,
        vol: (Number(p.transfers_in) || 0) + (Number(p.transfers_out) || 0),
        n: Math.round(effectiveNetTransfers(p)),
      }))
      .filter((x) => x.vol > 0)
      .sort((a, b) => b.vol - a.vol)
      .slice(0, 24);

    if (!top.length) {
      $("trends").innerHTML = `<p class="meta">No transfers recorded this gameweek yet.</p>`;
      return;
    }

    const max = top[0].vol;
    const cols = 6;
    const cellW = 150;
    const cellH = 124;
    const rows = Math.ceil(top.length / cols);
    const width = cols * cellW;
    const height = rows * cellH;

    const bubbles = top
      .map(({ p, vol, n }, i) => {
        const cx = (i % cols) * cellW + cellW / 2;
        const cy = Math.floor(i / cols) * cellH + cellH / 2;
        const r = 12 + 28 * Math.sqrt(vol / max);
        const label = p.web_name.length > 9 ? `${p.web_name.slice(0, 8)}…` : p.web_name;
        const netLabel = `${n >= 0 ? "+" : "−"}${Math.abs(n).toLocaleString()}`;
        return `<g>
          <title>${esc(p.web_name)}: ${vol.toLocaleString()} total (${netLabel} est. net)</title>
          <circle class="bub ${n >= 0 ? "rise" : "fall"}" cx="${cx}" cy="${cy}" r="${r.toFixed(1)}"></circle>
          <text class="bub-label" x="${cx}" y="${cy + 4}">${esc(label)}</text>
        </g>`;
      })
      .join("");

    $("trends").innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Transfer trends">${bubbles}</svg>`;
  }

  // ---------- Past tab (price changes and locks) ----------
  async function loadEvents() {
    try {
      const res = await fetch("/api/prices/events");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      events = Array.isArray(data.events) ? data.events : [];
      locks = new Map(Object.entries(data.locks ?? {}).map(([id, until]) => [Number(id), Number(until)]));
      eventsError = null;
    } catch (err) {
      eventsError = err.message;
    }
    eventsLoaded = true;
    renderCurrent();
  }

  // Server-side progress, counted from each player's last price change.
  // An empty response means the server has not rebuilt its windows yet, so the local estimate stays in use.
  async function loadProgress() {
    try {
      const res = await fetch("/api/prices/progress");
      if (!res.ok) return;
      const data = await res.json();
      const progress = data.progress ?? {};
      if (Object.keys(progress).length) {
        serverProgress = progress;
        serverReady = true;
      }
      renderCurrent();
    } catch {
      // Keep the current figures if the request fails
    }
  }

  function setupPastControls() {
    const body = $("past-rows");
    const tbl = body.closest("table");
    if (!tbl) return;

    const thead = tbl.querySelector("thead");
    if (thead) {
      thead.innerHTML = `<tr>
        <th>Player</th>
        <th>Club</th>
        <th>Date</th>
        <th class="n">New price</th>
        <th class="n">Move</th>
      </tr>`;
    }

    if (!document.getElementById("past-filter")) {
      const bar = document.createElement("div");
      bar.id = "past-filter";
      bar.innerHTML = [
        ["all", "All"],
        ["rise", "Rises"],
        ["fall", "Falls"],
      ]
        .map(
          ([k, l]) =>
            `<button type="button" class="subtab" data-past="${k}" aria-selected="${past.filter === k}">${l}</button>`,
        )
        .join("");
      tbl.closest(".table-wrap").before(bar);

      bar.addEventListener("click", (e) => {
        const b = e.target.closest("[data-past]");
        if (!b) return;
        past.filter = b.dataset.past;
        past.limit = PAST_PAGE;
        bar.querySelectorAll("[data-past]").forEach((x) =>
          x.setAttribute("aria-selected", String(x.dataset.past === past.filter)),
        );
        renderPast();
      });
    }
  }

  // "This gameweek" for live entries, a date for imported ones, and date and time for logged ones.
  function whenLabel(e) {
    if (!e.at) return "This gameweek";
    if (/^\d{4}-\d{2}-\d{2}$/.test(e.at)) {
      return new Date(e.at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
    }
    return new Date(e.at)
      .toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
      .replace(",", "");
  }

  function moveNote(e) {
    if (e.source === "gameweek") return "Net this gameweek";
    if (e.source === "imported") return "Official site";
    const n = e.net ?? 0;
    return `${n >= 0 ? "+" : "−"}${Math.abs(n).toLocaleString()} net`;
  }

  function renderPast() {
    setupPastControls();
    const body = $("past-rows");

    if (!eventsLoaded) {
      body.innerHTML = `<tr><td colspan="5">Loading price changes…</td></tr>`;
      return;
    }
    if (eventsError) {
      body.innerHTML = `<tr><td colspan="5">Could not load price changes. ${esc(eventsError)}</td></tr>`;
      return;
    }

    const list = events.filter((e) =>
      past.filter === "all" ? true : past.filter === "rise" ? e.dir === 1 : e.dir === -1,
    );
    const shown = list.slice(0, past.limit);

    body.innerHTML = shown.length
      ? shown
          .map((e) => {
            const p = e.id !== null && e.id !== undefined ? byId.get(e.id) : undefined;
            const up = e.dir === 1;
            const nameHtml = p
              ? nameCell(p, false)
              : `<div class="pl"><div class="pname">${esc(e.name)}</div></div>`;
            return `<tr>
              <td>${nameHtml}</td>
              <td>${esc(e.club)}</td>
              <td>${esc(whenLabel(e))}</td>
              <td class="n">${money(e.cost)}</td>
              <td class="n ${up ? "up" : "down"}">${up ? "Rise" : "Fall"}<div class="small muted">${esc(moveNote(e))}</div></td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="5">${
          events.length
            ? "No changes match this filter."
            : "No price changes recorded yet. Changes appear here as FPL makes them."
        }</td></tr>`;

    const wrap = body.closest(".table-wrap");
    let more = document.getElementById("more-past");
    if (!more) {
      const p = document.createElement("p");
      more = document.createElement("button");
      more.id = "more-past";
      more.type = "button";
      p.append(more);
      wrap.after(p);
      more.addEventListener("click", () => {
        past.limit += PAST_PAGE;
        renderPast();
      });
    }
    const left = list.length - past.limit;
    more.hidden = left <= 0;
    more.textContent = `Show more (${Math.max(0, left)} left)`;
  }

  // ---------- Countdown ----------
  function startCountdown() {
    const pad = (n) => String(n).padStart(2, "0");
    const tick = () => {
      const now = Date.now();
      const ms = Math.max(0, nextChange(now) - now);
      $("cd").textContent = `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor((ms % 3600000) / 60000))}:${pad(
        Math.floor((ms % 60000) / 1000),
      )}`;
    };
    tick();
    setInterval(tick, 1000);
  }

  // ---------- Rendering ----------
  function renderCurrent() {
    const now = Date.now();
    if (state.tab === "table") renderTable(now);
    if (state.tab === "summary") renderSummary(now);
    if (state.tab === "trends") renderTrends();
    if (state.tab === "past") renderPast();
  }

  function refresh() {
    const now = Date.now();
    syncPriceMeta(now);
    updateRates(now);
    renderCurrent();
    const nextTime = new Date(nextChange(now)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    $("meta").textContent =
      `Next price change at ${nextTime} (Local Time) · Last updated ${new Date(now).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })} · Updates every 15 minutes`;
  }

  // ---------- Wiring ----------
  function setTab(tab) {
    state.tab = tab;
    document.querySelectorAll(".tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
    for (const t of ["table", "summary", "trends", "past"]) $(`tab-${t}`).hidden = t !== tab;
    const pager = document.getElementById("tbl-pager");
    if (pager) pager.hidden = tab !== "table";
    renderCurrent();
    if (tab === "past") loadEvents();
  }

  const resetTable = () => {
    tablePage = 1;
    renderTable(Date.now());
  };

  function init(s) {
    snap = s;
    teamById = new Map(snap.teams.map((t) => [t.id, t]));
    posById = new Map(snap.positions.map((p) => [p.id, p.short]));
    byId = new Map(snap.players.map((p) => [p.id, p]));
    watch = readJSON(KEY_WATCH, []);
    mine = new Set(readJSON(KEY_BASE, []));

    snap.positions.forEach((p) => $("pos").append(new Option(p.short, String(p.id))));
    [...snap.teams]
      .sort((a, b) => a.short.localeCompare(b.shor
