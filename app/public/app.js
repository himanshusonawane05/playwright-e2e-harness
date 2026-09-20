/**
 * Demo app frontend.
 *
 * After every mutation the list is re-fetched from the server rather than patched
 * locally. Optimistic UI would let the screen and the database disagree, and the
 * e2e suite asserts on what the server actually stored.
 */
(function () {
  "use strict";

  const $ = (id) => document.querySelector(`[data-testid="${id}"]`);

  const authView = $("auth-view");
  const authForm = document.getElementById("auth-form");
  const authEmail = $("auth-email");
  const authPassword = $("auth-password");
  const authSubmit = $("auth-submit");
  const authToggle = $("auth-toggle");
  const authError = $("auth-error");
  const authModeLabel = $("auth-mode-label");

  const appView = $("app-view");
  const currentUser = $("current-user");
  const logoutBtn = $("logout");
  const tipEl = $("tip");
  const tipSourceEl = $("tip-source");

  const todoForm = document.getElementById("todo-form");
  const todoInput = $("todo-input");
  const todoAdd = $("todo-add");
  const todoList = $("todo-list");
  const todoCount = $("todo-count");
  const emptyState = $("empty-state");
  const todoError = $("todo-error");

  let authMode = "login";
  let todos = [];

  async function api(path, options = {}) {
    const opts = { credentials: "same-origin", ...options };
    if (opts.body !== undefined) {
      opts.headers = { ...opts.headers, "Content-Type": "application/json" };
    }
    try {
      const res = await fetch(path, opts);
      const body = res.status === 204 ? null : await res.json().catch(() => null);
      return { ok: res.ok, status: res.status, body };
    } catch {
      // A dropped connection must not take the page down with it; callers decide
      // what a failed request means for their own piece of UI.
      return { ok: false, status: 0, body: null };
    }
  }

  function showError(el, message) {
    el.textContent = message || "";
    el.hidden = !message;
  }

  function setAuthMode(mode) {
    authMode = mode;
    const isLogin = mode === "login";
    authModeLabel.textContent = isLogin ? "Sign in" : "Create account";
    authSubmit.textContent = isLogin ? "Sign in" : "Create account";
    authToggle.textContent = isLogin ? "Create account" : "Sign in";
    authPassword.autocomplete = isLogin ? "current-password" : "new-password";
    showError(authError, "");
  }

  function showAuthView() {
    appView.hidden = true;
    authView.hidden = false;
    setAuthMode("login");
    authEmail.value = "";
    authPassword.value = "";
  }

  async function showAppView(email) {
    currentUser.textContent = email;
    authView.hidden = true;
    appView.hidden = false;
    todoInput.value = "";
    showError(todoError, "");
    await loadTodos();
    // The tip comes from a third party, so it must never gate the app being usable.
    // Deliberately not awaited: it fills in when (and if) it arrives.
    void loadTip();
  }

  async function loadTip() {
    const { body } = await api("/api/tip");
    tipEl.textContent = body && body.tip ? body.tip : "No tip available";
    tipSourceEl.textContent = (body && body.source) || "";
  }

  async function loadTodos() {
    const { ok, body } = await api("/api/todos");
    todos = ok && Array.isArray(body) ? body : [];
    render();
  }

  function render() {
    todoList.textContent = "";
    const done = todos.filter((t) => t.done).length;
    todoCount.textContent = `${done} of ${todos.length} done`;

    emptyState.hidden = todos.length > 0;
    todoList.hidden = todos.length === 0;

    for (const todo of todos) {
      const li = document.createElement("li");
      li.className = "todo-item";
      li.dataset.testid = "todo-item";
      li.dataset.todoId = String(todo.id);
      li.dataset.done = todo.done ? "true" : "false";

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "todo-toggle";
      toggle.dataset.testid = "todo-toggle";
      toggle.setAttribute("aria-pressed", todo.done ? "true" : "false");
      toggle.setAttribute("aria-label", `Mark "${todo.title}" ${todo.done ? "not done" : "done"}`);
      toggle.textContent = todo.done ? "✓" : "";
      toggle.addEventListener("click", () => mutate(`/api/todos/${todo.id}`, "PATCH", { done: !todo.done }));

      const title = document.createElement("span");
      title.className = "todo-title";
      title.dataset.testid = "todo-title";
      title.textContent = todo.title;

      const del = document.createElement("button");
      del.type = "button";
      del.className = "todo-delete";
      del.dataset.testid = "todo-delete";
      del.setAttribute("aria-label", `Delete "${todo.title}"`);
      del.textContent = "✕";
      del.addEventListener("click", () => mutate(`/api/todos/${todo.id}`, "DELETE"));

      li.append(toggle, title, del);
      todoList.appendChild(li);
    }
  }

  // One path for every mutation: call, surface the server's error verbatim, reload.
  async function mutate(path, method, payload) {
    showError(todoError, "");
    const { ok, body } = await api(path, {
      method,
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    if (!ok) {
      showError(todoError, (body && body.error) || "Request failed");
      return false;
    }
    await loadTodos();
    return true;
  }

  authToggle.addEventListener("click", () => setAuthMode(authMode === "login" ? "register" : "login"));

  authForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = authEmail.value.trim();
    const password = authPassword.value;
    authSubmit.disabled = true;
    showError(authError, "");
    try {
      if (authMode === "register") {
        const reg = await api("/api/register", { method: "POST", body: JSON.stringify({ email, password }) });
        if (!reg.ok) {
          showError(authError, (reg.body && reg.body.error) || "Could not create account");
          return;
        }
      }
      const login = await api("/api/login", { method: "POST", body: JSON.stringify({ email, password }) });
      if (!login.ok) {
        showError(authError, (login.body && login.body.error) || "Could not sign in");
        return;
      }
      await showAppView(login.body.email);
    } finally {
      authSubmit.disabled = false;
    }
  });

  logoutBtn.addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" });
    todos = [];
    showAuthView();
  });

  todoForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = todoInput.value.trim();
    if (!title) return;
    todoAdd.disabled = true;
    try {
      const created = await mutate("/api/todos", "POST", { title });
      if (created) todoInput.value = "";
    } finally {
      todoAdd.disabled = false;
    }
  });

  (async function start() {
    const me = await api("/api/me");
    if (me.ok && me.body) {
      await showAppView(me.body.email);
    } else {
      showAuthView();
    }
    document.body.dataset.ready = "true"; // lets tests wait for hydration deterministically
  })();
})();
