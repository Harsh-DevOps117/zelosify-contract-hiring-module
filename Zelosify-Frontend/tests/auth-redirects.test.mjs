// Run against a running stack: node --test tests/auth-redirects.test.mjs
// These tests use only synthetic cookies and never create or modify accounts.
import assert from "node:assert/strict";
import test from "node:test";

const origin = process.env.AUTH_TEST_ORIGIN || "http://localhost:5173";
const jwt = (claims) =>
  [
    { alg: "RS256", typ: "JWT" },
    claims,
  ].map((part) => Buffer.from(JSON.stringify(part)).toString("base64url")).join(".") + ".invalid-signature";

async function reachLogin(path, initialCookies) {
  const jar = new Map(Object.entries(initialCookies));
  let url = new URL(path, origin);
  for (let redirects = 0; redirects < 5; redirects++) {
    const response = await fetch(url, {
      redirect: "manual",
      headers: { Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; ") },
      signal: AbortSignal.timeout(10000),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (!value) jar.delete(name);
      else jar.set(name, value);
    }
    const location = response.headers.get("location");
    if (location) {
      await response.body?.cancel();
      url = new URL(location, url);
      assert.equal(url.origin, new URL(origin).origin);
      continue;
    }
    assert.equal(response.status, 200);
    assert.equal(url.pathname, "/login");
    assert.match(await response.text(), /Sign [Ii]n/);
    for (const name of ["access_token", "refresh_token", "role"]) {
      assert.equal(jar.has(name), false, `${name} must be cleared`);
    }
    return;
  }
  assert.fail("Login did not settle within five requests: redirect loop");
}

const vendor = { realm_access: { roles: ["IT_VENDOR"] } };
for (const [name, token] of [
  ["expired", jwt({ ...vendor, exp: Math.floor(Date.now() / 1000) - 60 })],
  ["malformed", "invalid-token"],
  ["missing expiry", jwt(vendor)],
]) {
  for (const path of ["/login", "/vendor/openings"]) {
    test(`${name} credentials recover from ${path}`, () => reachLogin(path, {
      access_token: token, refresh_token: "stale-refresh", role: "IT_VENDOR",
    }));
  }
}

for (const role of ["IT_VENDOR", "HIRING_MANAGER"]) {
  test(`backend-rejected ${role} token recovers despite future expiry`, () =>
    reachLogin("/login", {
      access_token: jwt({ realm_access: { roles: [role] }, exp: Math.floor(Date.now() / 1000) + 3600 }),
      refresh_token: "stale-refresh", role,
    }));
}

test("refresh cookie alone is cleared", () =>
  reachLogin("/login", { refresh_token: "stale-refresh", role: "IT_VENDOR" }));

test("anonymous protected request reaches login", () => reachLogin("/vendor/openings", {}));
