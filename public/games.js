/* games.js: results by gameweek, scorers, and live bonus. Starts on fpl:ready from app.js. */
(() => {
  if (document.body.dataset.page !== "games") return;
  const $ = (id) => document.getElementById(id);

  document.addEventListener("fpl:ready", (e) => {
    if (e.detail) init(e.detail);
  });

  function init(snap) {
    const F = window.FPL;
    const max = snap.events.length || 38;
    const current = snap.events.find((e) => e.current) ?? snap.events.find((e) => e.next);
    const fromUrl = Number(new URLSearchParams(location.search).get("gw"));
    let gw = fromUrl >= 1 && fromUrl <= max ? fromUrl : (current?.id ?? 1);

    const byTeam = new Map();
    for (const p of snap.players) {
      const list = byTeam.get(p.team) ?? [];
      list.push(p);
      byTeam.set(p.team, list);
    }

    // [[playerId, value], ...] becomes shirt + name, with "×2" for two.
    const scorers = (pairs = []) =>
      pairs.map(([id, v]) => `${F.playerHtml(id)}${v > 1 ? ` ×${v}` : ""}`).join(", ");

    // One line per side: team shirt, then its scorers.
    const sides = (f, stat) => {
      const lines = [];
      const h = scorers(f.stats?.[stat]?.h);
      const a = scorers(f.stats?.[stat]?.a);
      if (h) lines.push(`${F.teamHtml(f.home)}: ${h}`);
      if (a) lines.push(`${F.teamHtml(f.away)}: ${a}`);
      return lines.length ? lines.join("<br>") : "–";
    };

    // Live bonus section, below the results table.
    const liveSec = document.createElement("section");
    liveSec.innerHTML = `<h2>Live bonus</h2><div id="live-bonus"></div>`;
    document.querySelector("main").append(liveSec);

    // Bonus for one match, highest first. Uses the live feed, so it updates during play.
    const bonusLine = (f) => {
      const live = F.live();
      const rows = [...(byTeam.get(f.home) ?? []), ...(byTeam.get(f.away) ?? [])]
        .map((p) => ({ p, d: live.get(p.id) }))
        .filter((x) => x.d && x.d.bn > 0)
        .sort((a, b) => b.d.bn - a.d.bn || b.d.b - a.d.b);
      if (!rows.length) return "No bonus points yet.";
      return rows.map(({ p, d }) => `${F.playerHtml(p.id)} <strong>+${d.bn}</strong> <span class="muted">BPS ${d.b}</span>`).join(" · ");
    };

    function renderLive() {
      const inPlay = snap.fixtures.filter((f) => f.gw === gw && f.started && !f.finished);
      $("live-bonus").innerHTML = inPlay.length
        ? inPlay
            .map(
              (f) => `<p class="bonus-line">
                ${F.teamHtml(f.home)} <strong>${f.home_score ?? 0} – ${f.away_score ?? 0}</strong> ${F.teamHtml(f.away)}<br>
                <span class="meta">${bonusLine(f)}</span>
              </p>`,
            )
            .join("")
        : `<p class="meta">No matches in play in this gameweek.</p>`;
    }

    function draw() {
      $("gw").textContent = `Gameweek ${gw}`;
      $("prev").disabled = gw <= 1;
      $("next").disabled = gw >= max;
      history.replaceState(null, "", `?gw=${gw}`);

      const games = snap.fixtures
        .filter((f) => f.gw === gw && (f.started || f.finished))
        .sort((a, b) => (a.kickoff ?? "").localeCompare(b.kickoff ?? ""));

      $("meta").textContent = games.length ? "" : "No games have started in this gameweek yet.";

      $("list").innerHTML = games
        .map((f) => {
          const status = f.finished ? "FT" : `<span class="live">LIVE</span>`;
          return `<tr>
            <td>${F.teamHtml(f.home)} <span class="muted">v</span> ${F.teamHtml(f.away)}</td>
            <td class="c">${f.home_score ?? 0} – ${f.away_score ?? 0} ${status}</td>
            <td>${sides(f, "goals_scored")}</td>
            <td>${sides(f, "assists")}</td>
          </tr>`;
        })
        .join("");

      renderLive();
    }

    $("prev").addEventListener("click", () => {
      gw = Math.max(1, gw - 1);
      draw();
    });
    $("next").addEventListener("click", () => {
      gw = Math.min(max, gw + 1);
      draw();
    });
    document.addEventListener("fpl:live", renderLive);

    draw();
  }
})();
