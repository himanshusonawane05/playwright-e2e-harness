// Hammer the API with no browsers involved, to separate server capacity from browser load.
const BASE = "http://127.0.0.1:8090";
const one = async (i) => {
  const t = Date.now();
  const user = { email: `load-${i}-${Date.now()}@example.test`, password: "correct-horse-battery" };
  const r1 = await fetch(`${BASE}/api/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(user) });
  const r2 = await fetch(`${BASE}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(user) });
  const cookie = r2.headers.get("set-cookie").split(";")[0];
  const r3 = await fetch(`${BASE}/api/todos`, { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ title: "load" }) });
  const r4 = await fetch(`${BASE}/api/todos`, { headers: { cookie } });
  return { ms: Date.now() - t, codes: [r1.status, r2.status, r3.status, r4.status].join("/") };
};
for (const c of [6, 12, 24]) {
  const t = Date.now();
  const res = await Promise.all(Array.from({ length: c }, (_, i) => one(i)));
  const times = res.map(r => r.ms).sort((a, b) => a - b);
  const bad = res.filter(r => r.codes !== "201/200/201/200").length;
  console.log(`concurrency ${c}: total ${Date.now() - t}ms, median ${times[Math.floor(c/2)]}ms, max ${times[c-1]}ms, bad ${bad}`);
}
