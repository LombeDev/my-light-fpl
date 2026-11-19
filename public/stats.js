/* stats.js: season leaderboards. Starts on fpl:ready from app.js. */
(() => {
  if (document.body.dataset.page !== "stats") return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

  // [field, label, formatter]
  const STATS = [
    ["total_points", "Total points", (v) => v],
    ["goals", "Goals", (v) => v],
    ["assists", "Assists", (v) => v],
    ["expected_goals", "Expected goals", (v) => v.toFixed(2)],
    ["expected_assists", "Expected assists", (v) => v.toFixed(2)],
    ["ict", "ICT index", (v) => v.toFixed(1)],
    ["clean_sheets", "Clean sheets", (v) => v],
    ["bonus", "Bonus points", (v) => v],
    ["points_per_million", "Points per £m", (v) => v.toFixed(2)],
    ["form", "Form", (v) => v.toFixed(1)],
  ];

  const MINUTES = [
    [0, "Any minutes"],
    [450, "450+ minutes"],
    [900, "900+ minutes"],
  ];

  document.addEventListener("fpl:ready", (e) => init(e.detail));

  function init(snap) {
    const teams = new Map(snap.teams.map((t) => [t.id, t.short]));
    const positions = new Map(snap.positions.map((p) => [p.id, p.short]));
    const statSel = $("stat");
    const posSel = $("pos");
    const minSel = $("mins");

    STATS.forEach(([field, label]) => statSel.append(new Option(label, field)));
    snap.positions.forEach((p) => posSel.append(new Option(p.short, String(p.id))));
    MINUTES.forEach(([value, label]) => minSel.append(new Option(label, String(value))));

    function render() {
      const [field, label, fmt] = STATS.find((s) => s[0] === statSel.value) ?? STATS[0];
      const posId = Number(posSel.value);
      const min = Number(minSel.value);
      $("valh").textContent = label;

      const list = snap.players
        .filter((p) => (!posId || p.element_type === posId) && p.minutes >= min)
        .sort((a, b) => b[field] - a[field])
        .slice(0, 100);

      $("rows").innerHTML = list.length
        ? list
            .map(
              (p, i) => `<tr>
                <td class="n">${i + 1}</td>
                <td>${esc(p.web_name)}</td>
                <td>${esc(teams.get(p.team))}</td>
                <td>${esc(positions.get(p.element_type))}</td>
                <td class="n"><strong>${fmt(p[field])}</strong></td>
                <td class="n">${p.minutes.toLocaleString()}</td>
                <td class="n">${p.goals}</td>
                <td class="n">${p.assists}</td>
                <td class="n">${p.expected_goals.toFixed(2)}</td>
                <td class="n">${p.expected_assists.toFixed(2)}</td>
                <td class="n">${p.ict.toFixed(1)}</td>
                <td class="n">${p.clean_sheets}</td>
                <td class="n">${p.total_points}</td>
              </tr>`,
            )
            .join("")
        : `<tr><td colspan="13">No players match.</td></tr>`;

      $("meta").textContent = `Top ${list.length} · season to date · updated ${new Date(snap.generatedAt).toLocaleString()}`;
    }

    statSel.addEventListener("change", render);
    posSel.addEventListener("change", render);
    minSel.addEventListener("change", render);
    render();
  }
})();
