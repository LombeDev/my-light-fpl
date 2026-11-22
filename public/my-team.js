/* my-team.js: My team page. Squad in the team view, deadline countdown, and transfers in and out.
   Page key: team-view. Loads after app.js and team-view.js. */
(() => {
  if (document.body.dataset.page !== "team-view") return;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const SHIRTS = "https://fantasy.premierleague.com/dist/img/shirts/standard";
  const PAGE = 25;

  let snap = null;
  let gw = 1;
  let session = null;
  let me = null;
  let picks = null;
  let gross = 0;
  let deadlineMs = null;
  let trRows = []; // transfers data for the gameweek, all players
  let trShown = PAGE;
  let trQuery = "";

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

  // ---------- Deadline countdown ----------
  function setupDeadline(snapshot) {
    // The deadline is the next gameweek that has not finished, from FPL's events data.
    const next = snapshot.events.find((e) => e.current && !e.finished) ?? snapshot.events.find((e) => e.next);
    const iso = next?.deadline ?? null;
    deadlineMs = iso ? Date.parse(iso) : null;

    if (deadlineMs) {
      $("dl-date").textContent = new Date(deadlineMs).toLocaleString(undefined, {
        weekday: "short",
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } else {
      $("dl-date").textContent = "Deadline not available";
    }

    const pad = (n) => String(n).padStart(2, "0");
    const tick = () => {
      if (!deadlineMs) return;
      const ms = deadlineMs - Date.now();
      if (ms <= 0) {
        ["dl-d", "dl-h", "dl-m", "dl-s"].forEach((id) => ($(id).textContent = "00"));
        $("dl-date").textContent = "Deadline passed";
        return;
      }
      const d = Math.floor(ms / 86400000);
      const h = Math.floor((ms % 86400000) / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      $("dl-d").textContent = pad(d);
      $("dl-h").textContent = pad(h);
      $("dl-m").textContent = pad(m);
      $("dl-s").textContent = pad(s);
    };
    tick();
    setInterval(tick, 1000);
  }

  // ---------- Transfers in and out ----------
  // Uses this gameweek's transfer counts from the snapshot, for every player.
  function trFilter() {
    const needle = trQuery.trim().toLowerCase();
    return trRows.filter((r) => !needle || r.name.toLowerCase().includes(needle));
  }

  function renderTransfers() {
    const all = trFilter();
    const list = all.slice(0, trShown);

    $("tr-head").innerHTML = `<tr>
      <th class="tr-namecol">Name</th>
      <th class="n">Cost</th>
      <th class="n">TSB %</th>
      <th class="n">Pts</th>
      <th class="n is-sort">Transfers in</th>
      <th class="n">Transfers out</th>
    </tr>`;

    $("tr-body").innerHTML = list.length
      ? list
          .map((r) => {
            const shirt = r.shirt
              ? `<img class="tr-shirt" src="${esc(r.shirt)}" alt="" loading="lazy">`
              : `<span class="tr-shirt tr-shirt-empty"></span>`;
            return `<tr>
              <td class="tr-namecol"><div class="tr-name">${shirt}<div>
                <div class="tr-pname">${esc(r.name)}</div>
                <div class="tr-sub">${esc(r.club)} • ${esc(r.pos)}${r.yellow ? ` <span class="tr-card"></span>` : ""}</div>
              </div></div></td>
              <td class="n">${r.cost}</td>
              <td class="n">${r.owned}</td>
              <td class="n">${r.pts}</td>
              <td class="n is-sort">${r.tin.toLocaleString()}</td>
              <td class="n">${r.tout.toLocaleString()}</td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="6">No players match.</td></tr>`;

    const btn = $("tr-more");
    btn.hidden = all.length <= trShown;
    btn.textContent = `Show more (${Math.max(0, all.length - trShown)} left)`;
  }

  function setupTransfers(snapshot) {
    const teamById = new Map(snapshot.teams.map((t) => [t.id, t]));
    const posById = new Map(snapshot.positions.map((p) => [p.id, p.short]));

    // Transfers in and out for the gameweek, sorted by transfers in by default.
    trRows = snapshot.players
      .map((p) => {
        const t = teamById.get(p.team);
        return {
          name: p.web_name,
          club: t?.short ?? "",
          pos: posById.get(p.element_type) ?? "",
          shirt: t?.code ? `${SHIRTS}/shirt_${t.code}-66.png` : "",
          cost: `£${(p.now_cost / 10).toFixed(1)}m`,
          owned: `${Number(p.selected_by_percent).toFixed(1)}%`,
          pts: p.total_points,
          tin: p.transfers_in ?? 0,
          tout: p.transfers_out ?? 0,
          yellow: false,
        };
      })
      .sort((a, b) => b.tin - a.tin);

    $("tr-q").addEventListener("input", (e) => {
      trQuery = e.target.value;
      trShown = PAGE;
      renderTransfers();
    });
    $("tr-more").addEventListener("click", () => {
      trShown += PAGE;
      renderTransfers();
    });

    renderTransfers();
  }

  // ---------- Squad ----------
  async function load() {
    const auth = { headers: { Authorization: `Bearer ${session.token}` } };
    const [meRes, picksRes, mgrRes] = await Promise.all([
      api("/me", auth),
      api(`/picks/${session.entryId}/${gw}`).catch(() => null),
      api(`/managers?ids=${session.entryId}`).catch(() => null),
    ]);
    me = meRes.entry;
    picks = picksRes;
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
      $("team-note").textContent = "";
      $("content").innerHTML = `<p class="muted">Picks for gameweek ${gw} are not available yet.</p>`;
      return;
    }

    $("team-note").textContent = "";
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

  async function init() {
    setNavCurrent();
    session = readSession();
    if (!session) return location.assign("/login");

    setupDeadline(snap);
    setupTransfers(snap);

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
    init();
  });
})();
