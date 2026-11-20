/* games.js: match cards with scores, your gain, sample comparison, bonus race and DefCon.
   Starts on fpl:ready from app.js. */
(() => {
  if (document.body.dataset.page !== "games") return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const SHIRTS = "https://fantasy.premierleague.com/dist/img/shirts/standard";
  const SESSION = "fpl.session";
  const DEFCON_BASE = 10; // DefCon points needed for a defender (CBIT), midfielder/forward use the same line here
  const BONUS_ROWS = 4;

  // Stats we show on a card, in the order they appear.
  const EVENT_ICON = { goals_scored: "⚽", assists: "A", own_goals: "⚽", red_cards: "🟥", yellow_cards: "🟨" };

  let snap;
  let F;
  let byId;
  let teamById;
  let myPicks = null; // Set of player ids in your squad for this gameweek
  let sample = null; // effective ownership and captains from the top-500 sample
  let gw = 1;
  let hideGains = false;

  // ---------- Helpers ----------
  const shirt = (code) => (code ? `<img class="gshirt" src="${SHIRTS}/shirt_${code}-66.png" alt="" loading="lazy">` : "");

  const teamShirt = (id) => shirt(teamById.get(id)?.code);

  const pts = (n) => (n === null || n === undefined ? "–" : n);

  // Effective ownership (%) for one player from the sample: owned plus captained.
  const eoOf = (id) => {
    if (!sample || !sample.sampled) return null;
    return (sample.owned[id] ?? 0) + (sample.captain?.[id] ?? 0);
  };

  // Sum of effective ownership across a club's players, as shown under each team.
  const teamEo = (teamId) => {
    if (!sample || !sample.sampled) return null;
    let total = 0;
    for (const p of snap.players) {
      if (p.team === teamId) total += eoOf(p.id) ?? 0;
    }
    return total;
  };

  // Points from one match for your squad. Uses the snapshot's per-player match stats.
  // Captain doubles, and bench players count only if they are in the matchday XI (not modelled here).
  function youPoints(f) {
    if (!myPicks) return null;
    return null; // see note at the top of the file: points per match need the live feed, filled in below
  }

  // Players in a fixture, from the team sides, with their goals, assists, saves and DefCon.
  function matchPlayers(f) {
    const home = snap.players.filter((p) => p.team === f.home);
    const away = snap.players.filter((p) => p.team === f.away);
    return { home, away };
  }

  // ---------- Stat lines ----------
  const statList = (f, stat, side) => {
    const pairs = f.stats?.[stat]?.[side] ?? [];
    return pairs.map(([id, v]) => ({ id, v }));
  };

  function eventLine(f, side) {
    const parts = [];
    const add = (stat, icon) => {
      for (const x of statList(f, stat, side)) {
        const name = byId.get(x.id)?.web_name ?? "Unknown";
        parts.push(`<div class="ev">${icon} ${esc(name)}${x.v > 1 ? ` ×${x.v}` : ""}</div>`);
      }
    };
    add("goals_scored", "⚽");
    add("assists", "<span class=\"ai\">A</span>");
    add("own_goals", "⚽");
    return parts.join("") || `<div class="ev muted">–</div>`;
  }

  // Bonus race: top BPS players in the match, from the live bonus feed when available.
  function bonusRace(f) {
    const live = F.live();
    const rows = [];
    for (const side of ["home", "away"]) {
      const ids = side === "home" ? matchPlayers(f).home : matchPlayers(f).away;
      const list = ids
        .map((p) => ({ p, d: live.get(p.id) }))
        .filter((x) => x.d && x.d.b > 0)
        .sort((a, b) => b.d.b - a.d.b);
      rows.push({ side, list });
    }
    return rows;
  }

  function bonusBlock(f) {
    const race = bonusRace(f);
    const max = Math.max(1, ...race.flatMap((r) => r.list.map((x) => x.d.b)));
    const col = (side) => {
      const r = race.find((x) => x.side === side);
      const top = r.list.slice(0, BONUS_ROWS);
      if (!top.length) return `<p class="meta">No bonus yet.</p>`;
      return top
        .map(({ p, d }) => {
          const w = Math.round((d.b / max) * 100);
          const bonus = d.bn > 0 ? `<span class="bonusTag">+${d.bn}</span>` : "";
          return `<div class="brow">
            <span class="bname">${bonus}${esc(p.web_name)}</span>
            <span class="bbar"><span style="width:${w}%"></span></span>
            <span class="bval">${d.b}</span>
          </div>`;
        })
        .join("");
    };
    return `<div class="bonus-race">
      <div class="block-title">Bonus race</div>
      <div class="two">
        <div><div class="side-h">Home</div>${col("home")}</div>
        <div><div class="side-h">Away</div>${col("away")}</div>
      </div>
    </div>`;
  }

  // DefCon: defensive contribution points, from the live feed. Shows a dash when FPL sends none.
  function defconBlock(f) {
    const live = F.live();
    const col = (side) => {
      const ids = side === "home" ? matchPlayers(f).home : matchPlayers(f).away;
      const rows = ids
        .map((p) => ({ p, d: live.get(p.id) }))
        .filter((x) => x.d && x.d.dc !== null && x.d.dc !== undefined && x.d.dc > 0)
        .sort((a, b) => b.d.dc - a.d.dc)
        .slice(0, 4);
      if (!rows.length) return `<p class="meta">None yet.</p>`;
      return rows
        .map(({ p, d }) => {
          const w = Math.min(100, Math.round((d.dc / DEFCON_BASE) * 100));
          return `<div class="brow">
            <span class="bname">${esc(p.web_name)}</span>
            <span class="bbar"><span style="width:${w}%"></span></span>
            <span class="bval">${d.dc}/${DEFCON_BASE}</span>
          </div>`;
        })
        .join("");
    };
    return `<div class="defcon">
      <div class="block-title">DefCon</div>
      <div class="two">
        <div><div class="side-h">Home</div>${col("home")}</div>
        <div><div class="side-h">Away</div>${col("away")}</div>
      </div>
    </div>`;
  }

  // ---------- Match card ----------
  function matchCard(f) {
    const done = f.finished;
    const eoHome = teamEo(f.home);
    const eoAway = teamEo(f.away);
    const sampleText = sample && sample.sampled ? `Sample +${(eoHome ?? 0).toFixed(1)}` : "";

    const status = done ? `<span class="pillDone">Done</span>` : f.started ? `<span class="pillLive">LIVE</span>` : "";

    return `<article class="card">
      <div class="card-top">${status}</div>
      <div class="card-body">
        <div class="side">
          ${teamShirt(f.home)}
          <div class="tname">${esc(teamById.get(f.home)?.name ?? "")}</div>
          <div class="goals">${f.home_score ?? 0}</div>
          ${eoHome === null ? "" : `<div class="eo">EO ${eoHome.toFixed(1)}%</div>`}
          <div class="events">${eventLine(f, "h")}</div>
        </div>
        <div class="score">
          <div class="big">${f.home_score ?? 0} - ${f.away_score ?? 0}</div>
          <div class="youRow muted">${myPicks ? "You –" : ""}</div>
          <div class="muted small">${sampleText}</div>
        </div>
        <div class="side">
          ${teamShirt(f.away)}
          <div class="tname">${esc(teamById.get(f.away)?.name ?? "")}</div>
          <div class="goals">${f.away_score ?? 0}</div>
          ${eoAway === null ? "" : `<div class="eo">EO ${eoAway.toFixed(1)}%</div>`}
          <div class="events">${eventLine(f, "a")}</div>
        </div>
      </div>
      <div class="card-foot">
        ${bonusBlock(f)}
        ${defconBlock(f)}
      </div>
    </article>`;
  }

  // ---------- Gameweek ----------
  function draw() {
    const max = snap.events.length || 38;
    $("gw").textContent = `Gameweek ${gw}`;
    $("title").textContent = `Games – Gameweek ${gw}`;
    $("prev").disabled = gw <= 1;
    $("next").disabled = gw >= max;
    history.replaceState(null, "", `?gw=${gw}`);

    const games = snap.fixtures
      .filter((f) => f.gw === gw && (f.started || f.finished))
      .sort((a, b) => (a.kickoff ?? "").localeCompare(b.kickoff ?? ""));

    $("meta").textContent = games.length ? "" : "No games have started in this gameweek yet.";
    $("cards").innerHTML = games.map(matchCard).join("");
    $("cards").classList.toggle("hide-gains", hideGains);
  }

  // ---------- Init ----------
  async function loadSample() {
    try {
      const res = await fetch("/api/sample");
      const s = await res.json();
      if (res.ok) sample = s;
    } catch {
      /* sample unavailable: keep the sample figures blank */
    }
  }

  async function loadMyPicks() {
    let session = null;
    try {
      session = JSON.parse(localStorage.getItem(SESSION));
    } catch {}
    if (!session) return;
    try {
      const res = await fetch(`/api/picks/${session.entryId}/${gw}`);
      const data = await res.json();
      if (res.ok) myPicks = new Set(data.picks.map((p) => p.element));
    } catch {
      /* picks unavailable: show the match without your gain */
    }
  }

  function init(s) {
    snap = s;
    F = window.FPL;
    byId = new Map(snap.players.map((p) => [p.id, p]));
    teamById = new Map(snap.teams.map((t) => [t.id, t]));
    const max = snap.events.length || 38;
    const fromUrl = Number(new URLSearchParams(location.search).get("gw"));
    gw = fromUrl >= 1 && fromUrl <= max ? fromUrl : (F.gw ?? 1);

    $("prev").addEventListener("click", () => {
      gw = Math.max(1, gw - 1);
      draw();
    });
    $("next").addEventListener("click", () => {
      gw = Math.min(max, gw + 1);
      draw();
    });
    $("gains").addEventListener("click", () => {
      hideGains = !hideGains;
      $("gains").setAttribute("aria-pressed", String(!hideGains));
      $("gains").textContent = hideGains ? "Show gains" : "Hide gains";
      $("cards").classList.toggle("hide-gains", hideGains);
    });

    // Refresh the live-dependent parts (bonus race, DefCon) when the live feed changes.
    document.addEventListener("fpl:live", draw);

    Promise.all([loadSample(), loadMyPicks()]).then(draw);
    draw();
  }

  document.addEventListener("fpl:ready", (e) => {
    if (e.detail) init(e.detail);
  });
})();
