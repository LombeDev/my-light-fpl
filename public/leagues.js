/* leagues.js: standings in groups of 25, live points and projections, your live rank, what-if scenarios,
   a dropdown of your leagues, and pitch-view manager pages. Waits for app.js to load the snapshot before drawing shirts. */
(() => {
  const page = document.body.dataset.page;
  if (page !== "leagues" && page !== "manager") return;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const ID = /^\d{1,9}$/;
  const BATCH = 10;
  const SHOW = 25; // managers shown at a time on a league page
  const EO_SAMPLE = 25; // managers used for league effective ownership on a manager page
  const DASH = "–";
  const PENDING = `<span class="muted">…</span>`;
  const pts = (n) => Math.round(n).toLocaleString();

  let currentLeague = "";
  let rows = []; // managers on this league page
  let shown = 0; // how many of `rows` are rendered
  let liveReady = false;
  let liveOn = false;
  let liveByEntry = new Map(); // entry -> projection, with its live position

  // Resolves once app.js has loaded the snapshot (or failed to), so shirts can be drawn.
  const readyP = new Promise((resolve) =>
    document.addEventListener("fpl:ready", (e) => resolve(e.detail), { once: true }),
  );

  const helpers = () =>
    window.FPL ?? {
      teamHtml: () => "",
      playerHtml: () => "",
      fdr: () => "",
      pitchCard: () => "",
      pitchHtml: () => "",
      live: () => new Map(),
      gw: 1,
    };
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

  // ---------- Dropdown of your leagues ----------
  function setupMenu() {
    const btn = $("lg-btn");
    const menu = $("lg-menu");
    if (!btn || btn.dataset.ready) return;
    btn.dataset.ready = "1";

    const setOpen = (open) => {
      menu.hidden = !open;
      btn.setAttribute("aria-expanded", String(open));
    };

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      setOpen(menu.hidden);
    });
    document.addEventListener("click", (e) => {
      if (!menu.contains(e.target)) setOpen(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") setOpen(false);
    });
  }

  async function showMyLeagues() {
    const s = session();
    if (!s) return;
    try {
      const { leagues } = await api("/me/leagues", { headers: { Authorization: `Bearer ${s.token}` } });
      if (!leagues.length) return;

      const open = new URLSearchParams(location.search).get("id");
      $("mine-list").innerHTML = leagues
        .map(
          (l) =>
            `<li><a href="/leagues?id=${l.id}" aria-current="${String(String(l.id) === open)}">${esc(l.name)}${
              l.rank ? ` <span class="muted">· rank ${Number(l.rank).toLocaleString()}</span>` : ""
            }</a></li>`,
        )
        .join("");
      $("mine").hidden = false;
      setupMenu();
    } catch {
      /* not signed in, or FPL unavailable: keep the dropdown hidden */
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

      const list = around.rows
        .filter((r) => out.has(r.entry))
        .map((r) => ({ r, v: project(out.get(r.entry), r.total - r.gw) }))
        .sort((a, b) => b.v.exp - a.v.exp);

      const mine = list.find((x) => x.r.you);
      if (!mine) {
        $("live-rank-body").innerHTML = `<p class="meta">Your live figures are not available yet.</p>`;
        return;
      }

      const others = list.filter((x) => !x.r.you).map((x) => x.v.exp);
      $("live-rank-body").innerHTML = `
        <p>Projected total: <strong>${pts(mine.v.exp)}</strong> <span class="muted">(${pts(mine.v.low)} to ${pts(mine.v.high)})</span></p>
        <p class="meta">${whatIf(mine.v, others, list.length)}</p>
        <div class="table-wrap"><table>
          <thead><tr><th class="n">Pos</th><th>Manager</th><th class="n">Live GW</th><th class="n">Projected</th></tr></thead>
          <tbody>${list
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
        <p class="meta">Compared with the ${list.length} managers around your overall rank, not the whole table. Your overall live rank is estimated from them.</p>`;
    } catch (err) {
      sec.hidden = false;
      $("live-rank-body").textContent = `Could not load your live rank. ${err.message}`;
    }
  }

  // ---------- Standings ----------
  function rowHtml(r) {
    const link = `/manager?id=${r.entry}${currentLeague ? `&league=${currentLeague}` : ""}`;
    return `<tr data-row="${r.entry}" data-net="${r.gw}">
      <td class="n">${r.rank}</td>
      <td><a href="${link}" data-entry="${r.entry}">${esc(r.manager)}</a><br><span class="muted">${esc(r.team)}</span></td>
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

  // Any placeholder left after a batch becomes a dash, so no row stays pending forever.
  function blank(entry) {
    const tr = document.querySelector(`tr[data-row="${entry}"]`);
    if (!tr) return;
    tr.querySelectorAll("[data-c]").forEach((td) => {
      if (td.textContent.trim() === "…") td.textContent = DASH;
    });
  }

  // Fetches captain, chip, transfers and value for these rows only.
  async function fillDetails(list) {
    await readyP;
    for (let i = 0; i < list.length; i += BATCH) {
      const chunk = list.slice(i, i + BATCH);
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

  // Writes live cells for these rows, from projections worked out for the whole page.
  function applyLiveCells(list) {
    for (const r of list) {
      const v = liveOn ? liveByEntry.get(r.entry) : null;
      const cells = { live: DASH, proj: DASH, pos: DASH };
      if (v) {
        cells.live = `${pts(v.gross)}${v.hits ? ` <span class="muted">(−${v.hits})</span>` : ""}`;
        cells.proj = `${pts(v.exp)} <span class="muted">${pts(v.low)}–${pts(v.high)}</span>`;
        cells.pos = String(v.pos);
      }
      for (const k of Object.keys(cells)) setCell(r.entry, k, cells[k]);
    }
  }

  // Works out live figures for every manager on the page, so positions match the full page,
  // then fills the rows that are currently shown.
  async function computeLive(list) {
    await readyP;
    const { out, isLive } = await scoreAll(list.map((r) => r.entry));
    liveOn = isLive;
    liveByEntry = new Map();

    $("live-status").textContent = isLive
      ? "Matches are in play. Live figures refresh about once a minute."
      : "No matches in play right now. Live points appear during match windows.";

    if (isLive) {
      const board = list
        .filter((r) => out.has(r.entry))
        .map((r) => ({ entry: r.entry, ...project(out.get(r.entry), r.total - r.gw) }))
        .sort((a, b) => b.exp - a.exp);
      board.forEach((v, i) => liveByEntry.set(v.entry, { ...v, pos: i + 1 }));

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

    liveReady = true;
    applyLiveCells(rows.slice(0, shown));
  }

  // Shows the next group of managers and fetches their details.
  function showMore() {
    const start = shown;
    shown = Math.min(rows.length, shown + SHOW);
    const batch = rows.slice(start, shown);
    if (batch.length) {
      $("rows").insertAdjacentHTML("beforeend", batch.map(rowHtml).join(""));
      fillDetails(batch);
      if (liveReady) applyLiveCells(batch);
    }
    updateMore();
  }

  // The "Show more" button sits under the standings table.
  function updateMore() {
    let btn = $("more-league");
    if (!btn) {
      const p = document.createElement("p");
      btn = document.createElement("button");
      btn.id = "more-league";
      btn.type = "button";
      p.append(btn);
      $("rows").closest(".table-wrap").after(p);
      btn.addEventListener("click", showMore);
    }
    const left = rows.length - shown;
    btn.hidden = left <= 0;
    btn.textContent = `Show more (${left} left)`;
  }

  async function loadLeague(id, pageNo) {
    currentLeague = id;
    $("meta").textContent = "";
    const data = await api(`/league/${id}?page=${pageNo}`);

    rows = data.results;
    shown = 0;
    liveReady = false;

    $("title").textContent = data.league;
    $("lg-label").textContent = data.league;
    document.title = `${data.league} · FPL`;
    $("meta").textContent = `Page ${pageNo} · ${rows.length} managers · ${SHOW} shown at a time`;
    $("rows").innerHTML = "";
    if (!rows.length) $("rows").innerHTML = `<tr><td colspan="11">No managers on this page.</td></tr>`;

    $("prev").hidden = pageNo <= 1;
    $("next").hidden = !data.hasNext;
    $("prev").onclick = () => location.assign(`/leagues?id=${id}&page=${pageNo - 1}`);
    $("next").onclick = () => location.assign(`/leagues?id=${id}&page=${pageNo + 1}`);

    computeLive(rows);
    showMore();
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

  // ---------- Effective ownership for a manager page ----------

  // Effective ownership across the first managers in a league. Owned share plus captain share.
  async function leagueEo(leagueId, gw) {
    if (!ID.test(leagueId)) return null;
    try {
      const data = await api(`/league/${leagueId}?page=1`);
      const ids = data.results.slice(0, EO_SAMPLE).map((r) => r.entry);
      const owned = new Map();
      const captained = new Map();
      let n = 0;

      for (let i = 0; i < ids.length; i += BATCH) {
        const picks = await Promise.all(
          ids.slice(i, i + BATCH).map((e) => api(`/picks/${e}/${gw}`).catch(() => null)),
        );
        for (const p of picks) {
          if (!p || !Array.isArray(p.picks)) continue;
          n += 1;
          for (const pk of p.picks) {
            owned.set(pk.element, (owned.get(pk.element) ?? 0) + 1);
            if (pk.is_captain) captained.set(pk.element, (captained.get(pk.element) ?? 0) + 1);
          }
        }
      }
      if (!n) return null;

      const eo = new Map();
      for (const [id, c] of owned) {
        eo.set(id, Math.round(((c + (captained.get(id) ?? 0)) / n) * 1000) / 10);
      }
      return {
        eo,
        note: `Green: effective ownership across ${n} managers in this league (first ${EO_SAMPLE}). Grey: GW${gw} points, shown during match times.`,
      };
    } catch {
      return null;
    }
  }

  // Fallback when no league is given: effective ownership from the top-500 sample.
  async function sampleEo(gw) {
    try {
      const s = await api("/sample");
      if (!s.sampled) return null;
      const eo = new Map();
      for (const id of new Set([...Object.keys(s.owned), ...Object.keys(s.captain ?? {})])) {
        eo.set(Number(id), Math.round(((s.owned[id] ?? 0) + (s.captain?.[id] ?? 0)) * 10) / 10);
      }
      return {
        eo,
        note: `Green: effective ownership across the top ${s.sampled} managers (owned plus captained). Grey: GW${gw} points, shown during match times.`,
      };
    } catch {
      return null;
    }
  }

  // ---------- Manager page (pitch view) ----------
  const currentGw = (snap) =>
    (snap.events.find((e) => e.current) ?? snap.events.find((e) => e.next) ?? snap.events[0])?.id ?? 1;

  async function initManager() {
    const params = new URLSearchParams(location.search);
    const id = params.get("id") ?? "";
    const leagueId = params.get("league") ?? "";
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
      const eoData = (await leagueEo(leagueId, gw)) ?? (await sampleEo(gw));

      const rank = entry.summary_overall_rank?.toLocaleString() ?? "—";
      const gwPts = picks?.entry_history?.points;

      $("title").textContent = entry.name;
      document.title = `${entry.name} · FPL`;

      out.innerHTML = `
        <p class="meta">${esc(entry.player_first_name)} ${esc(entry.player_last_name)} · ${entry.summary_overall_points} pts · rank ${rank}${
          gwPts !== undefined ? ` · GW${gw}: ${gwPts} pts` : ""
        }</p>
        <p class="meta" id="pitch-note"></p>
        <div id="pitch-wrap"></div>`;

      $("pitch-note").textContent = eoData
        ? `Percentages show effective ownership from the managers in this league or the top sample. Points show GW${gw}.`
        : `Percentages show effective ownership once the sample has data. Points show GW${gw}.`;

      const draw = () => {
        if (!picks) {
          $("pitch-wrap").innerHTML = `<p class="muted">Picks for gameweek ${gw} are not available yet.</p>`;
          return;
        }
        const F = helpers();
        const live = F.live();
        window.PITCH?.render($("pitch-wrap"), picks, {
          snap,
          eo: eoData?.eo ?? null,
          live,
          hasLive: live.size > 0,
          gw,
        });
      };

      draw();
      document.addEventListener("fpl:live", draw);
    } catch (err) {
      out.textContent = `Could not load manager. ${err.message}`;
    }
  }

  if (page === "leagues") initLeagues();
  if (page === "manager") initManager();
})();
