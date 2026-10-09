import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { createHiringRouter } from "../../src/modules/hiring/routes.js";
import { HiringRepository } from "../../src/modules/hiring/repository.js";
import { HiringService } from "../../src/modules/hiring/service.js";
import { RecommendationService } from "../../src/modules/hiring/recommendation-service.js";
import { RecommendationAgent } from "../../src/modules/hiring/agent/orchestrator.js";
import type { ProfileStorage } from "../../src/modules/hiring/storage.js";
import { PDF } from "../../src/modules/hiring/domain.js";
import { requirements, pdfFixture, ScriptedProvider } from "./fixtures.js";
const enabled = Boolean(process.env.HIRING_TEST_DATABASE_URL);
const suite = describe.skipIf(!enabled);
suite("hiring HTTP integration with PostgreSQL and verified JWTs", () => {
  let db: PrismaClient;
  let server: Server;
  let jwks: Server;
  let base: string;
  let issuer: string;
  let openingId: string;
  let foreignOpeningId: string;
  let tenantId: string;
  let profileId: number;
  const schema = `hiring_test_${randomUUID().replaceAll("-", "")}`;
  const objects = new Map<string, Buffer>();
  const storage: ProfileStorage = {
    put: async (key, bytes) => {
      if (objects.has(key)) throw { $metadata: { httpStatusCode: 412 } };
      objects.set(key, bytes);
    },
    get: async (key) => {
      const bytes = objects.get(key);
      if (!bytes) throw new Error("MISSING_FILE");
      return bytes;
    },
  };
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const users = new Map<
    string,
    {
      id: string;
      externalId: string;
      role: "IT_VENDOR" | "HIRING_MANAGER";
      tenantId: string;
    }
  >();
  const listen = (app: Server) =>
    new Promise<number>((resolve) => {
      app.listen(0, "127.0.0.1", () =>
        resolve((app.address() as { port: number }).port),
      );
    });
  function token(name: string, overrides: Record<string, unknown> = {}) {
    const user = users.get(name)!;
    return jwt.sign(
      {
        sub: user.externalId,
        azp: "dynamic-client",
        realm_access: { roles: [user.role] },
        ...overrides,
      },
      privateKey,
      { algorithm: "RS256", keyid: "hiring-test-key", issuer, expiresIn: "5m" },
    );
  }
  async function request(
    path: string,
    name?: string,
    method = "GET",
    body?: unknown,
    customHeaders: Record<string, string> = {},
  ) {
    return fetch(`${base}${path}`, {
      method,
      headers: {
        ...(name ? { Authorization: `Bearer ${token(name)}` } : {}),
        ...(body
          ? { "Content-Type": Buffer.isBuffer(body) ? PDF : "application/json" }
          : {}),
        ...customHeaders,
      },
      body: body
        ? Buffer.isBuffer(body)
          ? new Uint8Array(body)
          : JSON.stringify(body)
        : undefined,
    });
  }
  async function submit(name = "vendor", id = openingId) {
    const bytes = pdfFixture();
    const reservation = await request(
      `/vendor/openings/${id}/profiles/presign`,
      name,
      "POST",
      {
        files: [
          { fileName: "candidate.pdf", size: bytes.length, contentType: PDF },
        ],
      },
    );
    expect(reservation.status).toBe(201);
    const { uploads } = await reservation.json();
    const uploaded = await request(uploads[0].uploadPath, name, "PUT", bytes);
    expect(uploaded.status).toBe(200);
    const response = await request(
      `/vendor/openings/${id}/profiles/upload`,
      name,
      "POST",
      { uploadIds: [uploads[0].id] },
    );
    expect(response.status).toBe(202);
    return { ...(await response.json()).items[0], uploadId: uploads[0].id };
  }
  beforeAll(async () => {
    const url = new URL(process.env.HIRING_TEST_DATABASE_URL!);
    url.searchParams.set("schema", schema);
    execFileSync(
      process.execPath,
      ["node_modules/prisma/build/index.js", "migrate", "deploy"],
      { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: "pipe" },
    );
    db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    jwks = createServer((_req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          keys: [
            {
              ...publicKey.export({ format: "jwk" }),
              kid: "hiring-test-key",
              alg: "RS256",
              use: "sig",
            },
          ],
        }),
      );
    });
    const jwksPort = await listen(jwks);
    process.env.KEYCLOAK_URL = `http://127.0.0.1:${jwksPort}`;
    process.env.KEYCLOAK_REALM = "test";
    process.env.HIRING_UPLOAD_SIGNING_SECRET = randomUUID();
    process.env.KEYCLOAK_CLIENT_ID = "dynamic-client";
    issuer = `${process.env.KEYCLOAK_URL}/realms/test`;
    await db.$transaction(async (tx) => {
      tenantId = (
        await tx.tenants.create({ data: { companyName: "Test tenant A" } })
      ).tenantId;
      const other = (
        await tx.tenants.create({ data: { companyName: "Test tenant B" } })
      ).tenantId;
      for (const [name, role, tenant] of [
        ["vendor", "IT_VENDOR", tenantId],
        ["vendor2", "IT_VENDOR", tenantId],
        ["manager", "HIRING_MANAGER", tenantId],
        ["manager2", "HIRING_MANAGER", tenantId],
        ["foreign", "IT_VENDOR", other],
        ["foreignManager", "HIRING_MANAGER", other],
      ] as const) {
        users.set(
          name,
          (await tx.user.create({
            data: {
              email: `${name}@test.example`,
              role,
              tenantId: tenant,
              externalId: randomUUID(),
            },
            select: { id: true, externalId: true, role: true, tenantId: true },
          })) as typeof users extends Map<string, infer U> ? U : never,
        );
      }
      openingId = (
        await tx.opening.create({
          data: {
            ...requirements,
            tenantId,
            hiringManagerId: users.get("manager")!.id,
          },
        })
      ).id;
      foreignOpeningId = (
        await tx.opening.create({
          data: {
            ...requirements,
            tenantId: other,
            hiringManagerId: users.get("foreignManager")!.id,
          },
        })
      ).id;
    });
    const app = express();
    app.use(express.json(), cookieParser(), createHiringRouter(db, storage));
    server = createServer(app);
    base = `http://127.0.0.1:${await listen(server)}`;
  }, 20000);
  afterAll(async () => {
    for (const app of [server, jwks])
      if (app) await new Promise<void>((resolve) => app.close(() => resolve()));
    if (db) {
      await db.$transaction((tx) =>
        tx.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`),
      );
      await db.$disconnect();
    }
  });
  it("rejects anonymous, forged, expired and wrong-client tokens", async () => {
    expect((await request("/vendor/openings")).status).toBe(401);
    expect(
      (
        await request("/vendor/openings", undefined, "GET", undefined, {
          Authorization: "Bearer invalid",
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await request("/vendor/openings", undefined, "GET", undefined, {
          Authorization: `Bearer ${token("vendor", { azp: "other-client" })}`,
        })
      ).status,
    ).toBe(401);
    const expired = jwt.sign(
      { sub: users.get("vendor")!.externalId, azp: "dynamic-client" },
      privateKey,
      { algorithm: "RS256", keyid: "hiring-test-key", issuer, expiresIn: -1 },
    );
    expect(
      (
        await request("/vendor/openings", undefined, "GET", undefined, {
          Authorization: `Bearer ${expired}`,
        })
      ).status,
    ).toBe(401);
  });
  it("enforces persona and tenant boundaries on listings and details", async () => {
    expect((await request("/vendor/openings", "manager")).status).toBe(403);
    expect((await request("/hiring-manager/openings", "vendor")).status).toBe(
      403,
    );
    expect(
      (await request(`/vendor/openings/${foreignOpeningId}`, "vendor")).status,
    ).toBe(404);
    expect(
      (await request(`/hiring-manager/openings/${openingId}`, "manager2"))
        .status,
    ).toBe(404);
    expect(
      (await (await request("/vendor/openings", "vendor")).json()).total,
    ).toBe(1);
    expect(
      (await (await request("/hiring-manager/openings", "manager2")).json())
        .total,
    ).toBe(0);
    expect(
      (await request("/vendor/openings?pageSize=999", "vendor")).status,
    ).toBe(400);
  });
  it("uploads, submits, recommends and shortlists with an atomic durable job", async () => {
    const profile = await submit();
    profileId = profile.id;
    expect(profile).not.toHaveProperty("s3Key");
    expect(profile).not.toHaveProperty("recommendationScore");
    expect(await db.recommendationJob.count({ where: { profileId } })).toBe(1);
    const worker = new RecommendationService(
      new HiringRepository(db),
      storage,
      new RecommendationAgent(new ScriptedProvider()),
    );
    expect(await worker.processOne()).toBe(true);
    const stored = await db.hiringProfile.findUniqueOrThrow({
      where: { id: profileId },
    });
    expect(stored.recommendationStatus).toBe("COMPLETED");
    expect(stored.recommendationScore).toBe(1);
    expect(stored.recommendationLatencyMs).toBeLessThan(1500);
    const profiles = await (
      await request(`/hiring-manager/openings/${openingId}/profiles`, "manager")
    ).json();
    expect(profiles.items[0].recommendationConfidence).toBe(0.9);
    expect(
      (
        await request(
          `/hiring-manager/profiles/${profileId}/shortlist`,
          "manager",
          "POST",
        )
      ).status,
    ).toBe(200);
    const selected = await db.hiringProfile.findUniqueOrThrow({
      where: { id: profileId },
    });
    expect(selected.status).toBe("SHORTLISTED");
    expect(selected.shortlistedBy).toBe(users.get("manager")!.id);
    const replay = await request(
      `/vendor/openings/${openingId}/profiles/upload`,
      "vendor",
      "POST",
      { uploadIds: [profile.uploadId] },
    );
    expect((await replay.json()).items[0].id).toBe(profileId);
    expect(await db.hiringProfile.count({ where: { id: profileId } })).toBe(1);
    const completed = await request(
      `/hiring-manager/profiles/${profileId}/recommend`,
      "manager",
      "POST",
    );
    expect((await completed.json()).queued).toBe(false);
  });
  it("does not leak profiles or recommendations through vendor endpoints", async () => {
    const own = await (
      await request(`/vendor/openings/${openingId}`, "vendor")
    ).json();
    expect(own.profiles.items[0]).not.toHaveProperty("recommended");
    expect(own.profiles.items[0]).not.toHaveProperty(
      "recommendationConfidence",
    );
    expect(own.profiles.items[0]).not.toHaveProperty("recommendationMetadata");
    const other = await (
      await request(`/vendor/openings/${openingId}`, "vendor2")
    ).json();
    expect(other.profilesCount).toBe(0);
    expect(other.profiles.items).toEqual([]);
    for (const name of ["vendor2", "foreign"]) {
      expect(
        (await request(`/vendor/profiles/${profileId}/file`, name)).status,
      ).toBe(404);
      expect(
        (await request(`/vendor/profiles/${profileId}`, name, "DELETE")).status,
      ).toBe(404);
    }
    expect(
      (await request(`/hiring-manager/profiles/${profileId}/file`, "manager2"))
        .status,
    ).toBe(404);
    expect(
      (
        await request(
          `/hiring-manager/profiles/${profileId}/reject`,
          "manager2",
          "POST",
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await request(
          `/hiring-manager/profiles/${profileId}/shortlist`,
          "vendor",
          "POST",
        )
      ).status,
    ).toBe(403);
  });
  it("serves private backend file bytes with safe headers", async () => {
    const response = await request(
      `/vendor/profiles/${profileId}/file`,
      "vendor",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-security-policy")).toBe("sandbox");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(pdfFixture());
  });
  it("rejects cross-vendor reservations and partial submission batches", async () => {
    const bytes = pdfFixture();
    const response = await request(
      `/vendor/openings/${openingId}/profiles/presign`,
      "vendor",
      "POST",
      {
        files: [
          { fileName: "one.pdf", size: bytes.length, contentType: PDF },
          { fileName: "two.pdf", size: bytes.length, contentType: PDF },
        ],
      },
    );
    const { uploads } = await response.json();
    expect(
      (await request(uploads[0].uploadPath, "vendor2", "PUT", bytes)).status,
    ).toBe(404);
    expect(
      (await request(uploads[0].uploadPath, "vendor", "PUT", bytes)).status,
    ).toBe(200);
    const before = await db.hiringProfile.count();
    expect(
      (
        await request(
          `/vendor/openings/${openingId}/profiles/upload`,
          "vendor",
          "POST",
          { uploadIds: uploads.map((upload: { id: string }) => upload.id) },
        )
      ).status,
    ).toBe(409);
    expect(await db.hiringProfile.count()).toBe(before);
    expect(
      (
        await request(
          uploads[1].uploadPath,
          "vendor",
          "PUT",
          Buffer.alloc(bytes.length),
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await request(
          `/vendor/openings/${openingId}/profiles/presign`,
          "manager",
          "POST",
          { files: [] },
        )
      ).status,
    ).toBe(403);
  });
  it("blocks cross-origin cookie mutations", async () => {
    const response = await request(
      `/vendor/profiles/${profileId}`,
      undefined,
      "DELETE",
      undefined,
      {
        Cookie: `access_token=${token("vendor")}`,
        Origin: "https://attacker.example",
      },
    );
    expect(response.status).toBe(403);
  });
  it("atomically rolls back a transaction that fails after a write", async () => {
    const repository = new HiringRepository(db);
    const before = await db.hiringProfile.findUniqueOrThrow({
      where: { id: profileId },
    });
    await expect(
      repository.transaction(async (tx) => {
        await tx.hiringProfile.update({
          where: { id: profileId },
          data: { recommendationScore: 0.01 },
        });
        throw new Error("ROLLBACK");
      }),
    ).rejects.toThrow("ROLLBACK");
    expect(
      (await db.hiringProfile.findUniqueOrThrow({ where: { id: profileId } }))
        .recommendationScore,
    ).toBe(before.recommendationScore);
  });
  it("does not publish a recommendation after deletion during inference", async () => {
    const profile = await submit();
    const provider = new ScriptedProvider();
    const original = provider.complete.bind(provider);
    let deleted = false;
    provider.complete = async (...args) => {
      if (!deleted) {
        deleted = true;
        await new HiringService(new HiringRepository(db), storage).remove(
          { id: users.get("vendor")!.id, role: "IT_VENDOR", tenantId },
          profile.id,
        );
      }
      return original(...args);
    };
    await new RecommendationService(
      new HiringRepository(db),
      storage,
      new RecommendationAgent(provider),
    ).processOne();
    const stored = await db.hiringProfile.findUniqueOrThrow({
      where: { id: profile.id },
    });
    expect(stored.isDeleted).toBe(true);
    expect(stored.recommendationScore).toBeNull();
  });
  it("allows only one concurrent worker to claim a profile", async () => {
    const profile = await submit();
    const provider = new ScriptedProvider();
    const complete = vi.spyOn(provider, "complete");
    const worker = new RecommendationService(
      new HiringRepository(db),
      storage,
      new RecommendationAgent(provider),
    );
    await Promise.all([worker.processOne(), worker.processOne()]);
    expect(
      (
        await db.recommendationJob.findUniqueOrThrow({
          where: { profileId: profile.id },
        })
      ).attempts,
    ).toBe(1);
    expect(complete).toHaveBeenCalledTimes(6);
  });
  it("soft deletes and removes file access without hard deleting records", async () => {
    expect(
      (await request(`/vendor/profiles/${profileId}`, "vendor", "DELETE"))
        .status,
    ).toBe(204);
    expect(
      (await request(`/vendor/profiles/${profileId}/file`, "vendor")).status,
    ).toBe(404);
    expect(
      (
        await request(
          `/hiring-manager/profiles/${profileId}/shortlist`,
          "manager",
          "POST",
        )
      ).status,
    ).toBe(404);
    expect(
      (await db.hiringProfile.findUniqueOrThrow({ where: { id: profileId } }))
        .isDeleted,
    ).toBe(true);
  });
});
