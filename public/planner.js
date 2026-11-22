/* planner.js: season ticker and fixtures. Starts on fpl:ready from app.js. */
(() => {
  if (document.body.dataset.page !== "planner") return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const SHIRTS = "https://fantasy.premierleague.com/dist/img/shirts/standard";

  const MAX_GW = 10;
  let F;
  let snap;
  let teamById;
  let count = 5; // gameweeks in the ticker
  let fxGw = 1;  // gameweek shown in the fixtures list
  let teamEo = null; // club id -> summed effective ownership (%), null until the sample loads

  // Difficulty colour classes, from FPL's 1 (easiest) to 5 (hardest).
  const solid = (d) => `fdr-solid-${Math.round(d)}`;
  const maxGw = () => snap.events.length || 38;
  const gwEnd = (from, n) => Math.min(maxGw(), from + n - 1);

  const shirt = (code) =>
    code ? `<img class="shirt" src="${SHIRTS}/shirt_${code}-66.png" alt="" loading="lazy">` : "";

  // ---------- Effective ownership by club (shown under the fixtures) ----------
  const eoText = (teamId) => (teamEo === null ? "–" : `${Math.round(teamEo.get(teamId) ?? 0)}%`);

  async function loadEo() {
    try {
      const res = await fetch("/api/sample");
      const s = await res.json();
      if (!res.ok || !s.sampled) return;
      const map = new Map();
      for (const p of snap.players) {
        const eo = (s.owned[p.id] ?? 0) + (s.captain?.[p.id] ?? 0);
        map.set(p.team, (map.get(p.team) ?? 0) + eo);
      }
      teamEo = map;
      renderFixtures();
    } catch {
      /* sample unavailable: keep the dashes */
    }
  }

  // ---------- Season ticker ----------
  function renderTicker() {
    const start = F.gw;
    const last = gwEnd(start, count);
    const gws = [];
    for (let g = start; g <= last; g++) gws.push(g);

    // "team:gw" -> fixtures for that club in that gameweek
    const grid = new Map();
    const add = (team, gw, entry) => {
      const k = `${team}:${gw}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(entry);
    };
    for (const f of snap.fixtures) {
      if (f.gw === null || f.gw < start || f.gw > last) continue;
      add(f.home, f.gw, { home: true, opp: f.away, diff: f.home_difficulty });
      add(f.away, f.gw, { home: false, opp: f.home, diff: f.away_difficulty });
    }

    const clubs = [...snap.teams].sort((a, b) => a.name.localeCompare(b.name));

    $("tk-head").innerHTML = `<tr>
      <th class="tk-club">Team</th>
      ${gws.map((g) => `<th class="tk-gw">GW${g}</th>`).join("")}
    </tr>`;

    $("tk-body").innerHTML = clubs
      .map((t) => {
        const cells = gws
          .map((g) => {
            const list = grid.get(`${t.id}:${g}`) ?? [];
            if (!list.length) return `<td class="tk-cell tk-blank">Blank</td>`;
            return `<td class="tk-cell">${list
              .map((x) => {
                const name = teamById.get(x.opp)?.short ?? "";
                const label = x.home ? `${name} (H)` : `${name} (A)`;
                return `<span class="tk-pill ${solid(x.diff)}">${esc(label)}</span>`;
              })
              .join("")}</td>`;
          })
          .join("");

        return `<tr>
          <td class="tk-club">
            <div class="tk-clubcell">${shirt(t.code)}<span>${esc(t.name)}</span></div>
          </td>
          ${cells}
        </tr>`;
      })
      .join("");
  }

  // ---------- Fixtures ----------
  function renderFixtures() {
    const max = maxGw();
    $("fx-gw").textContent = `Gameweek ${fxGw}`;
    $("fx-prev").disabled = fxGw <= 1;
    $("fx-next").disabled = fxGw >= max;

    const items = snap.fixtures
      .filter((f) => f.gw === fxGw)
      .sort((a, b) => (a.kickoff ?? "~").localeCompare(b.kickoff ?? "~"));

    if (!items.length) {
      $("fx-list").innerHTML = `<p class="meta">No fixtures in this gameweek.</p>`;
      return;
    }

    const time = (iso) =>
      iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "TBC";

    const mid = (f) => {
      if (f.finished) return `${f.home_score ?? 0} – ${f.away_score ?? 0}<small>FT</small>`;
      if (f.started) return `${f.home_score ?? 0} – ${f.away_score ?? 0}<small>LIVE</small>`;
      return time(f.kickoff);
    };

    const side = (teamId, d, isHome) => {
      const t = teamById.get(teamId);
      const pill = `<span class="tk-pill ${solid(d)}">${esc(t?.name ?? "")}</span>`;
      const img = shirt(t?.code);
      const eo = `<div class="eo">${eoText(teamId)}</div>`;
      return isHome
        ? `<div class="fx-side home"><div class="fx-line">${pill}${img}</div>${eo}</div>`
        : `<div class="fx-side away"><div class="fx-line">${img}${pill}</div>${eo}</div>`;
    };

    const days = new Map();
    for (const f of items) {
      const key = f.kickoff ? new Date(f.kickoff).toDateString() : "TBC";
      if (!days.has(key)) {
        const label = f.kickoff
          ? new Date(f.kickoff).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })
          : "Date to be confirmed";
        days.set(key, { label, list: [] });
      }
      days.get(key).list.push(f);
    }

    $("fx-list").innerHTML = [...days.values()]
      .map(
        ({ label, list }) => `<h3 class="fx-day">${esc(label)}</h3>${list
          .map(
            (f) => `<div class="fx-row">
              ${side(f.home, f.home_difficulty, true)}
              <div class="fx-mid">${mid(f)}</div>
              ${side(f.away, f.away_difficulty, false)}
            </div>`,
          )
          .join("")}`,
      )
      .join("");
  }

  function renderAll() {
    // Keep the ticker window inside the gameweeks that remain.
    const cap = Math.min(MAX_GW, maxGw() - F.gw + 1);
    count = Math.min(count, cap);

    renderTicker();
    renderFixtures();

    $("gw-count").textContent = String(count);
    $("gw-minus").disabled = count <= 1;
    $("gw-plus").disabled = count >= cap;
  }

  function init(s) {
    snap = s;
    F = window.FPL;
    teamById = new Map(snap.teams.map((t) => [t.id, t]));
    fxGw = F.gw;

    $("gw-minus").addEventListener("click", () => {
      count = Math.max(1, count - 1);
      renderAll();
    });
    $("gw-plus").addEventListener("click", () => {
      count = Math.min(MAX_GW, count + 1);
      renderAll();
    });
    $("fx-prev").addEventListener("click", () => {
      fxGw = Math.max(1, fxGw - 1);
      renderFixtures();
    });
    $("fx-next").addEventListener("click", () => {
      fxGw = Math.min(maxGw(), fxGw + 1);
      renderFixtures();
    });

    renderAll();
    loadEo();
  }

  document.addEventListener("fpl:ready", (e) => {
    if (e.detail) init(e.detail);
  });
})();
