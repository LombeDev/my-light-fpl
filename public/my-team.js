/* my-team.js: My team page. Loads the signed-in squad into the same team view used in mini-league rows.
   Page key: team-view. Loads after app.js and team-view.js. */
(() => {
  if (document.body.dataset.page !== "team-view") return;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

  let snap = null;
  let gw = 1;
  let session = null;
  let me = null;
  let picks = null;
  let gross = 0;

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

  // Fetches the squad and the team details, then draws the view.
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
