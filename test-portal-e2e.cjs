const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");

const port = process.env.TEST_PORT || "8766";
const baseUrl = `http://127.0.0.1:${port}`;
const python = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
const server = spawn(python, ["-m", "http.server", port, "--bind", "127.0.0.1"], {
  cwd: __dirname,
  stdio: "ignore",
  windowsHide: true,
});

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if ((await fetch(`${baseUrl}/`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Portal test server did not start");
}

(async () => {
  let browser;
  try {
    await waitForServer();
    const launchOptions = { headless: true };
    if (process.env.BROWSER_EXECUTABLE) launchOptions.executablePath = process.env.BROWSER_EXECUTABLE;
    else launchOptions.channel = process.env.BROWSER_CHANNEL || "msedge";
    browser = await chromium.launch(launchOptions);
    const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
    await context.addInitScript(() => {
      if (/^https?:\/\/127\.0\.0\.1:/.test(location.origin)) {
        localStorage.setItem("w2g-calculator-draft:mastermix", JSON.stringify({ "mm-total-vol": "12", "mm-replicates": "5" }));
        localStorage.setItem("w2g-calculator-draft:qpcrdata", JSON.stringify({ "qpa-target-gene": "LegacyGene" }));
      }
    });
    const page = await context.newPage();
    const runtimeErrors = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") runtimeErrors.push(message.text());
    });

    await page.goto(`${baseUrl}/#mastermix`, { waitUntil: "load" });
    assert.ok(await page.locator("#panel-qpcr").evaluate((element) => element.classList.contains("active")));
    assert.ok(await page.locator("#qpcr-mode-mastermix").isVisible());
    assert.equal(await page.locator("#mm-total-vol").inputValue(), "12");
    assert.equal(await page.locator("#mm-replicates").inputValue(), "5");
    assert.equal(await page.locator("#qpa-target-gene").inputValue(), "LegacyGene");
    const draftState = await page.evaluate(() => ({
      merged: JSON.parse(localStorage.getItem("w2g-calculator-draft:qpcr")),
      oldMastermix: localStorage.getItem("w2g-calculator-draft:mastermix"),
      oldAnalysis: localStorage.getItem("w2g-calculator-draft:qpcrdata"),
    }));
    assert.equal(draftState.merged["mm-total-vol"], "12");
    assert.equal(draftState.merged["qpa-target-gene"], "LegacyGene");
    assert.equal(draftState.oldMastermix, null);
    assert.equal(draftState.oldAnalysis, null);

    await page.locator('[data-qpcr-mode-target="rt"]').click();
    await page.locator("#qpcr-example").click();
    assert.ok((await page.locator("#rt-result").innerText()).length > 20);
    await page.locator('[data-qpcr-mode-target="mastermix"]').click();
    await page.locator("#mm-example").click();
    assert.match(await page.locator("#mm-result").innerText(), /Master Mix/);
    await page.locator('[data-qpcr-mode-target="qpcrdata"]').click();
    await page.locator("#qpa-example").click();
    assert.ok((await page.locator("#qpa-result").innerText()).length > 20);
    await page.locator('[data-qpcr-mode-target="qmulti"]').click();
    await page.locator("#qme-example").click();
    assert.ok((await page.locator("#qme-result").innerText()).length > 20);

    await page.locator('[data-workbench-tab="bca"]').first().click();
    assert.ok(await page.locator("#panel-bca").evaluate((element) => element.classList.contains("active")));
    assert.deepEqual(await page.locator(".suite-nav a").evaluateAll((links) => links.map((link) => link.getAttribute("href"))), [
      "https://weigenwu.github.io/ikun-calculator/",
      "https://weigenwu.github.io/wb/#studio",
      "https://if-group-pictures.onrender.com/",
    ]);
    assert.equal(await page.locator('a[target="_blank"]').count(), 0);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${baseUrl}/#qpcrdata`, { waitUntil: "load" });
    await page.waitForFunction(() => {
      const panel = document.querySelector("#panel-qpcr")?.getBoundingClientRect();
      return panel && panel.top >= 0 && panel.top < innerHeight;
    });
    assert.ok(await page.locator("#qpcr-mode-qpcrdata").isVisible());
    const mobile = await page.evaluate(() => ({
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
      modeNavWidth: document.querySelector(".qpcr-mode-nav").getBoundingClientRect().width,
    }));
    assert.ok(mobile.pageWidth <= mobile.viewportWidth + 1, "mobile page must not overflow horizontally");
    assert.ok(mobile.modeNavWidth <= mobile.viewportWidth, "qPCR mode navigation must stay inside the viewport");
    assert.deepEqual(runtimeErrors, []);
    console.log("Portal Edge E2E passed: qPCR migration, all four modes, workflow, deep links and mobile layout.");
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
