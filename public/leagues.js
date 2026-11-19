/* leagues.js: standings, the signed-in user's leagues, and manager pages. Loads after app.js. */
(() => {
  const page = document.body.dataset.page;
  if (page !== "leagues" && page !== "manager") return;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const ID = /^\d{1,9}$/;
  const BATCH = 10;
  const PLACEHOLDER = `<span class="muted">…</span>`;

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

  const session = () => {
    try {
      return JSON.parse(localStorage.getItem("fpl.session"));
    } catch {
      return null;
    }
  };

  // Warm the manager page on hover so the click feels instant.
  function warmManagerPages() {
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
  }

  // ---------- My leagues ----------
  async function showMyLeagues() {
    const s = session();
    if (!s) return;
    try {
      const { leagues } = await api("/me/leagues", { headers: { Authorization: `Bearer ${s.token}` } });
      if (!leagues.length) return;
      $("mine-list").innerHTML = leagues
        .map(
          (l) =>
            `<li><a href="/leagues?id=${l.id}">${esc(l.name)}</a>${
              l.rank ? ` <span class="muted">rank ${Number(l.rank).toLocaleString()}</span>` : ""
            }</li>`,
        )
        .join("");
      $("mine").hidden = false;
    } catch {
      /* not signed in, or FPL unavailable: keep the section hidden */
    }
  }

  // ---------- Standings ----------
  function rowHtml(r) {
    return `<tr data-row="${r.entry}" data-net="${r.gw}">
      <td class="n">${r.rank}</td>
      <td><a href="/manager?id=${r.entry}" data-entry="${r.entry}">${esc(r.manager)}</a><br><span class="muted">${esc(r.team)}</span></td>
      <td data-c="captain">${PLACEHOLDER}</td>
      <td data-c="chip">${PLACEHOLDER}</td>
      <td data-c="transfers">${PLACEHOLDER}</td>
      <td class="n" data-c="gw">${r.gw}</td>
      <td class="n">${r.total}</td>
      <td class="n" data-c="value">${PLACEHOLDER}</td>
    </tr>`;
  }

  function fill(d) {
    const tr = document.querySelector(`tr[data-row="${d.entry}"]`);
    if (!tr) return;
    const set = (key, html) => {
      const td = tr.querySelector(`[data-c="${key}"]`);
      if (td) td.innerHTML = html;
    };

    set(
      "captain",
      d.captain
        ? `${esc(d.captain)}${d.vice ? `<br><span class="muted">${esc(d.vice)}</span>` : ""}`
        : "–",
    );
    set("chip", d.chip ? esc(d.chip) : "–");
    set(
      "transfers",
      d.transfers.length ? d.transfers.map((t) => `${esc(t.out)} → ${esc(t.in)}`).join("<br>") : "–",
    );
    set("value", `£${(d.value / 10).toFixed(1)}m`);

    const net = tr.dataset.net;
    set("gw", d.hit > 0 ? `${d.gross} <span class="muted">(−${d.hit})</span> = ${net}` : net);
  }

  // Any placeholder left after a batch becomes a dash, so no row stays "loading" forever.
  function blank(entry) {
    const tr = document.querySelector(`tr[data-row="${entry}"]`);
    if (!tr) return;
    tr.querySelectorAll("[data-c]").forEach((td) => {
      if (td.textContent.trim() === "…") td.textContent = "–";
    });
  }

  async function fillDetails(results) {
    for (let i = 0; i < results.length; i += BATCH) {
      const chunk = results.slice(i, i + BATCH);
      try {
        const { managers } = await api(`/managers?ids=${chunk.map((r) => r.entry).join(",")}`);
        const got = new Set(managers.map((m) => m.entry));
        managers.forEach(fill);
        chunk.filter((r) => !got.has(r.entry)).forEach((r) => blank(r.entry));
      } catch {
        chunk.forEach((r) => blank(r.entry));
      }
    }
  }

  async function loadLeague(id, pageNo) {
    $("meta").textContent = "Loading…";
    const data = await api(`/league/${id}?page=${pageNo}`);

    $("title").textContent = data.league;
    document.title = `${data.league} · FPL`;
    $("meta").textContent = `Page ${pageNo} · 50 managers per page`;

    $("rows").innerHTML = data.results.length
      ? data.results.map(rowHtml).join("")
      : `<tr><td colspan="8">No managers on this page.</td></tr>`;

    $("prev").hidden = pageNo <= 1;
    $("next").hidden = !data.hasNext;
    $("prev").onclick = () => location.assign(`/leagues?id=${id}&page=${pageNo - 1}`);
    $("next").onclick = () => location.assign(`/leagues?id=${id}&page=${pageNo + 1}`);

    await fillDetails(data.results);
  }

  function initLeagues() {
    const params = new URLSearchParams(location.search);
    const id = (params.get("id") ?? "").trim();
    const pageNo = Math.max(1, Number(params.get("page")) || 1);

    $("id").value = id;
    $("find").addEventListener("submit", (e) => {
      e.preventDefault();
      const v = $("id").value.trim();
      if (ID.test(v)) location.assign(`/leagues?id=${v}`);
      else $("meta").textContent = "Enter a numeric league ID.";
    });

    warmManagerPages();
    showMyLeagues();

    if (!id) return;
    if (!ID.test(id)) {
      $("meta").textContent = "Enter a numeric league ID.";
      return;
    }
    loadLeague(id, pageNo).catch((err) => {
      $("meta").textContent = err.message;
      $("rows").innerHTML = "";
    });
  }

  // ---------- Manager page ----------
  async function snapshot() {
    const cached = localStorage.getItem("fpl.snapshot");
    return cached ? JSON.parse(cached) : api("/snapshot");
  }

  const currentGw = (snap) =>
    (snap.events.find((e) => e.current) ?? snap.events.find((e) => e.next) ?? snap.events[0])?.id ?? 1;

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
