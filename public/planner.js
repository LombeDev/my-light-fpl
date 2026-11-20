/* planner.js: season ticker with FDR editing, fixtures with effective ownership, squad builder (25 players at a time),
   transfers. Starts on fpl:ready from app.js. */
(() => {
  if (document.body.dataset.page !== "planner") return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const money = (tenths) => `£${(tenths / 10).toFixed(1)}m`;
  const SHIRTS = "https://fantasy.premierleague.com/dist/img/shirts/standard";

  const KEY = "fpl.squad";
  const BASE = "fpl.baseline";
  const FT_KEY = "fpl.ft";
  const OVR_KEY = "fpl.fdrOverrides";
  const SESSION = "fpl.session";
  const BUDGET = 1000; // tenths of a million
  const SIZE = 15;
  const QUOTA = { 1: 2, 2: 5, 3: 5, 4: 3 }; // element_type: count
  const CLUB_MAX = 3;
  const HIT = 4;
  const MAX_GW = 10;
  const PAGE = 25;

  let F;
  let snap;
  let byId;
  let teamById;
  let positions;
  let count = 5; // gameweeks in the ticker, also the window for squad FDR
  let fxGw = 1; // gameweek shown in the fixtures list
  let fixtureMap = new Map(); // team id -> [{ opp, home, diff }] for the squad window
  let teamEo = null; // club id -> summed effective ownership (%), null until the sample loads
  let squad = [];
  let baseline = [];
  let ovr = readOvr(); // "fixtureId:h" or "fixtureId:a" -> difficulty override
  let editing = false;
  let poolLimit = PAGE;

  // ---------- Storage ----------
  const readList = (key) => {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? [];
    } catch {
      return [];
    }
  };
  const saveList = (key, list) => localStorage.setItem(key, JSON.stringify(list));

  function readOvr() {
    try {
      return JSON.parse(localStorage.getItem(OVR_KEY)) ?? {};
    } catch {
      return {};
    }
  }
  const saveOvr = () => localStorage.setItem(OVR_KEY, JSON.stringify(ovr));

  const readSession = () => {
    try {
      return JSON.parse(localStorage.getItem(SESSION));
    } catch {
      return null;
    }
  };

  // ---------- Helpers ----------
  const shirt = (code) =>
    code ? `<img class="shirt" src="${SHIRTS}/shirt_${code}-66.png" alt="" loading="lazy">` : "";

  const maxGw = () => snap.events.length || 38;
  const gwEnd = (from, n) => Math.min(maxGw(), from + n - 1);

  // Difficulty for one side of a fixture, with any manual change applied.
  function diffOf(f, side) {
    const k = `${f.id}:${side}`;
    if (ovr[k] !== undefined) return ovr[k];
    return side === "h" ? f.home_difficulty : f.away_difficulty;
  }

  const solid = (d) => `fdr-solid-${Math.round(d)}`;

  const spent = () => squad.reduce((sum, id) => sum + byId.get(id).now_cost, 0);
  const countPos = (type) => squad.filter((id) => byId.get(id).element_type === type).length;
  const countClub = (team) => squad.filter((id) => byId.get(id).team === team).length;

  function blockReason(p) {
    if (squad.includes(p.id)) return "In squad";
    if (squad.length >= SIZE) return "Squad full";
    if (countPos(p.element_type) >= QUOTA[p.element_type]) return "Position full";
    if (countClub(p.team) >= CLUB_MAX) return "Club limit";
    if (spent() + p.now_cost > BUDGET) return "Over budget";
    return null;
  }

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

  // ---------- Squad window: next `n` unfinished fixtures per team ----------
  function buildFixtures(n) {
    const upcoming = snap.fixtures
      .filter((f) => !f.finished && f.kickoff)
      .sort((a, b) => a.kickoff.localeCompare(b.kickoff));

    const map = new Map();
    const add = (team, opp, home, diff) => {
      const list = map.get(team) ?? [];
      if (list.length < n) {
        list.push({ opp, home, diff });
        map.set(team, list);
      }
    };
    for (const f of upcoming) {
      add(f.home, f.away, true, diffOf(f, "h"));
      add(f.away, f.home, false, diffOf(f, "a"));
    }
    fixtureMap = map;
  }

  // Average over rated fixtures only, so a missing rating is never counted as 0.
  function fdrOf(teamId) {
    const list = fixtureMap.get(teamId) ?? [];
    const rated = list.filter((x) => x.diff > 0);
    const avg = rated.length ? rated.reduce((s, x) => s + x.diff, 0) / rated.length : null;
    return { list, avg };
  }

  const sortKey = (teamId) => {
    const { avg } = fdrOf(teamId);
    return avg === null ? Number.POSITIVE_INFINITY : avg;
  };

  function fdrCell(teamId) {
    const { avg } = fdrOf(teamId);
    if (avg === null) return `<td class="n">–</td>`;
    return `<td class="n"><span class="pill ${solid(avg)}">${avg.toFixed(1)}</span></td>`;
  }

  function nextCell(teamId) {
    const { list } = fdrOf(teamId);
    if (!list.length) return `<td class="muted">No fixtures</td>`;
    return `<td>${list
      .map((x) => `<span class="chip ${solid(x.diff)}">${F.teamHtml(x.opp)} ${x.home ? "H" : "A"}</span>`)
      .join("")}</td>`;
  }

  function squadFdr() {
    const avgs = squad.map((id) => fdrOf(byId.get(id).team).avg).filter((v) => v !== null);
    return avgs.length ? avgs.reduce((s, v) => s + v, 0) / avgs.length : null;
  }

  // ---------- Effective ownership by club ----------
  const eoText = (teamId) => (teamEo === null ? "–" : `${Math.round(teamEo.get(teamId) ?? 0)}%`);

  async function loadEo() {
    try {
      const res = await fetch("/api/sample");
      const s = await res.json();
      if (!res.ok || !s.sampled) return;

      const map = new Map();
      for (const p of snap.players) {
        const eo = (s.owned[p.id] ?? 0) + (s.captain?.[p.id] ?? 0);
        map.set(p.team, (map.get(p.team) ?? 0) + eo);
      }
      teamEo = map;
      renderFixtures();
    } catch {
      /* sample unavailable: keep the dashes */
    }
  }

  // ---------- Init ----------
  document.addEventListener("fpl:ready", (e) => {
    if (e.detail) init(e.detail);
  });

  // Any change to the pool's search or filters starts the list again from the first 25.
  const resetPool = () => {
    poolLimit = PAGE;
    renderPool();
  };

  function init(s) {
    snap = s;
    F = window.FPL;
    byId = new Map(snap.players.map((p) => [p.id, p]));
    teamById = new Map(snap.teams.map((t) => [t.id, t]));
    positions = new Map(snap.positions.map((p) => [p.id, p.short]));
    squad = readList(KEY).filter((id) => byId.has(id)).slice(0, SIZE);
    baseline = readList(BASE).filter((id) => byId.has(id)).slice(0, SIZE);
    fxGw = F.gw;

    snap.positions.forEach((p) => $("pos").append(new Option(p.short, String(p.id))));
    $("ft").value = localStorage.getItem(FT_KEY) ?? "1";

    const session = readSession();
    $("import").hidden = !session;

    // Season ticker controls
    $("gw-minus").addEventListener("click", () => {
      count = Math.max(1, count - 1);
      renderAll();
    });
    $("gw-plus").addEventListener("click", () => {
      count = Math.min(MAX_GW, count + 1);
      renderAll();
    });
    $("edit-fdr").addEventListener("click", () => {
      editing = !editing;
      renderAll();
    });
    $("fdr-editor").addEventListener("change", (e) => {
      const sel = e.target;
      if (!sel.dataset.fid) return;
      ovr[`${sel.dataset.fid}:${sel.dataset.side}`] = Number(sel.value);
      saveOvr();
      renderAll();
    });
    $("fdr-editor").addEventListener("click", (e) => {
      if (e.target.id !== "fdr-reset") return;
      ovr = {};
      saveOvr();
      renderAll();
    });

    // Fixtures controls
    $("fx-prev").addEventListener("click", () => {
      fxGw = Math.max(1, fxGw - 1);
      renderFixtures();
    });
    $("fx-next").addEventListener("click", () => {
      fxGw = Math.min(maxGw(), fxGw + 1);
      renderFixtures();
    });

    // Squad and transfers
    $("import").addEventListener("click", () => importSquad(session));
    $("setbase").addEventListener("click", () => {
      baseline = squad.slice();
      saveList(BASE, baseline);
      renderTransfers();
    });
    $("clear").addEventListener("click", () => {
      squad = [];
      saveList(KEY, squad);
      renderAll();
    });
    $("ft").addEventListener("change", () => {
      localStorage.setItem(FT_KEY, $("ft").value);
      renderTransfers();
    });
    $("squad").addEventListener("click", (e) => {
      const id = Number(e.target.dataset.remove);
      if (!id) return;
      squad = squad.filter((x) => x !== id);
      saveList(KEY, squad);
      renderAll();
    });
    $("pool").addEventListener("click", (e) => {
      const id = Number(e.target.dataset.add);
      if (!id || blockReason(byId.get(id))) return;
      squad.push(id);
      saveList(KEY, squad);
      renderAll();
    });
    $("q").addEventListener("input", resetPool);
    $("pos").addEventListener("change", resetPool);
    $("sort").addEventListener("change", resetPool);

    $("meta").textContent = `Prices as of ${new Date(snap.generatedAt).toLocaleString()}`;
    renderAll();
    loadEo();
  }

  function renderAll() {
    // Keep the ticker window inside the gameweeks that remain.
    const cap = Math.min(MAX_GW, maxGw() - F.gw + 1);
    count = Math.min(count, cap);

    buildFixtures(count);
    renderSummary();
    renderTicker();
    renderEditor();
    renderFixtures();
    renderSquad();
    renderTransfers();
    renderPool();

    $("gw-count").textContent = String(count);
    $("gw-minus").disabled = count <= 1;
    $("gw-plus").disabled = count >= cap;
    $("edit-fdr").textContent = editing ? "Done editing" : "Edit FDR";
    document.querySelectorAll("[data-h]").forEach((th) => (th.textContent = `FDR next ${count}`));
  }

  function renderSummary() {
    const left = (BUDGET - spent()) / 10;
    const parts = Object.entries(QUOTA)
      .map(([type, q]) => `${positions.get(Number(type))} ${countPos(Number(type))}/${q}`)
      .join(" · ");
    const valid =
      squad.length === SIZE &&
      Object.entries(QUOTA).every(([type, q]) => countPos(Number(type)) === q) &&
      spent() <= BUDGET;

    const sf = squadFdr();
    const fdrText = sf === null ? "" : ` · squad FDR ${sf.toFixed(1)} over next ${count}`;

    $("summary").textContent =
      `${squad.length}/${SIZE} players · £${left.toFixed(1)}m left · ${parts}${fdrText}` +
      (valid ? " · Valid squad" : "");
  }

  // ---------- Season ticker ----------
  function renderTicker() {
    const start = F.gw;
    const last = gwEnd(start, count);
    const gws = [];
    for (let g = start; g <= last; g++) gws.push(g);

    // "team:gw" -> fixtures for that club in that gameweek
    const grid = new Map();
    const add = (team, gw, entry) => {
      const k = `${team}:${gw}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(entry);
    };
    for (const f of snap.fixtures) {
      if (f.gw === null || f.gw < start || f.gw > last) continue;
      add(f.home, f.gw, { home: true, opp: f.away, diff: diffOf(f, "h") });
      add(f.away, f.gw, { home: false, opp: f.home, diff: diffOf(f, "a") });
    }

    const score = (team) =>
      gws.reduce((s, g) => s + (grid.get(`${team}:${g}`) ?? []).reduce((t, x) => t + x.diff, 0), 0);

    const clubs = [...snap.teams].sort((a, b) => score(a.id) - score(b.id) || a.name.localeCompare(b.name));

    $("tk-head").innerHTML = `<tr>
      <th>Club</th><th>Mine</th><th class="n">Score</th>
      ${gws.map((g) => `<th class="c">${g}</th>`).join("")}
    </tr>`;

    $("tk-body").innerHTML = clubs
      .map((t) => {
        const mine =
          squad
            .map((id) => byId.get(id))
            .filter((p) => p && p.team === t.id)
            .map((p) => esc(p.web_name))
            .join(", ") || "—";

        const cells = gws
          .map((g) => {
            const list = grid.get(`${t.id}:${g}`) ?? [];
            if (!list.length) return `<td class="c muted">Blank</td>`;
            return `<td class="cellwrap">${list
              .map((x) => {
                const name = teamById.get(x.opp)?.short ?? "";
                const label = x.home ? name.toUpperCase() : name.toLowerCase();
                return `<div class="cell ${solid(x.diff)}">${esc(label)}<small>${Math.round(x.diff)}</small></div>`;
              })
              .join("")}</td>`;
          })
          .join("");

        return `<tr>
          <td>${esc(t.name)}</td>
          <td class="mine">${mine}</td>
          <td class="n"><strong>${score(t.id)}</strong></td>
          ${cells}
        </tr>`;
      })
      .join("");
  }

  // Editor: one row per fixture in the ticker window, with a home and an away difficulty.
  function renderEditor() {
    const box = $("fdr-editor");
    box.hidden = !editing;
    if (!editing) {
      box.innerHTML = "";
      return;
    }

    const start = F.gw;
    const last = gwEnd(start, count);
    const items = snap.fixtures
      .filter((f) => f.gw !== null && f.gw >= start && f.gw <= last)
      .sort((a, b) => a.gw - b.gw || (a.kickoff ?? "~").localeCompare(b.kickoff ?? "~"));

    const opts = (cur) =>
      [1, 2, 3, 4, 5].map((d) => `<option value="${d}"${d === cur ? " selected" : ""}>${d}</option>`).join("");
    const name = (id) => teamById.get(id)?.short ?? "";

    box.innerHTML = `
      <p class="meta">
        Change the difficulty of any fixture. Changes are saved on this device and apply to the ticker,
        fixtures and squad figures. FPL's ratings are used for anything you don't change.
      </p>
      <div class="table-wrap"><table>
        <thead><tr><th>GW</th><th>Fixture</th><th class="c">Home FDR</th><th class="c">Away FDR</th></tr></thead>
        <tbody>${items
          .map(
            (f) => `<tr>
              <td>${f.gw}</td>
              <td>${esc(name(f.home))} v ${esc(name(f.away))}</td>
              <td class="c"><select data-fid="${f.id}" data-side="h" aria-label="Home difficulty">${opts(diffOf(f, "h"))}</select></td>
              <td class="c"><select data-fid="${f.id}" data-side="a" aria-label="Away difficulty">${opts(diffOf(f, "a"))}</select></td>
            </tr>`,
          )
          .join("")}</tbody>
      </table></div>
      <div class="row"><button id="fdr-reset" type="button">Reset all changes</button></div>`;
  }

  // ---------- Fixtures with effective ownership ----------
  function renderFixtures() {
    const max = maxGw();
    $("fx-gw").textContent = `Gameweek ${fxGw}`;
    $("fx-prev").disabled = fxGw <= 1;
    $("fx-next").disabled = fxGw >= max;

    const items = snap.fixtures
      .filter((f) => f.gw === fxGw)
      .sort((a, b) => (a.kickoff ?? "~").localeCompare(b.kickoff ?? "~"));

    if (!items.length) {
      $("fx-list").innerHTML = `<p class="meta">No fixtures in this gameweek.</p>`;
      return;
    }

    const time = (iso) =>
      iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "TBC";

    const mid = (f) => {
      if (f.finished) return `${f.home_score ?? 0} – ${f.away_score ?? 0}<small>FT</small>`;
      if (f.started) return `${f.home_score ?? 0} – ${f.away_score ?? 0}<small>LIVE</small>`;
      return time(f.kickoff);
    };

    const side = (teamId, d, isHome) => {
      const t = teamById.get(teamId);
      const pill = `<span class="pill ${solid(d)}">${esc(t?.name ?? "")}</span>`;
      const img = shirt(t?.code);
      const eo = `<div class="eo">${eoText(teamId)}</div>`;
      return isHome
        ? `<div class="fx-side home"><div class="fx-line">${pill}${img}</div>${eo}</div>`
        : `<div class="fx-side away"><div class="fx-line">${img}${pill}</div>${eo}</div>`;
    };

    const days = new Map();
    for (const f of items) {
      const key = f.kickoff ? new Date(f.kickoff).toDateString() : "TBC";
      if (!days.has(key)) {
        const label = f.kickoff
          ? new Date(f.kickoff).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })
          : "Date to be confirmed";
        days.set(key, { label, list: [] });
      }
      days.get(key).list.push(f);
    }

    $("fx-list").innerHTML = [...days.values()]
      .map(
        ({ label, list }) => `<h3 class="fx-day">${esc(label)}</h3>${list
          .map(
            (f) => `<div class="fx-row">
              ${side(f.home, diffOf(f, "h"), true)}
              <div class="fx-mid">${mid(f)}</div>
              ${side(f.away, diffOf(f, "a"), false)}
            </div>`,
          )
          .join("")}`,
      )
      .join("");
  }

  // ---------- Squad ----------
  function renderSquad() {
    $("squad").innerHTML = squad.length
      ? squad
          .map((id) => {
            const p = byId.get(id);
            return `<tr>
              <td>${F.playerHtml(p.id)}</td>
              <td>${F.teamHtml(p.team)}</td>
              <td>${esc(positions.get(p.element_type))}</td>
              <td class="n">${money(p.now_cost)}</td>
              ${fdrCell(p.team)}
              ${nextCell(p.team)}
              <td><button type="button" data-remove="${p.id}">Remove</button></td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="7">No players yet. Add players below or import your squad.</td></tr>`;
  }

  // ---------- Transfers ----------
  function renderTransfers() {
    const box = $("transfers");
    if (!baseline.length) {
      box.innerHTML = `<p class="meta">Set your current team first. Use <strong>Import my squad</strong> when signed in, or <strong>Use this squad as my team</strong> with the squad you have now.</p>`;
      return;
    }

    const outs = baseline.filter((id) => !squad.includes(id));
    const ins = squad.filter((id) => !baseline.includes(id));
    const made = Math.max(outs.length, ins.length);
    const ft = Number($("ft").value);
    const hits = Math.max(0, made - ft);
    const cost = hits * HIT;

    const rows = Array.from({ length: made }, (_, i) => {
      const o = outs[i];
      const n = ins[i];
      return `<tr>
        <td>${o ? F.playerHtml(o) : ""}</td>
        <td>${n ? F.playerHtml(n) : ""}</td>
      </tr>`;
    }).join("");

    box.innerHTML = `
      <p>
        <strong>${made}</strong> transfer${made === 1 ? "" : "s"} · ${ft} free ·
        ${hits} hit${hits === 1 ? "" : "s"}${cost ? ` = <strong>−${cost} pts</strong>` : " = no cost"}
      </p>
      ${
        made
          ? `<div class="table-wrap"><table>
               <thead><tr><th>Out</th><th>In</th></tr></thead>
               <tbody>${rows}</tbody>
             </table></div>`
          : `<p class="meta">No changes from your current team.</p>`
      }
      <p class="meta">Each hit costs 4 points. Set free transfers to what you have available.</p>
    `;
  }

  // ---------- Pool ----------
  function renderPool() {
    const needle = $("q").value.trim().toLowerCase();
    const posId = Number($("pos").value);
    const mode = $("sort").value;

    const all = snap.players
      .filter(
        (p) =>
          (!posId || p.element_type === posId) &&
          (!needle || p.web_name.toLowerCase().includes(needle)),
      )
      .sort((a, b) => {
        if (mode === "fdr") return sortKey(a.team) - sortKey(b.team) || b.total_points - a.total_points;
        if (mode === "price") return a.now_cost - b.now_cost;
        return b.total_points - a.total_points;
      });

    const list = all.slice(0, poolLimit);

    $("pool").innerHTML = list.length
      ? list
          .map((p) => {
            const reason = blockReason(p);
            const label = reason ?? "Add";
            const disabled = reason ? " disabled" : "";
            return `<tr${p.status !== "a" ? ' class="dim"' : ""}>
              <td>${F.playerHtml(p.id)}</td>
              <td>${F.teamHtml(p.team)}</td>
              <td>${esc(positions.get(p.element_type))}</td>
              <td class="n">${money(p.now_cost)}</td>
              <td class="n">${p.total_points}</td>
              ${fdrCell(p.team)}
              ${nextCell(p.team)}
              <td><button type="button" data-add="${p.id}"${disabled}>${label}</button></td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="8">No players match.</td></tr>`;

    moreBtn("more-pool", $("pool"), all.length, poolLimit, () => {
      poolLimit += PAGE;
      renderPool();
    });
  }

  // ---------- Import from FPL ----------
  async function importSquad(session) {
    if (!session) return;
    $("meta").textContent = "Importing…";
    try {
      const gw = F.gw;
      const res = await fetch(`/api/picks/${session.entryId}/${gw}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      const ids = data.picks.map((p) => p.element).filter((id) => byId.has(id)).slice(0, SIZE);
      squad = ids.slice();
      baseline = ids.slice();
      saveList(KEY, squad);
      saveList(BASE, baseline);
      renderAll();
      $("meta").textContent = `Imported your squad for gameweek ${gw}.`;
    } catch (err) {
      $("meta").textContent = `Could not import: ${err.message}`;
    }
  }
})();
