/* leagues-table.js: mini-league analysis, a sortable gameweek table, live rank and projected points,
   team views and CSV download. Uses only data the site already loads: league standings, /api/managers,
   /api/livescore and /api/picks. Page key: league-table. Loads after app.js, menu.js and team-view.js. */
(() => {
  if (document.body.dataset.page !== "league-table") return;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const ID = /^\d{1,9}$/;
  const PAGE_SIZE = 50; // managers per league page, as the league route returns them
  const BATCH = 10;     // ids per /managers and /livescore request
  const pts = (n) => Math.round(Number(n) || 0).toLocaleString();
  const money = (tenths) => `£${(tenths / 10).toFixed(1)}m`;

  const COLS = [
    { key: "manager", label: "Name", sort: true, text: true },
    { key: "liveRank", label: "Live ML rank", sort: true },
    { key: "change", label: "Change", sort: true },
    { key: "gwPts", label: "Live GW pts", sort: true },
    { key: "liveTotal", label: "Live overall", sort: true },
    { key: "total", label: "Total", sort: true },
    { key: "captain", label: "Captain", sort: true, text: true },
    { key: "vc", label: "Vice", sort: true, text: true },
    { key: "chip", label: "Active chip", sort: true, text: true },
    { key: "moveCount", label: "GW transfers", sort: true },
    { key: "hit", label: "Hit", sort: true },
    { key: "moves", label: "Transfers", sort: false, text: true },
  ];

  const SORT = {
    manager: (r) => r.manager,
    liveRank: (r) => r.liveRank,
    change: (r) => r.change ?? -999,
    gwPts: (r) => r.gwPts,
    liveTotal: (r) => r.liveTotal,
    total: (r) => r.total,
    captain: (r) => r.captain,
    vc: (r) => r.vc,
    chip: (r) => r.chip,
    moveCount: (r) => r.moveCount,
    hit: (r) => r.hit,
  };

  const S = {
    snap: null,
    gw: 1,
    leagueId: "",
    pageNo: 1,
    hasNext: false,
    entries: [],          // league standings rows for this page
    detail: new Map(),    // entry -> /api/managers data
    live: new Map(),      // entry -> projected points during matches
    isLive: false,
    rows: [],             // computed rows for the table and analysis
    sortKey: "liveRank",
    sortDir: 1,
    filter: "",
    open: new Set(),      // entries whose team view is open
    teamHtml: new Map(),  // entry -> rendered team view
    names: new Map(),     // player id -> name
    loadToken: 0,
  };

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

  const nameOf = (id) => (id ? S.names.get(id) ?? "Unknown" : "");

  // ---------- Building the rows ----------
  function buildRows() {
    const offset = (S.pageNo - 1) * PAGE_SIZE;
    const rows = S.entries.map((e, i) => {
      const d = S.detail.get(e.entry) ?? null;
      const lv = S.isLive ? S.live.get(e.entry) : null;
      const total = Number(e.total) || 0;
      const gw = Number(e.gw) || 0;
      return {
        entry: e.entry,
        team: e.team ?? "",
        manager: e.manager ?? "",
        leaguePos: offset + i + 1,
        total,
        d,
        gwPts: lv ? lv.gross : Number(d?.gross ?? gw),
        liveTotal: lv ? lv.exp : total,
      };
    });

    // Live rank: by projected total during matches, otherwise by the league total.
    [...rows]
      .sort((a, b) => b.liveTotal - a.liveTotal || a.leaguePos - b.leaguePos)
      .forEach((r, i) => {
        r.liveRank = i + 1;
      });

    for (const r of rows) {
      const d = r.d;
      r.change = S.isLive ? r.leaguePos - r.liveRank : null;
      r.captain = d ? nameOf(d.captainId) : "";
      r.vc = d ? nameOf(d.viceId) : "";
      r.chip = d?.chip ?? "";
      r.hit = Number(d?.hit) || 0;
      r.moves = d?.transfers ?? [];
      r.moveCount = r.moves.length;
      r.value = Number(d?.value) || 0;
    }
    return rows;
  }

  // ---------- Analysis tiles ----------
  function highlights(rows) {
    const have = rows.filter((r) => r.d);
    const best = (list, fn) => list.reduce((b, r) => (b === null || fn(r) > fn(b) ? r : b), null);
    const worst = (list, fn) => list.reduce((b, r) => (b === null || fn(r) < fn(b) ? r : b), null);
    const tally = (items) => {
      const m = new Map();
      for (const k of items) if (k) m.set(k, (m.get(k) ?? 0) + 1);
      return m;
    };
    const top = (m) => {
      let t = null;
      for (const [k, v] of m) if (!t || v > t[1]) t = [k, v];
      return t;
    };
    const T = (icon, title, value, sub) => ({ icon, title, value, sub });
    const out = [];

    const hi = best(have, (r) => r.gwPts);
    const lo = worst(have, (r) => r.gwPts);
    out.push(hi ? T("🎯", "Manager of the week", hi.manager, `${pts(hi.gwPts)} pts`) : T("🎯", "Manager of the week", "–", "Loading"));
    out.push(lo ? T("🥄", "Worst manager of the week", lo.manager, `${pts(lo.gwPts)} pts`) : T("🥄", "Worst manager of the week", "–", "Loading"));

    if (S.isLive) {
      const up = best(rows, (r) => r.change ?? -999);
      const down = worst(rows, (r) => r.change ?? 999);
      out.push(up && up.change > 0
        ? T("📈", "Biggest rise", up.manager, `+${up.change} places`)
        : T("📈", "Biggest rise", "None yet", "Nobody has moved up"));
      out.push(down && down.change < 0
        ? T("📉", "Biggest fall", down.manager, `${down.change} places`)
        : T("📉", "Biggest fall", "None yet", "Nobody has dropped"));
    } else {
      out.push(T("📈", "Biggest rise", "Waiting", "Shown once matches are live"));
      out.push(T("📉", "Biggest fall", "Waiting", "Shown once matches are live"));
    }

    const cap = top(tally(have.map((r) => r.captain)));
    out.push(cap ? T("©", "Most captained", cap[0], `${cap[1]} managers`) : T("©", "Most captained", "–", "Loading"));

    const ins = top(tally(have.flatMap((r) => r.moves.map((m) => nameOf(m.inId)))));
    const outs = top(tally(have.flatMap((r) => r.moves.map((m) => nameOf(m.outId)))));
    out.push(ins
      ? T("👍", "Most transferred in", ins[0], `${ins[1]} managers`)
      : T("👍", "Most transferred in", "None yet", "No transfers this week"));
    out.push(outs
      ? T("👎", "Most transferred out", outs[0], `${outs[1]} managers`)
      : T("👎", "Most transferred out", "None yet", "No transfers this week"));

    const valued = have.filter((r) => r.value > 0);
    const rich = best(valued, (r) => r.value);
    const poor = worst(valued, (r) => r.value);
    out.push(rich ? T("💰", "Best team value", rich.manager, money(rich.value)) : T("💰", "Best team value", "–", "Loading"));
    out.push(poor ? T("💸", "Lowest team value", poor.manager, money(poor.value)) : T("💸", "Lowest team value", "–", "Loading"));

    const busy = best(have, (r) => r.moveCount);
    out.push(busy && busy.moveCount > 0
      ? T("🔀", "Most transfers this week", busy.manager, `${busy.moveCount} moves`)
      : T("🔀", "Most transfers this week", "None yet", "No transfers this week"));

    const hit = best(have, (r) => r.hit);
    out.push(hit && hit.hit > 0
      ? T("🧨", "Worst transfers this week", hit.manager, `−${hit.hit} pts in hits`)
      : T("🧨", "Worst transfers this week", "None", "No point hits taken"));

    const chips = tally(have.map((r) => r.chip));
    const chipText = [...chips].map(([k, v]) => `${k} ×${v}`).join(", ");
    const chipCount = [...chips.values()].reduce((a, b) => a + b, 0);
    out.push(T("🃏", "Chips this week", chipText || "None", chipCount ? `${chipCount} managers` : "No chips played"));

    return out;
  }

  function renderHighlights(rows) {
    $("la-tiles").innerHTML = highlights(rows)
      .map((t) => `<div class="la-tile">
        <span class="la-ico" aria-hidden="true">${t.icon}</span>
        <div>
          <div class="la-title">${esc(t.title)}</div>
          <div class="la-val">${esc(t.value)}</div>
          <div class="la-sub">${esc(t.sub)}</div>
        </div>
      </div>`)
      .join("");

    const loaded = rows.filter((r) => r.d).length;
    $("la-note").textContent =
      loaded < rows.length
        ? `Loading managers: ${loaded} of ${rows.length} done.`
        : `Based on the ${rows.length} managers on this page. Bench points, ownership and all-time ranks need data the public feed doesn't include, so they aren't shown.`;
  }

  // ---------- Table ----------
  function visibleRows(rows) {
    const q = S.filter.trim().toLowerCase();
    const list = q
      ? rows.filter((r) => r.manager.toLowerCase().includes(q) || r.team.toLowerCase().includes(q))
      : [...rows];
    const get = SORT[S.sortKey] ?? SORT.liveRank;
    return list.sort((a, b) => {
      const x = get(a);
      const y = get(b);
      if (typeof x === "string") return S.sortDir * x.localeCompare(y);
      return S.sortDir * (x - y);
    });
  }

  function renderHead() {
    const cells = COLS.map((c) => {
      if (!c.sort) return `<th scope="col">${esc(c.label)}</th>`;
      const on = S.sortKey === c.key;
      const aria = on ? (S.sortDir > 0 ? "ascending" : "descending") : "none";
      const mark = on ? (S.sortDir > 0 ? " ▲" : " ▼") : "";
      return `<th scope="col" class="${c.text ? "" : "n"}" aria-sort="${aria}">
        <button type="button" class="lx-sort${on ? " is-on" : ""}" data-sort="${c.key}">${esc(c.label)}${mark}</button>
      </th>`;
    });
    $("lx-head").innerHTML = `<tr>${cells.join("")}</tr>`;
  }

  function rowHtml(r) {
    const cls = r.change === null ? "" : r.change > 0 ? "up" : r.change < 0 ? "down" : "";
    const change = r.change === null ? "–" : r.change > 0 ? `+${r.change}` : String(r.change);
    const open = S.open.has(r.entry);
    const moves = r.moves.length
      ? r.moves
          .map((m) => `<span class="lx-move"><span class="lx-out">${esc(nameOf(m.outId))}</span> → <span class="lx-in">${esc(nameOf(m.inId))}</span></span>`)
          .join("")
      : `<span class="muted">None</span>`;

    return `<tr data-row="${r.entry}">
      <td class="lx-name">
        <div class="lx-team">${esc(r.team)}</div>
        <div class="lx-mgr">${esc(r.manager)}</div>
        <button type="button" class="lx-view" data-view="${r.entry}" aria-expanded="${open}">${open ? "Hide team" : "View team"}</button>
      </td>
      <td class="n">${r.liveRank}</td>
      <td class="n ${cls}">${change}</td>
      <td class="n">${pts(r.gwPts)}</td>
      <td class="n">${pts(r.liveTotal)}</td>
      <td class="n">${pts(r.total)}</td>
      <td>${esc(r.captain || "–")}</td>
      <td>${esc(r.vc || "–")}</td>
      <td>${r.chip ? `<span class="lx-chip">${esc(r.chip)}</span>` : "–"}</td>
      <td class="n">${r.moveCount}</td>
      <td class="n">${r.hit ? `−${r.hit}` : "0"}</td>
      <td class="lx-moves">${moves}</td>
    </tr>`;
  }

  function renderTable(rows) {
    renderHead();
    const list = visibleRows(rows);
    let html = "";
    for (const r of list) {
      html += rowHtml(r);
      if (S.open.has(r.entry)) {
        html += `<tr class="lx-detail"><td colspan="${COLS.length}">${
          S.teamHtml.get(r.entry) ?? `<p class="lx-loading">Loading team…</p>`
        }</td></tr>`;
      }
    }
    $("lx-rows").innerHTML =
      html || `<tr><td colspan="${COLS.length}" class="lx-empty">No managers match this filter.</td></tr>`;
    $("lx-count").textContent = `${list.length} of ${rows.length} managers`;
  }

  function renderPager() {
    $("prev").hidden = S.pageNo <= 1;
    $("next").hidden = !S.hasNext;
    $("prev").onclick = () => location.assign(`/leagues?id=${S.leagueId}&page=${S.pageNo - 1}`);
    $("next").onclick = () => location.assign(`/leagues?id=${S.leagueId}&page=${S.pageNo + 1}`);
    const time = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    $("meta").textContent = `Page ${S.pageNo} · ${S.entries.length} managers · Updated ${time}`;
  }

  function renderAll() {
    S.rows = buildRows();
    renderHighlights(S.rows);
    renderTable(S.rows);
    renderPager();
  }

  // ---------- Team views ----------
  function closeTeam(entry) {
    S.open.delete(entry);
    renderAll();
  }

  async function openTeam(entry) {
    S.open.add(entry);
    renderAll();
    if (S.teamHtml.has(entry)) return;

    try {
      const picks = await api(`/picks/${entry}/${S.gw}`);
      const d = S.detail.get(entry);
      const live = window.FPL?.live?.() ?? new Map();
      const holder = document.createElement("div");
      window.TEAMVIEW.render(holder, picks, {
        snap: S.snap,
        live,
        hasLive: live.size > 0,
        gw: S.gw,
        gross: Number(d?.gross ?? picks.entry_history?.points ?? 0),
        rank: d?.overallRank ?? null,
        back: true,
      });
      S.teamHtml.set(entry, holder.innerHTML);
    } catch (err) {
      S.teamHtml.set(entry, `<p class="lx-loading">Could not load this team. ${esc(err.message)}</p>`);
    }
    if (S.open.has(entry)) renderAll();
  }

  // ---------- Loading ----------
  async function loadDetails(ids, token) {
    for (let i = 0; i < ids.length; i += BATCH) {
      if (token !== S.loadToken) return;
      try {
        const data = await api(`/managers?ids=${ids.slice(i, i + BATCH).join(",")}`);
        for (const m of data.managers ?? []) S.detail.set(m.entry, m);
      } catch {
        // Managers that fail keep their league figures, without captain or transfer detail.
      }
      if (token === S.loadToken) renderAll();
    }
  }

  async function loadLive(ids, token) {
    for (let i = 0; i < ids.length; i += BATCH) {
      if (token !== S.loadToken) return;
      const data = await api(`/livescore?ids=${ids.slice(i, i + BATCH).join(",")}`).catch(() => null);
      if (!data) continue;
      S.isLive = S.isLive || !!data.live;
      for (const r of data.rows ?? []) {
        const e = S.entries.find((x) => x.entry === r.entry);
        const base = e ? (Number(e.total) || 0) - (Number(e.gw) || 0) : 0;
        const net = (Number(r.gross) || 0) - (Number(r.hits) || 0);
        S.live.set(r.entry, {
          gross: Number(r.gross) || 0,
          exp: base + net + (Number(r.remaining?.exp) || 0),
        });
      }
      if (token === S.loadToken) renderAll();
    }
  }

  async function loadLeague(id, pageNo) {
    const token = ++S.loadToken;
    const data = await api(`/league/${id}?page=${pageNo}`);

    Object.assign(S, {
      leagueId: id,
      pageNo,
      hasNext: !!data.hasNext,
      entries: data.results ?? [],
      detail: new Map(),
      live: new Map(),
      isLive: false,
      open: new Set(),
      teamHtml: new Map(),
    });

    setHeader(data.league);
    renderAll();

    const ids = S.entries.map((e) => e.entry);
    await loadDetails(ids, token);
    await loadLive(ids, token);

    if (token === S.loadToken) {
      $("live-status").textContent = S.isLive
        ? "Matches are in play. Live figures update about once a minute."
        : "No matches in play right now. Live points appear during match windows.";
    }
  }

  function setHeader(name) {
    const label = name || "Mini-league";
    $("title").textContent = label;
    $("lg-label").textContent = name || "Leagues";
    $("gw-label").textContent = `Gameweek ${S.gw}`;
    document.title = `${label} · FPL`;
  }

  // ---------- CSV ----------
  function downloadCsv() {
    const quote = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = ["Name", "Team", "Live ML rank", "Change", "Live GW pts", "Live overall", "Total", "Captain", "Vice", "Active chip", "GW transfers", "Hit", "Transfers"];
    const lines = [head.map(quote).join(",")];

    for (const r of visibleRows(S.rows)) {
      const moves = r.moves.map((m) => `${nameOf(m.outId)} -> ${nameOf(m.inId)}`).join("; ");
      lines.push([
        r.manager,
        r.team,
        r.liveRank,
        r.change ?? "",
        r.gwPts,
        r.liveTotal,
        r.total,
        r.captain,
        r.vc,
        r.chip,
        r.moveCount,
        r.hit,
        moves,
      ].map(quote).join(","));
    }

    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `league-${S.leagueId || "table"}-gw${S.gw}.csv`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- Table controls ----------
  function wireTable() {
    $("lx-head").addEventListener("click", (e) => {
      const b = e.target.closest("[data-sort]");
      if (!b) return;
      const key = b.dataset.sort;
      if (S.sortKey === key) {
        S.sortDir = -S.sortDir;
      } else {
        const text = COLS.find((c) => c.key === key)?.text;
        S.sortKey = key;
        S.sortDir = key === "liveRank" || text ? 1 : -1;
      }
      renderAll();
    });

    $("lx-rows").addEventListener("click", (e) => {
      const view = e.target.closest("[data-view]");
      if (view) {
        const id = Number(view.dataset.view);
        if (S.open.has(id)) closeTeam(id);
        else openTeam(id);
        return;
      }
      const back = e.target.closest("[data-tv-back]");
      if (back) {
        const main = back.closest("tr.lx-detail")?.previousElementSibling;
        if (main?.dataset.row) closeTeam(Number(main.dataset.row));
      }
    });

    $("lx-filter").addEventListener("input", (e) => {
      S.filter = e.target.value;
      renderAll();
    });
    $("lx-csv").addEventListener("click", downloadCsv);
  }

  // ---------- Your leagues menu ----------
  function session() {
    try {
      return JSON.parse(localStorage.getItem("fpl.session"));
    } catch {
      return null;
    }
  }

  function setupMenu() {
    const btn = $("lg-btn");
    const menu = $("lg-menu");
    if (btn.dataset.ready) return;
    btn.dataset.ready = "1";

    const setOpen = (open) => {
      menu.hidden = !open;
      btn.setAttribute("aria-expanded", String(open));
    };
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      setOpen(menu.hidden);
    });
    document.addEventListener("click", (e) => {
      if (!menu.contains(e.target)) setOpen(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") setOpen(false);
    });
  }

  async function showMyLeagues() {
    const s = session();
    if (!s) return;
    try {
      const { leagues } = await api("/me/leagues", { headers: { Authorization: `Bearer ${s.token}` } });
      if (!leagues.length) return;
      const open = new URLSearchParams(location.search).get("id");
      $("mine-list").innerHTML = leagues
        .map(
          (l) => `<li><a href="/leagues?id=${l.id}" aria-current="${String(String(l.id) === open)}">${esc(l.name)}${
            l.rank ? ` <span class="muted">· rank ${Number(l.rank).toLocaleString()}</span>` : ""
          }</a></li>`,
        )
        .join("");
      $("mine").hidden = false;
      setupMenu();
    } catch {
      // Not signed in, or FPL is unavailable. The dropdown stays hidden.
    }
  }

  // ---------- Start ----------
  function initLeagues() {
    const params = new URLSearchParams(location.search);
    const id = (params.get("id") ?? "").trim();
    const pageNo = Math.max(1, Number(params.get("page")) || 1);
    $("id").value = id;

    $("find").addEventListener("submit", (e) => {
      e.preventDefault();
      const v = $("id").value.trim();
      if (ID.test(v)) location.assign(`/leagues?id=${v}`);
      else $("meta").textContent = "Enter a numeric league ID.";
    });

    showMyLeagues();
    renderAll();

    if (!id) {
      $("meta").textContent = "Enter a classic league ID, or pick one of your leagues.";
      $("lx-rows").innerHTML = `<tr><td colspan="${COLS.length}" class="lx-empty">Enter a league ID above to see its gameweek table.</td></tr>`;
      return;
    }
    if (!ID.test(id)) {
      $("meta").textContent = "Enter a numeric league ID.";
      return;
    }

    loadLeague(id, pageNo).catch((err) => {
      $("meta").textContent = err.message;
      $("lx-rows").innerHTML = `<tr><td colspan="${COLS.length}" class="lx-empty">${esc(err.message)}</td></tr>`;
    });
  }

  readyP.then((snap) => {
    if (!snap) return;
    S.snap = snap;
    S.names = new Map(snap.players.map((p) => [p.id, p.web_name]));
    const current = snap.events.find((e) => e.current) ?? snap.events.find((e) => e.next) ?? snap.events[0];
    S.gw = current?.id ?? 1;
    document.querySelectorAll('nav a[href="/leagues"]').forEach((a) => a.setAttribute("aria-current", "page"));
    wireTable();
    initLeagues();
  });
})();
