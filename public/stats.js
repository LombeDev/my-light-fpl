/* stats.js: the Stats page. A filter bar, a sortable player table with extra columns and presets,
   then double and blank gameweeks, sample ownership, ownership combinations and managers around you.
   Starts on fpl:ready from app.js. */
(() => {
  if (document.body.dataset.page !== "stats") return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const pct = (v) => `${Number(v ?? 0).toFixed(1)}%`;
  const SHIRTS = "https://fantasy.premierleague.com/dist/img/shirts/standard";
  const SESSION = "fpl.session";
  const PAGE = 25;
  const TOP = 10;
  const MAX_EXTRA = 4;

  // Points per match, estimated from minutes at about 90 per match.
  // The snapshot does not store matches played, so this is an estimate.
  const ppmOf = (p) => (p.minutes ? p.total_points / Math.max(1, Math.round(p.minutes / 90)) : 0);

  const STATS = [
    { key: "form", label: "Form", get: (p) => p.form, fmt: (v) => v.toFixed(1) },
    { key: "total", label: "Points", get: (p) => p.total_points, fmt: (v) => v },
    { key: "ppm", label: "Points per match", get: ppmOf, fmt: (v) => v.toFixed(1) },
    { key: "money", label: "Points per £m", get: (p) => p.points_per_million, fmt: (v) => v.toFixed(2) },
    { key: "cost", label: "Cost", get: (p) => p.now_cost, fmt: (v) => `£${(v / 10).toFixed(1)}m` },
    { key: "owned", label: "TSB %", get: (p) => p.selected_by_percent, fmt: (v) => `${v.toFixed(1)}%` },
    { key: "goals", label: "Goals", get: (p) => p.goals, fmt: (v) => v },
    { key: "assists", label: "Assists", get: (p) => p.assists, fmt: (v) => v },
    { key: "xg", label: "xG", get: (p) => p.expected_goals, fmt: (v) => v.toFixed(2) },
    { key: "xa", label: "xA", get: (p) => p.expected_assists, fmt: (v) => v.toFixed(2) },
    { key: "ict", label: "ICT", get: (p) => p.ict, fmt: (v) => v.toFixed(1) },
    { key: "cs", label: "Clean sheets", get: (p) => p.clean_sheets, fmt: (v) => v },
    { key: "bonus", label: "Bonus", get: (p) => p.bonus, fmt: (v) => v },
    { key: "tin", label: "Transfers in", get: (p) => p.transfers_in, fmt: (v) => v.toLocaleString() },
    { key: "mins", label: "Minutes", get: (p) => p.minutes, fmt: (v) => v.toLocaleString() },
  ];

  const statOf = (key) => STATS.find((s) => s.key === key);

  // Columns always shown, in order. Extra columns are added after these.
  const FIXED = ["cost", "owned", "total", "ppm", "form"];
  const HEAD = { cost: "Cost", owned: "TSB %", total: "Pts", ppm: "Pts/match", form: "Form" };
  const labelOf = (key) => HEAD[key] ?? statOf(key).label;
  const cellOf = (key, p) => (key === "ppm" && !p.minutes ? "–" : statOf(key).fmt(statOf(key).get(p)));

  const PRESETS = [
    { name: "Form", stat: "form", extras: [] },
    { name: "Value", stat: "money", extras: ["goals", "assists"] },
    { name: "Attack", stat: "xg", extras: ["goals", "assists", "xa"] },
    { name: "Defence", stat: "cs", extras: ["bonus", "ict"] },
  ];

  document.addEventListener("fpl:ready", (e) => {
    if (e.detail) init(e.detail);
  });

  async function api(path) {
    const res = await fetch(`/api${path}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  // Adds a titled section below the table and returns its note and body elements.
  function section(title) {
    const sec = document.createElement("section");
    sec.innerHTML = `<h2>${esc(title)}</h2><p class="meta note"></p><div class="body"></div>`;
    document.querySelector("main").append(sec);
    return { note: sec.querySelector(".note"), body: sec.querySelector(".body") };
  }

  // head: [{ label, cls }]. rows: HTML string of <tr> rows.
  const table = (head, rows) => `<div class="table-wrap"><table>
    <thead><tr>${head.map((h) => `<th class="${h.cls ?? ""}">${h.label}</th>`).join("")}</tr></thead>
    <tbody>${rows || `<tr><td colspan="${head.length}">No data yet.</td></tr>`}</tbody>
  </table></div>`;

  function init(snap) {
    const F = window.FPL;
    const max = snap.events.length || 38;
    const state = { pos: 0, team: 0, stat: "form", extras: [], photo: true, limit: PAGE };
    const positions = new Map(snap.positions.map((p) => [p.id, p.short]));
    const teamById = new Map(snap.teams.map((t) => [t.id, t]));

    // Filter options
    snap.positions.forEach((p) => $("pos").append(new Option(p.short, String(p.id))));
    [...snap.teams]
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((t) => $("team").append(new Option(t.name, String(t.id))));
    for (let g = 1; g <= max; g++) {
      $("gw-from").append(new Option(`GW${g}`, String(g)));
      $("gw-to").append(new Option(`GW${g}`, String(g)));
    }
    $("gw-from").value = "1";
    $("gw-to").value = String(F.gw);
    STATS.forEach((s) => $("stat").append(new Option(s.label, s.key)));
    $("stat").value = state.stat;

    // Players after the position and team filters, sorted by the chosen stat.
    function sorted() {
      const s = statOf(state.stat);
      return snap.players
        .filter((p) => (!state.pos || p.element_type === state.pos) && (!state.team || p.team === state.team))
        .sort((a, b) => s.get(b) - s.get(a));
    }

    function renderHead() {
      const fixed = FIXED.map(
        (key) =>
          `<th class="${key === state.stat ? "is-sort" : ""}" data-key="${key}">${esc(labelOf(key))}</th>`,
      ).join("");
      const extra = state.extras
        .map(
          (key) =>
            `<th class="${key === state.stat ? "is-sort" : ""}" data-key="${key}">${esc(labelOf(key))}<button type="button" class="st-x" data-remove="${key}" aria-label="Remove ${esc(labelOf(key))} column">×</button></th>`,
        )
        .join("");
      $("st-head").innerHTML = `<tr><th class="st-namecol">Name</th>${fixed}${extra}</tr>`;
    }

    function renderBody() {
      const all = sorted();
      const list = all.slice(0, state.limit);
      const cols = [...FIXED, ...state.extras];

      $("st-body").innerHTML = list.length
        ? list
            .map((p) => {
              const t = teamById.get(p.team);
              const shirt =
                state.photo && t?.code
                  ? `<img class="st-shirt" src="${SHIRTS}/shirt_${t.code}-66.png" alt="" loading="lazy">`
                  : "";
              const name = `<td class="st-namecol"><div class="st-name">${shirt}<div>
                  <div class="st-pname">${esc(p.web_name)}</div>
                  <div class="st-sub">${esc(t?.short ?? "")} · ${esc(positions.get(p.element_type) ?? "")}</div>
                </div></div></td>`;
              const cells = cols
                .map((key) => `<td class="n${key === state.stat ? " is-sort" : ""}">${cellOf(key, p)}</td>`)
                .join("");
              return `<tr>${name}${cells}</tr>`;
            })
            .join("")
        : `<tr><td colspan="${cols.length + 1}">No players match.</td></tr>`;

      const btn = $("st-more");
      btn.hidden = all.length <= state.limit;
      btn.textContent = `Show more (${Math.max(0, all.length - state.limit)} left)`;
      $("meta").textContent = `${all.length} players · sorted by ${statOf(state.stat).label} · season to date`;
    }

    function rerender() {
      renderHead();
      renderBody();
    }

    // Header clicks: sort by that column, or remove an extra column.
    $("st-head").addEventListener("click", (e) => {
      const rm = e.target.closest("[data-remove]");
      if (rm) {
        state.extras = state.extras.filter((k) => k !== rm.dataset.remove);
        rerender();
        return;
      }
      const th = e.target.closest("th[data-key]");
      if (th) {
        state.stat = th.dataset.key;
        state.limit = PAGE;
        $("stat").value = state.stat;
        rerender();
      }
    });

    $("photo").addEventListener("change", (e) => {
      state.photo = e.target.checked;
      renderBody();
    });
    $("pos").addEventListener("change", (e) => {
      state.pos = Number(e.target.value);
      state.limit = PAGE;
      renderBody();
    });
    $("team").addEventListener("change", (e) => {
      state.team = Number(e.target.value);
      state.limit = PAGE;
      renderBody();
    });
    $("stat").addEventListener("change", (e) => {
      state.stat = e.target.value;
      state.limit = PAGE;
      rerender();
    });
    $("add-col").addEventListener("click", () => {
      const key = state.stat;
      if (FIXED.includes(key) || state.extras.includes(key)) {
        $("meta").textContent = "That column is already shown.";
        return;
      }
      if (state.extras.length >= MAX_EXTRA) {
        $("meta").textContent = `You can add up to ${MAX_EXTRA} extra columns.`;
        return;
      }
      state.extras.push(key);
      rerender();
    });

    let presetIndex = -1;
    $("preset").addEventListener("click", () => {
      presetIndex = (presetIndex + 1) % PRESETS.length;
      const pr = PRESETS[presetIndex];
      state.stat = pr.stat;
      state.extras = [...pr.extras];
      state.pos = 0;
      state.team = 0;
      state.limit = PAGE;
      $("pos").value = "0";
      $("team").value = "0";
      $("stat").value = state.stat;
      rerender();
      $("meta").textContent = `Loaded the ${pr.name} preset.`;
    });

    $("st-more").addEventListener("click", () => {
      state.limit += PAGE;
      renderBody();
    });

    rerender();

    // Lower sections, unchanged from before
    renderFixtureLoad(snap);
    renderSample(snap);
    renderCombos(snap);
    renderAround(snap);
  }

  // Double and blank gameweeks from the fixture list, with squad players affected.
  function renderFixtureLoad(snap) {
    const F = window.FPL;
    const max = snap.events.length || 38;
    const from = F.gw;
    const short = new Map(snap.teams.map((t) => [t.id, t.short]));

    const perTeam = new Map(); // "team:gw" -> number of fixtures
    const gwsWithFixtures = new Set();
    for (const f of snap.fixtures) {
      if (f.gw === null) continue;
      gwsWithFixtures.add(f.gw);
      for (const t of [f.home, f.away]) {
        const k = `${t}:${f.gw}`;
        perTeam.set(k, (perTeam.get(k) ?? 0) + 1);
      }
    }

    const playersByTeam = new Map();
    for (const p of snap.players) {
      playersByTeam.set(p.team, (playersByTeam.get(p.team) ?? 0) + 1);
    }
    const countPlayers = (ids) => ids.reduce((sum, id) => sum + (playersByTeam.get(id) ?? 0), 0);
    const names = (ids) => ids.map((id) => short.get(id)).join(", ") || "–";

    const rows = [];
    for (let g = from; g <= max; g++) {
      if (!gwsWithFixtures.has(g)) continue;
      const dbl = [];
      const blank = [];
      for (const t of snap.teams) {
        const n = perTeam.get(`${t.id}:${g}`) ?? 0;
        if (n >= 2) dbl.push(t.id);
        else if (n === 0) blank.push(t.id);
      }
      if (!dbl.length && !blank.length) continue;

      rows.push(`<tr>
        <td>GW${g}</td>
        <td>${esc(names(dbl))}</td>
        <td>${esc(names(blank))}</td>
        <td class="n">${countPlayers(dbl)}</td>
        <td class="n">${countPlayers(blank)}</td>
      </tr>`);
    }

    const { note, body } = section("Double and blank gameweeks");
    note.textContent = "Player counts include every squad player in the affected teams, for upcoming gameweeks.";
    body.innerHTML = table(
      [
        { label: "Gameweek" },
        { label: "Double teams" },
        { label: "Blank teams" },
        { label: "Players in DGW", cls: "n" },
        { label: "Players in BGW", cls: "n" },
      ],
      rows.join(""),
    );
  }

  // Effective ownership, captains, chips and template, from a sample of top managers.
  async function renderSample(snap) {
    const F = window.FPL;
    const { note, body } = section("Ownership, captains and chips");
    const byId = new Map(snap.players.map((p) => [p.id, p]));
    const pos = new Map(snap.positions.map((p) => [p.id, p.short]));

    let s;
    try {
      s = await api("/sample");
    } catch (err) {
      body.textContent = `Could not load the sample. ${err.message}`;
      return;
    }

    if (!s.sampled) {
      note.textContent = `Collecting the top ${s.target} managers for gameweek ${s.gw}. Check back in a few minutes.`;
      return;
    }

    const coverage = s.sampled < s.target ? " Still collecting, so figures will firm up." : "";
    const skipped = s.skipped ? ` ${s.skipped} had no picks yet.` : "";
    note.textContent =
      `Based on ${s.sampled} of the top ${s.target} managers for gameweek ${s.gw}.${coverage}${skipped} ` +
      `These are estimates from a sample, not official FPL figures.`;

    // Effective ownership: sample ownership plus sample captaincy.
    const eo = [...new Set([...Object.keys(s.owned), ...Object.keys(s.captain)])]
      .map((id) => {
        const p = byId.get(Number(id));
        if (!p) return null;
        const own = s.owned[id] ?? 0;
        const cap = s.captain[id] ?? 0;
        return { p, own, cap, eo: Math.round((own + cap) * 10) / 10 };
      })
      .filter(Boolean)
      .sort((a, b) => b.eo - a.eo)
      .slice(0, TOP);

    const eoRows = eo
      .map(
        (x) => `<tr>
          <td>${F.playerHtml(x.p.id)}</td>
          <td>${F.teamHtml(x.p.team)}</td>
          <td>${esc(pos.get(x.p.element_type))}</td>
          <td class="n">£${(x.p.now_cost / 10).toFixed(1)}m</td>
          <td class="n">${pct(x.own)}</td>
          <td class="n">${pct(x.cap)}</td>
          <td class="n"><strong>${pct(x.eo)}</strong></td>
          <td class="n">${pct(x.p.selected_by_percent)}</td>
        </tr>`,
      )
      .join("");

    const caps = Object.entries(s.captain)
      .map(([id, v]) => ({ p: byId.get(Number(id)), cap: v, vice: s.vice[id] ?? 0 }))
      .filter((x) => x.p)
      .sort((a, b) => b.cap - a.cap)
      .slice(0, TOP);

    const capRows = caps
      .map(
        (x) => `<tr>
          <td>${F.playerHtml(x.p.id)}</td>
          <td>${F.teamHtml(x.p.team)}</td>
          <td class="n"><strong>${pct(x.cap)}</strong></td>
          <td class="n">${pct(x.vice)}</td>
        </tr>`,
      )
      .join("");

    const chipRows = s.chips
      .map(
        (c) => `<tr>
          <td>${esc(c.name)}</td>
          <td class="n">${c.managers}</td>
          <td class="n">${pct(c.pct)}</td>
        </tr>`,
      )
      .join("");

    const template = Object.entries(s.owned)
      .map(([id, v]) => ({ p: byId.get(Number(id)), v }))
      .filter((x) => x.p)
      .sort((a, b) => b.v - a.v)
      .slice(0, TOP);

    const tmplRows = template
      .map(
        (x) => `<tr>
          <td>${F.playerHtml(x.p.id)}</td>
          <td>${F.teamHtml(x.p.team)}</td>
          <td>${esc(pos.get(x.p.element_type))}</td>
          <td class="n"><strong>${pct(x.v)}</strong></td>
          <td class="n">${pct(x.p.selected_by_percent)}</td>
        </tr>`,
      )
      .join("");

    body.innerHTML = `
      <h3>Effective ownership (top ${TOP})</h3>
      <p class="meta">Effective ownership is the share of the sample owning the player, plus the share captaining them.</p>
      ${table(
        [
          { label: "Player" },
          { label: "Team" },
          { label: "Pos" },
          { label: "Price", cls: "n" },
          { label: "Sample owned", cls: "n" },
          { label: "Sample captain", cls: "n" },
          { label: "EO", cls: "n" },
          { label: "Overall owned", cls: "n" },
        ],
        eoRows,
      )}

      <h3>Captains</h3>
      ${table(
        [
          { label: "Player" },
          { label: "Team" },
          { label: "Captain", cls: "n" },
          { label: "Vice", cls: "n" },
        ],
        capRows,
      )}

      <h3>Chips this gameweek</h3>
      ${table(
        [
          { label: "Chip" },
          { label: "Managers", cls: "n" },
          { label: "Share", cls: "n" },
        ],
        chipRows,
      )}

      <h3>Template (most owned in the sample, top ${TOP})</h3>
      ${table(
        [
          { label: "Player" },
          { label: "Team" },
          { label: "Pos" },
          { label: "Sample owned", cls: "n" },
          { label: "Overall owned", cls: "n" },
        ],
        tmplRows,
      )}
    `;
  }

  // Most common player pairs, and a lookup for who is owned alongside a chosen player.
  async function renderCombos(snap) {
    const F = window.FPL;
    const { note, body } = section("Ownership combinations");
    const byId = new Map(snap.players.map((p) => [p.id, p]));
    const teamShort = new Map(snap.teams.map((t) => [t.id, t.short]));

    let s;
    try {
      s = await api("/sample");
    } catch (err) {
      body.textContent = `Could not load combinations. ${err.message}`;
      return;
    }

    if (!s.sampled) {
      note.textContent = "Combinations appear once the sample starts collecting managers.";
      return;
    }

    note.textContent =
      `Based on ${s.sampled} sampled managers for gameweek ${s.gw}. ` +
      "Shares show how often two players appear in the same 15-player squad. Estimates from the sample, not official FPL figures.";

    const name = (id) => F.playerHtml(id) || esc("Unknown");

    const pairRows = (s.pairs ?? [])
      .slice(0, TOP)
      .map(
        (x) => `<tr>
          <td>${name(x.a)}</td>
          <td>${name(x.b)}</td>
          <td class="n">${x.managers}</td>
          <td class="n">${pct(x.pct)}</td>
        </tr>`,
      )
      .join("");

    const choices = Object.entries(s.owned)
      .map(([id, v]) => ({ p: byId.get(Number(id)), v }))
      .filter((x) => x.p)
      .sort((a, b) => b.v - a.v || a.p.web_name.localeCompare(b.p.web_name))
      .slice(0, 150)
      .map((x) => `<option value="${x.p.id}">${esc(x.p.web_name)} (${esc(teamShort.get(x.p.team) ?? "")})</option>`)
      .join("");

    body.innerHTML = `
      <h3>Most common pairs (top ${TOP})</h3>
      ${table(
        [
          { label: "Player" },
          { label: "Player" },
          { label: "Managers", cls: "n" },
          { label: "Share", cls: "n" },
        ],
        pairRows,
      )}

      <h3>Who else do managers pick?</h3>
      <p class="meta">Choose a player to see the players they are most often owned alongside (top ${TOP}). Share is the percentage of that player's owners who also own the other player.</p>
      <div class="controls">
        <label for="pair-pick">Player</label>
        <select id="pair-pick">${choices}</select>
      </div>
      <div id="pair-out"></div>
    `;

    const pick = body.querySelector("#pair-pick");
    const out = body.querySelector("#pair-out");

    const load = async () => {
      out.textContent = "Loading…";
      try {
        const d = await api(`/pairs/${pick.value}`);
        if (!d.owners) {
          out.innerHTML = `<p class="meta">Not enough sampled managers own this player yet.</p>`;
          return;
        }
        const rows = d.partners
          .slice(0, TOP)
          .map((x) => {
            const p = byId.get(x.id);
            return `<tr>
              <td>${name(x.id)}</td>
              <td>${esc(p ? teamShort.get(p.team) : "")}</td>
              <td class="n">${x.managers}</td>
              <td class="n">${pct(x.pct)}</td>
            </tr>`;
          })
          .join("");
        out.innerHTML = `<p class="meta">${d.owners} sampled managers own this player.</p>${table(
          [
            { label: "Partner" },
            { label: "Team" },
            { label: "Managers", cls: "n" },
            { label: "Share of owners", cls: "n" },
          ],
          rows,
        )}`;
      } catch (err) {
        out.textContent = `Could not load. ${err.message}`;
      }
    };

    pick.addEventListener("change", load);
    load();
  }

  // Managers near your overall rank, with DGW and BGW players in each squad.
  async function renderAround(snap) {
    const { note, body } = section("Managers around you");
    let session = null;
    try {
      session = JSON.parse(localStorage.getItem(SESSION));
    } catch {}

    if (!session) {
      body.innerHTML = `<p class="meta">Log in to see the managers ranked around you. <a href="/login">Log in</a></p>`;
      return;
    }

    note.textContent =
      "Five places either side of your overall rank. DGW and BGW show squad players in double or blank teams this gameweek.";

    try {
      const d = await api(`/around/${session.entryId}`);
      body.innerHTML = table(
        [
          { label: "Rank", cls: "n" },
          { label: "Manager" },
          { label: "Team" },
          { label: "GW", cls: "n" },
          { label: "Total", cls: "n" },
          { label: "DGW", cls: "n" },
          { label: "BGW", cls: "n" },
          { label: "Captain" },
        ],
        d.rows
          .map(
            (r) => `<tr${r.you ? ' class="you"' : ""}>
              <td class="n">${r.rank.toLocaleString()}</td>
              <td><a href="/manager?id=${r.entry}" data-entry="${r.entry}">${esc(r.manager)}</a></td>
              <td>${esc(r.team)}</td>
              <td class="n">${r.gw}</td>
              <td class="n">${r.total}</td>
              <td class="n">${r.dgw ?? "–"}</td>
              <td class="n">${r.bgw ?? "–"}</td>
              <td>${esc(r.captain || "–")}</td>
            </tr>`,
          )
          .join(""),
      );
    } catch (err) {
      body.textContent = `Could not load managers around you. ${err.message}`;
    }
  }
})();
