/* app.js: nav, spinner, snapshot cache, shirts, pitch cards, live updates, players, fixtures, ticker, my team, login. */
(() => {
  const page = document.body.dataset.page;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const money = (tenths) => `£${(tenths / 10).toFixed(1)}m`;
  const MIN = 60_000;
  const SESSION = "fpl.session";
  const SNAP = "fpl.snapshot";
  const HASH = "fpl.hash";
  const SHIRTS = "https://fantasy.premierleague.com/dist/img/shirts/standard";

  // ---------- Spinner ----------
  const spinner = document.createElement("div");
  spinner.className = "spinner";
  spinner.setAttribute("role", "status");
  spinner.setAttribute("aria-label", "Loading");
  document.body.append(spinner);

  // Counts in-flight API requests. Background checks (live, version) are ignored.
  let pending = 0;
  const setBusy = (delta) => {
    pending = Math.max(0, pending + delta);
    document.body.classList.toggle("busy", pending > 0);
  };

  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    const tracked = url.includes("/api/") && !/\/api\/(live|version)/.test(url);
    if (!tracked) return realFetch(input, init);
    setBusy(1);
    return realFetch(input, init).finally(() => setBusy(-1));
  };

  // ---------- Session ----------
  const expiry = (token) => {
    try {
      return JSON.parse(atob(token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/"))).exp;
    } catch {
      return 0;
    }
  };

  let session = null;
  try {
    session = JSON.parse(localStorage.getItem(SESSION));
  } catch {}
  if (session && Date.now() / 1000 >= expiry(session.token)) {
    localStorage.removeItem(SESSION);
    session = null;
  }

  const signOut = () => {
    localStorage.removeItem(SESSION);
    location.assign("/login");
  };

  // ---------- Nav ----------
  const LINKS = [
    { href: "/games", label: "Games", key: "games" },
    { href: "/prices", label: "Prices", key: "prices" },
    { href: "/stats", label: "Stats", key: "stats" },
    { href: "/planner", label: "Planner", key: "planner" },
    { href: "/leagues", label: "Leagues", key: "leagues" },
    { href: "/team", label: "My team", key: "team", signedIn: true },
    { href: "/login", label: "Log in", key: "login", signedIn: false },
  ];

  function renderNav() {
    const nav = $("nav");
    if (!nav) return;
    const here = page === "manager" ? "leagues" : page;
    const links = LINKS.filter((l) => l.signedIn === undefined || l.signedIn === !!session)
      .map((l) => `<a href="${l.href}"${here === l.key ? ' aria-current="page"' : ""}>${l.label}</a>`)
      .join("");
    nav.innerHTML = links + (session ? `<button type="button" id="signout">Sign out</button>` : "");
    $("signout")?.addEventListener("click", signOut);
  }

  // ---------- API ----------
  async function api(path, options = {}) {
    const res = await fetch(`/api${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // Serve the cached snapshot when the server's version hash has not changed.
  async function loadSnapshot() {
    const cached = localStorage.getItem(SNAP);
    if (cached) {
      try {
        const v = await api("/version");
        if (v.hash === localStorage.getItem(HASH)) return JSON.parse(cached);
      } catch {
        return JSON.parse(cached); // offline or server down: show what we have
      }
    }
    const snap = await api("/snapshot");
    try {
      localStorage.setItem(SNAP, JSON.stringify(snap));
      localStorage.setItem(HASH, snap.hash);
    } catch {
      /* storage full: continue without caching */
    }
    return snap;
  }

  const currentGw = (snap) =>
    (snap.events.find((e) => e.current) ?? snap.events.find((e) => e.next) ?? snap.events[0])?.id ?? 1;

  // ---------- Shirts and difficulty ----------
  let teamInfo = new Map();
  let playerInfo = new Map();

  const shirtImg = (code, goalkeeper = false) =>
    `<img class="shirt" src="${SHIRTS}/shirt_${code}${goalkeeper ? "_1" : ""}-66.png" alt="" loading="lazy">`;

  const teamHtml = (id) => {
    const t = teamInfo.get(id);
    if (!t) return "";
    return `${t.code ? shirtImg(t.code) : ""}<span>${esc(t.short)}</span>`;
  };

  const playerHtml = (id) => {
    const p = playerInfo.get(id);
    if (!p) return "";
    const t = teamInfo.get(p.team);
    const img = t?.code ? shirtImg(t.code, p.element_type === 1) : "";
    return `${img}<span>${esc(p.web_name)}</span>`;
  };

  // FDR class, from 1 (easiest) to 5 (hardest). Returns "" when there is no rating.
  const fdr = (d) => (d >= 1 && d <= 5 ? `fdr-${Math.round(d)}` : "");

  // ---------- Pitch cards ----------
  // Shirt, name bar with (C) or (V), green effective-ownership bar, grey points bar.
  // Bench players use black bars. Pass null for eo or pts to show a dash.
  const STATUS_ICON = { i: "🤕", s: "🟥", d: "❔", u: "⛔" };

  function pitchCard({ id, badge = "", eo = null, pts = null, bench = false }) {
    const p = playerInfo.get(id);
    if (!p) return "";
    const t = teamInfo.get(p.team);
    const gk = p.element_type === 1;
    const shirt = t?.code
      ? `<img class="pshirt" src="${SHIRTS}/shirt_${t.code}${gk ? "_1" : ""}-66.png" alt="" loading="lazy">`
      : "";
    const icon = STATUS_ICON[p.status] ? `<span class="pstatus">${STATUS_ICON[p.status]}</span>` : "";
    const tag = badge ? ` (${badge})` : "";
    const eoText = eo === null ? "–" : `${eo.toFixed(1)}%`;
    const ptsText = pts === null ? "–" : pts;
    const zero = eo === 0 ? " zero" : "";

    return `<div class="pcard${bench ? " bench" : ""}">
      <div class="pshirt-wrap">${shirt}${icon}</div>
      <div class="pname">${esc(p.web_name)}${tag}</div>
      <div class="peo${zero}">${eoText}</div>
      <div class="ppts">${ptsText}</div>
    </div>`;
  }

  const pitchHtml = (cards) => `<div class="pitch">${cards.join("")}</div>`;

  // Effective ownership from the top-500 sample: owned share plus captain share.
  function sampleEo(s) {
    if (!s || !s.sampled) return null;
    const eo = new Map();
    for (const id of new Set([...Object.keys(s.owned), ...Object.keys(s.captain ?? {})])) {
      eo.set(Number(id), Math.round(((s.owned[id] ?? 0) + (s.captain?.[id] ?? 0)) * 10) / 10);
    }
    return eo;
  }

  // ---------- Live updates ----------
  let liveHash = null;
  let liveMap = new Map(); // player id -> live delta

  function put(tr, field, value) {
    const cell = tr.querySelector(`[data-f="${field}"]`);
    const text = String(value);
    if (cell && cell.textContent !== text) cell.textContent = text;
  }

  function applyLive() {
    if (!liveMap.size) return;
    document.querySelectorAll("tr[data-el]").forEach((tr) => {
      const d = liveMap.get(Number(tr.dataset.el));
      if (!d) return;
      put(tr, "p", d.p);
      put(tr, "m", d.m);
      put(tr, "b", d.b);
    });
  }

  function inMatchWindow(snap) {
    const now = Date.now();
    return snap.fixtures.some((f) => {
      if (f.finished || !f.kickoff) return false;
      const k = Date.parse(f.kickoff);
      return now >= k - 15 * MIN && now <= k + 180 * MIN;
    });
  }

  // Runs on every page. Only fetches during match windows and while the tab is visible.
  function startLive(snap) {
    const tick = async () => {
      if (document.hidden || !inMatchWindow(snap)) return;
      try {
        const d = await api("/live");
        if (d.hash && d.hash !== liveHash) {
          liveHash = d.hash;
          liveMap = new Map(d.deltas.map((x) => [x.e, x]));
          applyLive();
          document.dispatchEvent(new CustomEvent("fpl:live"));
        }
      } catch {
        /* try again on the next tick */
      }
    };
    tick();
    setInterval(tick, MIN);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) tick();
    });
  }

  // ---------- Players ----------
  function initPlayers(snap) {
    const positions = new Map(snap.positions.map((p) => [p.id, p.short]));
    const q = $("q");
    const pos = $("pos");
    const sort = $("sort");
    const rows = $("rows");
    const more = $("more");
    const meta = $("meta");
    const STEP = 50;
    const SORT = {
      points: "total_points",
      form: "form",
      price: "now_cost",
      owned: "selected_by_percent",
      xg: "expected_goals",
      ppm: "points_per_million",
    };
    let limit = STEP;

    snap.positions.forEach((p) => pos.append(new Option(p.short, String(p.id))));

    const rowHtml = (p) => `<tr data-el="${p.id}"${p.status !== "a" ? ' class="dim"' : ""}>
      <td>${playerHtml(p.id)}</td>
      <td>${teamHtml(p.team)}</td>
      <td>${esc(positions.get(p.element_type))}</td>
      <td class="n">${money(p.now_cost)}</td>
      <td class="n">${p.total_points}</td>
      <td class="n" data-f="p">–</td>
      <td class="n" data-f="m">–</td>
      <td class="n" data-f="b">–</td>
      <td class="n">${p.form.toFixed(1)}</td>
      <td class="n">${p.selected_by_percent.toFixed(1)}%</td>
      <td class="n">${p.expected_goals.toFixed(2)}</td>
    </tr>`;

    function render() {
      const needle = q.value.trim().toLowerCase();
      const posId = Number(pos.value);
      const field = SORT[sort.value] ?? "total_points";

      const list = snap.players
        .filter(
          (p) =>
            (!posId || p.element_type === posId) &&
            (!needle || p.web_name.toLowerCase().includes(needle)),
        )
        .sort((a, b) => b[field] - a[field]);

      rows.innerHTML = list.length
        ? list.slice(0, limit).map(rowHtml).join("")
        : `<tr><td colspan="11">No players match.</td></tr>`;

      more.hidden = list.length <= limit;
      more.textContent = `Show more (${list.length - limit} left)`;
      meta.textContent = `${list.length} players · updated ${new Date(snap.generatedAt).toLocaleString()}`;
      applyLive();
    }

    const reset = () => {
      limit = STEP;
      render();
    };
    q.addEventListener("input", reset);
    pos.addEventListener("change", reset);
    sort.addEventListener("change", reset);
    more.addEventListener("click", () => {
      limit += STEP;
      render();
    });
    document.addEventListener("fpl:live", applyLive);

    render();
  }

  // ---------- Fixtures ----------
  function initFixtures(snap) {
    const max = snap.events.length || 38;
    const fromUrl = Number(new URLSearchParams(location.search).get("gw"));
    let gw = fromUrl >= 1 && fromUrl <= max ? fromUrl : currentGw(snap);

    const fmt = (iso) =>
      iso
        ? new Date(iso).toLocaleString(undefined, {
            weekday: "short",
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "TBC";

    function draw() {
      $("gw").textContent = `Gameweek ${gw}`;
      $("prev").disabled = gw <= 1;
      $("next").disabled = gw >= max;

      const items = snap.fixtures
        .filter((f) => f.gw === gw)
        .sort((a, b) => (a.kickoff ?? "").localeCompare(b.kickoff ?? ""));

      $("list").innerHTML = items.length
        ? items
            .map((f) => {
              const score =
                f.started || f.finished ? `${f.home_score ?? 0} – ${f.away_score ?? 0}` : fmt(f.kickoff);
              return `<tr>
                <td class="r ${fdr(f.home_difficulty)}">${teamHtml(f.home)}</td>
                <td class="c">${esc(score)}</td>
                <td class="${fdr(f.away_difficulty)}">${teamHtml(f.away)}</td>
              </tr>`;
            })
            .join("")
        : `<tr><td colspan="3">No fixtures for this gameweek.</td></tr>`;

      history.replaceState(null, "", `?gw=${gw}`);
    }

    $("prev").addEventListener("click", () => {
      gw = Math.max(1, gw - 1);
      draw();
    });
    $("next").addEventListener("click", () => {
      gw = Math.min(max, gw + 1);
      draw();
    });

    draw();
    initTicker(snap);
  }

  // Season ticker: each team's opponents across upcoming gameweeks, tinted by FDR.
  function initTicker(snap) {
    const main = document.querySelector("main");
    if (!main) return;
    const max = snap.events.length || 38;
    const start = currentGw(snap);
    const shortOf = (id) => teamInfo.get(id)?.short ?? "";

    const sec = document.createElement("section");
    sec.innerHTML = `
      <h2>Season ticker</h2>
      <p class="meta">Each cell shows the opponent and venue (H or A), tinted by difficulty. Double gameweeks show two opponents.</p>
      <div class="controls">
        <label for="tk-len">Show</label>
        <select id="tk-len">
          <option value="5">next 5 gameweeks</option>
          <option value="10" selected>next 10 gameweeks</option>
          <option value="all">all remaining</option>
        </select>
      </div>
      <div class="table-wrap">
        <table class="ticker">
          <thead id="tk-head"></thead>
          <tbody id="tk-body"></tbody>
        </table>
      </div>`;
    main.append(sec);

    const grid = new Map(); // "team:gw" -> [{ opp, home, diff }]
    for (const f of snap.fixtures) {
      if (f.gw === null || f.gw < start) continue;
      const push = (team, opp, home, diff) => {
        const k = `${team}:${f.gw}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push({ opp, home, diff });
      };
      push(f.home, f.away, true, f.home_difficulty);
      push(f.away, f.home, false, f.away_difficulty);
    }

    const draw = () => {
      const choice = $("tk-len").value;
      const count = choice === "all" ? max - start + 1 : Number(choice);
      const gws = Array.from({ length: Math.min(count, max - start + 1) }, (_, i) => start + i);

      $("tk-head").innerHTML = `<tr><th>Team</th>${gws.map((g) => `<th class="c">GW${g}</th>`).join("")}</tr>`;
      $("tk-body").innerHTML = [...snap.teams]
        .sort((a, b) => a.short.localeCompare(b.short))
        .map(
          (t) => `<tr><td>${teamHtml(t.id)}</td>${gws
            .map((g) => {
              const list = grid.get(`${t.id}:${g}`) ?? [];
              if (!list.length) return `<td class="c muted">Blank</td>`;
              return `<td class="c">${list
                .map((x) => `<span class="chip ${fdr(x.diff)}">${esc(shortOf(x.opp))} ${x.home ? "H" : "A"}</span>`)
                .join("<br>")}</td>`;
            })
            .join("")}</tr>`,
        )
        .join("");
    };

    $("tk-len").addEventListener("change", draw);
    draw();
  }

  // ---------- Login ----------
  function initLogin() {
    let challenge = "";
    const msg = (text) => ($("msg").textContent = text);

    const start = async () => {
      msg("");
      $("start").disabled = true;
      try {
        const r = await api("/auth/challenge", {
          method: "POST",
          body: JSON.stringify({ entryId: $("entry").value.trim() }),
        });
        challenge = r.token;
        $("code").textContent = r.code;
        $("step2").hidden = false;
      } catch (err) {
        msg(err.message);
      } finally {
        $("start").disabled = false;
      }
    };

    $("start").addEventListener("click", start);
    $("entry").addEventListener("keydown", (e) => {
      if (e.key === "Enter") start();
    });

    $("copy").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText($("code").textContent);
        msg("Code copied.");
      } catch {
        msg("Could not copy. Select the code and copy it manually.");
      }
    });

    $("verify").addEventListener("click", async () => {
      msg("");
      $("verify").disabled = true;
      try {
        const r = await api("/auth/verify", {
          method: "POST",
          body: JSON.stringify({ token: challenge }),
        });
        localStorage.setItem(SESSION, JSON.stringify({ token: r.token, entryId: r.entryId, name: r.name }));
        location.assign("/team");
      } catch (err) {
        msg(err.message);
        $("verify").disabled = false;
      }
    });
  }

  // ---------- My team (pitch view) ----------
  async function initTeam(snap) {
    const out = $("content");
    if (!session) return signOut();

    try {
      const me = await api("/me", { headers: { Authorization: `Bearer ${session.token}` } });
      const gw = currentGw(snap);
      const [picks, sample] = await Promise.all([
        api(`/picks/${session.entryId}/${gw}`).catch(() => null),
        api("/sample").catch(() => null),
      ]);
      const eo = sampleEo(sample);
      const e = me.entry;
      const rank = e.summary_overall_rank?.toLocaleString() ?? "—";

      out.innerHTML = `
        <h1>${esc(e.name)}</h1>
        <p class="meta" id="team-meta"></p>
        <p class="meta" id="team-note"></p>
        <div id="pitch-wrap"></div>`;

      const draw = () => {
        const hasLive = liveMap.size > 0;
        const gwPts = picks?.entry_history?.points;
        let total = gwPts;
        if (picks && hasLive) {
          total = picks.picks
            .filter((x) => x.position <= 11)
            .reduce((s, pk) => s + (liveMap.get(pk.element)?.p ?? 0) * (pk.multiplier ?? 1), 0);
        }
        const totalText = total !== undefined ? ` · GW${gw}: ${total} pts${hasLive ? " (live)" : ""}` : "";

        $("team-meta").textContent =
          `${e.player_first_name} ${e.player_last_name} · ${e.summary_overall_points} pts · rank ${rank}${totalText}`;

        $("team-note").textContent = eo
          ? `Green: effective ownership across the top ${sample.sampled} managers (owned plus captained). Grey: GW${gw} points, shown during match times.`
          : `Green: effective ownership, available once the top-manager sample has data. Grey: GW${gw} points, shown during match times.`;

        if (!picks) {
          $("pitch-wrap").innerHTML = `<p class="muted">Picks for gameweek ${gw} are not available yet.</p>`;
          return;
        }

        const cards = picks.picks.map((pk) => {
          const d = liveMap.get(pk.element);
          const badge = pk.is_captain ? "C" : pk.is_vice_captain ? "V" : "";
          return pitchCard({
            id: pk.element,
            badge,
            eo: eo ? (eo.get(pk.element) ?? 0) : null,
            pts: hasLive ? (d ? d.p : 0) : null,
            bench: pk.position > 11,
          });
        });
        $("pitch-wrap").innerHTML = pitchHtml(cards);
      };

      draw();
      document.addEventListener("fpl:live", draw);
    } catch (err) {
      if (err.status === 401) return signOut();
      out.textContent = `Could not load your team. ${err.message}`;
    }
  }

  // ---------- Hover prefetch for any [data-entry] link ----------
  const picksCache = new Map();

  function prefetchPicks(entry, gw) {
    const key = `${entry}:${gw}`;
    if (!picksCache.has(key)) {
      const p = api(`/picks/${entry}/${gw}`);
      p.catch(() => picksCache.delete(key));
      picksCache.set(key, p);
    }
    return picksCache.get(key);
  }

  function initPrefetch(gw) {
    const hit = (e) => {
      const el = e.target.closest?.("[data-entry]");
      if (el) prefetchPicks(el.dataset.entry, gw).catch(() => {});
    };
    document.addEventListener("mouseover", hit, { passive: true });
    document.addEventListener("touchstart", hit, { passive: true });
  }

  // ---------- Boot ----------
  (async () => {
    renderNav();
    if (page === "login") return initLogin();

    let snap = null;
    try {
      snap = await loadSnapshot();
      teamInfo = new Map(snap.teams.map((t) => [t.id, t]));
      playerInfo = new Map(snap.players.map((p) => [p.id, p]));
    } catch (err) {
      const message = `Could not load data. ${err.message}`;
      if (page === "team") $("content").textContent = message;
      else if (page !== "leagues" && page !== "manager") {
        const el = $("meta") || $("gw");
        if (el) el.textContent = message;
      }
    }

    window.FPL = {
      teamHtml,
      playerHtml,
      fdr,
      pitchCard,
      pitchHtml,
      gw: snap ? currentGw(snap) : 1,
      live: () => liveMap,
    };

    // Leagues pages always get this event, so their tables still load without the snapshot.
    if (snap || page === "leagues" || page === "manager") {
      document.dispatchEvent(new CustomEvent("fpl:ready", { detail: snap }));
    }
    if (!snap) return;

    startLive(snap);
    initPrefetch(currentGw(snap));

    if (page === "team") return initTeam(snap);
    if (page === "players") initPlayers(snap);
    if (page === "fixtures") initFixtures(snap);
  })();
})();
