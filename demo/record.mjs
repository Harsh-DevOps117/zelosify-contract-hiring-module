import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { mkdirSync, renameSync, readdirSync, statSync, copyFileSync } from "node:fs";
import path from "node:path";

const BASE = "http://localhost:5173";
const OUT_DIR = path.resolve("./output");
mkdirSync(OUT_DIR, { recursive: true });

const TENANT_ID = "b0000000-0000-4000-8000-000000000001";
const OPENING_TITLE = "Platform Engineer";

const RUN_ID = Date.now().toString(36);

// Give each run's uploads unique filenames so locators never collide with
// leftover profiles from earlier test runs against the same shared dev DB.
const ASSETS = path.resolve("./assets");
const RUN_ASSETS = path.join(ASSETS, `run-${RUN_ID}`);
mkdirSync(RUN_ASSETS, { recursive: true });
const STRONG_NAME = `elena_martinez_${RUN_ID}.pdf`;
const WEAK_NAME = `priya_nair_${RUN_ID}.pptx`;
const SCRATCH_NAME = `duplicate_upload_${RUN_ID}.pdf`;
const STRONG_PDF = path.join(RUN_ASSETS, STRONG_NAME);
const WEAK_PPTX = path.join(RUN_ASSETS, WEAK_NAME);
const SCRATCH_PDF = path.join(RUN_ASSETS, SCRATCH_NAME);
copyFileSync(path.join(ASSETS, "strong_candidate.pdf"), STRONG_PDF);
copyFileSync(path.join(ASSETS, "weak_candidate.pptx"), WEAK_PPTX);
copyFileSync(path.join(ASSETS, "scratch_candidate.pdf"), SCRATCH_PDF);

const VENDOR = {
  username: `nova-vendor-${RUN_ID}`,
  email: `nova.vendor.${RUN_ID}@example.com`,
  password: "Demo@Pass123",
  firstName: "Nova",
  lastName: "Reyes",
  phoneNumber: "+15550123456",
  department: "Staffing Partners",
};

const MANAGER = {
  username: "user123",
  password: "DemoManager#2026",
};

// --- RFC 6238 TOTP (SHA1, 30s step, 6 digits) -------------------------------
function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.replace(/=+$/, "").toUpperCase();
  let bits = "";
  for (const char of clean) {
    const val = alphabet.indexOf(char);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function totp(secretBase32, stepSeconds = 30, digits = 6, timeMs = Date.now()) {
  const counter = Math.floor(timeMs / 1000 / stepSeconds);
  const key = base32Decode(secretBase32);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binCode % 10 ** digits).padStart(digits, "0");
}

async function freshTotp(secret) {
  const stepMs = 30000;
  const remaining = stepMs - (Date.now() % stepMs);
  if (remaining < 4000) {
    await new Promise((r) => setTimeout(r, remaining + 200));
  }
  return totp(secret);
}

function log(step) {
  console.log(`\n[demo] ${step}`);
}

async function waitForAnyText(page, texts, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (const text of texts) {
      const count = await page.getByText(text, { exact: false }).count();
      if (count > 0) return text;
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`Timed out waiting for any of: ${texts.join(", ")}`);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: OUT_DIR, size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();

  try {
    // ---------------------------------------------------------------------
    log("Intro hold (narrate the overview here)");
    await page.goto(`${BASE}/register`, { waitUntil: "networkidle" });
    await page.waitForTimeout(28000);

    log("Vendor registration: filling the form");
    await page.locator('input[name="username"]').fill(VENDOR.username);
    await page.locator('input[name="email"]').fill(VENDOR.email);
    await page.locator('input[name="password"]').fill(VENDOR.password);
    await page.locator('input[name="confirmPassword"]').fill(VENDOR.password);
    await page.locator('input[name="firstName"]').fill(VENDOR.firstName);
    await page.locator('input[name="lastName"]').fill(VENDOR.lastName);
    await page.locator('input[name="phoneNumber"]').fill(VENDOR.phoneNumber);
    await page.locator('input[name="tenantId"]').fill(TENANT_ID);
    await page.locator('input[name="department"]').fill(VENDOR.department);
    // role select already defaults to IT_VENDOR
    await page.waitForTimeout(8000);

    let registerBody;
    await page.route("**/auth/register", async (route) => {
      const response = await route.fetch();
      registerBody = await response.json();
      await route.fulfill({ response });
    });
    await page.getByRole("button", { name: "Create Account" }).click();
    const deadline = Date.now() + 15000;
    while (!registerBody && Date.now() < deadline) {
      await page.waitForTimeout(100);
    }
    if (!registerBody) throw new Error("Did not capture /auth/register response");
    await page.unroute("**/auth/register");
    const secretMatch = registerBody.otpAuthUrl.match(/secret=([A-Z2-7]+)/i);
    const vendorTotpSecret = secretMatch[1];
    log(`Vendor registered, TOTP secret captured (len ${vendorTotpSecret.length})`);

    await page.waitForURL(/\/setup-totp/, { timeout: 15000 });
    await page.waitForTimeout(2000);

    log("Vendor TOTP setup: scanning QR, entering code from authenticator");
    await page.waitForTimeout(18000); // hold on the QR code screen
    const setupCode = await freshTotp(vendorTotpSecret);
    await page.locator("#totp-code").fill(setupCode);
    await page.waitForTimeout(2000);
    await page.getByRole("button", { name: "Verify & complete setup" }).click();
    // Setup verification logs the session in immediately and the middleware
    // redirects straight through /login to the role's workspace.
    await page.waitForURL(/\/(login|vendor\/openings)/, { timeout: 15000 });
    await page.waitForTimeout(2000);

    // ---------------------------------------------------------------------
    log("Vendor logs out and signs back in to demonstrate the TOTP challenge");
    await context.clearCookies();
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);

    await page.getByLabel("Username or Email").fill(VENDOR.username);
    await page.getByLabel("Password", { exact: true }).fill(VENDOR.password);
    await page.waitForTimeout(2000);
    await page.getByRole("button", { name: "Continue to 2FA" }).click();
    await page.waitForTimeout(3000);

    const loginCode = await freshTotp(vendorTotpSecret);
    await page.getByLabel("2FA Code").fill(loginCode);
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: "Complete sign in" }).click();
    await page.waitForURL(/\/vendor\/openings/, { timeout: 20000 });
    log("Vendor landed on /vendor/openings");
    await page.waitForTimeout(12000);

    // ---------------------------------------------------------------------
    log(`Vendor browses openings, opens ${OPENING_TITLE}`);
    await page.getByRole("link", { name: OPENING_TITLE }).first().click();
    await page.waitForURL(/\/vendor\/openings\//, { timeout: 15000 });
    await page.waitForTimeout(12000);

    log("Vendor uploads 3 candidate profiles (PDF + PPTX), drag-and-drop zone");
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles([STRONG_PDF, WEAK_PPTX, SCRATCH_PDF]);
    await page.waitForTimeout(6000);

    const submitBtn = page.getByRole("button", { name: /Submit \d+ profiles/ });
    await submitBtn.click();
    await waitForAnyText(page, ["submitted successfully"], 30000);
    log("Profiles submitted");
    await page.waitForTimeout(6000);

    // ---------------------------------------------------------------------
    log("Vendor soft-deletes the scratch/duplicate profile");
    const scratchCard = page.locator("article", { hasText: SCRATCH_NAME });
    await scratchCard.getByRole("button", { name: new RegExp(`Remove ${SCRATCH_NAME}`) }).click();
    await page.waitForTimeout(1500);
    await scratchCard.getByRole("button", { name: "Confirm removal" }).click();
    await page.waitForTimeout(6000);

    // ---------------------------------------------------------------------
    log("RBAC check: vendor tries hiring-manager route directly");
    await page.goto(`${BASE}/hiring-manager/openings`, { waitUntil: "networkidle" });
    await page.waitForTimeout(4000);
    const vendorBlockedUrl = page.url();
    log(`Vendor redirected away from hiring-manager route -> ${vendorBlockedUrl}`);
    await page.waitForTimeout(6000);

    // ---------------------------------------------------------------------
    log("Switching persona: clearing session, logging in as hiring manager");
    await context.clearCookies();
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);

    await page.getByLabel("Username or Email").fill(MANAGER.username);
    await page.getByLabel("Password", { exact: true }).fill(MANAGER.password);
    await page.waitForTimeout(2000);
    await page.getByRole("button", { name: "Continue to 2FA" }).click();
    await page.waitForURL(/\/hiring-manager\/openings/, { timeout: 20000 });
    log("Hiring manager landed directly on /hiring-manager/openings (seeded-user fast path)");
    await page.waitForTimeout(10000);

    log(`Hiring manager opens ${OPENING_TITLE} opening`);
    await page.getByRole("link", { name: OPENING_TITLE }).first().click();
    await page.waitForURL(/\/hiring-manager\/openings\//, { timeout: 15000 });
    await page.waitForTimeout(8000);

    log("AI recommendation agent picks up both profiles asynchronously (queued/processing)");
    await waitForAnyText(page, ["AI assessment"], 20000);
    await page.waitForTimeout(70000); // dwell: explain scoring engine, tool-calling agent, etc.

    // ---------------------------------------------------------------------
    log("Hiring manager shortlists the strong match");
    const strongCard = page.locator("article", { hasText: STRONG_NAME });
    await strongCard.getByRole("button", { name: "Shortlist" }).click();
    await page.waitForTimeout(5000);

    log("Hiring manager rejects the weak match");
    const weakCard = page.locator("article", { hasText: WEAK_NAME });
    await weakCard.getByRole("button", { name: "Reject" }).click();
    await page.waitForTimeout(6000);

    // ---------------------------------------------------------------------
    log("Toggling dark mode");
    await page.getByRole("button", { name: "Toggle color theme" }).click();
    await page.waitForTimeout(10000);
    await page.getByRole("button", { name: "Toggle color theme" }).click();
    await page.waitForTimeout(3000);

    // ---------------------------------------------------------------------
    log("Responsive check: narrow viewport to mobile width");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(10000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(3000);

    // ---------------------------------------------------------------------
    log("Reverse RBAC check: hiring manager tries vendor route directly");
    await page.goto(`${BASE}/vendor/openings`, { waitUntil: "networkidle" });
    await page.waitForTimeout(5000);
    const managerBlockedUrl = page.url();
    log(`Hiring manager redirected away from vendor route -> ${managerBlockedUrl}`);
    await page.waitForTimeout(20000); // closing hold

    log("Demo flow complete");
  } catch (error) {
    console.error("[demo] FAILED:", error);
    await page.screenshot({ path: path.join(OUT_DIR, "failure.png") }).catch(() => {});
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }

  // Rename the produced video (most recently modified .webm) to something predictable
  const files = readdirSync(OUT_DIR)
    .filter((f) => f.endsWith(".webm"))
    .map((f) => ({ f, mtime: statSync(path.join(OUT_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (files.length) {
    const target = path.join(OUT_DIR, "zelosify-hiring-demo.webm");
    renameSync(path.join(OUT_DIR, files[0].f), target);
    log(`Video saved: ${target}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
