/* stats.js: the Stats page. A filter bar and a sortable player table, with a face or shirt toggle,
   extra columns and presets. Starts on fpl:ready from app.js. */
(() => {
  if (document.body.dataset.page !== "stats") return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const SHIRTS = "https://fantasy.premierleague.com/dist/img/shirts/standard";
  const FACES = "https://resources.premierleague.com/premierleague/photos/players/110x140";
  const PAGE = 25;
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
  const HEAD = { cost: "Cost", owned: "TSB %", total: "PTS", ppm: "PTS/MATCH", form: "FORM" };
  const labelOf = (key) => HEAD[key] ?? statOf(key).label;
  const cellOf = (key, p) => {
    if (key === "ppm" && !p.minutes) return "–";
    const s = statOf(key);
    return s.fmt(s.get(p));
  };

  const PRESETS = [
    { stat: "form", extras: [] },
    { stat: "money", extras: ["goals", "assists"] },
    { stat: "xg", extras: ["goals", "assists", "xa"] },
    { stat: "cs", extras: ["bonus", "ict"] },
  ];

  // Player face: FPL's photo for the player (photo code), falling back to the club shirt if it fails.
  function avatar(p, team, usePhoto) {
    const shirtUrl = team?.code ? `${SHIRTS}/shirt_${team.code}-66.png` : "";
    const faceUrl = p.photo ? `${FACES}/p${p.photo}` : "";
    const src = usePhoto && faceUrl ? faceUrl : shirtUrl;
    if (!src) return `<span class="st-avatar st-avatar-empty"></span>`;
    const cls = usePhoto && faceUrl ? "st-avatar is-face" : "st-avatar is-shirt";
    const fallback = shirtUrl && src !== shirtUrl ? ` data-fallback="${esc(shirtUrl)}"` : "";
    return `<img class="${cls}" src="${esc(src)}" alt=""${fallback} loading="lazy">`;
  }

  document.addEventListener("fpl:ready", (e) => {
    if (e.detail) init(e.detail);
  });

  function init(snap) {
    const max = snap.events.length || 38;
    const currentGw = (snap.events.find((e) => e.current) ?? snap.events.find((e) => e.next))?.id ?? max;
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
    $("gw-to").value = String(currentGw);
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
              const name = `<td class="st-namecol"><div class="st-name">${avatar(p, t, state.photo)}<div>
                  <div class="st-pname">${esc(p.web_name)}</div>
                  <div class="st-sub">${esc(t?.short ?? "")} • ${esc(positions.get(p.element_type) ?? "")}</div>
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
    }

    function rerender() {
      renderHead();
      renderBody();
    }

    // If a face fails to load, fall back to the club shirt.
    $("st-body").addEventListener(
      "error",
      (e) => {
        const img = e.target;
        if (img.tagName === "IMG" && img.dataset.fallback && img.src !== img.dataset.fallback) {
          img.src = img.dataset.fallback;
          img.classList.remove("is-face");
          img.classList.add("is-shirt");
        }
      },
      true,
    );

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
    $("gw-from").addEventListener("change", (e) => {
      if (Number(e.target.value) > Number($("gw-to").value)) $("gw-to").value = e.target.value;
    });
    $("gw-to").addEventListener("change", (e) => {
      if (Number(e.target.value) < Number($("gw-from").value)) $("gw-from").value = e.target.value;
    });
    $("stat").addEventListener("change", (e) => {
      state.stat = e.target.value;
      state.limit = PAGE;
      rerender();
    });
    $("add-col").addEventListener("click", () => {
      const key = state.stat;
      if (FIXED.includes(key) || state.extras.includes(key) || state.extras.length >= MAX_EXTRA) return;
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
    });

    $("st-more").addEventListener("click", () => {
      state.limit += PAGE;
      renderBody();
    });

    rerender();
  }
})();
