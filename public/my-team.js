/* my-team.js: My team in a three-column dashboard on desktop (standings, your team, and select team with feed
   and matches), stacked on phones. Standings show captain, chip, players in play and yet to start (from each
   manager's picks), and GW net. Points come from the live feed during matches, otherwise from /api/gwstats.
   Impact and in-play counts are our own estimates. Page key: team-view. Each section runs on its own. */
(() => {
  if (document.body.dataset.page !== "team-view") return;

  const $ = (id) => document.getElementById(id);
  const set = (id, text) => {
    const el = $(id);
    if (el) el.textContent = text;
  };
  const html = (id, markup) => {
    const el = $(id);
    if (el) el.innerHTML = markup;
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const SHIRTS = "https://fantasy.premierleague.com/dist/img/shirts/standard";
  const FALLBACK_LEAGUES = [{ id: 101712, name: "Kopala EPL" }];
  const PICK_BATCH = 5;

  const st = {
    snap: null,
    session: null,
    gw: 1,
    leagues: [],
    leagueId: null,
    standingsView: "standard",
    pitch: false,
    selPitch: false,
    tab: "imp",
    me: null,
    picks: null,
    mgr: null,
    stats: null,
    rows: [],
    managersById: new Map(),
    picksByEntry: new Map(),
    selected: null,
    selPicks: null,
    selMgr: null,
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
      set("fg-note", `${name} could not load: ${err.message}`);
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
  const ownOf = (p) => {
    const v = parseFloat(p?.selected_by_percent);
    return Number.isFinite(v) ? v : 0;
  };
  const short = (teamId) => st.teamById.get(teamId)?.short ?? "";
  const isMine = (entry) => String(entry) === String(st.session?.entryId ?? "");

  function kickoffLabel(iso) {
    if (!iso) return "TBC";
    const d = new Date(iso);
    const day = d.toLocaleDateString("en-GB", { weekday: "short" });
    return `${day} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
  }

  function fixturesForGw() {
    if (!st.snap?.fixtures) return [];
    return st.snap.fixtures.filter((f) => f.gw === st.gw);
  }

  function fixtureFor(teamId) {
    return (
      fixturesForGw()
        .filter((f) => f.home === teamId || f.away === teamId)
        .sort((a, b) => (a.kickoff ?? "~").localeCompare(b.kickoff ?? "~"))[0] ?? null
    );
  }

  // "finished", "started" (a match is on), "sleep" (not kicked off), or "none" (no fixture this gameweek).
  function clubState(teamId) {
    const list = fixturesForGw().filter((f) => f.home === teamId || f.away === teamId);
    if (!list.length) return "none";
    if (list.every((f) => f.finished)) return "finished";
    if (list.some((f) => f.started && !f.finished)) return "started";
    return "sleep";
  }

  // Points for a player this gameweek. The live feed is used during matches, otherwise the stored gameweek stats.
  function figures(id, live) {
    const d = live.get(id);
    const s = st.stats?.get(id);
    if (d) return { pts: d.p, minutes: d.m, bn: d.bn ?? 0, dc: d.dc ?? null };
    if (s) return { pts: s.pts ?? 0, minutes: s.minutes ?? 0, bn: s.bn ?? 0, dc: null };
    return { pts: 0, minutes: 0, bn: 0, dc: null };
  }

  function statusOf(p, live) {
    const f = figures(p.id, live);
    const cs = clubState(p.team);
    if (f.minutes > 0 && cs === "finished") return { label: `Done (${f.minutes}) (P)`, cls: "is-done" };
    if (f.minutes > 0) return { label: `Playing (${f.minutes}')`, cls: "is-live" };
    if (cs === "finished") return { label: "Did not play", cls: "is-dnp" };
    if (cs === "none") return { label: "No fixture", cls: "is-dnp" };
    return { label: kickoffLabel(fixtureFor(p.team)?.kickoff), cls: "" };
  }

  function impOf(p, inTeam) {
    return inTeam ? 100 - ownOf(p) : -ownOf(p);
  }

  // The bar's width is set in JavaScript after render, because inline style attributes are blocked by the CSP.
  function impCell(v) {
    const w = Math.min(100, Math.abs(v));
    const cls = v >= 0 ? "is-pos" : "is-neg";
    return `<div class="fg-imp"><div class="fg-imp-track"><i class="${cls}" data-w="${w.toFixed(1)}"></i></div><span>${v > 0 ? "+" : ""}${Math.round(v)}%</span></div>`;
  }

  function applyWidths(root) {
    (root ?? document).querySelectorAll("[data-w]").forEach((el) => {
      el.style.width = `${el.dataset.w}%`;
    });
  }

  function badgeFor(pk) {
    if (pk?.is_captain) return `<span class="fg-cv">C</span>`;
    if (pk?.is_vice_captain) return `<span class="fg-cv is-v">V</span>`;
    return "";
  }

  function shirtFor(p) {
    const t = st.teamById.get(p.team);
    const gk = p.element_type === 1;
    return t?.code
      ? `<img class="fg-shirt" src="${SHIRTS}/shirt_${t.code}${gk ? "_1" : ""}-66.png" alt="" loading="lazy">`
      : "";
  }

  function squadOf(picks) {
    const list = picks?.picks ?? [];
    return {
      xi: list.filter((pk) => pk.position <= 11).sort((a, b) => a.position - b.position),
      bench: list.filter((pk) => pk.position > 11).sort((a, b) => a.position - b.position),
    };
  }

  function gwPointsOf(squad, live) {
    return squad.xi.reduce((sum, pk) => sum + figures(pk.element, live).pts * (pk.multiplier ?? 1), 0);
  }

  // Players in the starting XI whose match is on, and those whose match has not started.
  function playingCounts(entry) {
    const picks = st.picksByEntry.get(Number(entry));
    if (!picks) return null;
    let inPlay = 0;
    let toStart = 0;
    for (const pk of squadOf(picks).xi) {
      const p = st.byId.get(pk.element);
      if (!p) continue;
      const cs = clubState(p.team);
      if (cs === "started") inPlay += 1;
      else if (cs === "sleep") toStart += 1;
    }
    return { inPlay, toStart };
  }

  // One table row. Options: pk (for captain badge and multiplier), imp (number), impText (custom), dim.
  function rowHtml(p, live, opts = {}) {
    if (!p) return "";
    const f = figures(p.id, live);
    const s = statusOf(p, live);
    const mult = opts.pk?.multiplier ?? 1;
    const impHtml = opts.impText ?? impCell(opts.imp ?? 0);
    return `<tr class="${opts.dim ? "fg-dim" : ""}">
      <td><div class="fg-player">${shirtFor(p)}<span class="fg-name">${esc(p.web_name)}</span>${badgeFor(opts.pk)}</div></td>
      <td><span class="fg-status ${s.cls}">${esc(s.label)}</span></td>
      <td class="fg-num"><b>${f.pts * mult}</b></td>
      <td>${impHtml}</td>
    </tr>`;
  }

  // Pitch markup for any squad: goalkeeper to forward, then the bench.
  function pitchMarkup(squad, live) {
    const groups = { 1: [], 2: [], 3: [], 4: [] };
    for (const pk of squad.xi) {
      const p = st.byId.get(pk.element);
      if (p) groups[p.element_type].push({ pk, p });
    }

    const card = ({ pk, p }) => {
      const pts = figures(p.id, live).pts * (pk?.multiplier ?? 1);
      return `<div class="fg-pcard">
        ${shirtFor(p)}
        <div class="fg-pname">${esc(p.web_name)} ${badgeFor(pk)}</div>
        <div class="fg-ppts">${pts}</div>
      </div>`;
    };

    const field = [1, 2, 3, 4].map((t) => `<div class="fg-prow">${groups[t].map(card).join("")}</div>`).join("");
    const bench = squad.bench
      .map((pk) => {
        const p = st.byId.get(pk.element);
        return p ? card({ pk: null, p }) : "";
      })
      .join("");

    return `<div class="fg-field">${field}</div>
       <div class="fg-bench-label">Bench</div>
       <div class="fg-prow fg-prow-bench">${bench}</div>`;
  }

  // ---------- Header: team, summary and boxes ----------
  function renderHeader(squad, live) {
    const me = st.me;
    if (!me) return;
    set("fg-team-name", me.name);
    set("fg-mgr-name", `${me.player_first_name ?? ""} ${me.player_last_name ?? ""}`.trim());

    const gross = gwPointsOf(squad, live);
    const hit = Number(st.mgr?.hit) || 0;
    const moves = st.mgr?.transfers ?? [];
    const chip = st.picks?.active_chip ?? st.mgr?.chip ?? "";
    const value = st.mgr?.value ?? null;
    const rank = me.summary_overall_rank ? Number(me.summary_overall_rank).toLocaleString() : "–";

    set("fg-gw-net", String(gross - hit));
    set("fg-safety", "–");

    html(
      "fg-info",
      [
        ["Total points", me.summary_overall_points ?? "–"],
        ["GW points", gross],
        ["Transfers", `${moves.length}${hit ? ` (−${hit})` : ""}`],
        ["Live rank", rank],
        ["Chip", chip ? String(chip).toUpperCase() : "None"],
        ["Team value", value === null ? "–" : `£${(value / 10).toFixed(1)}m`],
      ]
        .map(([k, v]) => `<div class="fg-kv"><span>${esc(k)}</span><b>${esc(String(v))}</b></div>`)
        .join(""),
    );
  }

  // ---------- Your player table: starting XI, then bench ----------
  function renderTable(squad, live) {
    if (!st.picks) {
      html("fg-table-body", `<tr><td colspan="4" class="fg-empty">Picks for this gameweek are not available yet.</td></tr>`);
      return;
    }
    const xi = squad.xi
      .map((pk) => {
        const p = st.byId.get(pk.element);
        return rowHtml(p, live, { pk, imp: impOf(p, true) });
      })
      .join("");
    const bench = squad.bench
      .map((pk) => {
        const p = st.byId.get(pk.element);
        return rowHtml(p, live, { imp: impOf(p, true), dim: true });
      })
      .join("");
    html("fg-table-body", `${xi}<tr class="fg-divider"><td colspan="4">Bench</td></tr>${bench}`);
    applyWidths($("fg-table-body"));
  }

  function renderPitch(squad, live) {
    html("fg-pitch", pitchMarkup(squad, live));
  }

  function applyPitchToggle() {
    const tableWrap = $("fg-table-wrap");
    const pitch = $("fg-pitch");
    const tabs = document.querySelector(".fg-tabs");
    const lower = tabs?.nextElementSibling;
    if (tableWrap) tableWrap.hidden = st.pitch;
    if (pitch) pitch.hidden = !st.pitch;
    if (tabs) tabs.hidden = st.pitch;
    if (lower) lower.hidden = st.pitch;
  }

  // ---------- Other important players / transfer suggestions ----------
  function renderLower(squad, live) {
    const inTeam = new Set([...squad.xi, ...squad.bench].map((pk) => pk.element));
    const others = st.snap.players.filter((p) => !inTeam.has(p.id));

    let rows;
    if (st.tab === "transfers") {
      const net = (p) => (Number(p.transfers_in) || 0) - (Number(p.transfers_out) || 0);
      rows = others
        .slice()
        .sort((a, b) => net(b) - net(a))
        .slice(0, 10)
        .map((p) => {
          const n = net(p);
          const text = `<span class="fg-net">${n > 0 ? "+" : ""}${n.toLocaleString()} net</span>`;
          return rowHtml(p, live, { impText: text });
        });
    } else {
      rows = others
        .slice()
        .sort((a, b) => ownOf(b) - ownOf(a))
        .slice(0, 10)
        .map((p) => rowHtml(p, live, { imp: impOf(p, false) }));
    }

    html("fg-lower-body", rows.join("") || `<tr><td colspan="4" class="fg-empty">No players to show.</td></tr>`);
    applyWidths($("fg-lower-body"));

    document.querySelectorAll(".fg-tab").forEach((b) => {
      b.setAttribute("aria-selected", String(b.dataset.tab === st.tab));
    });
  }

  // ---------- League standings ----------
  function renderStandings() {
    if (!st.rows.length) {
      html("fg-standings", `<p class="fg-empty">League standings are not available right now.</p>`);
      return;
    }
    const compact = st.standingsView === "compact";
    const selected = st.selected === null ? null : Number(st.selected);

    const body = st.rows
      .map((r, i) => {
        const m = st.managersById.get(r.entry);
        const counts = playingCounts(r.entry);
        const cap = m ? nameOf(m.captainId) : "–";
        const chip = m?.chip ?? "";
        const gwNet = m ? (Number(m.gross) || 0) - (Number(m.hit) || 0) : Number(r.gw) || 0;
        const pos = r.rank ?? i + 1;
        const classes = [isMine(r.entry) ? "is-mine" : "", selected === Number(r.entry) ? "is-selected" : ""]
          .filter(Boolean)
          .join(" ");
        return `<tr class="${classes}" data-entry="${r.entry}" tabindex="0">
          <td class="fg-num">${pos}</td>
          <td>
            <div class="fg-team">${esc(r.team)}</div>
            ${compact ? "" : `<div class="fg-sub">${esc(r.manager)}</div>`}
          </td>
          ${compact ? "" : `<td>${esc(cap)}</td>`}
          ${compact ? "" : `<td>${chip ? `<span class="fg-chip">${esc(String(chip).toUpperCase())}</span>` : ""}</td>`}
          ${compact ? "" : `<td class="fg-num">${counts ? counts.inPlay : "–"}</td>`}
          ${compact ? "" : `<td class="fg-num">${counts ? counts.toStart : "–"}</td>`}
          <td class="fg-num">${gwNet}</td>
          <td class="fg-num">–</td>
          <td class="fg-num"><b>${Number(r.total) || 0}</b></td>
        </tr>`;
      })
      .join("");

    html(
      "fg-standings",
      `<table class="fg-table fg-standings-table">
        <thead><tr>
          <th class="fg-num">#</th><th>Team</th>
          ${compact ? "" : "<th>Captain</th><th>Chip</th><th class=\"fg-num\">In play</th><th class=\"fg-num\">To start</th>"}
          <th class="fg-num">GW</th><th class="fg-num">Month</th><th class="fg-num">Total</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>`,
    );
  }

  // Fetches each listed manager's picks, a few at a time, so the In play and To start columns fill in.
  async function loadStandingPicks() {
    const gw = st.gw;
    const need = st.rows.map((r) => r.entry).filter((id) => !st.picksByEntry.has(Number(id)));
    for (let i = 0; i < need.length; i += PICK_BATCH) {
      if (gw !== st.gw) return;
      const batch = need.slice(i, i + PICK_BATCH);
      await Promise.all(
        batch.map(async (id) => {
          const picks = await api(`/picks/${id}/${gw}`).catch(() => null);
          st.picksByEntry.set(Number(id), picks);
        }),
      );
      if (gw === st.gw) safe("Standings", renderStandings);
    }
  }

  // ---------- Select team (the opponent or any team you click) ----------
  function renderSelect(live) {
    const toggle = $("fg-select-toggle");
    if (toggle) toggle.checked = st.selPitch;
    const table = $("fg-select");
    const pitch = $("fg-select-pitch");

    if (!st.selected) {
      html("fg-select", `<p class="fg-empty">Click a team in the league to compare it with yours.</p>`);
      if (pitch) pitch.hidden = true;
      if (table) table.hidden = false;
      return;
    }
    if (!st.selPicks) {
      html("fg-select", `<p class="fg-empty">Loading team…</p>`);
      if (pitch) pitch.hidden = true;
      if (table) table.hidden = false;
      return;
    }

    const squad = squadOf(st.selPicks);
    const m = st.selMgr;
    const pts = gwPointsOf(squad, live);
    const name = m?.name ?? "Team";
    const mgr = m?.playerName ?? "";
    const rows = squad.xi.map((pk) => rowHtml(st.byId.get(pk.element), live, { pk, impText: `<span class="fg-net">–</span>` })).join("");

    html(
      "fg-select",
      `<div class="fg-kvs">
        <div class="fg-kv"><span>Team</span><b>${esc(name)}</b></div>
        <div class="fg-kv"><span>Manager</span><b>${esc(mgr)}</b></div>
        <div class="fg-kv"><span>GW points</span><b>${pts}</b></div>
      </div>
      <table class="fg-table">
        <thead><tr><th>Player</th><th>Status</th><th class="fg-num">Pts</th><th>Imp</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`,
    );
    html("fg-select-pitch", `<div class="fg-kvs"><div class="fg-kv"><span>Team</span><b>${esc(name)}</b></div></div>${pitchMarkup(squad, live)}`);
    if (table) table.hidden = st.selPitch;
    if (pitch) pitch.hidden = !st.selPitch;
  }

  // ---------- My feed: this gameweek's events for your starting XI ----------
  function renderFeed(squad) {
    const events = [];
    for (const pk of squad.xi) {
      const p = st.byId.get(pk.element);
      const s = st.stats?.get(p?.id);
      if (!p || !s) continue;
      const fx = fixtureFor(p.team);
      const when = fx?.kickoff ?? "";
      const team = short(p.team);
      const add = (label) => events.push({ when, player: p.web_name, team, label });

      if (s.gs) add(s.gs > 1 ? `Goal ×${s.gs}` : "Goal");
      if (s.a) add(s.a > 1 ? `Assist ×${s.a}` : "Assist");
      if (s.bn) add(`${s.bn} bonus pts`);
      if (s.yc) add(s.yc > 1 ? `Yellow ×${s.yc}` : "Yellow card");
      if (s.rc) add("Red card");
      if (s.og) add(s.og > 1 ? `Own goal ×${s.og}` : "Own goal");
      if (s.cs && p.element_type <= 2) add("Clean sheet");
    }

    events.sort((a, b) => (b.when || "").localeCompare(a.when || ""));
    html(
      "fg-feed",
      events.length
        ? events
            .map(
              (e) => `<div class="fg-feed-row">
                <span class="fg-time">${esc(kickoffLabel(e.when))}</span>
                <div><div class="fg-name">${esc(e.player)}</div><div class="fg-sub">${esc(e.team)}</div></div>
                <span class="fg-event">${esc(e.label)}</span>
              </div>`,
            )
            .join("")
        : `<p class="fg-empty">No events yet this gameweek.</p>`,
    );
  }

  // ---------- Matches for this gameweek ----------
  function renderMatches() {
    const fx = fixturesForGw().sort((a, b) => (a.kickoff ?? "~").localeCompare(b.kickoff ?? "~"));
    if (!fx.length) {
      html("fg-matches", `<p class="fg-empty">No fixtures found.</p>`);
      return;
    }
    const row = (f) => {
      const score = f.started ? `${f.home_score ?? 0} - ${f.away_score ?? 0}` : "? - ?";
      const tag = f.finished
        ? `<span class="fg-tag is-done">Done (P)</span>`
        : f.started
          ? `<span class="fg-tag is-live">Live</span>`
          : `<span class="fg-tag">${esc(kickoffLabel(f.kickoff))}</span>`;
      return `<div class="fg-match">
        <span class="fg-mhome">${esc(short(f.home))}</span>
        <span class="fg-score">${esc(score)}</span>
        <span class="fg-maway">${esc(short(f.away))}</span>
        ${tag}
      </div>`;
    };
    const played = fx.filter((f) => f.started);
    const upcoming = fx.filter((f) => !f.started);
    html(
      "fg-matches",
      `${played.length ? `<div class="fg-group">Live / Finished</div>${played.map(row).join("")}` : ""}
       ${upcoming.length ? `<div class="fg-group">Upcoming</div>${upcoming.map(row).join("")}` : ""}`,
    );
  }

  // ---------- League and gameweek selectors ----------
  function renderSelectors() {
    html(
      "fg-league",
      st.leagues
        .map((l) => `<option value="${l.id}"${String(l.id) === String(st.leagueId) ? " selected" : ""}>${esc(l.name)}</option>`)
        .join(""),
    );
    html(
      "fg-gw",
      (st.snap?.events ?? [])
        .map((ev) => `<option value="${ev.id}"${ev.id === st.gw ? " selected" : ""}>GW ${ev.id}</option>`)
        .join(""),
    );
  }

  // ---------- Drawing ----------
  function draw() {
    const live = liveMap();
    const squad = squadOf(st.picks);
    set("fg-note", st.picks ? "" : "Your picks for this gameweek are not available yet.");

    safe("Header", () => renderHeader(squad, live));
    safe("Table", () => renderTable(squad, live));
    safe("Pitch", () => renderPitch(squad, live));
    safe("Lower list", () => renderLower(squad, live));
    safe("Standings", renderStandings);
    safe("Select team", () => renderSelect(live));
    safe("Feed", () => renderFeed(squad));
    safe("Matches", renderMatches);
    safe("Selectors", renderSelectors);
    applyPitchToggle();
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

  async function loadLeagues() {
    try {
      const { leagues } = await api("/me/leagues", { headers: { Authorization: `Bearer ${st.session.token}` } });
      st.leagues = leagues?.length ? leagues.map((l) => ({ id: l.id, name: l.name })) : FALLBACK_LEAGUES;
    } catch {
      st.leagues = FALLBACK_LEAGUES;
    }
    if (!st.leagueId || !st.leagues.some((l) => String(l.id) === String(st.leagueId))) {
      st.leagueId = st.leagues[0].id;
    }
  }

  async function loadStandings() {
    if (!st.leagueId) return;
    try {
      const data = await api(`/league/${st.leagueId}?page=1`);
      st.rows = data.results ?? [];
      const need = st.rows.map((r) => r.entry).filter((id) => !st.managersById.has(id));
      for (let i = 0; i < need.length; i += 10) {
        const batch = need.slice(i, i + 10);
        const d = await api(`/managers?ids=${batch.join(",")}`).catch(() => null);
        for (const m of d?.managers ?? []) st.managersById.set(m.entry, m);
      }
    } catch (err) {
      st.rows = [];
      set("fg-note", `Standings could not load. ${err.message}`);
    }
  }

  async function loadSelected() {
    if (!st.selected) return;
    const id = Number(st.selected);
    st.selPicks = st.picksByEntry.get(id) ?? null;
    st.selMgr = null;
    draw();
    const [picks, mgr] = await Promise.all([
      st.selPicks ? Promise.resolve(st.selPicks) : api(`/picks/${id}/${st.gw}`).catch(() => null),
      st.managersById.get(id) ?? api(`/managers?ids=${id}`).then((d) => d.managers?.[0] ?? null).catch(() => null),
    ]);
    if (Number(st.selected) !== id) return;
    const row = st.rows.find((r) => Number(r.entry) === id);
    st.selPicks = picks;
    st.picksByEntry.set(id, picks);
    st.selMgr = mgr ? { ...mgr, name: row?.team ?? "", playerName: row?.manager ?? "" } : null;
    draw();
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
    st.picksByEntry.set(Number(st.session.entryId), picksRes);
    st.mgr = mgrRes?.managers?.[0] ?? null;
    st.stats = stats;
    await loadStandings();
    draw();
    if (st.selected) await loadSelected();
    loadStandingPicks();
  }

  async function refresh() {
    set("fg-note", "Refreshing…");
    try {
      await loadAll();
    } catch (err) {
      if (err.status === 401) return signOut();
      set("fg-note", `Could not load your team. ${err.message}`);
    }
  }

  function selectEntry(entry) {
    st.selected = Number(entry);
    st.selPicks = null;
    loadSelected();
  }

  // ---------- Wiring ----------
  function wire() {
    $("fg-pitch-toggle")?.addEventListener("change", (e) => {
      st.pitch = e.target.checked;
      applyPitchToggle();
    });

    $("fg-select-toggle")?.addEventListener("change", (e) => {
      st.selPitch = e.target.checked;
      safe("Select team", () => renderSelect(liveMap()));
    });

    $("fg-view")?.addEventListener("change", (e) => {
      st.standingsView = e.target.value;
      safe("Standings", renderStandings);
    });

    $("fg-league")?.addEventListener("change", async (e) => {
      st.leagueId = e.target.value;
      st.managersById = new Map();
      st.rows = [];
      st.selected = null;
      st.selPicks = null;
      await loadStandings();
      safe("Standings", renderStandings);
      safe("Selectors", renderSelectors);
      loadStandingPicks();
    });

    $("fg-gw")?.addEventListener("change", async (e) => {
      const v = Number(e.target.value);
      if (!v) return;
      st.gw = v;
      st.managersById = new Map();
      st.picksByEntry = new Map();
      st.selected = null;
      st.selPicks = null;
      await refresh();
    });

    $("fg-refresh")?.addEventListener("click", refresh);

    $("fg-opp-btn")?.addEventListener("click", () => {
      if (!st.selected) {
        const first = st.rows.find((r) => !isMine(r.entry));
        if (first) selectEntry(first.entry);
      }
      $("fg-select-col")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    const moreBtn = $("fg-more-btn");
    const moreMenu = $("fg-more-menu");
    moreBtn?.addEventListener("click", () => {
      const open = moreMenu.hidden;
      moreMenu.hidden = !open;
      moreBtn.setAttribute("aria-expanded", String(open));
    });
    document.addEventListener("click", (e) => {
      if (!moreMenu || moreMenu.hidden) return;
      if (!e.target.closest(".fg-dd")) {
        moreMenu.hidden = true;
        moreBtn.setAttribute("aria-expanded", "false");
      }
    });

    document.querySelectorAll(".fg-tab").forEach((b) =>
      b.addEventListener("click", () => {
        st.tab = b.dataset.tab;
        safe("Lower list", () => renderLower(squadOf(st.picks), liveMap()));
      }),
    );

    // Clicking a row (or pressing Enter on it) opens that team in the Select team panel.
    $("fg-standings")?.addEventListener("click", (e) => {
      const row = e.target.closest("tr[data-entry]");
      if (row) selectEntry(row.dataset.entry);
    });
    $("fg-standings")?.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const row = e.target.closest("tr[data-entry]");
      if (row) selectEntry(row.dataset.entry);
    });

    document.addEventListener("fpl:live", () => {
      if (st.me) safe("Live update", draw);
    });
  }

  async function init() {
    setNavCurrent();
    wire();

    st.session = readSession();
    if (!st.session) {
      html("fg-note", `Log in to see your team. <a href="/login">Log in</a>`);
      return;
    }

    await loadLeagues();
    await refresh();
  }

  readyP.then((snap) => {
    if (!snap) {
      set("fg-note", "Could not load data. Try again shortly.");
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
