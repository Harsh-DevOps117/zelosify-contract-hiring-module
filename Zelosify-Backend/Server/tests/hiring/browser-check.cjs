const { chromium } = require(
  process.env.HIRING_PLAYWRIGHT_MODULE || "playwright",
);
const fs = require("node:fs");
const assert = require("node:assert/strict");
(async () => {
  const fixture = JSON.parse(
    fs.readFileSync("/tmp/hiring-browser-fixture.json", "utf8"),
  );
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.HIRING_BROWSER_EXECUTABLE,
  });
  const errors = [];
  async function context(token, viewport = { width: 1440, height: 1000 }) {
    const context = await browser.newContext({ viewport });
    await context.addCookies([
      { name: "access_token", value: token, domain: "localhost", path: "/" },
      {
        name: "refresh_token",
        value: "browser-test-only",
        domain: "localhost",
        path: "/",
      },
    ]);
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    return { context, page };
  }
  const vendor = await context(fixture.vendor);
  await vendor.page.goto("http://localhost:5173/vendor/openings");
  await vendor.page
    .getByRole("link", { name: "Frontend Engineer", exact: true })
    .waitFor();
  await vendor.page.screenshot({
    path: "/tmp/hiring-vendor-desktop.png",
    fullPage: true,
  });
  await vendor.page
    .getByRole("link", { name: "Frontend Engineer", exact: true })
    .click();
  await vendor.page
    .getByText("Submit candidate profiles", { exact: true })
    .waitFor();
  await vendor.page
    .locator("input[type=file]")
    .setInputFiles("/tmp/hiring-browser-resume.pdf");
  await vendor.page
    .getByRole("button", { name: "Submit 1 profile", exact: true })
    .click();
  await vendor.page.getByText("1 profile submitted successfully.").waitFor();
  assert.equal(
    await vendor.page.getByText("AI assessment", { exact: true }).count(),
    0,
  );
  await vendor.page.getByRole("button", { name: "Toggle color theme" }).click();
  await vendor.page.screenshot({
    path: "/tmp/hiring-vendor-dark.png",
    fullPage: true,
  });
  const mobile = await context(fixture.vendor, { width: 390, height: 844 });
  await mobile.page.goto(
    `http://localhost:5173/vendor/openings/${fixture.openingId}`,
  );
  await mobile.page
    .getByText("Submit candidate profiles", { exact: true })
    .waitFor();
  assert.equal(
    await mobile.page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
  );
  await mobile.page.screenshot({
    path: "/tmp/hiring-vendor-mobile.png",
    fullPage: true,
  });
  const manager = await context(fixture.manager);
  await manager.page.goto(
    `http://localhost:5173/hiring-manager/openings/${fixture.openingId}`,
  );
  await manager.page
    .getByRole("button", { name: "Shortlist", exact: true })
    .first()
    .waitFor();
  await manager.page
    .getByRole("button", { name: "Shortlist", exact: true })
    .first()
    .click();
  await manager.page
    .getByText("shortlisted", { exact: true })
    .first()
    .waitFor();
  await manager.page
    .getByRole("button", { name: "Reject", exact: true })
    .first()
    .click();
  await manager.page.getByText("rejected", { exact: true }).first().waitFor();
  await manager.page.getByRole("combobox").selectOption("100");
  await manager.page
    .getByRole("region", { name: "Scrollable candidate profiles" })
    .waitFor();
  assert.ok((await manager.page.locator("article").count()) < 20);
  await manager.page.screenshot({
    path: "/tmp/hiring-manager-desktop.png",
    fullPage: true,
  });
  await manager.page
    .getByRole("region", { name: "Scrollable candidate profiles" })
    .evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
  await manager.page.getByText("Candidate_01.pdf", { exact: true }).waitFor();
  const anonymous = await browser.newPage();
  await anonymous.goto("http://localhost:5173/hiring-manager/openings");
  await anonymous.waitForURL("**/login");
  await vendor.page.goto("http://localhost:5173/hiring-manager/openings");
  await vendor.page.waitForURL("**/user");
  console.log(
    JSON.stringify({
      passed: [
        "vendor listing",
        "upload and submit",
        "vendor recommendation exclusion",
        "dark theme",
        "mobile without horizontal overflow",
        "manager shortlist and reject",
        "virtualization and bottom scroll",
        "anonymous redirect",
        "wrong-role redirect",
      ],
      pageErrors: errors,
    }),
  );
  assert.deepEqual(errors, []);
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
