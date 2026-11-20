/* prices.js: price change predictor (an estimate) and actual price changes, with shirts. Starts on fpl:ready from app.js. */
(() => {
  if (document.body.dataset.page !== "prices") return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const money = (tenths) => `£${(tenths / 10).toFixed(1)}m`;
  const signed = (tenths) =>
    tenths === 0 ? "0.0" : `${tenths > 0 ? "+" : "−"}${(Math.abs(tenths) / 10).toFixed(1)}`;
  const net = (p) => p.transfers_in - p.transfers_out;
  const count = (n) => (n > 0 ? `+${n.toLocaleString()}` : n.toLocaleString());

  // Predictor settings. These come from the thresholds in your Kopala FPL predictor notes:
  // about 220,000 net transfers in the window, and players under 1.7% ownership are ignored.
  // Adjust them here if they drift from real price changes.
  const RISE_NET = 220000;
  const OWN_FLOOR = 1.7;
  const LIKELY = 80; // progress % at which a change is "likely"
  const POSSIBLE = 50; // progress % at which a change is "possible"

  const SORTS = {
    net: (p) => net(p),
    window: (p) => p.cost_change_window,
    start: (p) => p.cost_change_start,
    price: (p) => p.now_cost,
  };

  document.addEventListener("fpl:ready", (e) => {
    if (e.detail) init(e.detail);
  });

  // Players whose net transfers are at least POSSIBLE% of the threshold, rising or falling.
  function predict(snap) {
    const rising = [];
    const falling = [];
    for (const p of snap.players) {
      if (p.selected_by_percent < OWN_FLOOR) continue;
      const n = net(p);
      if (n > 0) {
        const progress = (n / RISE_NET) * 100;
        if (progress >= POSSIBLE) rising.push({ p, n, progress });
      } else if (n < 0) {
        const progress = (-n / RISE_NET) * 100;
        if (progress >= POSSIBLE) falling.push({ p, n, progress });
      }
    }
    const byProgress = (a, b) => b.progress - a.progress;
    return { rising: rising.sort(byProgress).slice(0, 15), falling: falling.sort(byProgress).slice(0, 15) };
  }

  function init(snap) {
    const F = window.FPL || {};
    const player = (id, name) => (F.playerHtml ? F.playerHtml(id) : esc(name));
    const team = (id, short) => (F.teamHtml ? F.teamHtml(id) : esc(short));

    const teams = new Map(snap.teams.map((t) => [t.id, t.short]));
    const positions = new Map(snap.positions.map((p) => [p.id, p.short]));
    const filter = $("filter");
    const pos = $("pos");
    const sort = $("sort");
    const rows = $("rows");

    // ---------- Predictor ----------
    const predRow = (x) => {
      const pr = Math.min(100, Math.round(x.progress));
      const label = pr >= LIKELY ? "likely" : "possible";
      return `<tr>
        <td>${player(x.p.id, x.p.web_name)}</td>
        <td>${team(x.p.team, teams.get(x.p.team))}</td>
        <td class="n">${money(x.p.now_cost)}</td>
        <td class="n">${count(x.n)}</td>
        <td><progress max="100" value="${pr}"></progress> ${pr}% <span class="muted">${label}</span></td>
      </tr>`;
    };

    const predTable = (list) =>
      list.length
        ? `<div class="table-wrap"><table>
            <thead><tr>
              <th>Player</th><th>Team</th><th class="n">Price</th><th class="n">Net transfers</th><th>Progress</th>
            </tr></thead>
            <tbody>${list.map(predRow).join("")}</tbody>
          </table></div>`
        : `<p class="meta">No players are near a threshold right now.</p>`;

    const { rising, falling } = predict(snap);
    const predSec = document.createElement("section");
    predSec.innerHTML = `
      <h2>Price change predictor</h2>
      <p class="meta">
        Estimate only, not an official forecast. Uses this gameweek's net transfers against
        ${RISE_NET.toLocaleString()}, for players owned by at least ${OWN_FLOOR}%.
        Real changes happen overnight and can differ.
      </p>
      <div class="two-col">
        <div><h3>Likely to rise</h3>${predTable(rising)}</div>
        <div><h3>Likely to fall</h3>${predTable(falling)}</div>
      </div>`;

    const actualHead = document.createElement("h2");
    actualHead.textContent = "Actual price changes";
    const controls = document.querySelector("main .controls");
    controls.before(predSec, actualHead);

    // ---------- Actual price changes ----------
    snap.positions.forEach((p) => pos.append(new Option(p.short, String(p.id))));

    const keep = (p, f, posId) => {
      if (posId && p.element_type !== posId) return false;
      if (f === "rising") return net(p) > 0;
      if (f === "falling") return net(p) < 0;
      if (f === "changed") return p.cost_change_window !== 0;
      return true;
    };

    function render() {
      const list = snap.players
        .filter((p) => keep(p, filter.value, Number(pos.value)))
        .sort((a, b) => SORTS[sort.value](b) - SORTS[sort.value](a))
        .slice(0, 100);

      rows.innerHTML = list.length
        ? list
            .map(
              (p) => `<tr>
                <td>${player(p.id, p.web_name)}</td>
                <td>${team(p.team, teams.get(p.team))}</td>
                <td>${esc(positions.get(p.element_type) ?? "")}</td>
                <td class="n">${money(p.now_cost)}</td>
                <td class="n">${signed(p.cost_change_window)}</td>
                <td class="n">${signed(p.cost_change_start)}</td>
                <td class="n">${p.transfers_in.toLocaleString()}</td>
                <td class="n">${p.transfers_out.toLocaleString()}</td>
                <td class="n">${count(net(p))}</td>
              </tr>`,
            )
            .join("")
        : `<tr><td colspan="9">No players match.</td></tr>`;

      $("meta").textContent = `${list.length} shown (maximum 100) · updated ${new Date(snap.generatedAt).toLocaleString()}`;
    }

    filter.addEventListener("change", render);
    pos.addEventListener("change", render);
    sort.addEventListener("change", render);
    render();
  }
})();
