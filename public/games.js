/* games.js: match results by gameweek with goals and assists. Starts on fpl:ready from app.js. */
(() => {
  if (document.body.dataset.page !== "games") return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

  document.addEventListener("fpl:ready", (e) => init(e.detail));

  function init(snap) {
    const teams = new Map(snap.teams.map((t) => [t.id, t.short]));
    const names = new Map(snap.players.map((p) => [p.id, p.web_name]));
    const max = snap.events.length || 38;
    const current = snap.events.find((e) => e.current) ?? snap.events.find((e) => e.next);
    const fromUrl = Number(new URLSearchParams(location.search).get("gw"));
    let gw = fromUrl >= 1 && fromUrl <= max ? fromUrl : (current?.id ?? 1);

    // [[playerId, value], ...] becomes "Name, Name ×2".
    const names_ = (pairs = []) =>
      pairs.map(([id, v]) => `${esc(names.get(id) ?? "Unknown")}${v > 1 ? ` ×${v}` : ""}`).join(", ");

    // One line per side: "ARS: Saka, Odegaard" then "CHE: Palmer".
    const sides = (f, stat) => {
      const lines = [];
      const h = names_(f.stats?.[stat]?.h);
      const a = names_(f.stats?.[stat]?.a);
      if (h) lines.push(`${esc(teams.get(f.home))}: ${h}`);
      if (a) lines.push(`${esc(teams.get(f.away))}: ${a}`);
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
            <td>${esc(teams.get(f.home))} v ${esc(teams.get(f.away))}</td>
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
