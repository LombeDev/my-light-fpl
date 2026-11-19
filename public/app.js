/* app.js: shared nav, centred spinner, snapshot cache, shirts, players, fixtures, login, my team, live updates. */
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

  // ---------- Spinner: one centred element on every page ----------
  const spinner = document.createElement("div");
  spinner.className = "spinner";
  spinner.setAttribute("role", "status");
  spinner.setAttribute("aria-label", "Loading");
  document.body.append(spinner);

  // Counts in-flight API requests. Background checks (live, version) are ignored,
  // so the spinner doesn't flash every minute during matches.
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

  // ---------- Nav: one definition for every page ----------
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

  // A club's shirt and short name, e.g. "[shirt] ARS".
  const teamHtml = (id) => {
    const t = teamInfo.get(id);
    if (!t) return "";
    return `${t.code ? shirtImg(t.code) : ""}<span>${esc(t.short)}</span>`;
  };

  // A player's shirt and name. Goalkeepers get the goalkeeper shirt.
  const playerHtml = (id) => {
    const p = playerInfo.get(id);
    if (!p) return "";
    const t = teamInfo.get(p.team);
    const img = t?.code ? shirtImg(t.code, p.element_type === 1) : "";
    return `${img}<span>${esc(p.web_name)}</span>`;
  };

  // FDR class, from 1 (easiest) to 5 (hardest). Returns "" when there is no rating.
  const fdr = (d) => (d >= 1 && d <= 5 ? `fdr-${Math.round(d)}` : "");

  // ---------- Live updates ----------
  let liveHash = null;
  let liveDeltas = [];

  function put(tr, field, value) {
    const cell = tr.querySelector(`[data-f="${field}"]`);
    const text = String(value);
    if (cell && cell.textContent !== text) cell.textContent = text;
  }

  function applyLive() {
    if (!liveDeltas.length) return;
    const byId = new Map(liveDeltas.map((d) => [d.e, d]));
    document.querySelectorAll("tr[data-el]").forEach((tr) => {
      const d = byId.get(Number(tr.dataset.el));
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

  function startLive(snap) {
    const tick = async () => {
      if (document.hidden || !inMatchWindow(snap)) return;
      try {
        const d = await api("/live");
        if (d.hash && d.hash !== liveHash) {
          liveHash = d.hash;
          liveDeltas = d.deltas;
          applyLive();
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

    render();
    startLive(snap);
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

  // ---------- My team ----------
  async function initTeam(snap) {
    const out = $("content");
    if (!session) return signOut();

    try {
      const me = await api("/me", { headers: { Authorization: `Bearer ${session.token}` } });
      const gw = currentGw(snap);
      const picks = await api(`/picks/${session.entryId}/${gw}`).catch(() => null);

      const byId = new Map(snap.players.map((p) => [p.id, p]));
      const positions = new Map(snap.positions.map((p) => [p.id, p.short]));

      const table = (list) => `<table>
        <thead><tr><th>Player</th><th>Team</th><th>Pos</th><th></th></tr></thead>
        <tbody>${list
          .map((pk) => {
            const p = byId.get(pk.element);
            const badge = pk.is_captain ? "Captain" : pk.is_vice_captain ? "Vice" : "";
            return `<tr>
              <td>${playerHtml(pk.element)}</td>
              <td>${p ? teamHtml(p.team) : ""}</td>
              <td>${p ? esc(positions.get(p.element_type)) : ""}</td>
              <td>${badge}</td>
            </tr>`;
          })
          .join("")}</tbody>
      </table>`;

      const e = me.entry;
      const rank = e.summary_overall_rank?.toLocaleString() ?? "—";
      const gwPts = picks?.entry_history?.points;
      const gwText = gwPts !== undefined ? ` · GW${gw}: ${gwPts} pts` : "";

      out.innerHTML = `
        <h1>${esc(e.name)}</h1>
        <p class="meta">
          ${esc(e.player_first_name)} ${esc(e.player_last_name)} ·
          ${e.summary_overall_points} pts · rank ${rank}${gwText}
        </p>
        ${
          picks
            ? `<h2>Starting XI</h2>${table(picks.picks.filter((x) => x.position <= 11))}
               <h2>Bench</h2>${table(picks.picks.filter((x) => x.position > 11))}`
            : `<p class="muted">Picks for gameweek ${gw} are not available yet.</p>`
        }
      `;
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
      else if (page !== "leagues" && page !== "manager") ($("meta") || $("gw") || {}).textContent = message;
    }

    window.FPL = { teamHtml, playerHtml, fdr, gw: snap ? currentGw(snap) : 1 };

    // Leagues pages always get this event, so their tables still load without the snapshot.
    if (snap || page === "leagues" || page === "manager") {
      document.dispatchEvent(new CustomEvent("fpl:ready", { detail: snap }));
    }
    if (!snap) return;

    if (page === "team") return initTeam(snap);
    if (page === "players") initPlayers(snap);
    if (page === "fixtures") initFixtures(snap);
    initPrefetch(currentGw(snap));
  })();
})();
