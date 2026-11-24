/* prices.js: countdown, price progress table, predictions, trends and past changes.
   Lists show 25 at a time; search and filters run over every player. Starts on fpl:ready from app.js. */
(() => {
  if (document.body.dataset.page !== "prices") return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const SHIRTS = "https://fantasy.premierleague.com/dist/img/shirts/standard";
  const money = (tenths) => `£${(tenths / 10).toFixed(1)}m`;
  const absPct = (v) => `${Math.abs(v).toFixed(1)}%`;
  const signedPct = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}%`;
  const PAGE = 25;

  // Calibration settings. Tune against observed overnight FPL price changes.
  const OWN_FLOOR = 1.7; // minimum ownership (%) for Summary rise/fall callouts
  const PRICE_HOUR_UTC = 23; // overnight price change time in UTC
  const SAMPLE_MIN = 15; // minimum interval (minutes) between rate samples
  const GW_MAX_STEPS = 3; // max £0.1m moves (up or down) in a single gameweek (+/-£0.3m)

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
  let rates = {}; // player id -> progress change per hour (percentage points)
  let watch = [];
  let mine = new Set();
  const state = { tab: "table", sub: "all", list: "risers", pct: true, limit: PAGE, pastLimit: PAGE };

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

  // ---------- FPL Price Model Helpers ----------
  const ownershipPct = (p) => {
    const v = Number(p.selected_by_percent);
    return Number.isFinite(v) ? v : 0;
  };

  // Estimate non-chip effective transfers (filters out approximate Wildcard/Free Hit noise).
  function effectiveNetTransfers(p) {
    const rawIn = Number(p.transfers_in) || 0;
    const rawOut = Number(p.transfers_out) || 0;
    const rawNet = rawIn - rawOut;
    if (!rawNet) return 0;

    // Higher volume relative to ownership often includes more chip/wildcard churn
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
    const candidates = [
      p.price_progress,
      p.change_progress,
      p.progress_pct,
      p.price_change_progress,
    ];
    for (const val of candidates) {
      if (typeof val === "number" && Number.isFinite(val)) return val;
    }
    return null;
  }

  // Positive = rising progress, negative = falling progress, +/-100 = threshold reached.
  function signedProgress(p) {
    const official = readOfficialProgress(p);
    if (official !== null) return official;

    const n = effectiveNetTransfers(p);
    if (!n) return 0;
    const dir = n > 0 ? 1 : -1;
    if (isGwCapped(p, dir)) return 0;
    const threshold = effectiveThreshold(p, dir);
    return (n / threshold) * 100;
  }

  // Per-player cost/GW reset handling so only affected players reset their progress baseline.
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
        // After a price move, reset this player's baseline and rate to current progress
        progState.p[p.id] = signedProgress(p);
        progState.rate[p.id] = 0;
      } else if (gwChanged && progState.p[p.id] !== undefined) {
        // Carry over ~65% of pre-deadline progress into the new gameweek
        progState.p[p.id] = progState.p[p.id] * 0.65;
      }
    }

    writeJSON(KEY_PROG, progState);
    writeJSON(KEY_META, { event: eventId, costs, updatedAt: now });
  }

  // Next overnight price change as a UTC epoch ms timestamp.
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

  // Projection at the next price-change window using per-hour rate.
  function predict(id, sp, now) {
    const a = Math.abs(sp);
    const dir = Math.sign(sp);
    if (!dir) return { proj: null, label: "–" };
    if (a >= 100) return { proj: a, label: "Tonight" };

    const r = rates[id];
    if (r === undefined) return { proj: null, label: "–" };

    const rd = r * dir;
    const proj = a + rd * hoursToChange(now);
    if (rd <= 0) return { proj, label: "Stalling" };

    const days = (100 - a) / rd / 24;
    return { proj, label: formatEta(days) };
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
            const pr = predict(p.id, sp, now);
            const r = rates[p.id];
            const rateCell =
              r === undefined ? "–" : `<span class="${r * dir >= 0 ? "up" : "down"}">${signedPct(r)}</span>`;
            const predCell =
              pr.proj === null
                ? "–"
                : `<span class="${col}">${Math.max(0, pr.proj).toFixed(2)}%</span><div class="small muted">${pr.label}</div>`;

            return `<tr>
              <td>${nameCell(p, true)}</td>
              <td>${esc(teamById.get(p.team)?.short ?? "")}</td>
              <td>
                <div>${absPct(sp)}</div>
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

    $("table-note").textContent = Object.keys(rates).length
      ? "Uses ownership tiers, status flags, chip-noise filtering, and blended per-hr velocity."
      : "Uses ownership tiers, status flags, and chip-noise filtering; per-hr rates appear after ~15 min.";
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
        ? `<span class="${sp > 0 ? "up" : "down"}">${signedPct(sp)}</span>`
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

  // ---------- Past Tab ----------
  function renderPast() {
    const all = snap.players
      .filter((p) => p.cost_change_start !== 0)
      .sort((a, b) => Math.abs(b.cost_change_start) - Math.abs(a.cost_change_start));

    const rows = all
      .slice(0, state.pastLimit)
      .map((p) => {
        const start = p.now_cost - p.cost_change_start;
        const change = p.cost_change_start / 10;
        return `<tr>
          <td>${nameCell(p, false)}</td>
          <td>${esc(teamById.get(p.team)?.short ?? "")}</td>
          <td class="n">${money(start)}</td>
          <td class="n">${money(p.now_cost)}</td>
          <td class="n ${change >= 0 ? "up" : "down"}">${change >= 0 ? "+" : "−"}£${Math.abs(change).toFixed(1)}m</td>
        </tr>`;
      })
      .join("");

    $("past-rows").innerHTML = rows || `<tr><td colspan="5">No price changes this season yet.</td></tr>`;

    moreBtn("more-past", $("past-rows"), all.length, state.pastLimit, () => {
      state.pastLimit += PAGE;
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
  }

  const resetTable = () => {
    state.limit = PAGE;
    renderTable(Date.now());
  };

  function init(s) {
    snap = s;
    teamById = new Map(snap.teams.map((t) => [t.id, t]));
    posById = new Map(snap.positions.map((p) => [p.id, p.short]));
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
    setInterval(refresh, 60_000);
  }

  document.addEventListener("fpl:ready", (e) => {
    if (e.detail) init(e.detail);
  });
})();
