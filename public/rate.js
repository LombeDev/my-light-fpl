/* rate.js: Rate my team. Our own method, using FPL's public data for the current gameweek.
   1. The squad is checked against the FPL rules (15 players, budget, position quotas, 3 per club).
   2. The best starting XI is found by trying every valid formation and keeping the highest expected points.
   3. The captain is the best expected scorer in that XI, and their points count twice.
   4. The score is that total as a share of the best possible total from all players, out of 99.
   Expected points come from ep_this, which only exists for the current gameweek. */
(() => {
  if (document.body.dataset.page !== "rate") return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const SHIRTS = "https://fantasy.premierleague.com/dist/img/shirts/standard";
  const KEY = "fpl.rate.squad";
  const BUDGET = 1000; // £100.0m, in tenths
  const QUOTA = { 1: 2, 2: 5, 3: 5, 4: 3 };
  const POS = { 1: "GK", 2: "DEF", 3: "MID", 4: "FWD" };
  const MAX_PER_CLUB = 3;

  // Our own grade scale, out of 99.
  const GRADES = [
    [97, "S"],
    [93, "A"],
    [85, "B"],
    [75, "C"],
    [60, "D"],
    [0, "F"],
  ];

  let snap = null;
  let byId = new Map();
  let teamById = new Map();
  let squad = []; // player ids, up to 15

  const money = (tenths) => `£${(tenths / 10).toFixed(1)}m`;
  const shirt = (p) => {
    const t = teamById.get(p.team);
    const gk = p.element_type === 1;
    return t?.code ? `<img class="rt-shirt" src="${SHIRTS}/shirt_${t.code}${gk ? "_1" : ""}-66.png" alt="" loading="lazy">` : "";
  };
  const epOf = (p) => Number(p.ep_this) || 0;

  function readSquad() {
    try {
      const ids = JSON.parse(localStorage.getItem(KEY) ?? "[]");
      return Array.isArray(ids) ? ids.filter((id) => byId.has(id)).slice(0, 15) : [];
    } catch {
      return [];
    }
  }

  function saveSquad() {
    try {
      localStorage.setItem(KEY, JSON.stringify(squad));
    } catch {
      // Storage may be blocked; the squad still works for this visit
    }
  }

  // Current gameweek, for the import route.
  function currentGw() {
    return (snap.events.find((e) => e.current) ?? snap.events.find((e) => e.next) ?? snap.events[0])?.id ?? 1;
  }

  // ---------- Rules ----------
  function ruleIssues(ids) {
    const issues = [];
    const players = ids.map((id) => byId.get(id)).filter(Boolean);
    if (ids.length < 15) issues.push(`Pick ${15 - ids.length} more player${15 - ids.length === 1 ? "" : "s"}.`);

    const total = players.reduce((s, p) => s + p.now_cost, 0);
    if (total > BUDGET) issues.push(`Over budget by ${money(total - BUDGET)}.`);

    for (const type of [1, 2, 3, 4]) {
      const n = players.filter((p) => p.element_type === type).length;
      if (n > QUOTA[type]) issues.push(`Too many ${POS[type]}s: ${n} of ${QUOTA[type]} allowed.`);
    }

    const clubs = new Map();
    for (const p of players) clubs.set(p.team, (clubs.get(p.team) ?? 0) + 1);
    for (const [team, n] of clubs) {
      if (n > MAX_PER_CLUB) issues.push(`Too many players from ${teamById.get(team)?.short ?? "one club"}: ${n} of ${MAX_PER_CLUB} allowed.`);
    }
    return issues;
  }

  // ---------- Best XI ----------
  // Tries every formation with 1 GK, 3 to 5 DEF, 2 to 5 MID, 1 to 3 FWD, and keeps the highest total.
  function bestXI(pool) {
    const byPos = { 1: [], 2: [], 3: [], 4: [] };
    for (const p of pool) byPos[p.element_type]?.push(p);
    for (const type of [1, 2, 3, 4]) byPos[type].sort((a, b) => epOf(b) - epOf(a));

    let best = null;
    for (let d = 3; d <= 5; d++) {
      for (let m = 2; m <= 5; m++) {
        const f = 10 - d - m;
        if (f < 1 || f > 3) continue;
        if (byPos[1].length < 1 || byPos[2].length < d || byPos[3].length < m || byPos[4].length < f) continue;
        const xi = [
          ...byPos[1].slice(0, 1),
          ...byPos[2].slice(0, d),
          ...byPos[3].slice(0, m),
          ...byPos[4].slice(0, f),
        ];
        const total = xi.reduce((s, p) => s + epOf(p), 0);
        if (!best || total > best.total) best = { xi, total, formation: `${d}-${m}-${f}` };
      }
    }
    if (!best) return null;

    const captain = best.xi.reduce((a, b) => (epOf(b) > epOf(a) ? b : a));
    return { ...best, captain, points: best.total + epOf(captain) };
  }

  function grade(score) {
    return GRADES.find(([min]) => score >= min)?.[1] ?? "F";
  }

  // ---------- Rendering ----------
  function renderScore() {
    const issues = ruleIssues(squad);
    const full = squad.length === 15;
    const pool = squad.map((id) => byId.get(id)).filter(Boolean);
    const result = full && pool.length ? bestXI(pool) : null;

    let ceiling = null;
    if (result) {
      const all = [...byId.values()].filter((p) => p.status !== "u" && p.status !== "s");
      ceiling = bestXI(all);
    }

    const issueList = $("rt-issues");
    issueList.innerHTML = issues.map((i) => `<li>${esc(i)}</li>`).join("");

    if (!result || !ceiling || ceiling.points <= 0) {
      $("rt-num").textContent = "–";
      $("rt-letter").textContent = "–";
      $("rt-summary").textContent = full
        ? "Fix the issues below to see your rating."
        : `Add ${15 - squad.length} more player${15 - squad.length === 1 ? "" : "s"} to see your rating.`;
      $("rt-xi").innerHTML = "";
      $("rt-formation").textContent = "";
    } else {
      const score = Math.min(99, Math.round((result.points / ceiling.points) * 99));
      const letter = grade(score);
      $("rt-num").textContent = String(score);
      $("rt-letter").textContent = letter;
      $("rt-summary").textContent = issues.length
        ? "Rating shown, but the squad breaks a rule, so it can't be played as is."
        : `Your best XI scores ${result.points.toFixed(1)} expected points, against a best possible ${ceiling.points.toFixed(1)}.`;
      $("rt-formation").textContent = `Formation ${result.formation}. Captain: ${result.captain.web_name} (doubled).`;
      $("rt-xi").innerHTML = `<ul class="rt-xilist">${result.xi
        .map(
          (p) => `<li>${shirt(p)}<span class="rt-name">${esc(p.web_name)}${p.id === result.captain.id ? ` <span class="rt-cap">C</span>` : ""}</span>
            <span class="rt-pos">${POS[p.element_type]}</span><span class="rt-ep">${epOf(p).toFixed(2)}</span></li>`,
        )
        .join("")}</ul>`;
    }

    const value = squad.reduce((s, id) => s + (byId.get(id)?.now_cost ?? 0), 0);
    $("rt-count").textContent = `${squad.length}/15`;
    $("rt-value").textContent = money(value);
    renderSquad();
  }

  function renderSquad() {
    const box = $("rt-squad");
    if (!squad.length) {
      box.innerHTML = `<p class="rt-empty">No players yet. Import your team, or add players below.</p>`;
      return;
    }
    box.innerHTML = `<ul class="rt-list">${squad
      .map((id) => {
        const p = byId.get(id);
        if (!p) return "";
        return `<li>${shirt(p)}<span class="rt-name">${esc(p.web_name)}</span>
          <span class="rt-pos">${POS[p.element_type]} · ${esc(teamById.get(p.team)?.short ?? "")}</span>
          <span class="rt-price">${money(p.now_cost)}</span>
          <button type="button" data-remove="${p.id}" aria-label="Remove ${esc(p.web_name)}">Remove</button></li>`;
      })
      .join("")}</ul>`;
  }

  function renderList() {
    const needle = $("rt-q").value.trim().toLowerCase();
    const pos = Number($("rt-pos").value);
    const club = Number($("rt-club").value);
    const inSquad = new Set(squad);

    const rows = [...byId.values()]
      .filter((p) => (!pos || p.element_type === pos) && (!club || p.team === club))
      .filter((p) => !needle || p.web_name.toLowerCase().includes(needle))
      .sort((a, b) => epOf(b) - epOf(a) || a.web_name.localeCompare(b.web_name))
      .slice(0, 40);

    $("rt-list").innerHTML = rows.length
      ? `<ul class="rt-list">${rows
          .map((p) => {
            const added = inSquad.has(p.id);
            return `<li>${shirt(p)}<span class="rt-name">${esc(p.web_name)}</span>
              <span class="rt-pos">${POS[p.element_type]} · ${esc(teamById.get(p.team)?.short ?? "")}</span>
              <span class="rt-price">${money(p.now_cost)}</span>
              <span class="rt-ep" title="Expected points, this gameweek">${epOf(p).toFixed(2)}</span>
              ${
                added
                  ? `<button type="button" data-remove="${p.id}" aria-label="Remove ${esc(p.web_name)}">Remove</button>`
                  : `<button type="button" data-add="${p.id}" aria-label="Add ${esc(p.web_name)}" ${squad.length >= 15 ? "disabled" : ""}>Add</button>`
              }</li>`;
          })
          .join("")}</ul>`
      : `<p class="rt-empty">No players match. Try another search or filter.</p>`;
  }

  function setMsg(text) {
    $("rt-msg").textContent = text;
  }

  function update() {
    saveSquad();
    renderScore();
    renderList();
  }

  // ---------- Import ----------
  async function importTeam(entryId) {
    setMsg("Loading your team…");
    try {
      const res = await fetch(`/api/picks/${entryId}/${currentGw()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      const ids = (data.picks ?? []).map((pk) => pk.element).filter((id) => byId.has(id));
      if (!ids.length) throw new Error("No picks were found for this team.");
      squad = ids.slice(0, 15);
      setMsg(`Imported ${squad.length} players from team ${entryId}.`);
      update();
    } catch (err) {
      setMsg(`Could not import. ${err.message}`);
    }
  }

  // ---------- Wiring ----------
  function wire() {
    $("rt-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const id = $("rt-id").value.trim();
      if (!/^\d{1,9}$/.test(id)) {
        setMsg("Enter a numeric FPL team ID.");
        return;
      }
      importTeam(id);
    });

    $("rt-clear").addEventListener("click", () => {
      squad = [];
      setMsg("Squad cleared.");
      update();
    });

    // One delegated handler for both the squad list and the search results.
    document.addEventListener("click", (e) => {
      const add = e.target.closest("[data-add]");
      if (add) {
        const id = Number(add.dataset.add);
        if (squad.length < 15 && !squad.includes(id)) squad.push(id);
        update();
        return;
      }
      const rm = e.target.closest("[data-remove]");
      if (rm) {
        const id = Number(rm.dataset.remove);
        squad = squad.filter((x) => x !== id);
        update();
      }
    });

    $("rt-q").addEventListener("input", renderList);
    $("rt-pos").addEventListener("change", renderList);
    $("rt-club").addEventListener("change", renderList);
  }

  function fillClubs() {
    const sel = $("rt-club");
    [...snap.teams]
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((t) => sel.append(new Option(t.name, String(t.id))));
  }

  document.addEventListener("fpl:ready", (e) => {
    if (!e.detail) return;
    snap = e.detail;
    byId = new Map(snap.players.map((p) => [p.id, p]));
    teamById = new Map(snap.teams.map((t) => [t.id, t]));
    fillClubs();
    wire();
    squad = readSquad();
    update();
  });
})();
