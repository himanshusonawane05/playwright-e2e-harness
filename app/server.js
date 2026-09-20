/**
 * Demo application under test.
 *
 * State is entirely in-memory and per-process: users keyed by email, todos keyed by
 * id, and session tokens keyed by token. There is no database.
 *
 * Test isolation does NOT come from resetting shared state between tests - a reset
 * endpoint would make parallel tests interfere with each other. Instead every test
 * registers its own unique user, so tests are naturally independent and can run in
 * any order, in parallel, against one long-lived server process.
 */

import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const users = new Map(); // email -> { id, email, salt, hash }
const todos = new Map(); // id -> { id, title, done, createdAt, owner }
const sessions = new Map(); // token -> email
let nextTodoId = 1;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hashPassword(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey.toString("hex"));
    });
  });
}

async function verifyPassword(password, salt, expectedHash) {
  const derived = await hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(derived, "hex"), Buffer.from(expectedHash, "hex"));
}

// Kept deliberately dependency-free; cookie-parser would earn its place only if the
// app needed signed or multi-value cookies.
function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key) out[key] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function requireAuth(req, res, next) {
  const token = parseCookies(req).session;
  if (!token || !sessions.has(token)) {
    return res.status(401).json({ error: "not authenticated" });
  }
  req.email = sessions.get(token);
  req.token = token;
  next();
}

function validTitle(title) {
  return typeof title === "string" && title.trim().length > 0 && title.length <= 200;
}

const app = express();

// Opt-in request log. Off by default so test output stays readable; turn it on with
// LOG_REQUESTS=1 when you need to prove whether a stalled request reached the server
// at all, which is the fastest way to tell a server problem from a network one.
if (process.env.LOG_REQUESTS === "1") {
  app.use((req, res, next) => {
    const started = process.hrtime.bigint();
    res.on("finish", () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      console.log(`${new Date().toISOString()} ${req.method} ${req.url} ${res.statusCode} ${ms.toFixed(1)}ms`);
    });
    next();
  });
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.status(200).json({ ok: true, uptime_s: process.uptime() });
});

app.post("/api/register", async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== "string" || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "email is missing or malformed" });
  }
  if (typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ error: "password must be at least 8 characters" });
  }
  if (users.has(email)) {
    return res.status(409).json({ error: "email already registered" });
  }
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await hashPassword(password, salt);
  const id = crypto.randomUUID();
  users.set(email, { id, email, salt, hash });
  res.status(201).json({ id, email });
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body || {};
  const user = typeof email === "string" ? users.get(email) : undefined;
  // One generic failure for every case, so the response never reveals which
  // emails are registered.
  if (!user || typeof password !== "string" || !(await verifyPassword(password, user.salt, user.hash))) {
    return res.status(401).json({ error: "invalid credentials" });
  }
  const token = crypto.randomUUID();
  sessions.set(token, email);
  res.setHeader("Set-Cookie", `session=${token}; HttpOnly; Path=/; SameSite=Lax`);
  res.status(200).json({ email });
});

app.post("/api/logout", requireAuth, (req, res) => {
  sessions.delete(req.token);
  res.setHeader("Set-Cookie", "session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0");
  res.status(204).end();
});

app.get("/api/me", requireAuth, (req, res) => {
  res.status(200).json({ email: req.email });
});

app.get("/api/todos", requireAuth, (req, res) => {
  const list = [...todos.values()]
    .filter((t) => t.owner === req.email)
    .sort((a, b) => a.id - b.id)
    .map(({ owner, ...todo }) => todo);
  res.status(200).json(list);
});

app.post("/api/todos", requireAuth, (req, res) => {
  const { title } = req.body || {};
  if (!validTitle(title)) {
    return res.status(400).json({ error: "title must be 1-200 characters" });
  }
  const todo = { id: nextTodoId++, title, done: false, createdAt: new Date().toISOString(), owner: req.email };
  todos.set(todo.id, todo);
  const { owner, ...body } = todo;
  res.status(201).json(body);
});

app.patch("/api/todos/:id", requireAuth, (req, res) => {
  const todo = todos.get(Number(req.params.id));
  // A todo owned by someone else is reported as missing, not forbidden, so the
  // response cannot be used to enumerate other users' ids.
  if (!todo || todo.owner !== req.email) {
    return res.status(404).json({ error: "not found" });
  }
  const { title, done } = req.body || {};
  if (title !== undefined) {
    if (!validTitle(title)) return res.status(400).json({ error: "title must be 1-200 characters" });
    todo.title = title;
  }
  if (done !== undefined) {
    if (typeof done !== "boolean") return res.status(400).json({ error: "done must be a boolean" });
    todo.done = done;
  }
  const { owner, ...body } = todo;
  res.status(200).json(body);
});

app.delete("/api/todos/:id", requireAuth, (req, res) => {
  const todo = todos.get(Number(req.params.id));
  if (!todo || todo.owner !== req.email) {
    return res.status(404).json({ error: "not found" });
  }
  todos.delete(todo.id);
  res.status(204).end();
});

// Third-party dependency on purpose: the suite intercepts this to prove tests stay
// deterministic without reaching the real internet. Any failure degrades to a null
// tip rather than breaking the page.
app.get("/api/tip", async (_req, res) => {
  const url = process.env.TIP_URL || "https://api.example.com/tip";
  try {
    const upstream = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (!upstream.ok) throw new Error(`upstream ${upstream.status}`);
    const body = await upstream.json();
    res.status(200).json({ tip: body.tip ?? null, source: "external" });
  } catch {
    res.status(200).json({ tip: null, source: "unavailable" });
  }
});

const port = Number(process.env.PORT) || 8090;
const server = app.listen(port, "127.0.0.1", () => {
  console.log(`demo app listening on http://127.0.0.1:${port}`);
});

/**
 * Node closes idle keep-alive sockets after 5s by default. A client that reuses a
 * socket at that exact moment gets ECONNRESET - which surfaces as a test that fails
 * once in twenty for no visible reason. Keeping the server's idle timeout well above
 * any client's removes that race instead of papering over it with a retry.
 */
server.keepAliveTimeout = 61_000;
server.headersTimeout = 65_000;
