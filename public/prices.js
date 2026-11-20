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

  // Estimate settings. Confirm these against real price changes and adjust here.
  const RISE_NET = 220000; // net transfers for a rise to reach 100%
  const FALL_NET = 220000; // net transfers for a fall to reach 100%
  const OWN_FLOOR = 1.7; // players owned by less than this are left out of predictions
  const PRICE_HOUR_UTC = 23; // overnight price change time in UTC. Check against FPL's own countdown.
  const SAMPLE_MIN = 15; // minimum gap between progress samples used for per-hour rates

  const KEY_PROG = "fpl.progress";
  const KEY_WATCH = "fpl.watch";
  const KEY_BASE = "fpl.baseline";

  let snap = null;
  let teamById = new Map();
  let posById = new Map();
  let rates = {}; // player id -> progress change per hour, in percentage points
  let watch = [];
  let mine = new Set();
  const state = { tab: "table", sub: "all", list: "risers", pct: true, limit: PAGE, pastLimit: PAGE };

  // ---------- Storage ----------
  const readJSON = (key, fallback) => {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  };

  // ---------- Maths ----------
  const net = (p) => p.transfers_in - p.transfers_out;

  // Progress toward the next change. Positive means rising, negative falling, 100 means the threshold is reached.
  const signedProgress = (p) => {
    const n = net(p);
    if (!n) return 0;
    const threshold = n > 0 ? RISE_NET : FALL_NET;
    return (n / threshold) * 100;
  };

  // Next overnight price change, as a UTC timestamp.
  function nextChange(now) {
    const d = new Date(now);
    const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), PRICE_HOUR_UTC);
    return t > now ? t : t + 86400000;
  }

  const hoursToChange = (now) => (nextChange(now) - now) / 3600000;

  // Projection to the next change, using the per-hour rate once we have one.
  function predict(id, sp, now) {
    const a = Math.abs(sp);
    const dir = Math.sign(sp);
    if (!dir) return { proj: null, label: "–" };
    if (a >= 100) return { proj: a, label: "Reached" };

    const r = rates[id];
    if (r === undefined) return { proj: null, label: "–" };

    const rd = r * dir; // rate in the direction of travel
    const proj = a + rd * hoursToChange(now);
    if (rd <= 0) return { proj, label: "Stalling" };

    const days = (100 - a) / rd / 24;
    const rounded = Math.max(1, Math.round(days));
    return { proj, label: days > 2 ? ">2 days" : `${rounded} day${rounded === 1 ? "" : "s"}` };
  }

  // Store one progress sample per interval, then derive each player's per-hour change from the last sample.
  function updateRates(now) {
    const cur = {};
    for (const p of snap.players) cur[p.id] = signedProgress(p);

    let st = readJSON(KEY_PROG, null);
    if (!st) {
      st = { t: now, p: cur, rate: {} };
    } else if (now - st.t >= SAMPLE_MIN * 60000) {
      const dt = (now - st.t) / 3600000;
      const rate = {};
      for (const id in cur) {
        if (st.p[id] !== undefined) rate[id] = (cur[id] - st.p[id]) / dt;
      }
      st = { t: now, p: cur, rate };
    }
    localStorage.setItem(KEY_PROG, JSON.stringify(st));
    rates = st.rate ?? {};
  }

  // ---------- Shared pieces ----------
  const shirt = (p) => {
    const t = teamById.get(p.team);
    const gk = p.element_type === 1;
    return t?.code
      ? `<img class="pshirt" src="${SHIRTS}/shirt_${t.code}${gk ? "_1" : ""}-66.png" alt="" loading="lazy">`
      : "";
  };

  const nameCell = (p, withStar) => {
    const watching = watch.includes(p.id);
    const star = withStar
      ? `<button class="star" type="button" data-watch="${p.id}" aria-pressed="${watching}" aria-label="${
          watching ? "Remove from watchlist" : "Add to watchlist"
        }">${watching ? "★" : "☆"}</button>`
      : "";
    return `<div class="pl">${shirt(p)}<div>
      <div class="pname">${esc(p.web_name)}</div>
      <div class="small muted">${esc(posById.get(p.element_type))} ${money(p.now_cost)}</div>
    </div>${star}</div>`;
  };

  // "Show more" button under a table. Created once, then kept in sync.
  function moreBtn(id, tbody, total, limit, onClick) {
    let btn = document.getElementById(id);
    if (!btn) {
      const p = document.createElement("p");
      btn = document.createElement("button");
      btn.id = id;
      btn.type = "button";
      p.append(btn);
      tbody.closest(".table-wrap").after(p);
      btn.addEventListener("click", onClick);
    }
    const left = total - limit;
    btn.hidden = left <= 0;
    btn.textContent = `Show more (${Math.max(0, left)} left)`;
  }

  // ---------- Table tab ----------
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
      ? "Per hr and day predictions use progress measured on this device."
      : "Per hr and day predictions appear after about 15 minutes of progress history on this device.";
  }

  // ---------- Summary tab ----------
  function renderSummary() {
    const groups = { rise: [], riseMaybe: [], fall: [], fallMaybe: [] };
    for (const p of snap.players) {
      if (p.selected_by_percent < OWN_FLOOR) continue;
      const sp = signedProgress(p);
      const a = Math.abs(sp);
      if (a < 95) continue;
      const key = sp > 0 ? (a >= 100 ? "rise" : "riseMaybe") : a >= 100 ? "fall" : "fallMaybe";
      groups[key].push({ p, sp, a });
    }
    for (const g of Object.values(groups)) g.sort((x, y) => y.a - x.a);

    const row = ({ p, sp }) => {
      const value = state.pct
        ? `<span class="${sp > 0 ? "up" : "down"}">${signedPct(sp)}</span>`
        : `${net(p).toLocaleString()} net`;
      return `<div class="sumrow">
        <div class="pl">${shirt(p)}<span class="pname">${esc(p.web_name)}</span></div>
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

  // ---------- Trends tab ----------
  function renderTrends() {
    const top = snap.players
      .map((p) => ({ p, vol: p.transfers_in + p.transfers_out, n: net(p) }))
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
    const cellH = 110;
    const rows = Math.ceil(top.length / cols);
    const width = cols * cellW;
    const height = rows * cellH;

    const bubbles = top
      .map(({ p, vol, n }, i) => {
        const cx = (i % cols) * cellW + cellW / 2;
        const cy = Math.floor(i / cols) * cellH + cellH / 2;
        const r = 12 + 34 * Math.sqrt(vol / max);
        const label = p.web_name.length > 9 ? `${p.web_name.slice(0, 8)}…` : p.web_name;
        return `<g>
          <title>${esc(p.web_name)}: ${vol.toLocaleString()} transfers (${n >= 0 ? "+" : ""}${n.toLocaleString()} net)</title>
          <circle class="bub ${n > 0 ? "rise" : "fall"}" cx="${cx}" cy="${cy}" r="${r.toFixed(1)}"></circle>
          <text class="bub-label" x="${cx}" y="${cy + 4}">${esc(label)}</text>
        </g>`;
      })
      .join("");

    $("trends").innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Transfer trends">${bubbles}</svg>`;
  }

  // ---------- Past tab ----------
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
      const ms = nextChange(Date.now()) - Date.now();
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
    updateRates(Date.now());
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

  // Any change to a filter starts the list again from the first 25.
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

    // Star toggles. One listener on the table body covers every row.
    $("rows").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-watch]");
      if (!btn) return;
      const id = Number(btn.dataset.watch);
      watch = watch.includes(id) ? watch.filter((x) => x !== id) : [...watch, id];
      localStorage.setItem(KEY_WATCH, JSON.stringify(watch));
      renderTable(Date.now());
    });

    startCountdown();
    refresh();
    setInterval(refresh, 60_000);
  }

  document.addEventListener("fpl:ready", (e) => {
    if (e.detail) init(e.detail);
  });
})();
