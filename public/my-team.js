/* my-team.js: My team page. The squad in the team view, then Popular transfers (Top 10k) and
   Main threats to your rank. Both lists come from the top-10k sample.
   Page key: team-view. Loads after app.js and team-view.js. */
(() => {
  if (document.body.dataset.page !== "team-view") return;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const SHIRTS = "https://fantasy.premierleague.com/dist/img/shirts/standard";
  const RISE_NET = 220000; // net transfers for a price move to reach 100%
  const PAGE = 10;

  const PILLS = [
    ["all", "All"],
    ["played", "Played"],
    ["playing", "Playing"],
    ["toplay", "To Play"],
    ["didnt", "Didn't Play"],
    ["bench", "In Your Bench"],
  ];

  let snap = null;
  let gw = 1;
  let session = null;
  let me = null;
  let picks = null;
  let gross = 0;
  let sample = null;
  let byId = new Map();
  let teamById = new Map();
  let posById = new Map();
  let threatFilter = "all";
  let threatShown = PAGE;

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

  // State of each club this gameweek: finished, started (some fixtures begun), or sleep (not yet started).
  // A club with no fixture this gameweek is absent from the map.
  function clubStates() {
    const seen = new Map();
    for (const f of snap.fixtures) {
      if (f.gw !== gw) continue;
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

  // Price progress toward the next change, signed. Positive means rising.
  const progressOf = (p) => ((p.transfers_in - p.transfers_out) / RISE_NET) * 100;

  // Players the sample owns that you don't start, sorted by points you would lose.
  // EO Δ = your ownership (100 if in your XI, 0 otherwise) minus the sample's effective ownership.
  function threatRows() {
    if (!sample?.sampled) return null;
    const live = window.FPL?.live?.() ?? new Map();
    const states = clubStates();
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

  // A small shirt and name for a player in the transfer list.
  function chip(p) {
    if (!p) return `<span class="pt-name">Unknown</span>`;
    const t = teamById.get(p.team);
    const img = t?.code ? `<img src="${SHIRTS}/shirt_${t.code}-66.png" alt="" loading="lazy">` : "";
    return `${img}<span class="pt-name">${esc(p.web_name)}</span>`;
  }

  function renderPopular() {
    const box = $("pop-body");
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
      .map(
        (t) => `<div class="pt-row">
          <span class="pt-pct">${t.pct.toFixed(2)}%</span>
          <span class="pt-from">${chip(byId.get(t.out))}</span>
          <span class="pt-arrow" aria-hidden="true">→</span>
          <span class="pt-to">${chip(byId.get(t.in))}</span>
          <span class="pt-num">${t.managers}</span>
        </div>`,
      )
      .join("");
  }

  function threatCell(r) {
    const up = r.progress >= 0;
    return `<span class="${up ? "up" : "down"}">${Math.abs(r.progress).toFixed(1)}% ${up ? "↑" : "↓"}</span>`;
  }

  function threatLine(r) {
    const t = teamById.get(r.p.team);
    const img = t?.code ? `<img class="th-shirt" src="${SHIRTS}/shirt_${t.code}-66.png" alt="" loading="lazy">` : "";
    return `<tr>
      <td class="th-namecol"><div class="th-name">${img}<div>
        <div class="th-pname">${esc(r.p.web_name)}</div>
        <div class="th-sub">${esc(t?.short ?? "")} • ${esc(posById.get(r.p.element_type) ?? "")}</div>
      </div></div></td>
      <td class="n down">${r.delta.toFixed(1)}%</td>
      <td class="n">${r.pts === null ? "–" : r.pts}</td>
      <td class="n">${r.lost === null ? "–" : r.lost.toFixed(1)}</td>
      <td class="n">${threatCell(r)}</td>
    </tr>`;
  }

  function renderThreats() {
    $("th-pills").innerHTML = PILLS.map(
      ([key, label]) =>
        `<button type="button" class="th-pill${threatFilter === key ? " is-on" : ""}" data-filter="${key}" aria-pressed="${threatFilter === key}">${label}</button>`,
    ).join("");

    const all = threatRows();
    if (all === null) {
      $("th-note").textContent = "Threats appear once the top 10k sample has data.";
      $("th-head").innerHTML = "";
      $("th-body").innerHTML = "";
      $("th-more").hidden = true;
      return;
    }

    $("th-note").textContent = "";
    $("th-head").innerHTML = `<tr>
      <th class="th-namecol">Player</th>
      <th class="n">EO Δ</th>
      <th class="n">Score</th>
      <th class="n">Pts Lost</th>
      <th class="n">Progress towards price rise/fall</th>
    </tr>`;

    const list = all.filter(matchesFilter);
    const shown = list.slice(0, threatShown);
    $("th-body").innerHTML = shown.length
      ? shown.map(threatLine).join("")
      : `<tr><td colspan="5">No players match.</td></tr>`;

    const btn = $("th-more");
    btn.hidden = list.length <= threatShown;
    btn.textContent = `Show more (${Math.max(0, list.length - threatShown)} left)`;
  }

  async function load() {
    const auth = { headers: { Authorization: `Bearer ${session.token}` } };
    const [meRes, picksRes, mgrRes, sampleRes] = await Promise.all([
      api("/me", auth),
      api(`/picks/${session.entryId}/${gw}`).catch(() => null),
      api(`/managers?ids=${session.entryId}`).catch(() => null),
      api("/sample").catch(() => null),
    ]);
    me = meRes.entry;
    picks = picksRes;
    sample = sampleRes;
    gross = mgrRes?.managers?.[0]?.gross ?? picksRes?.entry_history?.points ?? 0;
    draw();
  }

  function draw() {
    const e = me;
    $("team-name").textContent = e.name;
    $("team-meta").textContent =
      `${e.player_first_name} ${e.player_last_name} · ${e.summary_overall_points} pts · rank ${
        e.summary_overall_rank ? Number(e.summary_overall_rank).toLocaleString() : "–"
      }`;

    if (!picks) {
      $("content").innerHTML = `<p class="muted">Picks for gameweek ${gw} are not available yet.</p>`;
    } else {
      const live = window.FPL?.live?.() ?? new Map();
      window.TEAMVIEW.render($("content"), picks, {
        snap,
        live,
        hasLive: live.size > 0,
        gw,
        gross,
        rank: e.summary_overall_rank ?? null,
        back: false,
      });
    }

    renderPopular();
    renderThreats();
  }

  async function init() {
    setNavCurrent();
    session = readSession();
    if (!session) return location.assign("/login");

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

    try {
      await load();
      document.addEventListener("fpl:live", () => {
        if (me) draw();
      });
    } catch (err) {
      if (err.status === 401) return signOutToLogin();
      $("team-note").textContent = `Could not load your team. ${esc(err.message)}`;
    }
  }

  readyP.then((s) => {
    snap = s;
    if (!snap) {
      $("team-note").textContent = "Could not load data. Try again shortly.";
      return;
    }
    gw = (snap.events.find((e) => e.current) ?? snap.events.find((e) => e.next) ?? snap.events[0])?.id ?? 1;
    byId = new Map(snap.players.map((p) => [p.id, p]));
    teamById = new Map(snap.teams.map((t) => [t.id, t]));
    posById = new Map(snap.positions.map((p) => [p.id, p.short]));
    init();
  });
})();
