/* login.js: team ID login. Page key: auth. Loads without the site navigation. */
(() => {
  if (document.body.dataset.page !== "auth") return;
  const $ = (id) => document.getElementById(id);
  const SESSION = "fpl.session";

  const expiry = (token) => {
    try {
      return JSON.parse(atob(token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/"))).exp;
    } catch {
      return 0;
    }
  };

  function savedSession() {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION));
      return s && Date.now() / 1000 < expiry(s.token) ? s : null;
    } catch {
      return null;
    }
  }

  const setMsg = (text) => {
    $("msg").textContent = text;
  };

  // Already signed in: go straight to My team.
  if (savedSession()) {
    location.replace("/team");
    return;
  }

  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    setMsg("");

    const entryId = $("team-id").value.trim();
    if (!entryId) {
      setMsg("Enter your FPL team ID.");
      return;
    }

    const btn = $("submit");
    btn.disabled = true;
    btn.textContent = "Checking…";

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Could not log in (${res.status}).`);

      localStorage.setItem(SESSION, JSON.stringify({ token: data.token, entryId: data.entryId, name: data.name }));
      location.assign("/team");
    } catch (err) {
      setMsg(err.message);
      btn.disabled = false;
      btn.textContent = "Continue";
    }
  });
})();
