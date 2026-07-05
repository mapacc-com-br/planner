const form = document.querySelector("#loginForm");
const message = document.querySelector("#loginMessage");
const params = new URLSearchParams(window.location.search);
const next = params.get("next") || "/";

initialize();

async function initialize() {
  if (window.lucide) {
    window.lucide.createIcons();
  }

  try {
    const session = await fetchJson("/api/session");
    if (session.authenticated && session.user) {
      window.location.href = next;
    }
  } catch {
    // Stay on login.
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.textContent = "";

  try {
    await fetchJson("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: document.querySelector("#username").value,
        password: document.querySelector("#password").value,
      }),
    });
    window.location.href = next;
  } catch (error) {
    message.textContent = error.message || "Nao foi possivel entrar.";
  }
});

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "Erro de autenticacao.");
  }

  return payload;
}
