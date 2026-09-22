// Smoke test: proves the built app, the Cloudflare adapter and the Supabase auth flow still work together.
// Zero dependencies on purpose. Run against a live server: BASE_URL=http://localhost:4321 node scripts/smoke.mjs

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4321";
const email = `smoke-${Date.now()}@example.com`;
const password = "Smoke-Test-Passw0rd!";

// Seeded by supabase/seed.sql on every `supabase start` and `supabase db reset`, so it exists
// locally and in the CI smoke job but nowhere else. A self-registered account is `elektryk`; this
// is the only way to exercise the admin side of the gate over HTTP.
const adminEmail = "admin@example.com";
const adminPassword = "admin123456";

const jar = new Map();

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function storeCookies(response) {
  for (const raw of response.headers.getSetCookie()) {
    const [pair, ...attrs] = raw.split(";");
    const [name, ...rest] = pair.split("=");
    const expired = attrs.some((a) => /max-age=0/i.test(a.trim()));
    if (expired) jar.delete(name.trim());
    else jar.set(name.trim(), rest.join("="));
  }
}

async function request(path, { method = "GET", form } = {}) {
  const response = await fetch(BASE_URL + path, {
    method,
    redirect: "manual",
    headers: {
      Cookie: cookieHeader(),
      Origin: BASE_URL,
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  storeCookies(response);
  return { status: response.status, location: response.headers.get("location") ?? "" };
}

const steps = [
  ["home renders", () => request("/"), { status: 200 }],
  ["dashboard redirects anonymous user", () => request("/dashboard"), { status: 302, location: "/auth/signin" }],
  [
    "signup creates account",
    () => request("/api/auth/signup", { method: "POST", form: { email, password } }),
    { status: 302, location: "/auth/confirm-email" },
  ],
  [
    "signin rejects wrong password",
    () => request("/api/auth/signin", { method: "POST", form: { email, password: "wrong" } }),
    { status: 302, location: "/auth/signin?error=" },
  ],
  [
    "signin accepts correct password",
    () => request("/api/auth/signin", { method: "POST", form: { email, password } }),
    { status: 302, location: "/" },
  ],
  ["dashboard renders for signed-in user", () => request("/dashboard"), { status: 200 }],
  // The gate, from the electrician's side: a self-registered account is `elektryk`, so /admin is
  // refused and they are bounced to their own home rather than to sign-in.
  ["admin refuses an electrician", () => request("/admin"), { status: 302, location: "/dashboard" }],
  ["signout clears session", () => request("/api/auth/signout", { method: "POST" }), { status: 302, location: "/" }],
  ["dashboard redirects after signout", () => request("/dashboard"), { status: 302, location: "/auth/signin" }],
  ["admin redirects anonymous user", () => request("/admin"), { status: 302, location: "/auth/signin" }],
  // And from the admin's side, using the seeded account. Signing in lands on /admin rather than /,
  // which is the role-aware redirect in src/pages/api/auth/signin.ts.
  [
    "seeded admin signs in and lands on the admin panel",
    () => request("/api/auth/signin", { method: "POST", form: { email: adminEmail, password: adminPassword } }),
    { status: 302, location: "/admin" },
  ],
  ["admin renders for the admin", () => request("/admin"), { status: 200 }],
  ["dashboard refuses the admin", () => request("/dashboard"), { status: 302, location: "/admin" }],
  [
    "signout clears the admin session",
    () => request("/api/auth/signout", { method: "POST" }),
    { status: 302, location: "/" },
  ],
  ["admin redirects after admin signout", () => request("/admin"), { status: 302, location: "/auth/signin" }],
];

let failed = 0;
for (const [name, run, expected] of steps) {
  const actual = await run();
  const ok =
    actual.status === expected.status &&
    (expected.location === undefined || actual.location.startsWith(expected.location));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  -> ${actual.status} ${actual.location}`);
  if (!ok) {
    failed++;
    console.log(`      expected ${expected.status} ${expected.location ?? ""}`);
  }
}

console.log(failed ? `\n${failed} step(s) failed` : "\nAll smoke steps passed");
process.exit(failed ? 1 : 0);
