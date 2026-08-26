import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("缺少 Playwright。请先运行 npm install，再运行 npx playwright install chromium。");
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(root, "tests", "fixtures", "performance.html");
const fixtureHtml = await fs.readFile(fixturePath, "utf8");
const sampleCount = Math.max(1, Number.parseInt(process.env.EDGE_PERF_SAMPLES ?? "3", 10) || 3);
const reportPath = path.join(root, "dist", "element-tools-performance-report.json");

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
  if (pathname === "/performance.html" || pathname === "/") {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(fixtureHtml);
    return;
  }
  response.writeHead(404);
  response.end("Not found");
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const fixtureOrigin = `http://127.0.0.1:${address.port}`;
const results = [];

try {
  for (const mode of ["baseline", "debug"]) {
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "edge-element-tools-perf-"));
    let context;
    try {
      context = await chromium.launchPersistentContext(userDataDir, {
        channel: process.env.EDGE_E2E_CHANNEL ?? "chromium",
        headless: process.env.EDGE_E2E_HEADFUL !== "1",
        args: [
          `--disable-extensions-except=${root}`,
          `--load-extension=${root}`
        ]
      });
      await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: fixtureOrigin });

      let serviceWorker = context.serviceWorkers()[0];
      if (!serviceWorker) {
        serviceWorker = await context.waitForEvent("serviceworker");
      }
      const extensionId = serviceWorker.url().split("/")[2];
      assert.match(extensionId, /^[a-z]{32}$/, "扩展 Service worker 未正确加载");

      const page = await context.newPage();
      await page.addInitScript(() => {
        window.__edgeElementToolsPerformanceEntries = [];
        window.addEventListener("message", (event) => {
          if (event.source !== window || event.data?.source !== "edge-element-tools-performance") {
            return;
          }
          if (event.data.type === "PERFORMANCE_ENTRY") {
            window.__edgeElementToolsPerformanceEntries.push(event.data.entry);
          }
        });
      });

      for (let sample = 1; sample <= sampleCount; sample += 1) {
        const debugQuery = mode === "debug" ? "&edge_element_tools_debug=1" : "";
        const fixtureUrl = `${fixtureOrigin}/performance.html?sample=${sample}${debugQuery}`;
        await page.goto(fixtureUrl);
        await page.waitForFunction(() => document.documentElement.dataset.performanceFixtureReady === "1");

        const popup = await openPopup(context, extensionId, fixtureUrl);
        await popup.locator("#pick-rich").click();
        await popup.close().catch(() => {});

        const target = page.locator("#perf-target");
        await target.hover();
        const startedAt = performance.now();
        await target.click();
        await page.locator(".edge-element-tools-copy-toast").filter({ hasText: "已复制完整元素上下文" }).waitFor({
          timeout: 30000
        });
        const endedAt = performance.now();
        const clipboard = await page.evaluate(() => navigator.clipboard.readText());
        assert.match(clipboard, /Performance target/, `${mode} 第 ${sample} 次没有复制目标元素`);

        const entries = mode === "debug"
          ? await page.evaluate(() => window.__edgeElementToolsPerformanceEntries)
          : [];
        const internal = entries.filter((entry) => entry.type === "selection-complete").at(-1) || null;
        results.push({
          mode,
          sample,
          externalTotalMs: endedAt - startedAt,
          internal
        });
      }
    } finally {
      await context?.close();
      await fs.rm(userDataDir, { recursive: true, force: true });
    }
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}

const baseline = results.filter((result) => result.mode === "baseline");
const debug = results.filter((result) => result.mode === "debug");
const median = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
};
const report = {
  generatedAt: new Date().toISOString(),
  fixture: {
    styleSheetCount: 21,
    rulesPerGeneratedStyleSheet: 300,
    ancestorDepth: 14
  },
  samples: results,
  summary: {
    baselineMedianMs: median(baseline.map((result) => result.externalTotalMs)),
    debugMedianMs: median(debug.map((result) => result.externalTotalMs)),
    debugInstrumentationOverheadMs: median(debug.map((result) => result.externalTotalMs))
      - median(baseline.map((result) => result.externalTotalMs))
  }
};
await fs.mkdir(path.dirname(reportPath), { recursive: true });
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(JSON.stringify(report, null, 2));
console.log(`✓ 性能报告已生成: ${path.relative(root, reportPath)}`);

async function openPopup(context, extensionId, targetUrl) {
  const popup = await context.newPage();
  const query = `?target=${encodeURIComponent(targetUrl)}`;
  await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html${query}`);
  await popup.locator("#status").waitFor();
  return popup;
}
