/* managers.js: All-time manager ranking page.
   Lookup shows a manager's current rank and season history (from /api/history).
   Tracked managers are saved on this device. Top managers come from the overall league (page by page).
   Starts on fpl:ready from app.js. Page key: managers. */
(() => {
  if (document.body.dataset.page !== "managers") return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const TRACK_KEY = "fpl.managers.track";
  const OVERALL = 314;      // overall classic league, the source of the top managers
  const PER_PAGE = 50;      // managers per league page
  const MAX_PAGE = 4;       // top 200 at most
  const TRACK_MAX = 30;

  let track = readTrack();
  let card = null;          // the manager currently shown in the lookup card
  let topRows = [];
  let topPage = 0;
  let topHasNext = false;

  const fmt = (n) => (n === null || n === undefined || n === "" ? "–" : Number(n).toLocaleString());

  // ---------- Storage ----------
  function readTrack() {
    try {
      const v = JSON.parse(localStorage.getItem(TRACK_KEY) ?? "[]");
      return Array.isArray(v) ? v.filter((x) => x && Number.isFinite(Number(x.id))).map((x) => ({ id: Number(x.id), name: String(x.name ?? "") })) : [];
    } catch {
      return [];
    }
  }

  function saveTrack() {
    try {
      localStorage.setItem(TRACK_KEY, JSON.stringify(track));
    } catch {
      // Storage may be blocked. Tracking still works for this visit.
    }
  }

  const isTracked = (id) => track.some((t) => t.id === Number(id));

  // ---------- API ----------
  async function api(path) {
    const res = await fetch(`/api${path}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  // ---------- Track button, used in the card and the top list ----------
  function trackBtn(id, name) {
    const on = isTracked(id);
    const label = on ? "Tracking" : "Track";
    return `<button type="button" class="mr-track${on ? " is-on" : ""}" data-track="${id}" data-name="${esc(name)}" aria-pressed="${on}" aria-label="${on ? "Stop tracking" : "Track"} ${esc(name)}">${label}</button>`;
  }

  function toggleTrack(id, name) {
    if (isTracked(id)) {
      track = track.filter((t) => t.id !== id);
    } else {
      if (track.length >= TRACK_MAX) {
        $("mr-msg").textContent = `You can track up to ${TRACK_MAX} managers. Remove one first.`;
        return;
      }
      track = [...track, { id, name }];
    }
    saveTrack();
    renderTrack();
    renderTop();
    if (card) renderCard();
  }

  // ---------- Lookup card ----------
  function renderCard() {
    const box = $("mr-card");
    if (!card) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    const { id, entry, past } = card;
    const name = entry.name ?? "";
    const manager = `${entry.player_first_name ?? ""} ${entry.player_last_name ?? ""}`.trim();

    const seasons = past
      .filter((p) => p.season)
      .slice()
      .sort((a, b) => String(b.season).localeCompare(String(a.season)));
    const ranked = seasons.filter((s) => typeof s.rank === "number" && s.rank > 0);
    const best = ranked.reduce((b, s) => (b === null || s.rank < b.rank ? s : b), null);

    box.hidden = false;
    box.innerHTML = `
      <div class="mr-cardbox">
        <div class="mr-cardhead">
          <div>
            <div class="mr-cardname">${esc(name)}</div>
            <div class="mr-cardsub">${esc(manager)} · ID ${id}</div>
          </div>
          ${trackBtn(id, name)}
        </div>
        <div class="mr-hero">
          <div class="mr-cell">
            <span class="mr-k">Current overall rank</span>
            <strong class="mr-big">${fmt(entry.summary_overall_rank)}</strong>
          </div>
          <div class="mr-cell">
            <span class="mr-k">Total points</span>
            <strong class="mr-big">${fmt(entry.summary_overall_points)}</strong>
          </div>
        </div>
        <div class="mr-stats">
          <div class="mr-cell">
            <span class="mr-k">Best finish</span>
            <strong class="mr-mid">${best ? fmt(best.rank) : "–"}</strong>
            <span class="mr-sub">${best ? esc(best.season) : "No finished seasons"}</span>
          </div>
          <div class="mr-cell">
            <span class="mr-k">Seasons played</span>
            <strong class="mr-mid">${seasons.length}</strong>
            <span class="mr-sub">Including this one</span>
          </div>
        </div>
        <div class="mr-tablewrap">
          <table class="mr-table">
            <thead>
              <tr>
                <th scope="col">Season</th>
                <th scope="col" class="n">Points</th>
                <th scope="col" class="n">Overall rank</th>
              </tr>
            </thead>
            <tbody>
              ${
                seasons.length
                  ? seasons
                      .map(
                        (s) => `<tr class="${best && s.season === best.season ? "is-best" : ""}">
                          <td>${esc(s.season)}</td>
                          <td class="n">${fmt(s.points)}</td>
                          <td class="n">${fmt(s.rank)}</td>
                        </tr>`,
                      )
                      .join("")
                  : `<tr><td colspan="3" class="mr-empty">No past seasons on record.</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </div>`;
  }

  async function lookup(id) {
    $("mr-msg").textContent = "Loading…";
    card = null;
    renderCard();
    try {
      const [entryRes, histRes] = await Promise.all([api(`/entry/${id}`), api(`/history/${id}`)]);
      card = { id: Number(id), entry: entryRes.entry, past: histRes.past ?? [] };
      $("mr-msg").textContent = "";
      renderCard();
    } catch (err) {
      $("mr-msg").textContent = err.message;
    }
  }

  // ---------- Tracked list ----------
  function renderTrack() {
    const box = $("mr-track");
    if (!track.length) {
      box.innerHTML = `<p class="mr-empty">Track a manager from the lookup or the top list to see them here.</p>`;
      return;
    }
    box.innerHTML = `<ul class="mr-list">${track
      .map(
        (t) => `<li class="mr-row">
          <span class="mr-rname">${esc(t.name || "Manager")}</span>
          <span class="mr-rid">ID ${t.id}</span>
          <button type="button" class="mr-btn mr-btn-ghost" data-lookup="${t.id}">Look up</button>
          <button type="button" class="mr-btn mr-btn-ghost" data-track="${t.id}" data-name="${esc(t.name)}">Remove</button>
        </li>`,
      )
      .join("")}</ul>`;
  }

  // ---------- Top managers ----------
  function renderTop() {
    const body = $("mr-top");
    body.innerHTML = topRows.length
      ? topRows
          .map(
            (r) => `<tr>
              <td class="n">${r.pos}</td>
              <td><a href="/manager?id=${r.entry}">${esc(r.manager)}</a></td>
              <td>${esc(r.team)}</td>
              <td class="n">${fmt(r.total)}</td>
              <td class="n">${fmt(r.gw)}</td>
              <td>${trackBtn(r.entry, r.manager)}</td>
            </tr>`,
          )
          .join("")
      : `<tr><td colspan="6" class="mr-empty">Loading the top managers…</td></tr>`;

    $("mr-top-count").textContent = topRows.length ? `(top ${topRows.length})` : "";
    const more = $("mr-more");
    more.hidden = !topHasNext || topPage >= MAX_PAGE;
  }

  async function loadTop(page) {
    try {
      const data = await api(`/league/${OVERALL}?page=${page}`);
      const results = data.results ?? [];
      const offset = (page - 1) * PER_PAGE;
      results.forEach((r, i) => {
        topRows.push({
          pos: typeof r.rank === "number" && r.rank > 0 ? r.rank : offset + i + 1,
          entry: r.entry,
          manager: r.manager ?? "",
          team: r.team ?? "",
          total: r.total,
          gw: r.gw,
        });
      });
      topPage = page;
      topHasNext = !!data.hasNext;
    } catch (err) {
      topHasNext = false;
      $("mr-msg").textContent = `Could not load the top managers. ${err.message}`;
    }
    renderTop();
  }

  // ---------- Wiring ----------
  function wire() {
    $("mr-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const id = $("mr-id").value.trim();
      if (!/^\d{1,9}$/.test(id)) {
        $("mr-msg").textContent = "Enter a numeric FPL team ID.";
        return;
      }
      lookup(id);
    });

    $("mr-more").addEventListener("click", () => loadTop(topPage + 1));

    document.addEventListener("click", (e) => {
      const tr = e.target.closest("[data-track]");
      if (tr) {
        toggleTrack(Number(tr.dataset.track), tr.dataset.name ?? "");
        return;
      }
      const lk = e.target.closest("[data-lookup]");
      if (lk) {
        const id = lk.dataset.lookup;
        $("mr-id").value = id;
        lookup(id);
        $("mr-lookup-h").scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }

  document.addEventListener("fpl:ready", (e) => {
    if (!e.detail) return;
    wire();
    renderTrack();
    renderTop();
    loadTop(1);

    const fromUrl = new URLSearchParams(location.search).get("id");
    if (fromUrl && /^\d{1,9}$/.test(fromUrl)) {
      $("mr-id").value = fromUrl;
      lookup(fromUrl);
    }
  });
})();
