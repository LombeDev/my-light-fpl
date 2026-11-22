/* leagues-table.js: the mini-league table, expandable team views, live projections, your league switcher.
   Page key: league-table. Loads after app.js and team-view.js. */
(() => {
  if (document.body.dataset.page !== "league-table") return;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const ID = /^\d{1,9}$/;
  const SHOW = 25;
  const BATCH = 10;
  const DASH = "–";
  const PENDING = `<span class="muted">…</span>`;
  const SHIRTS = "https://fantasy.premierleague.com/dist/img/shirts/standard";
  const CHIP_CODES = ["WC", "BB", "FH", "TC"];
  const pts = (n) => Math.round(n).toLocaleString();
  const kRank = (n) => (n >= 1000 ? `${Math.round(n / 1000)}K` : String(n));

  let snap = null;
  let gw = 1;
  let playerName = new Map();
  let currentLeague = "";
  let rows = [];
  let shown = 0;
  const mgr = new Map();
  let liveOn = false;
  let liveByEntry = new Map();

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

  const session = () => {
    try {
      return JSON.parse(localStorage.getItem("fpl.session"));
    } catch {
      return null;
    }
  };

  const nameOf = (id) => playerName.get(id) ?? "Unknown";
  const currentGwOf = (s) => (s.events.find((e) => e.current) ?? s.events.find((e) => e.next) ?? s.events[0])?.id ?? 1;

  // ---------- Live maths ----------
  async function scoreAll(ids) {
    const chunks = [];
    for (let i = 0; i < ids.length; i += BATCH) chunks.push(ids.slice(i, i + BATCH));
    const results = await Promise.all(
      chunks.map((c) => api(`/livescore?ids=${c.join(",")}`).catch(() => null)),
    );
    const out = new Map();
    let isLive = false;
    for (const d of results) {
      if (!d) continue;
      isLive = isLive || d.live;
      for (const r of d.rows) out.set(r.entry, r);
    }
    return { out, isLive };
  }

  function project(row, base) {
    const net = row.gross - row.hits;
    const at = (k) => base + net + row.remaining[k];
    return { gross: row.gross, hits: row.hits, net, low: at("low"), exp: at("exp"), high: at("high") };
  }

  const positionOf = (value, others) => others.filter((o) => o > value).length + 1;

  function whatIf(mine, others, total) {
    const at = (v) => positionOf(v, others);
    return `Position if your remaining players score low: <strong>${at(mine.low)}</strong> · expected: <strong>${at(mine.exp)}</strong> · high: <strong>${at(mine.high)}</strong> <span class="muted">of ${total}</span>`;
  }

  function applyLive(list) {
    for (const r of list) {
      const el = document.querySelector(`tr[data-row="${r.entry}"] .lt-live`);
      if (!el) continue;
      const v = liveOn ? liveByEntry.get(r.entry) : null;
      el.textContent = v ? `Live ${pts(v.gross)} · proj ${pts(v.exp)}` : "";
    }
  }

  async function computeLive(list) {
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
      board.forEach((v) => liveByEntry.set(v.entry, v));

      const mine = board.find((v) => v.entry === Number(session()?.entryId));
      if (mine) {
        const others = board.filter((v) => v !== mine).map((v) => v.exp);
        $("whatif-body").innerHTML = `<p>Your projected total is <strong>${pts(mine.exp)}</strong> <span class="muted">(${pts(mine.low)} to ${pts(mine.high)})</span>.</p><p class="meta">${whatIf(mine, others, board.length)}</p>`;
        $("whatif").hidden = false;
      }
    }
    applyLive(rows.slice(0, shown));
  }

  async function showLiveRank() {
    const s = session();
    if (!s) return;
    try {
      const around = await api(`/around/${s.entryId}`);
      const { out, isLive } = await scoreAll(around.rows.map((r) => r.entry));
      $("live-rank").hidden = false;
      if (!isLive) {
        $("live-rank-body").innerHTML = `<p class="meta">No matches in play right now.</p>`;
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
      $("live-rank-body").innerHTML = `<p>Projected total: <strong>${pts(mine.v.exp)}</strong> <span class="muted">(${pts(mine.v.low)} to ${pts(mine.v.high)})</span></p><p class="meta">${whatIf(mine.v, others, list.length)}</p>`;
    } catch (err) {
      $("live-rank").hidden = false;
      $("live-rank-body").textContent = `Could not load your live rank. ${err.message}`;
    }
  }

  // ---------- Table rows ----------
  function rowHtml(r) {
    return `<tr data-row="${r.entry}">
      <td class="lt-name">
        <div class="lt-namewrap">
          <img class="lt-shirt" alt="" loading="lazy" hidden>
          <div class="lt-namecol">
            <a class="lt-team" href="/manager?id=${r.entry}&league=${esc(currentLeague)}" data-entry="${r.entry}">${esc(r.team)}</a>
            <div class="lt-mgr">${esc(r.manager)}</div>
            <button type="button" class="lt-view" data-view="${r.entry}" aria-expanded="false">View Team <span aria-hidden="true">⌄</span></button>
          </div>
        </div>
      </td>
      <td class="lt-pts">
        <div class="lt-gross">${r.gw}</div>
        <div class="lt-total">(${r.total})</div>
        <div class="lt-live"></div>
      </td>
      <td class="lt-rank" data-c="rank">${PENDING}</td>
      <td class="lt-trs" data-c="transfers">${PENDING}</td>
    </tr>`;
  }

  function chipHtml(d) {
    return `<div class="lt-chips">${CHIP_CODES.map((c) => {
      const active = d.chip === c;
      const used = d.chipsUsed.includes(c) && !active;
      return `<span class="lt-chip${active ? " is-active" : ""}">${c}${used ? ` <b class="lt-x">✕</b>` : ""}</span>`;
    }).join("")}</div>`;
  }

  function transfersHtml(d) {
    const cap = d.captainId
      ? `<div class="lt-cap">${esc(nameOf(d.captainId))} <span class="lt-cbadge">C</span></div>`
      : "";
    const moves = d.transfers.length
      ? d.transfers
          .map(
            (t) => `<div class="lt-move"><span class="lt-out">${esc(nameOf(t.outId))}</span> <span class="lt-arrow" aria-hidden="true">›</span> <span class="lt-in">${esc(nameOf(t.inId))}</span></div>`,
          )
          .join("")
      : `<div class="lt-none">No transfers</div>`;
    return `${cap}${chipHtml(d)}${moves}`;
  }

  function fill(d) {
    const tr = document.querySelector(`tr[data-row="${d.entry}"]`);
    if (!tr) return;
    mgr.set(d.entry, d);

    const img = tr.querySelector(".lt-shirt");
    if (d.captainShirt) {
      img.src = `${SHIRTS}/shirt_${d.captainShirt}-66.png`;
      img.hidden = false;
    }

    const hit = d.hit > 0 ? ` <span class="lt-hit">(−${d.hit})</span>` : "";
    tr.querySelector(".lt-gross").innerHTML = `${d.gross}${hit}`;
    tr.querySelector('[data-c="rank"]').textContent = d.overallRank ? kRank(d.overallRank) : DASH;
    tr.querySelector('[data-c="transfers"]').innerHTML = transfersHtml(d);
  }

  function blank(r) {
    const tr = document.querySelector(`tr[data-row="${r.entry}"]`);
    if (!tr) return;
    tr.querySelector('[data-c="rank"]').textContent = DASH;
    tr.querySelector('[data-c="transfers"]').textContent = DASH;
  }

  async function fillDetails(list) {
    for (let i = 0; i < list.length; i += BATCH) {
      const chunk = list.slice(i, i + BATCH);
      try {
        const { managers } = await api(`/managers?ids=${chunk.map((r) => r.entry).join(",")}`);
        const got = new Set(managers.map((m) => m.entry));
        managers.forEach(fill);
        chunk.filter((r) => !got.has(r.entry)).forEach(blank);
      } catch {
        chunk.forEach(blank);
      }
    }
  }

  function updateMore() {
    const btn = $("more-league");
    const left = rows.length - shown;
    btn.hidden = left <= 0;
    btn.textContent = `Show more (${left} left)`;
  }

  function showMore() {
    const start = shown;
    shown = Math.min(rows.length, shown + SHOW);
    const batch = rows.slice(start, shown);
    if (batch.length) {
      $("rows").insertAdjacentHTML("beforeend", batch.map(rowHtml).join(""));
      fillDetails(batch);
      applyLive(batch);
    }
    updateMore();
  }

  // ---------- Team view inside a row ----------
  function closeTeam(entry) {
    document.querySelector(`tr[data-detail="${entry}"]`)?.remove();
    const btn = document.querySelector(`[data-view="${entry}"]`);
    if (btn) {
      btn.setAttribute("aria-expanded", "false");
      btn.innerHTML = `View Team <span aria-hidden="true">⌄</span>`;
    }
  }

  async function toggleTeam(entry, btn) {
    if (document.querySelector(`tr[data-detail="${entry}"]`)) return closeTeam(entry);

    const row = document.querySelector(`tr[data-row="${entry}"]`);
    btn.setAttribute("aria-expanded", "true");
    btn.innerHTML = `Hide Team <span aria-hidden="true">⌃</span>`;

    const detail = document.createElement("tr");
    detail.dataset.detail = String(entry);
    detail.innerHTML = `<td colspan="4" class="lt-detail"><div class="tv-slot"></div></td>`;
    row.after(detail);
    const slot = detail.querySelector(".tv-slot");

    try {
      const [picks, data] = await Promise.all([
        api(`/picks/${entry}/${gw}`),
        mgr.has(entry) ? Promise.resolve({ managers: [mgr.get(entry)] }) : api(`/managers?ids=${entry}`),
      ]);
      const d = data.managers[0] ?? {};
      const live = window.FPL?.live?.() ?? new Map();
      window.TEAMVIEW.render(slot, picks, {
        snap,
        live,
        hasLive: live.size > 0,
        gw,
        gross: d.gross ?? picks.entry_history?.points ?? 0,
        rank: d.overallRank ?? null,
      });
    } catch (err) {
      slot.textContent = `Could not load team. ${err.message}`;
    }
  }

  // ---------- Header ----------
  function setHeader(name, id) {
    $("title").textContent = name;
    document.title = `${name} · FPL`;
    $("gw-label").textContent = `Gameweek ${gw}`;
    $("sub").textContent = "Tap View Team to see a manager's squad for this gameweek.";
    $("act-open").href = `https://fantasy.premierleague.com/leagues/${id}/standings/c`;
    $("act-open").hidden = false;
    $("act-close").hidden = false;
  }

  // ---------- Your leagues switcher ----------
  function setupMenu() {
    const btn = $("lg-btn");
    const menu = $("lg-menu");
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
      /* not signed in, or FPL unavailable */
    }
  }

  // ---------- Load a league ----------
  async function loadLeague(id, pageNo) {
    currentLeague = id;
    const data = await api(`/league/${id}?page=${pageNo}`);

    rows = data.results;
    shown = 0;
    mgr.clear();
    liveOn = false;
    liveByEntry = new Map();

    setHeader(data.league, id);
    $("meta").textContent = `Page ${pageNo} · ${rows.length} managers`;
    $("rows").innerHTML = rows.length
      ? ""
      : `<tr><td colspan="4" class="lt-empty">No managers on this page.</td></tr>`;

    $("prev").hidden = pageNo <= 1;
    $("next").hidden = !data.hasNext;
    $("prev").onclick = () => location.assign(`/leagues?id=${id}&page=${pageNo - 1}`);
    $("next").onclick = () => location.assign(`/leagues?id=${id}&page=${pageNo + 1}`);

    showMore();
    computeLive(rows);
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

    $("rows").addEventListener("click", (e) => {
      const view = e.target.closest("[data-view]");
      if (view) return toggleTeam(Number(view.dataset.view), view);
      const back = e.target.closest("[data-tv-back]");
      if (back) closeTeam(back.closest("tr[data-detail]")?.dataset.detail);
    });
    $("more-league").addEventListener("click", showMore);

    showMyLeagues();
    showLiveRank();

    if (!id) {
      $("meta").textContent = "Enter a classic league ID, or pick one of your leagues.";
      return;
    }
    if (!ID.test(id)) {
      $("meta").textContent = "Enter a numeric league ID.";
      return;
    }
    loadLeague(id, pageNo).catch((err) => {
      $("meta").textContent = err.message;
      $("rows").innerHTML = "";
    });
  }

  // ---------- Boot ----------
  readyP.then((s) => {
    snap = s;
    gw = currentGwOf(s);
    playerName = new Map(s.players.map((p) => [p.id, p.web_name]));
    document.querySelectorAll('nav a[href="/leagues"]').forEach((a) => a.setAttribute("aria-current", "page"));
    initLeagues();
  });
})();
