/* leagues.js: mini-league standings and manager pages. Loads after app.js. */
(() => {
  const page = document.body.dataset.page;
  if (page !== "leagues" && page !== "manager") return;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const ID = /^\d{1,9}$/;

  async function api(path) {
    const res = await fetch(`/api${path}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // Reuse the snapshot app.js already cached; fall back to the network.
  async function snapshot() {
    const cached = localStorage.getItem("fpl.snapshot");
    return cached ? JSON.parse(cached) : api("/snapshot");
  }

  const currentGw = (snap) =>
    (snap.events.find((e) => e.current) ?? snap.events.find((e) => e.next) ?? snap.events[0])?.id ?? 1;

  // ---------- Standings ----------
  async function initLeagues() {
    const params = new URLSearchParams(location.search);
    const id = (params.get("id") ?? "").trim();
    const pageNo = Math.max(1, Number(params.get("page")) || 1);
    const meta = $("meta");

    $("id").value = id;
    $("find").addEventListener("submit", (e) => {
      e.preventDefault();
      const v = $("id").value.trim();
      if (ID.test(v)) location.assign(`/leagues?id=${v}`);
      else meta.textContent = "Enter a numeric league ID.";
    });

    // On hover, prefetch the manager page HTML so the click loads from cache.
    const warm = (e) => {
      const a = e.target.closest?.("a[data-entry]");
      if (!a || a.dataset.warm) return;
      a.dataset.warm = "1";
      const link = document.createElement("link");
      link.rel = "prefetch";
      link.href = a.getAttribute("href");
      document.head.append(link);
    };
    document.addEventListener("mouseover", warm, { passive: true });
    document.addEventListener("touchstart", warm, { passive: true });

    if (!id) return;
    if (!ID.test(id)) {
      meta.textContent = "Enter a numeric league ID.";
      return;
    }

    meta.textContent = "Loading…";
    try {
      const data = await api(`/league/${id}?page=${pageNo}`);
      $("title").textContent = data.league;
      document.title = `${data.league} · FPL`;
      meta.textContent = `Page ${pageNo}`;

      $("rows").innerHTML = data.results.length
        ? data.results
            .map(
              (r) => `<tr>
                <td class="n">${r.rank}</td>
                <td>${esc(r.team)}</td>
                <td><a href="/manager?id=${r.entry}" data-entry="${r.entry}">${esc(r.manager)}</a></td>
                <td class="n">${r.gw}</td>
                <td class="n">${r.total}</td>
              </tr>`,
            )
            .join("")
        : `<tr><td colspan="5">No managers on this page.</td></tr>`;

      $("prev").hidden = pageNo <= 1;
      $("next").hidden = !data.hasNext;
      $("prev").addEventListener("click", () => location.assign(`/leagues?id=${id}&page=${pageNo - 1}`));
      $("next").addEventListener("click", () => location.assign(`/leagues?id=${id}&page=${pageNo + 1}`));
    } catch (err) {
      meta.textContent = err.message;
      $("rows").innerHTML = "";
    }
  }

  // ---------- Manager ----------
  async function initManager() {
    const id = new URLSearchParams(location.search).get("id") ?? "";
    const out = $("content");

    if (!ID.test(id)) {
      out.textContent = "Missing or invalid manager ID.";
      return;
    }

    try {
      const [{ entry }, snap] = await Promise.all([api(`/entry/${id}`), snapshot()]);
      const gw = currentGw(snap);
      const picks = await api(`/picks/${id}/${gw}`).catch(() => null);

      const byId = new Map(snap.players.map((p) => [p.id, p]));
      const teams = new Map(snap.teams.map((t) => [t.id, t.short]));
      const positions = new Map(snap.positions.map((p) => [p.id, p.short]));

      const table = (list) => `<table>
        <thead><tr><th>Player</th><th>Team</th><th>Pos</th><th></th></tr></thead>
        <tbody>${list
          .map((pk) => {
            const p = byId.get(pk.element);
            const badge = pk.is_captain ? "Captain" : pk.is_vice_captain ? "Vice" : "";
            return `<tr>
              <td>${esc(p?.web_name ?? "Unknown")}</td>
              <td>${esc(p ? teams.get(p.team) : "")}</td>
              <td>${esc(p ? positions.get(p.element_type) : "")}</td>
              <td>${badge}</td>
            </tr>`;
          })
          .join("")}</tbody>
      </table>`;

      const rank = entry.summary_overall_rank?.toLocaleString() ?? "—";
      const gwPts = picks?.entry_history?.points;
      const gwText = gwPts !== undefined ? ` · GW${gw}: ${gwPts} pts` : "";

      $("title").textContent = entry.name;
      document.title = `${entry.name} · FPL`;

      out.innerHTML = `
        <p class="meta">
          ${esc(entry.player_first_name)} ${esc(entry.player_last_name)} ·
          ${entry.summary_overall_points} pts · rank ${rank}${gwText}
        </p>
        ${
          picks
            ? `<h2>Starting XI</h2>${table(picks.picks.filter((x) => x.position <= 11))}
               <h2>Bench</h2>${table(picks.picks.filter((x) => x.position > 11))}`
            : `<p class="muted">Picks for gameweek ${gw} are not available yet.</p>`
        }
      `;
    } catch (err) {
      out.textContent = `Could not load manager. ${err.message}`;
    }
  }

  if (page === "leagues") initLeagues();
  if (page === "manager") initManager();
})();
