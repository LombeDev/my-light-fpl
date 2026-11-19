/* planner.js: squad builder, transfers with hit cost, fixture difficulty and fixtures. Starts on fpl:ready from app.js. */
(() => {
  if (document.body.dataset.page !== "planner") return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const money = (tenths) => `£${(tenths / 10).toFixed(1)}m`;

  const KEY = "fpl.squad";        // planned squad
  const BASE = "fpl.baseline";    // current team, used for transfers
  const FT_KEY = "fpl.ft";        // free transfers
  const SESSION = "fpl.session";
  const BUDGET = 1000; // tenths of a million
  const SIZE = 15;
  const QUOTA = { 1: 2, 2: 5, 3: 5, 4: 3 }; // element_type: count
  const CLUB_MAX = 3;
  const HIT = 4;

  let F;
  let snap;
  let byId;
  let positions;
  let horizon = 5;
  let fixtureMap = new Map(); // team id -> [{ opp, home, diff }]
  let squad = [];
  let baseline = [];

  const readList = (key) => {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? [];
    } catch {
      return [];
    }
  };
  const saveList = (key, list) => localStorage.setItem(key, JSON.stringify(list));

  const readSession = () => {
    try {
      return JSON.parse(localStorage.getItem(SESSION));
    } catch {
      return null;
    }
  };

  const spent = () => squad.reduce((sum, id) => sum + byId.get(id).now_cost, 0);
  const countPos = (type) => squad.filter((id) => byId.get(id).element_type === type).length;
  const countClub = (team) => squad.filter((id) => byId.get(id).team === team).length;

  function blockReason(p) {
    if (squad.includes(p.id)) return "In squad";
    if (squad.length >= SIZE) return "Squad full";
    if (countPos(p.element_type) >= QUOTA[p.element_type]) return "Position full";
    if (countClub(p.team) >= CLUB_MAX) return "Club limit";
    if (spent() + p.now_cost > BUDGET) return "Over budget";
    return null;
  }

  // ---------- Fixture difficulty ----------
  // Each team's next `n` unfinished fixtures, in kickoff order.
  function buildFixtures(n) {
    const upcoming = snap.fixtures
      .filter((f) => !f.finished && f.kickoff)
      .sort((a, b) => a.kickoff.localeCompare(b.kickoff));

    const map = new Map();
    const add = (team, opp, home, diff) => {
      const list = map.get(team) ?? [];
      if (list.length < n) {
        list.push({ opp, home, diff });
        map.set(team, list);
      }
    };

    for (const f of upcoming) {
      add(f.home, f.away, true, f.home_difficulty);
      add(f.away, f.home, false, f.away_difficulty);
    }
    fixtureMap = map;
  }

  // Average over rated fixtures only, so a missing rating is never counted as 0.
  function fdrOf(teamId) {
    const list = fixtureMap.get(teamId) ?? [];
    const rated = list.filter((x) => x.diff > 0);
    const avg = rated.length ? rated.reduce((s, x) => s + x.diff, 0) / rated.length : null;
    return { list, avg };
  }

  const sortKey = (teamId) => {
    const { avg } = fdrOf(teamId);
    return avg === null ? Number.POSITIVE_INFINITY : avg;
  };

  function fdrCell(teamId) {
    const { avg } = fdrOf(teamId);
    if (avg === null) return `<td class="n">–</td>`;
    return `<td class="n ${F.fdr(Math.round(avg))}">${avg.toFixed(1)}</td>`;
  }

  function nextCell(teamId) {
    const { list } = fdrOf(teamId);
    if (!list.length) return `<td class="muted">No fixtures</td>`;
    return `<td>${list
      .map((x) => `<span class="chip ${F.fdr(x.diff)}">${F.teamHtml(x.opp)} ${x.home ? "H" : "A"}</span>`)
      .join("")}</td>`;
  }

  function squadFdr() {
    const avgs = squad.map((id) => fdrOf(byId.get(id).team).avg).filter((v) => v !== null);
    return avgs.length ? avgs.reduce((s, v) => s + v, 0) / avgs.length : null;
  }

  // ---------- Init ----------
  document.addEventListener("fpl:ready", (e) => {
    if (e.detail) init(e.detail);
  });

  function init(s) {
    snap = s;
    F = window.FPL;
    byId = new Map(snap.players.map((p) => [p.id, p]));
    positions = new Map(snap.positions.map((p) => [p.id, p.short]));
    squad = readList(KEY).filter((id) => byId.has(id)).slice(0, SIZE);
    baseline = readList(BASE).filter((id) => byId.has(id)).slice(0, SIZE);

    snap.positions.forEach((p) => $("pos").append(new Option(p.short, String(p.id))));
    buildFixtures(horizon);

    const session = readSession();
    $("import").hidden = !session;
    $("ft").value = localStorage.getItem(FT_KEY) ?? "1";

    $("horizon").addEventListener("change", (e) => {
      horizon = Number(e.target.value);
      buildFixtures(horizon);
      render();
    });
    $("import").addEventListener("click", () => importSquad(session));
    $("setbase").addEventListener("click", () => {
      baseline = squad.slice();
      saveList(BASE, baseline);
      render();
    });
    $("clear").addEventListener("click", () => {
      squad = [];
      saveList(KEY, squad);
      render();
    });
    $("ft").addEventListener("change", () => {
      localStorage.setItem(FT_KEY, $("ft").value);
      renderTransfers();
    });
    $("fx-len").addEventListener("change", renderFixtures);
    $("q").addEventListener("input", renderPool);
    $("pos").addEventListener("change", renderPool);
    $("sort").addEventListener("change", renderPool);

    $("squad").addEventListener("click", (e) => {
      const id = Number(e.target.dataset.remove);
      if (!id) return;
      squad = squad.filter((x) => x !== id);
      saveList(KEY, squad);
      render();
    });

    $("pool").addEventListener("click", (e) => {
      const id = Number(e.target.dataset.add);
      if (!id || blockReason(byId.get(id))) return;
      squad.push(id);
      saveList(KEY, squad);
      render();
    });

    $("meta").textContent = `Prices as of ${new Date(snap.generatedAt).toLocaleString()}`;
    render();
    renderFixtures();
  }

  function render() {
    renderSummary();
    renderSquad();
    renderTransfers();
    renderPool();
  }

  function renderSummary() {
    const left = (BUDGET - spent()) / 10;
    const parts = Object.entries(QUOTA)
      .map(([type, q]) => `${positions.get(Number(type))} ${countPos(Number(type))}/${q}`)
      .join(" · ");
    const valid =
      squad.length === SIZE &&
      Object.entries(QUOTA).every(([type, q]) => countPos(Number(type)) === q) &&
      spent() <= BUDGET;

    const sf = squadFdr();
    const fdrText = sf === null ? "" : ` · squad FDR ${sf.toFixed(1)} over next ${horizon}`;

    $("summary").textContent =
      `${squad.length}/${SIZE} players · £${left.toFixed(1)}m left · ${parts}${fdrText}` +
      (valid ? " · Valid squad" : "");

    document.querySelectorAll("[data-h]").forEach((th) => (th.textContent = `FDR next ${horizon}`));
  }

  function renderSquad() {
    $("squad").innerHTML = squad.length
      ? squad
          .map((id) => {
            const p = byId.get(id);
            return `<tr>
              <td>${F.playerHtml(p.id)}</td>
              <td>${F.teamHtml(p.team)}</td>
              <td>${esc(positions.get(p.element_type))}</td>
              <td class="n">${money(p.now_cost)}</td>
              ${fdrCell(p.team)}
              ${nextCell(p.team)}
              <td><button type="button" data-remove="${p.id}">Remove</button></td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="7">No players yet. Add players below or import your squad.</td></tr>`;
  }

  // ---------- Transfers ----------
  function renderTransfers() {
    const box = $("transfers");
    if (!baseline.length) {
      box.innerHTML = `<p class="meta">Set your current team first. Use <strong>Import my squad</strong> when signed in, or <strong>Use this squad as my team</strong> with the squad you have now.</p>`;
      return;
    }

    const outs = baseline.filter((id) => !squad.includes(id));
    const ins = squad.filter((id) => !baseline.includes(id));
    const made = Math.max(outs.length, ins.length);
    const ft = Number($("ft").value);
    const hits = Math.max(0, made - ft);
    const cost = hits * HIT;

    const rows = Array.from({ length: made }, (_, i) => {
      const o = outs[i];
      const n = ins[i];
      return `<tr>
        <td>${o ? F.playerHtml(o) : ""}</td>
        <td>${n ? F.playerHtml(n) : ""}</td>
      </tr>`;
    }).join("");

    box.innerHTML = `
      <p>
        <strong>${made}</strong> transfer${made === 1 ? "" : "s"} · ${ft} free ·
        ${hits} hit${hits === 1 ? "" : "s"}${cost ? ` = <strong>−${cost} pts</strong>` : " = no cost"}
      </p>
      ${
        made
          ? `<div class="table-wrap"><table>
               <thead><tr><th>Out</th><th>In</th></tr></thead>
               <tbody>${rows}</tbody>
             </table></div>`
          : `<p class="meta">No changes from your current team.</p>`
      }
      <p class="meta">Each hit costs 4 points. Set free transfers to what you have available.</p>
    `;
  }

  // ---------- Fixtures ----------
  function renderFixtures() {
    const max = snap.events.length || 38;
    const from = F.gw;
    const to = Math.min(max, from + Number($("fx-len").value) - 1);
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

    const items = snap.fixtures
      .filter((f) => f.gw !== null && f.gw >= from && f.gw <= to)
      .sort((a, b) => a.gw - b.gw || (a.kickoff ?? "").localeCompare(b.kickoff ?? ""));

    $("fx-rows").innerHTML = items.length
      ? items
          .map((f) => {
            const mid = f.started || f.finished ? `${f.home_score ?? 0} – ${f.away_score ?? 0}` : fmt(f.kickoff);
            return `<tr>
              <td class="r ${F.fdr(f.home_difficulty)}">${F.teamHtml(f.home)}</td>
              <td class="c"><span class="muted">GW${f.gw}</span><br>${esc(mid)}</td>
              <td class="${F.fdr(f.away_difficulty)}">${F.teamHtml(f.away)}</td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="3">No fixtures in this range.</td></tr>`;
  }

  // ---------- Pool ----------
  function renderPool() {
    const needle = $("q").value.trim().toLowerCase();
    const posId = Number($("pos").value);
    const mode = $("sort").value;

    const list = snap.players
      .filter(
        (p) =>
          (!posId || p.element_type === posId) &&
          (!needle || p.web_name.toLowerCase().includes(needle)),
      )
      .sort((a, b) => {
        if (mode === "fdr") return sortKey(a.team) - sortKey(b.team) || b.total_points - a.total_points;
        if (mode === "price") return a.now_cost - b.now_cost;
        return b.total_points - a.total_points;
      })
      .slice(0, 60);

    $("pool").innerHTML = list.length
      ? list
          .map((p) => {
            const reason = blockReason(p);
            const label = reason ?? "Add";
            const disabled = reason ? " disabled" : "";
            return `<tr${p.status !== "a" ? ' class="dim"' : ""}>
              <td>${F.playerHtml(p.id)}</td>
              <td>${F.teamHtml(p.team)}</td>
              <td>${esc(positions.get(p.element_type))}</td>
              <td class="n">${money(p.now_cost)}</td>
              <td class="n">${p.total_points}</td>
              ${fdrCell(p.team)}
              ${nextCell(p.team)}
              <td><button type="button" data-add="${p.id}"${disabled}>${label}</button></td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="8">No players match.</td></tr>`;
  }

  // ---------- Import from FPL ----------
  async function importSquad(session) {
    if (!session) return;
    $("meta").textContent = "Importing…";
    try {
      const gw = F.gw;
      const res = await fetch(`/api/picks/${session.entryId}/${gw}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      const ids = data.picks.map((p) => p.element).filter((id) => byId.has(id)).slice(0, SIZE);
      squad = ids.slice();
      baseline = ids.slice();
      saveList(KEY, squad);
      saveList(BASE, baseline);
      render();
      $("meta").textContent = `Imported your squad for gameweek ${gw}.`;
    } catch (err) {
      $("meta").textContent = `Could not import: ${err.message}`;
    }
  }
})();
