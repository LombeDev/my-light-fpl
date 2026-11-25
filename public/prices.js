/* prices.js: countdown, price progress table, predictions, trends and past changes.
   Past changes come from the server log at /api/prices/events, so changes made while nobody had the
   page open still appear. Lists show 25 at a time; search and filters run over every player.
   Starts on fpl:ready from app.js. */
(() => {
  if (document.body.dataset.page !== "prices") return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const SHIRTS = "https://fantasy.premierleague.com/dist/img/shirts/standard";
  const money = (tenths) => `£${(tenths / 10).toFixed(1)}m`;
  const signedPct = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}%`;
  const signed1Pct = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;
  const PAGE = 25;
  const EVENTS_EVERY_MS = 5 * 60_000;

  // Calibration settings aligned with official FPL & LiveFPL behavior.
  const OWN_FLOOR = 1.7; // players below 1.7% ownership are excluded unless searched by name
  const PRICE_HOUR_UTC = 0; // 00:00 UTC = 02:00 CAT (matches official FPL countdown)
  const SAMPLE_MIN = 15; // 15-minute sample interval
  const GW_MAX_STEPS = 3; // max +/-£0.3m movement per gameweek

  // Ownership tiers: [minOwnershipPct, riseThresholdNet, fallThresholdNet]
  const OWN_TIERS = [
    [50.0, 340000, 310000],
    [30.0, 275000, 250000],
    [15.0, 220000, 195000],
    [5.0,  165000, 145000],
    [1.7,  125000, 110000],
    [0.0,   90000,  85000],
  ];

  const KEY_PROG = "fpl.progress";
  const KEY_WATCH = "fpl.watch";
  const KEY_BASE = "fpl.baseline";
  const KEY_META = "fpl.priceMeta";

  let snap = null;
  let teamById = new Map();
  let posById = new Map();
  let byId = new Map();
  let rates = {}; // player id -> progress change per hour (percentage points)
  let watch = [];
  let mine = new Set();
  const state = { tab: "table", sub: "all", list: "risers", pct: true, limit: PAGE };

  // Logged price changes from the server, newest first.
  let events = [];
  let eventsLoaded = false;
  let eventsError = null;
  const past = { filter: "all", limit: PAGE };

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

  // ---------- Official + Fallback Price Model ----------
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
    if (status === "d" || (hasChance && chance < 75)) {
      return { code: "DOUBT", riseMult: 1.0, fallMult: 1.1 };
    }
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

  function readOfficialProgress(p) {
    const fields = [
      p.price_progress,
      p.change_progress,
      p.progress_pct,
      p.price_change_progress,
      p.progress,
    ];
    for (const val of fields) {
      if (typeof val === "number" && Number.isFinite(val)) return val;
      if (typeof val === "string" && val.trim() !== "" && Number.isFinite(Number(val))) {
        return Number(val);
      }
    }
    return null;
  }

  function readOfficialPredictedProgress(p) {
    const fields = [
      p.predicted_progress,
      p.price_predicted_progress,
      p.projected_progress,
    ];
    for (const val of fields) {
      if (typeof val === "number" && Number.isFinite(val)) return val;
      if (typeof val === "string" && val.trim() !== "" && Number.isFinite(Number(val))) {
        return Number(val);
      }
    }
    return null;
  }

  function readOfficialRate(p) {
    const fields = [p.rate_per_hour, p.hourly_progress, p.progress_per_hour];
    for (const val of fields) {
      if (typeof val === "number" && Number.isFinite(val)) return val;
    }
    return null;
  }

  // Positive = rising progress, negative = falling progress.
  // Deducts transfers already consumed by prior price changes in the current gameweek.
  function signedProgress(p) {
    const official = readOfficialProgress(p);
    if (official !== null) return official;

    const n = effectiveNetTransfers(p);
    if (!n) return 0;

    const dir = n > 0 ? 1 : -1;
    if (isGwCapped(p, dir)) return 0;

    const threshold = effectiveThreshold(p, dir);
    const gwSteps = Number(p.cost_change_event) || 0;

    // Subtract transfers already "spent" on earlier rises/falls in this gameweek
    const consumedNet = gwSteps * threshold;
    const remainingNet = n - consumedNet;

    // If all net transfers in this direction were already spent on earlier moves, progress resets near 0
    if (Math.sign(remainingNet) !== dir) return 0;

    return (remainingNet / threshold) * 100;
  }

  function syncPriceMeta(now) {
    const eventId = snap.event ?? snap.gameweek ?? null;
    const prev = readJSON(KEY_META, null);
    const progState = readJSON(KEY_PROG, { t: now, p: {}, rate: {} });
    const costs = {};
    const gwChanged = Boolean(prev && eventId !== null && prev.event !== null && prev.event !== eventId);

    for (const p of snap.players) {
      costs[p.id] = p.now_cost;
      const costChanged =
        prev?.costs && prev.costs[p.id] !== undefined && prev.costs[p.id] !== p.now_cost;

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

  function nextChange(now) {
    const d = new Date(now);
    const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), PRICE_HOUR_UTC);
    return t > now ? t : t + 86400000;
  }

  const hoursToChange = (now) => (nextChange(now) - now) / 3600000;

  function formatEta(days) {
    if (days <= 0.65) return "Tonight";
    if (days <= 1.45) return "Tomorrow";
    if (days <= 2.2) return "2 days";
    return ">2 days";
  }

  function statusLabel(sp, pred) {
    const ref = pred ?? sp;
    if (ref >= 100) return "Very likely to rise";
    if (ref <= -100) return "Very likely to drop";
    if (ref <= -97) return "Likely to drop";
    if (ref >= 97) return "Likely to rise";
    return "Unlikely to change";
  }

  function predict(player, sp, now) {
    const id = player.id;
    const dir = Math.sign(sp);
    const officialRate = readOfficialRate(player);
    const r = officialRate !== null ? officialRate : rates[id];
    const hrs = hoursToChange(now);

    const officialPred = readOfficialPredictedProgress(player);
    if (officialPred !== null) {
      const aPred = Math.abs(officialPred);
      const label =
        aPred >= 100
          ? "Tonight"
          : r && r * dir > 0
            ? formatEta((100 - Math.abs(sp)) / (r * dir) / 24)
            : "–";
      return { proj: officialPred, label, status: statusLabel(sp, officialPred) };
    }

    if (!dir) return { proj: null, label: "–", status: "Unlikely to change" };
    if (r === undefined) {
      return { proj: sp, label: Math.abs(sp) >= 100 ? "Tonight" : "–", status: statusLabel(sp, sp) };
    }

    const proj = sp + r * hrs;
    const rd = r * dir;
    if (Math.abs(proj) >= 100) return { proj, label: "Tonight", status: statusLabel(sp, proj) };
    if (rd <= 0) return { proj, label: "Stalling", status: statusLabel(sp, proj) };

    const days = (100 - Math.abs(sp)) / rd / 24;
    return { proj, label: formatEta(days), status: statusLabel(sp, proj) };
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

      if (anyChange) {
        writeJSON(KEY_PROG, { t: now, p: nextSample, rate: nextRate });
      }
      rates = nextRate;
    } else {
      rates = st.rate ?? {};
    }
  }

  // ---------- Shared UI Pieces ----------
  const shirt = (p) => {
    const t = teamById.get(p.team);
    const gk = p.element_type === 1;
    return t?.code
      ? `<img class="pshirt" src="${SHIRTS}/shirt_${t.code}${gk ? "_1" : ""}-66.png" alt="" loading="lazy">`
      : "";
  };

  const flagBadge = (p) => {
    const fl = flagInfo(p);
    return fl.code ? ` <span class="badge flag-${fl.code.toLowerCase()}">${esc(fl.code)}</span>` : "";
  };

  const starAttrs = (id, watching) => ({
    pressed: String(watching),
    label: watching ? "Remove from watchlist" : "Add to watchlist",
    glyph: watching ? "★" : "☆",
  });

  const nameCell = (p, withStar) => {
    const watching = watch.includes(p.id);
    const sa = starAttrs(p.id, watching);
    const star = withStar
      ? `<button class="star" type="button" data-watch="${p.id}" aria-pressed="${sa.pressed}" aria-label="${sa.label}">${sa.glyph}</button>`
      : "";
    return `<div class="pl">${shirt(p)}<div>
      <div class="pname">${esc(p.web_name)}${flagBadge(p)}</div>
      <div class="small muted">${esc(posById.get(p.element_type))} ${money(p.now_cost)} · ${ownershipPct(p).toFixed(1)}%</div>
    </div>${star}</div>`;
  };

  function moreBtn(id, tbody, total, limit, onClick) {
    const wrap = tbody.closest(".table-wrap");
    if (!wrap) return;
    let btn = document.getElementById(id);
    if (!btn) {
      const p = document.createElement("p");
      btn = document.createElement("button");
      btn.id = id;
      btn.type = "button";
      p.append(btn);
      wrap.after(p);
      btn.addEventListener("click", onClick);
    }
    const left = total - limit;
    btn.hidden = left <= 0;
    btn.textContent = `Show more (${Math.max(0, left)} left)`;
  }

  // ---------- Table Tab ----------
  function tableItems() {
    const dirWant = state.list === "risers" ? 1 : -1;
    const pos = Number($("pos").value);
    const team = Number($("team").value);
    const needle = $("q").value.trim().toLowerCase();

    let items = snap.players
      .map((p) => ({ p, sp: signedProgress(p) }))
      .filter((x) => Math.sign(x.sp) === dirWant);

    // Exclude sub-1.7% owned players from general listings unless user searches or checks My Team / Watchlist
    if (!needle && state.sub === "all") {
      items = items.filter((x) => ownershipPct(x.p) >= OWN_FLOOR);
    }

    if (state.sub === "mine") items = items.filter((x) => mine.has(x.p.id));
    if (state.sub === "watch") items = items.filter((x) => watch.includes(x.p.id));
    if (pos) items = items.filter((x) => x.p.element_type === pos);
    if (team) items = items.filter((x) => x.p.team === team);
    if (needle) items = items.filter((x) => x.p.web_name.toLowerCase().includes(needle));

    return items.sort((a, b) => Math.abs(b.sp) - Math.abs(a.sp));
  }

  function renderTable(now) {
    const all = tableItems();
    const items = all.slice(0, state.limit);
    const emptyText =
      state.sub === "mine" && !mine.size
        ? "Set your team first, by importing your squad in the Planner."
        : state.sub === "watch" && !watch.length
          ? "Press the star next to a player to add them here."
          : "No players match.";

    $("rows").innerHTML = items.length
      ? items
          .map(({ p, sp }) => {
            const dir = Math.sign(sp);
            const col = dir > 0 ? "up" : "down";
            const pr = predict(p, sp, now);
            const r = readOfficialRate(p) ?? rates[p.id];
            const rateCell =
              r === undefined ? "–" : `<span class="${r * dir >= 0 ? "up" : "down"}">${signedPct(r)}</span>`;
            const predCell =
              pr.proj === null
                ? "–"
                : `<span class="${col}">${signedPct(pr.proj)}</span><div class="small muted">${esc(pr.label)} · ${esc(pr.status)}</div>`;

            return `<tr>
              <td>${nameCell(p, true)}</td>
              <td>${esc(teamById.get(p.team)?.short ?? "")}</td>
              <td>
                <div>${signed1Pct(sp)}</div>
                <div class="bar"><span class="${col}" style="width:${Math.min(100, Math.abs(sp))}%"></span></div>
              </td>
              <td class="n">${predCell}</td>
              <td class="n">${rateCell}</td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="5">${esc(emptyText)}</td></tr>`;

    moreBtn("more-table", $("rows"), all.length, state.limit, () => {
      state.limit += PAGE;
      renderTable(Date.now());
    });

    $("table-note").textContent =
      "Accounts for prior GW price changes, status flags, ownership tiers (≥1.7%), and hourly velocity.";
  }

  // ---------- Summary Tab ----------
  function renderSummary() {
    const groups = { rise: [], riseMaybe: [], fall: [], fallMaybe: [] };
    for (const p of snap.players) {
      if (ownershipPct(p) < OWN_FLOOR) continue;
      const sp = signedProgress(p);
      const a = Math.abs(sp);
      if (a < 95) continue;
      const key = sp > 0 ? (a >= 100 ? "rise" : "riseMaybe") : a >= 100 ? "fall" : "fallMaybe";
      groups[key].push({ p, sp, a });
    }
    for (const g of Object.values(groups)) g.sort((x, y) => y.a - x.a);

    const row = ({ p, sp }) => {
      const n = Math.round(effectiveNetTransfers(p));
      const netStr = `${n >= 0 ? "+" : "−"}${Math.abs(n).toLocaleString()} net`;
      const value = state.pct
        ? `<span class="${sp > 0 ? "up" : "down"}">${signed1Pct(sp)}</span>`
        : netStr;
      return `<div class="sumrow">
        <div class="pl">${shirt(p)}<span class="pname">${esc(p.web_name)}${flagBadge(p)}</span></div>
        <div class="val"><div>${money(p.now_cost)}</div><div class="small">${value}</div></div>
      </div>`;
    };

    const list = (items) => (items.length ? items.map(row).join("") : `<div class="sumrow muted">None</div>`);

    $("summary").innerHTML = `
      <div>
        <div class="sumhead rise">Predicted rises tonight (${groups.rise.length})</div>
        <div class="sumlist">${list(groups.rise)}</div>
        <div class="sub-h">Maybe (95%+) (${groups.riseMaybe.length})</div>
        <div class="sumlist">${list(groups.riseMaybe)}</div>
      </div>
      <div>
        <div class="sumhead fall">Predicted falls tonight (${groups.fall.length})</div>
        <div class="sumlist">${list(groups.fall)}</div>
        <div class="sub-h">Maybe (95%+) (${groups.fallMaybe.length})</div>
        <div class="sumlist">${list(groups.fallMaybe)}</div>
      </div>`;
  }

  // ---------- Trends Tab ----------
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

  // ---------- Past Tab (logged price changes) ----------
  async function loadEvents() {
    try {
      const res = await fetch("/api/prices/events");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      events = Array.isArray(data.events) ? data.events : [];
      eventsError = null;
    } catch (err) {
      eventsError = err.message;
    }
    eventsLoaded = true;
    if (state.tab === "past") renderPast();
  }

  // Sets the Past table's headings and adds the All / Rises / Falls filter above it.
  function setupPastControls() {
    const body = $("past-rows");
    const tbl = body.closest("table");
    if (!tbl) return;

    const thead = tbl.querySelector("thead");
    if (thead) {
      thead.innerHTML = `<tr>
        <th>Player</th>
        <th>Club</th>
        <th>Detected</th>
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
        past.limit = PAGE;
        bar.querySelectorAll("[data-past]").forEach((x) =>
          x.setAttribute("aria-selected", String(x.dataset.past === past.filter)),
        );
        renderPast();
      });
    }
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
            const p = byId.get(e.id);
            const when = new Date(e.at)
              .toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
              .replace(",", "");
            const up = e.dir === 1;
            const netStr = `${e.net >= 0 ? "+" : "−"}${Math.abs(e.net).toLocaleString()} net`;
            const nameHtml = p
              ? nameCell(p, false)
              : `<div class="pl"><div class="pname">${esc(e.name)}</div></div>`;
            return `<tr>
              <td>${nameHtml}</td>
              <td>${esc(e.club)}</td>
              <td>${esc(when)}</td>
              <td class="n">${money(e.cost)}</td>
              <td class="n ${up ? "up" : "down"}">${up ? "Rise" : "Fall"}<div class="small muted">${esc(netStr)}</div></td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="5">${
          events.length
            ? "No changes match this filter."
            : "No price changes recorded yet. Changes appear here as FPL makes them."
        }</td></tr>`;

    moreBtn("more-past", body, list.length, past.limit, () => {
      past.limit += PAGE;
      renderPast();
    });
  }

  // ---------- Countdown ----------
  function startCountdown() {
    const tick = () => {
      const ms = Math.max(0, nextChange(Date.now()) - Date.now());
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      $("cd").textContent = `${h} hr ${String(m).padStart(2, "0")} min ${String(s).padStart(2, "0")} sec`;
    };
    tick();
    setInterval(tick, 1000);
  }

  // ---------- Rendering ----------
  function renderCurrent() {
    const now = Date.now();
    if (state.tab === "table") renderTable(now);
    if (state.tab === "summary") renderSummary();
    if (state.tab === "trends") renderTrends();
    if (state.tab === "past") renderPast();
  }

  function refresh() {
    const now = Date.now();
    syncPriceMeta(now);
    updateRates(now);
    renderCurrent();
    $("meta").textContent = `Updated ${new Date(snap.generatedAt).toLocaleString()}`;
  }

  // ---------- Wiring ----------
  function setTab(tab) {
    state.tab = tab;
    document.querySelectorAll(".tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
    for (const t of ["table", "summary", "trends", "past"]) $(`tab-${t}`).hidden = t !== tab;
    renderCurrent();
    if (tab === "past") loadEvents();
  }

  const resetTable = () => {
    state.limit = PAGE;
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
      .sort((a, b) => a.short.localeCompare(b.short))
      .forEach((t) => $("team").append(new Option(t.short, String(t.id))));

    document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));

    document.querySelectorAll(".subtab").forEach((b) =>
      b.addEventListener("click", () => {
        state.sub = b.dataset.sub;
        document.querySelectorAll(".subtab").forEach((x) =>
          x.setAttribute("aria-selected", String(x.dataset.sub === state.sub)),
        );
        resetTable();
      }),
    );

    const setList = (list) => {
      state.list = list;
      $("risers").setAttribute("aria-pressed", String(list === "risers"));
      $("fallers").setAttribute("aria-pressed", String(list === "fallers"));
      resetTable();
    };
    $("risers").addEventListener("click", () => setList("risers"));
    $("fallers").addEventListener("click", () => setList("fallers"));

    $("q").addEventListener("input", resetTable);
    $("pos").addEventListener("change", resetTable);
    $("team").addEventListener("change", resetTable);

    $("pct").addEventListener("change", (e) => {
      state.pct = e.target.checked;
      renderSummary();
    });

    $("rows").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-watch]");
      if (!btn) return;
      const id = Number(btn.dataset.watch);
      const watching = !watch.includes(id);
      watch = watching ? [...watch, id] : watch.filter((x) => x !== id);
      writeJSON(KEY_WATCH, watch);

      if (state.sub === "watch") {
        renderTable(Date.now());
      } else {
        const sa = starAttrs(id, watching);
        btn.setAttribute("aria-pressed", sa.pressed);
        btn.setAttribute("aria-label", sa.label);
        btn.textContent = sa.glyph;
      }
    });

    startCountdown();
    refresh();
    loadEvents();
    setInterval(refresh, 60_000);
    setInterval(loadEvents, EVENTS_EVERY_MS);
  }

  document.addEventListener("fpl:ready", (e) => {
    if (e.detail) init(e.detail);
  });
})();
