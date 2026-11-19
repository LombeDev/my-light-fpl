/* games.js: match results by gameweek with shirts for teams and scorers. Starts on fpl:ready from app.js. */
(() => {
  if (document.body.dataset.page !== "games") return;
  const $ = (id) => document.getElementById(id);

  document.addEventListener("fpl:ready", (e) => init(e.detail));

  function init(snap) {
    const { teamHtml, playerHtml } = window.FPL;
    const max = snap.events.length || 38;
    const current = snap.events.find((e) => e.current) ?? snap.events.find((e) => e.next);
    const fromUrl = Number(new URLSearchParams(location.search).get("gw"));
    let gw = fromUrl >= 1 && fromUrl <= max ? fromUrl : (current?.id ?? 1);

    // [[playerId, value], ...] becomes shirt + name, with "×2" for two.
    const scorers = (pairs = []) =>
      pairs.map(([id, v]) => `${playerHtml(id)}${v > 1 ? ` ×${v}` : ""}`).join(", ");

    // One line per side: team shirt, then its scorers.
    const sides = (f, stat) => {
      const lines = [];
      const h = scorers(f.stats?.[stat]?.h);
      const a = scorers(f.stats?.[stat]?.a);
      if (h) lines.push(`${teamHtml(f.home)}: ${h}`);
      if (a) lines.push(`${teamHtml(f.away)}: ${a}`);
      return lines.length ? lines.join("<br>") : "–";
    };

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
          const live = f.finished ? "" : ' <span class="muted">(live)</span>';
          return `<tr>
            <td>${teamHtml(f.home)} <span class="muted">v</span> ${teamHtml(f.away)}</td>
            <td class="c">${f.home_score ?? 0} – ${f.away_score ?? 0}${live}</td>
            <td>${sides(f, "goals_scored")}</td>
            <td>${sides(f, "assists")}</td>
          </tr>`;
        })
        .join("");
    }

    $("prev").addEventListener("click", () => {
      gw = Math.max(1, gw - 1);
      draw();
    });
    $("next").addEventListener("click", () => {
      gw = Math.min(max, gw + 1);
      draw();
    });

    draw();
  }
})();
