/* my-team.js: My team, laid out like the live rank and points page.
   Points, minutes and bonus come from the live feed while matches are on, and from /api/gwstats otherwise,
   so they stay correct after the match window closes. DC comes from the live feed only.
   Saves (SV pts) are not in FPL's public feed, so they show a dash.
   Each section runs on its own, so one failure does not stop the rest. Page key: team-view. */
(() => {
  if (document.body.dataset.page !== "team-view") return;

  const $ = (id) => document.getElementById(id);
  const set = (id, text) => {
    const el = $(id);
    if (el) el.textContent = text;
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const SHIRTS = "https://fantasy.premierleague.com/dist/img/shirts/standard";
  const POS = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };

  const st = {
    snap: null,
    session: null,
    gw: 1,
    me: null,
    picks: null,
    mgr: null,
    stats: null,
    byId: new Map(),
    teamById: new Map(),
  };

  const readyP = new Promise((resolve) =>
    document.addEventListener("fpl:ready", (e) => resolve(e.detail), { once: true }),
  );

  function safe(name, fn) {
    try {
      fn();
    } catch (err) {
      console.error(`${name} failed:`, err);
      set("mtl-note", `${name} could not load: ${err.message}`);
    }
  }

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

  function signOut() {
    localStorage.removeItem("fpl.session");
    location.assign("/login");
  }

  function setNavCurrent() {
    document.querySelectorAll('nav a[href="/team"]').forEach((a) => a.setAttribute("aria-current", "page"));
  }

  const liveMap = () => window.FPL?.live?.() ?? new Map();
  const nameOf = (id) => st.byId.get(id)?.web_name ?? "Unknown";
  const timeNow = () => new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  function clubStates() {
    const seen = new Map();
    for (const f of st.snap.fixtures) {
      if (f.gw !== st.gw) continue;
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

  function fixtureLabel(teamId) {
    if (!teamId || !st.snap?.fixtures) return "–";
    const list = st.snap.fixtures.filter(
      (f) => f.gw === st.gw && (f.home === teamId || f.away === teamId),
    );
    if (!list.length) return "BLANK";
    return list
      .map((f) => {
        const isHome = f.home === teamId;
        const oppId = isHome ? f.away : f.home;
        const oppShort = st.teamById.get(oppId)?.short ?? "???";
        return `${oppShort} (${isHome ? "H" : "A"})`;
      })
      .join(", ");
  }

  function figures(id, live) {
    const d = live.get(id);
    const s = st.stats?.get(id);
    if (d) {
      return { pts: d.p, minutes: d.m, bn: d.bn ?? 0, dc: d.dc ?? null };
    }
    if (s) {
      return { pts: s.pts ?? 0, minutes: s.minutes ?? 0, bn: s.bn ?? 0, dc: null };
    }
    return { pts: 0, minutes: 0, bn: 0, dc: null };
  }

  function rowData(pk, live, states) {
    const p = st.byId.get(pk.element);
    const f = figures(pk.element, live);
    const mult = pk.multiplier ?? 1;
    const fixState = p ? states.get(p.team) : undefined;

    let status;
    if (!p) status = "Unknown";
    else if (f.minutes > 0) status = fixState === "finished" ? "Played" : "Playing";
    else if (fixState === "finished") status = "Did not play";
    else if (fixState === undefined) status = "No fixture";
    else status = "Yet to play";

    return {
      p,
      pk,
      pts: f.pts,
      mult,
      total: f.pts * mult,
      bn: f.bn,
      dc: f.dc,
      status,
    };
  }

  // ---------- Live rank card ----------
  function renderRank(xi, live, states) {
    const me = st.me;
    const gwLive = xi.reduce((sum, pk) => sum + rowData(pk, live, states).total, 0);
    set("mtl-name", `${me.player_first_name ?? ""} ${me.player_last_name ?? ""}`.trim() || me.name);
    set("mtl-team", me.name);
    set("mtl-rank", me.summary_overall_rank ? Number(me.summary_overall_rank).toLocaleString() : "–");
    set("mtl-gwlive", String(gwLive));
    set("mtl-total", String(me.summary_overall_points ?? 0));
  }

  // ---------- Pitch & bench cards ----------
  function cardHtml(r) {
    const t = st.teamById.get(r.p.team);
    const gk = r.p.element_type === 1;
    const img = t?.code
      ? `<img src="${SHIRTS}/shirt_${t.code}${gk ? "_1" : ""}-110.png" alt="" loading="lazy">`
      : "";
    const badge = r.pk.is_captain
      ? `<span class="mtl-cap">C</span>`
      : r.pk.is_vice_captain
        ? `<span class="mtl-cap is-v">V</span>`
        : "";
    const statusBadge =
      r.bn >= 2
        ? `<span class="mtl-j-icon is-star" title="Bonus points">★</span>`
        : r.status === "Yet to play"
          ? `<span class="mtl-j-icon is-dice" title="Yet to play">⚄</span>`
          : "";

    const playedCls = r.status === "Played" || r.status === "Playing" ? " is-played" : "";
    const ownRaw = r.p.selected_by_percent ?? r.p.ownership ?? r.p.own;
    const ownText = ownRaw !== undefined && ownRaw !== null ? `${parseFloat(ownRaw).toFixed(1)}%` : "–";
    const fixText = fixtureLabel(r.p.team);

    return `<div class="mtl-p-card">
      <div class="mtl-p-shirt">
        ${badge}
        ${img}
        ${statusBadge}
      </div>
      <div class="mtl-p-pill">
        <div class="mtl-p-name">${esc(r.p.web_name)}</div>
        <div class="mtl-p-pts${playedCls}">${r.total}</div>
        <div class="mtl-p-split">
          <span class="mtl-p-own">${esc(ownText)}</span>
          <span class="mtl-p-fix">${esc(fixText)}</span>
        </div>
      </div>
    </div>`;
  }

  function renderPitch(xi, bench, live, states) {
    const groups = { GKP: [], DEF: [], MID: [], FWD: [] };

    for (const pk of xi) {
      const r = rowData(pk, live, states);
      const posKey = POS[r.p?.element_type];
      if (posKey && groups[posKey]) groups[posKey].push(r);
    }

    for (const [posKey, list] of Object.entries(groups)) {
      const el = $(`mtl-${posKey.toLowerCase()}`);
      if (el) el.innerHTML = list.map(cardHtml).join("");
    }

    const benchRows = bench.map((pk) => rowData(pk, live, states));
    $("mtl-bench").innerHTML = benchRows.length
      ? benchRows.map(cardHtml).join("")
      : `<p class="mtl-empty">No bench players to show.</p>`;
  }

  // ---------- Transfers ----------
  function renderTransfers() {
    const box = $("mtl-tr");
    const m = st.mgr;
    if (!m) {
      box.innerHTML = `<p class="mtl-empty">Transfers are not available yet.</p>`;
      return;
    }
    const moves = m.transfers ?? [];
    const ins = moves.map((t) => nameOf(t.inId));
    const outs = moves.map((t) => nameOf(t.outId));
    const hit = Number(m.hit) || 0;

    box.innerHTML = `<div class="mtl-trgrid">
      <div><span class="mtl-k">In</span><b>${ins.length}</b><small>${esc(ins.join(", ") || "None")}</small></div>
      <div><span class="mtl-k">Out</span><b>${outs.length}</b><small>${esc(outs.join(", ") || "None")}</small></div>
      <div><span class="mtl-k">Net pts (+/-)</span><b>${hit ? `−${hit}` : "0"}</b></div>
    </div>`;
  }

  // ---------- Gameweek summary (starting XI only) ----------
  function renderSummary(xi, live) {
    const box = $("mtl-sum");
    if (!st.stats) {
      box.innerHTML = `<p class="mtl-empty">The gameweek summary is not available yet.</p>`;
      return;
    }
    const ids = xi.map((pk) => pk.element);
    const isDefOrGk = (id) => {
      const p = st.byId.get(id);
      return !!p && (p.element_type === 1 || p.element_type === 2);
    };
    const sum = (key, filter = () => true) =>
      ids.reduce((total, id) => {
        const e = st.stats.get(id);
        return filter(id) && e ? total + (e[key] || 0) : total;
      }, 0);
    const dcTotal = ids.reduce((total, id) => total + (figures(id, live).dc ?? 0), 0);

    const items = [
      ["Goals", sum("gs")],
      ["Assists", sum("a")],
      ["Clean sheets (GK+DEF)", sum("cs", isDefOrGk)],
      ["DefCon pts", dcTotal],
      ["Bonus", sum("bn")],
      ["Pens missed / saved", `${sum("pm")}/${sum("ps")}`],
      ["Conceded (GK+DEF)", sum("gc", isDefOrGk)],
      ["Own goals", sum("og")],
      ["Yellow cards", sum("yc")],
      ["Red cards", sum("rc")],
    ];

    box.innerHTML = `<dl class="mtl-sumgrid">${items
      .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(String(v))}</dd></div>`)
      .join("")}</dl>`;
  }

  // ---------- Drawing ----------
  function draw() {
    set("mtl-updated", `Updated ${timeNow()}`);

    if (!st.picks) {
      set("mtl-note", "Your picks for this gameweek are not available yet.");
    }

    const live = liveMap();
    const states = clubStates();
    const xi = st.picks ? st.picks.picks.filter((pk) => pk.position <= 11) : [];
    const bench = st.picks
      ? st.picks.picks.filter((pk) => pk.position > 11).sort((a, b) => a.position - b.position)
      : [];

    safe("Live rank", () => renderRank(xi, live, states));
    safe("Pitch", () => renderPitch(xi, bench, live, states));
    safe("Transfers", renderTransfers);
    safe("Summary", () => renderSummary(xi, live));
  }

  // ---------- Loading ----------
  async function loadStats(gw) {
    try {
      const data = await api(`/gwstats/${gw}`);
      return new Map((data.elements ?? []).map((e) => [e.id, e]));
    } catch {
      return null;
    }
  }

  async function loadAll() {
    const auth = { headers: { Authorization: `Bearer ${st.session.token}` } };
    const [meRes, picksRes, mgrRes, stats] = await Promise.all([
      api("/me", auth),
      api(`/picks/${st.session.entryId}/${st.gw}`).catch(() => null),
      api(`/managers?ids=${st.session.entryId}`).catch(() => null),
      loadStats(st.gw),
    ]);
    st.me = meRes.entry;
    st.picks = picksRes;
    st.mgr = mgrRes?.managers?.[0] ?? null;
    st.stats = stats;
    set("mtl-note", "");
    draw();
  }

  async function refresh() {
    set("mtl-note", "Refreshing…");
    try {
      await loadAll();
    } catch (err) {
      if (err.status === 401) return signOut();
      set("mtl-note", `Could not load your team. ${err.message}`);
    }
  }

  // ---------- Wiring ----------
  function wire() {
    $("mtl-names").addEventListener("change", (e) => {
      $("mtl").classList.toggle("is-names-off", !e.target.checked);
    });
    $("mtl-refresh").addEventListener("click", refresh);
  }

  async function init() {
    setNavCurrent();
    wire();

    st.session = readSession();
    if (!st.session) {
      $("mtl-note").innerHTML = `Log in to see your team. <a href="/login">Log in</a>`;
      return;
    }

    await refresh();

    document.addEventListener("fpl:live", () => {
      if (st.me) safe("Live update", draw);
    });
  }

  readyP.then((snap) => {
    if (!snap) {
      set("mtl-note", "Could not load data. Try again shortly.");
      return;
    }
    st.snap = snap;
    st.byId = new Map(snap.players.map((p) => [p.id, p]));
    st.teamById = new Map(snap.teams.map((t) => [t.id, t]));
    const current = snap.events.find((e) => e.current) ?? snap.events.find((e) => e.next);
    st.gw = current?.id ?? 1;
    init();
  });
})();
