/* planner.js: squad builder with fixture difficulty. Starts on fpl:ready from app.js. */
(() => {
  if (document.body.dataset.page !== "planner") return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const money = (tenths) => `£${(tenths / 10).toFixed(1)}m`;

  const KEY = "fpl.squad";
  const SESSION = "fpl.session";
  const BUDGET = 1000; // tenths of a million
  const SIZE = 15;
  const QUOTA = { 1: 2, 2: 5, 3: 5, 4: 3 }; // element_type: count
  const CLUB_MAX = 3;
  const EASY = 2.5;
  const HARD = 3.5;

  let snap;
  let byId;
  let teams;
  let positions;
  let horizon = 5;
  let fixtureMap = new Map(); // team id -> [{ opp, home, diff }]
  let squad = [];

  const readSquad = () => {
    try {
      return JSON.parse(localStorage.getItem(KEY)) ?? [];
    } catch {
      return [];
    }
  };
  const saveSquad = () => localStorage.setItem(KEY, JSON.stringify(squad));

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
  // Builds each team's next `n` unfinished fixtures, in kickoff order.
  // Double gameweeks add two entries, blank gameweeks add none.
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

  // Average difficulty over rated fixtures only, so a missing value is never counted as 0.
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
    const cls = avg <= EASY ? "n fdr-easy" : avg >= HARD ? "n fdr-hard" : "n";
    return `<td class="${cls}">${avg.toFixed(1)}</td>`;
  }

  function nextCell(teamId) {
    const { list } = fdrOf(teamId);
    if (!list.length) return `<td class="muted">No fixtures</td>`;
    return `<td>${list
      .map((x) => `${esc(teams.get(x.opp))} (${x.home ? "H" : "A"}) ${x.diff || "–"}`)
      .join(", ")}</td>`;
  }

  // Average of each player's team FDR, ignoring teams with no rating.
  function squadFdr() {
    const avgs = squad.map((id) => fdrOf(byId.get(id).team).avg).filter((v) => v !== null);
    return avgs.length ? avgs.reduce((s, v) => s + v, 0) / avgs.length : null;
  }

  document.addEventListener("fpl:ready", (e) => init(e.detail));

  function init(s) {
    snap = s;
    byId = new Map(snap.players.map((p) => [p.id, p]));
    teams = new Map(snap.teams.map((t) => [t.id, t.short]));
    positions = new Map(snap.positions.map((p) => [p.id, p.short]));
    squad = readSquad().filter((id) => byId.has(id)).slice(0, SIZE);

    snap.positions.forEach((p) => $("pos").append(new Option(p.short, String(p.id))));
    buildFixtures(horizon);

    const session = readSession();
    $("import").hidden = !session;

    $("horizon").addEventListener("change", (e) => {
      horizon = Number(e.target.value);
      buildFixtures(horizon);
      render();
    });
    $("import").addEventListener("click", () => importSquad(session));
    $("clear").addEventListener("click", () => {
      squad = [];
      saveSquad();
      render();
    });
    $("q").addEventListener("input", renderPool);
    $("pos").addEventListener("change", renderPool);
    $("sort").addEventListener("change", renderPool);

    $("squad").addEventListener("click", (e) => {
      const id = Number(e.target.dataset.remove);
      if (!id) return;
      squad = squad.filter((x) => x !== id);
      saveSquad();
      render();
    });

    $("pool").addEventListener("click", (e) => {
      const id = Number(e.target.dataset.add);
      if (!id || blockReason(byId.get(id))) return;
      squad.push(id);
      saveSquad();
      render();
    });

    $("meta").textContent = `Prices as of ${new Date(snap.generatedAt).toLocaleString()}`;
    render();
  }

  function render() {
    renderSummary();
    renderSquad();
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
              <td>${esc(p.web_name)}</td>
              <td>${esc(teams.get(p.team))}</td>
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
              <td>${esc(p.web_name)}</td>
              <td>${esc(teams.get(p.team))}</td>
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

  async function importSquad(session) {
    if (!session) return;
    $("meta").textContent = "Importing…";
    try {
      const gw =
        (snap.events.find((e) => e.current) ?? snap.events.find((e) => e.next) ?? snap.events[0])?.id ?? 1;
      const res = await fetch(`/api/picks/${session.entryId}/${gw}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      squad = data.picks.map((p) => p.element).filter((id) => byId.has(id)).slice(0, SIZE);
      saveSquad();
      render();
      $("meta").textContent = `Imported your squad for gameweek ${gw}.`;
    } catch (err) {
      $("meta").textContent = `Could not import: ${err.message}`;
    }
  }
})();
