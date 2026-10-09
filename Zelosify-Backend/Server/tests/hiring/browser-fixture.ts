import { PrismaClient } from "@prisma/client";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import jwt from "jsonwebtoken";
import { createHiringRouter } from "../../src/modules/hiring/routes.js";
import { requirements, pdfFixture, ScriptedProvider } from "./fixtures.js";
import { HiringRepository } from "../../src/modules/hiring/repository.js";
import { RecommendationAgent } from "../../src/modules/hiring/agent/orchestrator.js";
import { RecommendationService } from "../../src/modules/hiring/recommendation-service.js";
import type { ProfileStorage } from "../../src/modules/hiring/storage.js";
if (!process.env.HIRING_BROWSER_DATABASE_URL)
  throw new Error("A dedicated HIRING_BROWSER_DATABASE_URL is required");
const db = new PrismaClient({
  datasources: { db: { url: process.env.HIRING_BROWSER_DATABASE_URL } },
});
const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const jwks = createServer((_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      keys: [
        {
          ...publicKey.export({ format: "jwk" }),
          kid: "browser-test",
          alg: "RS256",
          use: "sig",
        },
      ],
    }),
  );
});
await new Promise<void>((resolve) => jwks.listen(5092, "127.0.0.1", resolve));
process.env.KEYCLOAK_URL = "http://127.0.0.1:5092";
process.env.KEYCLOAK_REALM = "test";
process.env.HIRING_UPLOAD_SIGNING_SECRET = randomUUID();
const fixture = await db.$transaction(async (tx) => {
  const tenant = await tx.tenants.create({
    data: { companyName: "Browser test tenant" },
  });
  const manager = await tx.user.create({
    data: {
      tenantId: tenant.tenantId,
      email: `${randomUUID()}@browser.example`,
      firstName: "Bruce",
      lastName: "Wayne",
      role: "HIRING_MANAGER",
      externalId: randomUUID(),
    },
  });
  const vendor = await tx.user.create({
    data: {
      tenantId: tenant.tenantId,
      email: `${randomUUID()}@browser.example`,
      role: "IT_VENDOR",
      externalId: randomUUID(),
    },
  });
  const opening = await tx.opening.create({
    data: {
      ...requirements,
      tenantId: tenant.tenantId,
      hiringManagerId: manager.id,
      description:
        "Help shape the next generation of enterprise applications. Build accessible, reliable interfaces with our engineering team.",
      contractType: "6 months",
      expectedCompletionDate: new Date("2027-06-30"),
    },
  });
  return { tenant, manager, vendor, opening };
});
const storageObjects = new Map<string, Buffer>();
const storage: ProfileStorage = {
  put: async (key, bytes) => {
    storageObjects.set(key, bytes);
  },
  get: async (key) => storageObjects.get(key) ?? pdfFixture(),
};
await db.$transaction(async (tx) => {
  for (let i = 0; i < 65; i++)
    await tx.hiringProfile.create({
      data: {
        openingId: fixture.opening.id,
        uploadedBy: fixture.vendor.id,
        s3Key: `browser/${i}`,
        fileName: `Candidate_${String(i + 1).padStart(2, "0")}.pdf`,
        contentType: "application/pdf",
        size: pdfFixture().length,
        recommended: i % 3 === 0,
        recommendationScore: [0.9, 0.65, 0.35][i % 3],
        recommendationConfidence: 0.92,
        recommendationReason:
          "Documented React and TypeScript experience. Verified breakdown: skills 100%, experience 100%, location 100%.",
        recommendationStatus: "COMPLETED",
        recommendationLatencyMs: 180,
        recommendationVersion: "hiring-agent-v1",
      },
    });
});
const tokens = Object.fromEntries(
  ["vendor", "manager"].map((name) => {
    const user = fixture[name as "vendor" | "manager"];
    return [
      name,
      jwt.sign(
        {
          sub: user.externalId,
          azp: "dynamic-client",
          realm_access: { roles: [user.role] },
        },
        privateKey,
        {
          algorithm: "RS256",
          keyid: "browser-test",
          issuer: "http://127.0.0.1:5092/realms/test",
          expiresIn: "1h",
        },
      ),
    ];
  }),
);
await writeFile(
  "/tmp/hiring-browser-fixture.json",
  JSON.stringify({ ...tokens, openingId: fixture.opening.id }),
  { mode: 0o600 },
);
await writeFile("/tmp/hiring-browser-resume.pdf", pdfFixture());
const app = express();
app.use(
  cors({ origin: "http://localhost:5173", credentials: true }),
  express.json(),
  cookieParser(),
  createHiringRouter(db, storage),
);
const server = app.listen(5091, "127.0.0.1");
const worker = new RecommendationService(
  new HiringRepository(db),
  storage,
  new RecommendationAgent(new ScriptedProvider()),
);
let processing = false;
const interval = setInterval(async () => {
  if (processing) return;
  processing = true;
  try {
    await worker.processOne();
  } finally {
    processing = false;
  }
}, 250);
async function close() {
  clearInterval(interval);
  server.close();
  jwks.close();
  while (processing) await new Promise((resolve) => setTimeout(resolve, 100));
  await db.$transaction(async (tx) => {
    await tx.recommendationJob.deleteMany({
      where: { profile: { openingId: fixture.opening.id } },
    });
    await tx.hiringProfile.deleteMany({
      where: { openingId: fixture.opening.id },
    });
    await tx.profileUpload.deleteMany({
      where: { openingId: fixture.opening.id },
    });
    await tx.opening.delete({ where: { id: fixture.opening.id } });
    await tx.user.deleteMany({ where: { tenantId: fixture.tenant.tenantId } });
    await tx.tenants.delete({ where: { tenantId: fixture.tenant.tenantId } });
  });
  await db.$disconnect();
  process.exit(0);
}
process.once("SIGTERM", close);
process.once("SIGINT", close);
process.stdout.write(
  JSON.stringify({ event: "browser_fixture_ready", port: 5091 }) + "\n",
);
