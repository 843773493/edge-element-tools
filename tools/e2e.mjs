import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("缺少 Playwright。请先运行 npm install，再运行 npx playwright install chromium。");
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(root, "tests", "fixtures", "interaction.html");
const fixtureHtml = await fs.readFile(fixturePath, "utf8");
const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "edge-template-e2e-"));

const server = http.createServer((request, response) => {
  if (request.url === "/fixture.html" || request.url === "/") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(fixtureHtml);
    return;
  }
  response.writeHead(404);
  response.end("Not found");
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const fixtureOrigin = `http://127.0.0.1:${address.port}`;
const fixtureUrl = `${fixtureOrigin}/fixture.html`;
let context;

try {
  context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
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
  await page.goto(fixtureUrl);

  const popup = await openPopup(context, extensionId, fixtureUrl);
  await assertPopupState(popup, "就绪");
  await popup.locator("#pick").click();
  await popup.close().catch(() => {});

  await page.locator("#fixture-button").hover();
  await page.locator("#fixture-button").click();
  const firstClipboard = JSON.parse(await readClipboard(page, "fixture-button"));
  assert.equal(firstClipboard.tagName, "button");
  assert.equal(firstClipboard.selector, "#fixture-button");

  const appendPopup = await openPopup(context, extensionId, fixtureUrl);
  await appendPopup.locator("#pick-append").click();
  await appendPopup.close().catch(() => {});
  await page.locator("#fixture-heading").hover();
  await page.locator("#fixture-heading").click();
  const accumulatedClipboard = JSON.parse(await readClipboard(page, "fixture-heading"));
  assert.equal(accumulatedClipboard.length, 2);
  assert.equal(accumulatedClipboard[0].selector, "#fixture-button");
  assert.equal(accumulatedClipboard[1].selector, "#fixture-heading");

  const copyPopup = await openPopup(context, extensionId, fixtureUrl);
  await copyPopup.locator("#copy-log").click();
  await copyPopup.close().catch(() => {});
  const logs = JSON.parse(await readClipboard(page, "element_selected"));
  assert.equal(logs.length, 2);
  assert.equal(logs[0].type, "element_selected");
  assert.equal(logs[1].mode, "append");

  const countPopup = await openPopup(context, extensionId, fixtureUrl);
  assert.equal(await countPopup.locator("#log-count").textContent(), "2 条");
  await countPopup.close();

  console.log("✓ Edge 扩展隔离 E2E 通过：Popup、选择元素、选择元素+、剪贴板和复制日志均已验证");
} finally {
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(userDataDir, { recursive: true, force: true });
}

async function assertPopupState(popup, expectedStatus) {
  await popup.locator("#status").waitFor();
  assert.equal(await popup.locator("#status").textContent(), expectedStatus);
}

async function openPopup(context, extensionId, targetUrl) {
  const popup = await context.newPage();
  const query = targetUrl ? `?target=${encodeURIComponent(targetUrl)}` : "";
  await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html${query}`);
  await popup.locator("#status").waitFor();
  return popup;
}

async function readClipboard(page, marker) {
  const deadline = Date.now() + 3000;
  let text = "";
  while (Date.now() < deadline) {
    text = await page.evaluate(() => navigator.clipboard.readText());
    if (text.includes(marker)) {
      return text;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`剪贴板在 3 秒内没有出现预期内容: ${marker}，实际内容长度为 ${text.length}`);
}
