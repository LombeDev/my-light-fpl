/* prices.js: transfers and recorded price changes. Starts on fpl:ready from app.js. */
(() => {
  if (document.body.dataset.page !== "prices") return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const money = (tenths) => `£${(tenths / 10).toFixed(1)}m`;
  const signed = (tenths) =>
    tenths === 0 ? "0.0" : `${tenths > 0 ? "+" : "−"}${(Math.abs(tenths) / 10).toFixed(1)}`;
  const net = (p) => p.transfers_in - p.transfers_out;
  const count = (n) => (n > 0 ? `+${n.toLocaleString()}` : n.toLocaleString());

  const SORTS = {
    net: (p) => net(p),
    window: (p) => p.cost_change_window,
    start: (p) => p.cost_change_start,
    price: (p) => p.now_cost,
  };

  document.addEventListener("fpl:ready", (e) => init(e.detail));

  function init(snap) {
    const teams = new Map(snap.teams.map((t) => [t.id, t.short]));
    const positions = new Map(snap.positions.map((p) => [p.id, p.short]));
    const filter = $("filter");
    const pos = $("pos");
    const sort = $("sort");
    const rows = $("rows");

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
                <td>${esc(p.web_name)}</td>
                <td>${esc(teams.get(p.team))}</td>
                <td>${esc(positions.get(p.element_type))}</td>
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
