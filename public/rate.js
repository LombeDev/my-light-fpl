/* rate.js: Rate my team. Our own method, using FPL's public data for the current gameweek.
   1. The squad is checked against the FPL rules (15 players, budget, position quotas, 3 per club).
   2. The best starting XI is found by trying every valid formation and keeping the highest expected points.
   3. The captain is the best expected scorer in that XI. Their points are doubled, or tripled with Triple Captain.
   4. The score is that total as a share of the best possible total from every player, out of 99.
   Expected points come from ep_this, which only exists for the current gameweek. */
(() => {
  if (document.body.dataset.page !== "rate") return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const SHIRTS = "https://fantasy.premierleague.com/dist/img/shirts/standard";
  const KEY = "fpl.rate.squad";
  const KEY_CHIP = "fpl.rate.chip";
  const BUDGET = 1000; // £100.0m, in tenths
  const QUOTA = { 1: 2, 2: 5, 3: 5, 4: 3 };
  const POS = { 1: "GK", 2: "DEF", 3: "MID", 4: "FWD" };
  const POS_NAME = { 1: "Goalkeeper", 2: "Defender", 3: "Midfielder", 4: "Forward" };
  const MAX_CLUB = 3;
  const LIST_LIMIT = 60;
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
  const ceilings = new Map(); // chip -> best possible result

  const state = {
    squad: [],
    pos: 0,
    team: 0,
    q: "",
    pmin: 38,
    pmax: 158,
    omin: 0,
    omax: 100,
    chip: "standard",
  };

  const money = (tenths) => `£${(tenths / 10).toFixed(1)}m`;
  const epOf = (p) => Number(p.ep_this) || 0;
  const ownOf = (p) => Number(p.selected_by_percent) || 0;
  const shirtImg = (p) => {
    const t = teamById.get(p.team);
    const gk = p.element_type === 1;
    return t?.code
      ? `<img class="rt-shirt" src="${SHIRTS}/shirt_${t.code}${gk ? "_1" : ""}-66.png" alt="" loading="lazy">`
      : "";
  };

  // ---------- Storage ----------
  function readSquad() {
    try {
      const ids = JSON.parse(localStorage.getItem(KEY) ?? "[]");
      return Array.isArray(ids) ? ids.filter((id) => byId.has(id)).slice(0, 15) : [];
    } catch {
      return [];
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state.squad));
      localStorage.setItem(KEY_CHIP, state.chip);
    } catch {
      // Storage may be blocked. The squad still works for this visit.
    }
  }

  // ---------- Rules ----------
  function ruleIssues(ids) {
    const issues = [];
    const players = ids.map((id) => byId.get(id)).filter(Boolean);
    const missing = 15 - ids.length;
    if (missing > 0) issues.push(`Pick ${missing} more player${missing === 1 ? "" : "s"}.`);

    const total = players.reduce((s, p) => s + p.now_cost, 0);
    if (total > BUDGET) issues.push(`Over budget by ${money(total - BUDGET)}.`);

    for (const type of [1, 2, 3, 4]) {
      const n = players.filter((p) => p.element_type === type).length;
      if (n > QUOTA[type]) issues.push(`Too many ${POS[type]}s: ${n} of ${QUOTA[type]} allowed.`);
    }

    const clubs = new Map();
    for (const p of players) clubs.set(p.team, (clubs.get(p.team) ?? 0) + 1);
    for (const [team, n] of clubs) {
      if (n > MAX_CLUB) {
        issues.push(`Too many from ${teamById.get(team)?.short ?? "one club"}: ${n} of ${MAX_CLUB} allowed.`);
      }
    }
    return issues;
  }

  // ---------- Best XI ----------
  // Tries every formation with 1 GK, 3 to 5 DEF, 2 to 5 MID and 1 to 3 FWD, and keeps the highest total.
  function bestXI(pool, chip) {
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
    const multiplier = chip === "tc" ? 3 : 2;
    return { ...best, captain, points: best.total + epOf(captain) * (multiplier - 1) };
  }

  function ceilingFor(chip) {
    if (!ceilings.has(chip)) {
      ceilings.set(chip, bestXI([...byId.values()], chip));
    }
    return ceilings.get(chip);
  }

  function gradeOf(score) {
    return GRADES.find(([min]) => score >= min)?.[1] ?? "F";
  }

  // ---------- Pitch ----------
  function pitchSlots() {
    // Fill each row with the squad's players of that position, then empty slots for the rest.
    for (const type of [1, 2, 3, 4]) {
      const row = $(`rt-row-${type}`);
      const players = state.squad.map((id) => byId.get(id)).filter((p) => p && p.element_type === type);
      const slots = [];
      for (let i = 0; i < QUOTA[type]; i++) {
        const p = players[i];
        if (p) {
          slots.push(`<div class="rt-slot is-filled">
            ${shirtImg(p)}
            <span class="rt-slot-name">${esc(p.web_name)}</span>
            <span class="rt-slot-price">${money(p.now_cost)}</span>
            <button type="button" class="rt-slot-x" data-remove="${p.id}" aria-label="Remove ${esc(p.web_name)}">×</button>
          </div>`);
        } else {
          slots.push(`<button type="button" class="rt-slot is-empty" data-pos="${type}" aria-label="Pick a ${POS_NAME[type].toLowerCase()}">
            <span class="rt-plus" aria-hidden="true">+</span>
            <span class="rt-slot-pos">${POS[type]}</span>
          </button>`);
        }
      }
      row.innerHTML = slots.join("");
    }
  }

  // ---------- Score card and best XI ----------
  function renderScore() {
    const issues = ruleIssues(state.squad);
    const full = state.squad.length === 15;
    const pool = state.squad.map((id) => byId.get(id)).filter(Boolean);
    const result = full && pool.length ? bestXI(pool, state.chip) : null;
    const ceiling = result ? ceilingFor(state.chip) : null;

    $("rt-issues").innerHTML = issues.map((i) => `<li>${esc(i)}</li>`).join("");

    const ladder = document.querySelectorAll(".rt-ladder [data-g]");
    if (!result || !ceiling || ceiling.points <= 0) {
      $("rt-num").textContent = "0";
      ladder.forEach((el) => el.classList.remove("is-on"));
      $("rt-msg").textContent = full
        ? "Fix the issues below to see your rating."
        : `Pick ${15 - state.squad.length} more player${15 - state.squad.length === 1 ? "" : "s"} to get your rating. Tap any slot on the pitch to start.`;
      $("rt-best").innerHTML = "";
      $("rt-xpts").textContent = "–";
    } else {
      const score = Math.min(99, Math.round((result.points / ceiling.points) * 99));
      const letter = gradeOf(score);
      $("rt-num").textContent = String(score);
      ladder.forEach((el) => el.classList.toggle("is-on", el.dataset.g === letter));
      $("rt-msg").textContent = issues.length
        ? "Rating shown, but the squad breaks a rule, so it can't be played as is."
        : `Grade ${letter}. Best XI: ${result.points.toFixed(1)} expected points against a best possible ${ceiling.points.toFixed(1)}.`;
      $("rt-xpts").textContent = result.total.toFixed(1);
      $("rt-best").innerHTML = `
        <h2>Best XI · ${esc(result.formation)}</h2>
        <p class="rt-msg">Captain: ${esc(result.captain.web_name)}${state.chip === "tc" ? " (tripled)" : " (doubled)"}</p>
        <ul class="rt-xilist">${result.xi
          .map(
            (p) => `<li>${shirtImg(p)}<span class="rt-name">${esc(p.web_name)}${
              p.id === result.captain.id ? ` <span class="rt-cap">C</span>` : ""
            }</span><span class="rt-pos">${POS[p.element_type]}</span><span class="rt-ep">${epOf(p).toFixed(2)}</span></li>`,
          )
          .join("")}</ul>`;
    }

    const value = state.squad.reduce((s, id) => s + (byId.get(id)?.now_cost ?? 0), 0);
    $("rt-value").textContent = money(value);
  }

  // ---------- Player table ----------
  function filteredPlayers() {
    const needle = state.q.trim().toLowerCase();
    return [...byId.values()]
      .filter((p) => !state.pos || p.element_type === state.pos)
      .filter((p) => !state.team || p.team === state.team)
      .filter((p) => p.now_cost >= state.pmin && p.now_cost <= state.pmax)
      .filter((p) => ownOf(p) >= state.omin && ownOf(p) <= state.omax)
      .filter((p) => !needle || p.web_name.toLowerCase().includes(needle))
      .sort((a, b) => epOf(b) - epOf(a) || a.web_name.localeCompare(b.web_name));
  }

  function renderTable() {
    const all = filteredPlayers();
    const rows = all.slice(0, LIST_LIMIT);
    const inSquad = new Set(state.squad);
    const full = state.squad.length >= 15;

    $("rt-rows").innerHTML = rows.length
      ? rows
          .map((p) => {
            const added = inSquad.has(p.id);
            const t = teamById.get(p.team);
            const btn = added
              ? `<button type="button" class="rt-circle is-on" data-remove="${p.id}" aria-label="Remove ${esc(p.web_name)}">−</button>`
              : `<button type="button" class="rt-circle" data-add="${p.id}" aria-label="Add ${esc(p.web_name)}" ${full ? "disabled" : ""}>+</button>`;
            return `<tr>
              <td>
                <div class="rt-player">
                  ${shirtImg(p)}
                  <div>
                    <div class="rt-name">${esc(p.web_name)}</div>
                    <div class="rt-sub">${esc(t?.short ?? "")} · ${POS[p.element_type]}</div>
                  </div>
                </div>
              </td>
              <td class="n">${(p.now_cost / 10).toFixed(1)}</td>
              <td class="n">${ownOf(p).toFixed(1)}</td>
              <td class="n">${epOf(p).toFixed(1)}</td>
              <td class="n">${btn}</td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="5" class="rt-empty">No players match these filters.</td></tr>`;

    $("rt-count").textContent = all.length > LIST_LIMIT
      ? `Showing ${LIST_LIMIT} of ${all.length} players. Narrow the filters to see more.`
      : `${all.length} players`;
  }

  function renderPills() {
    document.querySelectorAll(".rt-pills [data-pos]").forEach((b) => {
      b.setAttribute("aria-pressed", String(Number(b.dataset.pos) === state.pos));
    });
  }

  function renderAll() {
    save();
    pitchSlots();
    renderScore();
    renderTable();
    renderPills();
  }

  // ---------- Import ----------
  function currentGw() {
    return (snap.events.find((e) => e.current) ?? snap.events.find((e) => e.next) ?? snap.events[0])?.id ?? 1;
  }

  async function importTeam(entryId) {
    $("rt-import-msg").textContent = "Loading your team…";
    try {
      const res = await fetch(`/api/picks/${entryId}/${currentGw()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      const ids = (data.picks ?? []).map((pk) => pk.element).filter((id) => byId.has(id));
      if (!ids.length) throw new Error("No picks were found for this team.");
      state.squad = ids.slice(0, 15);
      $("rt-import-msg").textContent = `Imported ${state.squad.length} players.`;
      renderAll();
    } catch (err) {
      $("rt-import-msg").textContent = `Could not import. ${err.message}`;
    }
  }

  // ---------- Wiring ----------
  function wire() {
    $("rt-import-btn").addEventListener("click", () => {
      state.open = !state.open;
      $("rt-import").hidden = !state.open;
      $("rt-import-btn").setAttribute("aria-expanded", String(state.open));
    });

    $("rt-import").addEventListener("submit", (e) => {
      e.preventDefault();
      const id = $("rt-id").value.trim();
      if (!/^\d{1,9}$/.test(id)) {
        $("rt-import-msg").textContent = "Enter a numeric FPL team ID.";
        return;
      }
      importTeam(id);
    });

    $("rt-reset").addEventListener("click", () => {
      state.squad = [];
      renderAll();
    });
    $("rt-clear").addEventListener("click", () => {
      state.squad = [];
      renderAll();
    });

    $("rt-chip").addEventListener("change", (e) => {
      state.chip = e.target.value;
      renderAll();
    });

    $("rt-q").addEventListener("input", (e) => {
      state.q = e.target.value;
      renderTable();
    });
    $("rt-team").addEventListener("change", (e) => {
      state.team = Number(e.target.value);
      renderTable();
    });

    const priceMin = $("rt-pmin");
    const priceMax = $("rt-pmax");
    const ownMin = $("rt-omin");
    const ownMax = $("rt-omax");
    const onPrice = () => {
      state.pmin = Math.min(Number(priceMin.value), Number(priceMax.value));
      state.pmax = Math.max(Number(priceMin.value), Number(priceMax.value));
      $("rt-price-label").textContent = `£${(state.pmin / 10).toFixed(1)} – £${(state.pmax / 10).toFixed(1)}`;
      renderTable();
    };
    const onOwn = () => {
      state.omin = Math.min(Number(ownMin.value), Number(ownMax.value));
      state.omax = Math.max(Number(ownMin.value), Number(ownMax.value));
      $("rt-own-label").textContent = `${state.omin}% – ${state.omax}%`;
      renderTable();
    };
    priceMin.addEventListener("input", onPrice);
    priceMax.addEventListener("input", onPrice);
    ownMin.addEventListener("input", onOwn);
    ownMax.addEventListener("input", onOwn);

    // One delegated handler covers the table, the pitch and the position pills.
    document.addEventListener("click", (e) => {
      const add = e.target.closest("[data-add]");
      if (add) {
        const id = Number(add.dataset.add);
        if (state.squad.length < 15 && !state.squad.includes(id)) state.squad.push(id);
        renderAll();
        return;
      }
      const rm = e.target.closest("[data-remove]");
      if (rm) {
        const id = Number(rm.dataset.remove);
        state.squad = state.squad.filter((x) => x !== id);
        renderAll();
        return;
      }
      const pos = e.target.closest("[data-pos]");
      if (pos) {
        state.pos = Number(pos.dataset.pos);
        renderAll();
      }
    });
  }

  function fillFilters() {
    const sel = $("rt-team");
    [...snap.teams]
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((t) => sel.append(new Option(t.name, String(t.id))));
  }

  document.addEventListener("fpl:ready", (e) => {
    if (!e.detail) return;
    snap = e.detail;
    byId = new Map(snap.players.map((p) => [p.id, p]));
    teamById = new Map(snap.teams.map((t) => [t.id, t]));
    fillFilters();

    try {
      const saved = localStorage.getItem(KEY_CHIP);
      if (saved === "tc" || saved === "standard") {
        state.chip = saved;
        $("rt-chip").value = saved;
      }
    } catch {
      // Storage may be blocked. The default chip is used.
    }

    state.squad = readSquad();
    wire();
    renderAll();
  });
})();
