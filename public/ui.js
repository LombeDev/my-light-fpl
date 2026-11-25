/* ui.js: shared empty and error states. Exposes window.UI.state(options), which returns HTML.
   Options: kind ("empty" or "error"), icon, title, text, and an optional action.
   action is { label, href } for a link, or { label, retry: true } for a retry button.
   Buttons with data-ui-retry are handled by the page through a click on document. */
(() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

  const DEFAULT_ICON = { empty: "○", error: "!" };

  function state({ kind = "empty", icon, title, text, action } = {}) {
    const cls = kind === "error" ? "ui-state is-error" : "ui-state";
    const role = kind === "error" ? ' role="alert"' : "";
    let btn = "";
    if (action?.href) {
      btn = `<a class="ui-state-btn" href="${esc(action.href)}">${esc(action.label)}</a>`;
    } else if (action?.retry) {
      btn = `<button class="ui-state-btn" type="button" data-ui-retry>${esc(action.label || "Try again")}</button>`;
    }
    return `<div class="${cls}"${role}>
      <span class="ui-state-icon" aria-hidden="true">${esc(icon ?? DEFAULT_ICON[kind] ?? "○")}</span>
      <p class="ui-state-title">${esc(title ?? "")}</p>
      ${text ? `<p class="ui-state-text">${esc(text)}</p>` : ""}
      ${btn}
    </div>`;
  }

  // Wrap a state in a table row, for tables that need a full-width message.
  function row(colspan, options) {
    return `<tr><td colspan="${colspan}">${state(options)}</td></tr>`;
  }

  window.UI = { state, row };
})();
