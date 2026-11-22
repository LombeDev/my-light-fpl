/* my-team.js: My team page. Gameweek summary at the top, the squad, Rank Gains, Popular transfers (Top 10k)
   and Main threats to your rank. Page key: team-view. Loads after app.js and team-view.js. */
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
  let around = null;
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

  // Club state this gameweek: finished, started (some fixtures begun), or sleep (not yet started).
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

  const progressOf = (p) => ((p.transfers_in - p.transfers_out) / RISE_NET) * 100;

  // ---------- Gameweek summary ----------
  // Figures are worked out from data the site has. Safety, off top 10k and off 3m need data we
  // do not store, so they show dashes. Pre and post substitution ranks use the overall rank.
  function summaryData() {
    const live = window.FPL?.live?.() ?? new Map();
    const xi = picks.picks.filter((x) => x.position <= 11);
    const bench = picks.picks.filter((x) => x.position > 11);

    const liveXi = xi.reduce((s, pk) => s + (live.get(pk.element)?.p ?? 0) * (pk.multiplier ?? 1), 0);
    const benchPts = bench.reduce((s, pk) => s + (live.get(pk.element)?.p ?? 0), 0);

    // Rank history from the overall rank for this gameweek and the previous one, from the snapshot's events.
    const rank = me.summary_overall_rank ?? null;
    const prevRank = (around?.rows ?? []).find((r) => r.you)?.rank ?? rank;

    // Star, Flop and Killer: each starter's points gain against the average of the managers around you.
    const avgGain = around?.rows?.length
      ? around.rows.reduce((s, r) => s + (r.gw ?? 0), 0) / around.rows.length
      : 0;
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

  const fmtNum = (n) => (n === null || n === undefined ? "–" : Number(n).toLocaleString());
  const fmtSigned = (n, suffix = "") => `${n > 0 ? "+" : ""}${Number(n).toLocaleString()}${suffix}`;

  function tile(label, value, extra = "") {
    return `<div class="gs-tile${extra}"><div class="gs-label">${label}</div><div class="gs-val">${value}</div></div>`;
  }

  function card(kind, label, icon, pick) {
    const img = pick
      ? (() => {
          const t = teamById.get(pick.p.team);
          const gk = pick.p.element_type === 1;
          return t?.code ? `<img src="${SHIRTS}/shirt_${t.code}${gk ? "_1" : ""}-66.png" alt="" loading="lazy">` : "";
        })()
      : "";
    const name = pick ? esc(pick.p.web_name) : "–";
    const figure = pick
      ? kind === "killer"
        ? `Loss: ${pick.pts.toFixed(2)} pts`
        : `Gain: ${pick.pts >= 0 ? "+" : ""}${pick.pts.toFixed(2)} pts`
      : "";
    return `<div class="gs-card is-${kind}">
      <div class="gs-cardhead"><span aria-hidden="true">${icon}</span> ${label}</div>
      <div class="gs-shirt">${img}</div>
      <div class="gs-name">${name}</div>
      <div class="gs-num">${pick ? pick.pts.toFixed(0) : "–"}</div>
      <div class="gs-fig">${figure}</div>
    </div>`;
  }

  function renderSummary() {
    const d = summaryData();
    const gainsTxt = fmtSigned(d.liveXi, "");
    const ranksTxt = fmtSigned(d.ranksGained);
    const topTxt = d.topPct === null ? "–" : `Top ${d.topPct.toFixed(1)}%`;
    const changeTxt = `${d.changePct >= 0 ? "+" : ""}${d.changePct.toFixed(2)}%`;

    $("gs-body").innerHTML = `
      <div class="gs-section-title"><span aria-hidden="true">🔢</span> Points gained: ${gainsTxt}</div>
      <div class="gs-grid">
        ${tile("GW live", fmtNum(d.liveXi))}
        ${tile("Total", fmtNum(d.total))}
        ${tile("Bench", fmtNum(d.benchPts))}
        ${tile("Safety", "–")}
        ${tile("Off top 10k", "–")}
        ${tile("Off 3m", "–")}
      </div>

      <div class="gs-section-title"><span aria-hidden="true">🌎</span> Ranks gained: ${ranksTxt}</div>
      <div class="gs-grid">
        ${tile("Pre-subs", fmtNum(d.rank))}
        ${tile("Old rank", fmtNum(d.prevRank))}
        ${tile("Change %", changeTxt, " is-green")}
        ${tile("Post-subs", fmtNum(d.rank))}
        ${tile("GW rank", fmtNum(d.rank))}
        ${tile("Rank %", topTxt)}
      </div>

      <div class="gs-cards">
        ${card("star", "Star", "☆", d.star)}
        ${card("flop", "Flop", "☹", d.flop)}
        ${card("killer", "Killer", "☠", d.killer)}
      </div>`;
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
        const mult = pk.multiplier ?? 1;
        const gain = Math.round(base * mult * each);
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
    const eachText = r.each ? r.each.toLocaleString() : "–";

    return `<div class="rg-row">
      <div class="rg-shirt">${img}</div>
      <div class="rg-main">
        <div class="rg-name">${esc(r.p.web_name)}</div>
        <div class="rg-each">Each pt: ${eachText} <span class="rg-dot" aria-hidden="true"></span></div>
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

  // ---------- Popular transfers (Top 10k) ----------
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
      .map((t) => {
        const net = t.net ?? 0;
        const cls = net > 0 ? "is-up" : net < 0 ? "is-down" : "is-zero";
        const sign = net > 0 ? "+" : "";
        return `<div class="pt-row">
          <span class="pt-pct">${t.pct.toFixed(2)}%</span>
          <span class="pt-from">${chip(byId.get(t.out))}<span class="pt-cnt">${t.outCount ?? ""}</span></span>
          <span class="pt-arrow" aria-hidden="true">→</span>
          <span class="pt-to">${chip(byId.get(t.in))}<span class="pt-cnt">${t.inCount ?? ""}</span></span>
          <span class="pt-num ${cls}">${sign}${net}</span>
        </div>`;
      })
      .join("");
  }

  // ---------- Main threats to your rank ----------
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
    $("th-pills").innerHTML = PILLS.map(
      ([key, label]) =>
        `<button type="button" class="th-pill${threatFilter === key ? " is-on" : ""}" data-filter="${key}" aria-pressed="${threatFilter === key}"><span class="th-dot" aria-hidden="true"></span>${label}</button>`,
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

  // ---------- Load and draw ----------
  async function load() {
    const auth = { headers: { Authorization: `Bearer ${session.token}` } };
    const [meRes, picksRes, mgrRes, sampleRes, aroundRes] = await Promise.all([
      api("/me", auth),
      api(`/picks/${session.entryId}/${gw}`).catch(() => null),
      api(`/managers?ids=${session.entryId}`).catch(() => null),
      api("/sample").catch(() => null),
      api(`/around/${session.entryId}`).catch(() => null),
    ]);
    me = meRes.entry;
    picks = picksRes;
    sample = sampleRes;
    around = aroundRes;
    gross = mgrRes?.managers?.[0]?.gross ?? picksRes?.entry_history?.points ?? 0;
    draw();
  }

  function draw() {
    const e = me;
    $("team-name").textContent = e.name;
    $("team-meta").textContent =
      `${e.player_first_name} ${e.player_last_name} · ${e.summary_overall_points} pts · rank ${
        e.summary_overall_rank ? Number(e.summary_overall_rank).toLocaleString() : "–"
      } · GW${gw}`;

    if (!picks) {
      $("content").innerHTML = `<p class="muted">Picks for gameweek ${gw} are not available yet.</p>`;
      $("gs-body").innerHTML = "";
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
      renderSummary();
    }

    renderRankGains();
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
