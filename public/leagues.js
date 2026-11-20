/* leagues.js: standings with live points and projections, your live rank, what-if scenarios, and manager pages.
   Waits for app.js to load the snapshot before drawing shirts. */
(() => {
  const page = document.body.dataset.page;
  if (page !== "leagues" && page !== "manager") return;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const ID = /^\d{1,9}$/;
  const BATCH = 10;
  const DASH = "–";
  const PENDING = `<span class="muted">…</span>`;
  const pts = (n) => Math.round(n).toLocaleString();

  // Resolves once app.js has loaded the snapshot (or failed to), so shirts can be drawn.
  const readyP = new Promise((resolve) =>
    document.addEventListener("fpl:ready", (e) => resolve(e.detail), { once: true }),
  );

  const helpers = () => window.FPL ?? { teamHtml: () => "", playerHtml: () => "", fdr: () => "", gw: 1 };
  const player = (id) => helpers().playerHtml(id) || DASH;

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

  // ---------- Live scoring ----------

  // Scores managers in parallel batches of 10. Returns results by entry, and whether any match is in play.
  async function scoreAll(ids) {
    const chunks = [];
    for (let i = 0; i < ids.length; i += BATCH) chunks.push(ids.slice(i, i + BATCH));
    const results = await Promise.all(chunks.map((c) => api(`/livescore?ids=${c.join(",")}`).catch(() => null)));

    const out = new Map();
    let isLive = false;
    for (const d of results) {
      if (!d) continue;
      isLive = isLive || d.live;
      for (const r of d.rows) out.set(r.entry, r);
    }
    return { out, isLive };
  }

  // base is the total before this gameweek: FPL's total minus this gameweek's points.
  function project(row, base) {
    const net = row.gross - row.hits;
    const at = (k) => base + net + row.remaining[k];
    return { gross: row.gross, hits: row.hits, net, low: at("low"), exp: at("exp"), high: at("high") };
  }

  // Position of a value among others' expected totals (1 is top).
  const positionOf = (value, others) => others.filter((o) => o > value).length + 1;

  function whatIf(mine, others, total) {
    const at = (v) => positionOf(v, others);
    return `Position if your remaining players score low: <strong>${at(mine.low)}</strong> · expected: <strong>${at(mine.exp)}</strong> · high: <strong>${at(mine.high)}</strong> <span class="muted">of ${total}</span>`;
  }

  const setCell = (entry, key, html) => {
    const td = document.querySelector(`tr[data-row="${entry}"] [data-c="${key}"]`);
    if (td) td.innerHTML = html;
  };

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

  // ---------- Your live rank (managers around you) ----------
  async function showLiveRank() {
    const s = session();
    if (!s) return;
    const sec = $("live-rank");
    try {
      const around = await api(`/around/${s.entryId}`);
      const { out, isLive } = await scoreAll(around.rows.map((r) => r.entry));
      sec.hidden = false;

      if (!isLive) {
        $("live-rank-body").innerHTML = `<p class="meta">No matches in play right now. Your live rank appears during match windows.</p>`;
        return;
      }

      const rows = around.rows
        .filter((r) => out.has(r.entry))
        .map((r) => ({ r, v: project(out.get(r.entry), r.total - r.gw) }))
        .sort((a, b) => b.v.exp - a.v.exp);

      const mine = rows.find((x) => x.r.you);
      if (!mine) {
        $("live-rank-body").innerHTML = `<p class="meta">Your live figures are not available yet.</p>`;
        return;
      }

      const others = rows.filter((x) => !x.r.you).map((x) => x.v.exp);
      $("live-rank-body").innerHTML = `
        <p>Projected total: <strong>${pts(mine.v.exp)}</strong> <span class="muted">(${pts(mine.v.low)} to ${pts(mine.v.high)})</span></p>
        <p class="meta">${whatIf(mine.v, others, rows.length)}</p>
        <div class="table-wrap"><table>
          <thead><tr><th class="n">Pos</th><th>Manager</th><th class="n">Live GW</th><th class="n">Projected</th></tr></thead>
          <tbody>${rows
            .map(
              (x, i) => `<tr${x.r.you ? ' class="you"' : ""}>
                <td class="n">${i + 1}</td>
                <td>${esc(x.r.manager)}</td>
                <td class="n">${pts(x.v.gross)}${x.v.hits ? ` <span class="muted">(−${x.v.hits})</span>` : ""}</td>
                <td class="n">${pts(x.v.exp)}</td>
              </tr>`,
            )
            .join("")}</tbody>
        </table></div>
        <p class="meta">Compared with the ${rows.length} managers around your overall rank, not the whole table. Your overall live rank is estimated from them.</p>`;
    } catch (err) {
      sec.hidden = false;
      $("live-rank-body").textContent = `Could not load your live rank. ${err.message}`;
    }
  }

  // ---------- Standings ----------
  function rowHtml(r) {
    return `<tr data-row="${r.entry}" data-net="${r.gw}">
      <td class="n">${r.rank}</td>
      <td><a href="/manager?id=${r.entry}" data-entry="${r.entry}">${esc(r.manager)}</a><br><span class="muted">${esc(r.team)}</span></td>
      <td data-c="captain">${PENDING}</td>
      <td data-c="chip">${PENDING}</td>
      <td data-c="transfers">${PENDING}</td>
      <td class="n" data-c="gw">${r.gw}</td>
      <td class="n">${r.total}</td>
      <td class="n" data-c="value">${PENDING}</td>
      <td class="n" data-c="live">${PENDING}</td>
      <td class="n" data-c="proj">${PENDING}</td>
      <td class="n" data-c="pos">${PENDING}</td>
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
      d.captainId
        ? `${player(d.captainId)}${d.viceId ? `<br><span class="muted">${player(d.viceId)}</span>` : ""}`
        : DASH,
    );
    set("chip", d.chip ? esc(d.chip) : DASH);
    set(
      "transfers",
      d.transfers.length
        ? d.transfers.map((t) => `${player(t.outId)} → ${player(t.inId)}`).join("<br>")
        : DASH,
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
      if (td.textContent.trim() === "…") td.textContent = DASH;
    });
  }

  async function fillDetails(results) {
    await readyP;
    const chunks = [];
    for (let i = 0; i < results.length; i += BATCH) chunks.push(results.slice(i, i + BATCH));
    for (const chunk of chunks) {
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

  // Fills Live GW, Projected and Live pos, then the What if section for your own row.
  async function fillLive(results) {
    await readyP;
    const { out, isLive } = await scoreAll(results.map((r) => r.entry));
    $("live-status").textContent = isLive
      ? "Matches are in play. Live figures refresh about once a minute."
      : "No matches in play right now. Live points appear during match windows.";

    if (!isLive) {
      results.forEach((r) => ["live", "proj", "pos"].forEach((k) => setCell(r.entry, k, DASH)));
      return;
    }

    const board = results
      .filter((r) => out.has(r.entry))
      .map((r) => ({ entry: r.entry, ...project(out.get(r.entry), r.total - r.gw) }))
      .sort((a, b) => b.exp - a.exp);

    board.forEach((v, i) => {
      setCell(v.entry, "live", `${pts(v.gross)}${v.hits ? ` <span class="muted">(−${v.hits})</span>` : ""}`);
      setCell(v.entry, "proj", `${pts(v.exp)} <span class="muted">${pts(v.low)}–${pts(v.high)}</span>`);
      setCell(v.entry, "pos", String(i + 1));
    });
    results
      .filter((r) => !out.has(r.entry))
      .forEach((r) => ["live", "proj", "pos"].forEach((k) => setCell(r.entry, k, DASH)));

    const mine = board.find((v) => v.entry === Number(session()?.entryId));
    if (mine) {
      const others = board.filter((v) => v !== mine).map((v) => v.exp);
      $("whatif-body").innerHTML = `
        <p>Your projected total is <strong>${pts(mine.exp)}</strong> <span class="muted">(${pts(mine.low)} to ${pts(mine.high)})</span>.</p>
        <p class="meta">${whatIf(mine, others, board.length)}</p>
        <p class="meta">Scenarios use FPL's expected points for players yet to play. Other managers are held at their expected totals. These are estimates, and automatic substitutions are not applied.</p>`;
      $("whatif").hidden = false;
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
      : `<tr><td colspan="11">No managers on this page.</td></tr>`;

    $("prev").hidden = pageNo <= 1;
    $("next").hidden = !data.hasNext;
    $("prev").onclick = () => location.assign(`/leagues?id=${id}&page=${pageNo - 1}`);
    $("next").onclick = () => location.assign(`/leagues?id=${id}&page=${pageNo + 1}`);

    await fillDetails(data.results);
    await fillLive(data.results);
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
    showLiveRank();

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
      const [{ entry }, snap] = await Promise.all([
        api(`/entry/${id}`),
        readyP.then((s) => s ?? api("/snapshot")),
      ]);
      const gw = currentGw(snap);
      const picks = await api(`/picks/${id}/${gw}`).catch(() => null);

      const byId = new Map(snap.players.map((p) => [p.id, p]));
      const positions = new Map(snap.positions.map((p) => [p.id, p.short]));

      const table = (list) => `<table>
        <thead><tr><th>Player</th><th>Team</th><th>Pos</th><th></th></tr></thead>
        <tbody>${list
          .map((pk) => {
            const p = byId.get(pk.element);
            const badge = pk.is_captain ? "Captain" : pk.is_vice_captain ? "Vice" : "";
            return `<tr>
              <td>${player(pk.element)}</td>
              <td>${p ? helpers().teamHtml(p.team) : ""}</td>
              <td>${p ? esc(positions.get(p.element_type)) : ""}</td>
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
