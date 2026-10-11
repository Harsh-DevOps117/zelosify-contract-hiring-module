import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import type { Server } from "node:http";
import { authenticator } from "otplib";
import jwt from "jsonwebtoken";

const mocks = vi.hoisted(() => ({
  user: { findFirst: vi.fn(), create: vi.fn(), findUnique: vi.fn() },
  tenants: { findUnique: vi.fn() },
  get: vi.fn(),
  post: vi.fn(),
}));
vi.mock("../../src/config/prisma/prisma.js", () => ({ default: { user: mocks.user, tenants: mocks.tenants } }));
vi.mock("axios", () => ({ default: { get: mocks.get, post: mocks.post } }));
vi.mock("../../src/utils/keycloak/getAdminToken.js", () => ({ getAdminToken: vi.fn().mockResolvedValue("admin-token") }));
vi.mock("../../src/utils/keycloak/createKeycloakUser.js", () => ({ createKeycloakUser: vi.fn().mockResolvedValue({ id: "keycloak-user" }) }));
vi.mock("../../src/config/keycloak/keycloak.js", () => ({ getClientSecret: vi.fn().mockResolvedValue("client-secret") }));
vi.mock("../../src/utils/keycloak/getKeycloakClientSecret.js", () => ({ getKeycloakClientSecret: vi.fn().mockResolvedValue("client-secret") }));

import { register } from "../../src/modules/onboarding/register.js";
import { verifyTOTP } from "../../src/controllers/auth/local/login/verifyTOTP.js";

let server: Server;
let base: string;
const payload = {
  username: "vendor", email: "vendor@example.test", password: "test-password",
  firstName: "Test", lastName: "Vendor", phoneNumber: "1234567890",
  tenantId: "test-tenant", department: "Engineering", role: "IT_VENDOR",
};
const send = (path: string, body: unknown, cookie = "") => fetch(`${base}${path}`, {
  method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body),
});

beforeAll(async () => {
  const app = express();
  app.use(express.json(), cookieParser());
  app.post("/register", register);
  app.post("/verify-totp", verifyTOTP);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve())));
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("JWT_SECRET", "test-only-registration-signing-key");
  vi.stubEnv("NODE_ENV", "test");
  mocks.user.findFirst.mockResolvedValue(null);
  mocks.tenants.findUnique.mockResolvedValue({ tenantId: "test-tenant" });
  mocks.user.create.mockImplementation(async ({ data }) => ({ id: "database-user", ...data }));
  mocks.get.mockResolvedValue({ data: { id: "role-id" } });
  mocks.post.mockResolvedValue({ data: { access_token: "access-token", refresh_token: "refresh-token" } });
});
afterEach(() => vi.unstubAllEnvs());

describe("registration and initial TOTP verification", () => {
  it("rejects a company name in place of the required tenant ID", async () => {
    const response = await send("/register", { ...payload, tenantId: undefined, companyName: "Example" });
    expect(response.status).toBe(400);
    expect(mocks.user.create).not.toHaveBeenCalled();
  });

  it("rejects the former unsupported USER role", async () => {
    const response = await send("/register", { ...payload, role: "USER" });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ message: "Invalid role provided." });
  });

  it("issues login cookies only after a valid authenticator code", async () => {
    const response = await send("/register", payload);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.qrCode).toMatch(/^data:image\/png;base64,/);
    expect(body.expiresIn).toBe(300);
    const cookies = response.headers.getSetCookie();
    const temporary = cookies.find((cookie) => cookie.startsWith("temp_token="))!;
    expect(temporary).toContain("HttpOnly");
    expect(cookies.some((cookie) => /^access_token=[^;]/.test(cookie))).toBe(false);
    expect(cookies.some((cookie) => /^refresh_token=[^;]/.test(cookie))).toBe(false);
    const cookie = temporary.split(";")[0];
    const token = decodeURIComponent(cookie.slice("temp_token=".length));
    expect(jwt.verify(token, process.env.JWT_SECRET!)).toMatchObject({ userId: "database-user", refreshToken: "refresh-token" });
    const secret = new URL(body.otpAuthUrl).searchParams.get("secret")!;
    mocks.user.findUnique.mockResolvedValue({ id: "database-user", role: "IT_VENDOR", totpSecret: secret });

    const invalid = await send("/verify-totp", { totp: "invalid" }, cookie);
    expect(invalid.status).toBe(401);
    expect(invalid.headers.getSetCookie()).toEqual([]);

    const valid = await send("/verify-totp", { totp: authenticator.generate(secret) }, cookie);
    expect(valid.status).toBe(200);
    expect(valid.headers.getSetCookie()).toEqual(expect.arrayContaining([
      expect.stringContaining("access_token=access-token;"),
      expect.stringContaining("refresh_token=refresh-token;"),
    ]));
    expect((await valid.json()).user).not.toHaveProperty("totpSecret");
  });
});
