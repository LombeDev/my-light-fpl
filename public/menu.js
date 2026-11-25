/* menu.js: mobile hamburger menu. On screens 720px and narrower, the header nav is replaced by a
   button that slides a panel down from the top. The panel copies the links from #nav, so it always
   matches what app.js renders. Works on any page with header.site and nav#nav. */
(() => {
  const header = document.querySelector("header.site");
  const nav = document.getElementById("nav");
  if (!header || !nav || header.dataset.menu) return;
  header.dataset.menu = "1";

  const mq = window.matchMedia("(max-width: 720px)");

  // Hamburger button, placed where the nav sits.
  const burger = document.createElement("button");
  burger.type = "button";
  burger.className = "mn-burger";
  burger.setAttribute("aria-label", "Open menu");
  burger.setAttribute("aria-expanded", "false");
  burger.setAttribute("aria-controls", "mn-panel");
  burger.innerHTML = "<span></span><span></span><span></span>";
  nav.before(burger);

  // Backdrop and sliding panel.
  const backdrop = document.createElement("div");
  backdrop.className = "mn-backdrop";
  backdrop.setAttribute("aria-hidden", "true");

  const panel = document.createElement("div");
  panel.id = "mn-panel";
  panel.className = "mn-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "Site menu");
  panel.innerHTML = `
    <div class="mn-top">
      <span class="mn-title">Menu</span>
      <button type="button" class="mn-close" aria-label="Close menu">×</button>
    </div>
    <nav class="mn-links" aria-label="Main"></nav>`;

  document.body.append(backdrop, panel);
  const links = panel.querySelector(".mn-links");
  const closeBtn = panel.querySelector(".mn-close");

  let open = false;

  function setOpen(next) {
    open = next;
    panel.classList.toggle("is-open", next);
    backdrop.classList.toggle("is-open", next);
    document.body.classList.toggle("mn-lock", next);
    burger.setAttribute("aria-expanded", String(next));
    burger.setAttribute("aria-label", next ? "Close menu" : "Open menu");
    if (next) {
      const first = links.querySelector("a, button");
      if (first) first.focus({ preventScroll: true });
    } else if (mq.matches) {
      burger.focus({ preventScroll: true });
    }
  }

  // Copy the links from the header nav into the panel. Anchors keep their href and aria-current.
  // Buttons, such as Sign out, are forwarded to the original button when tapped.
  function sync() {
    links.innerHTML = "";
    nav.querySelectorAll("a, button").forEach((src) => {
      const el = document.createElement(src.tagName === "A" ? "a" : "button");
      el.className = "mn-link";
      el.textContent = src.textContent.trim();
      if (src.tagName === "A") {
        el.href = src.getAttribute("href");
        if (src.getAttribute("aria-current")) el.setAttribute("aria-current", src.getAttribute("aria-current"));
      } else {
        el.type = "button";
        el.addEventListener("click", () => src.click());
      }
      el.addEventListener("click", () => setOpen(false));
      links.append(el);
    });
  }

  burger.addEventListener("click", () => setOpen(!open));
  closeBtn.addEventListener("click", () => setOpen(false));
  backdrop.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && open) setOpen(false);
  });

  // Close the panel if the window grows past the mobile width.
  mq.addEventListener("change", (e) => {
    if (!e.matches && open) setOpen(false);
  });

  // app.js may render the nav after this script runs, and some pages set aria-current later.
  // Watch the nav so the panel stays in step.
  new MutationObserver(sync).observe(nav, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-current", "href"],
  });
  sync();
})();
