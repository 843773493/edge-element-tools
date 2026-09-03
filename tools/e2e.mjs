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
const downloadsDir = await fs.mkdtemp(path.join(os.tmpdir(), "edge-template-downloads-"));

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
    channel: process.env.EDGE_E2E_CHANNEL ?? "chromium",
    headless: process.env.EDGE_E2E_HEADFUL !== "1",
    downloadsPath: downloadsDir,
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
  await page.waitForTimeout(500);
  await page.evaluate(async () => {
    console.log("fixture console log");
    await new Promise((resolve) => setTimeout(resolve, 80));
    console.warn("fixture console warning");
    await new Promise((resolve) => setTimeout(resolve, 80));
    console.error("fixture console error");
  });
  await page.waitForTimeout(500);

  const popup = await openPopup(context, extensionId, fixtureUrl);
  await assertPopupState(popup, "就绪");
  await popup.locator("#capture-screenshot").waitFor();
  await popup.waitForFunction(() => Number.parseInt(document.querySelector("#log-count")?.textContent, 10) >= 3);
  await popup.locator("#pick").click();
  await popup.close().catch(() => {});

  await page.locator("#fixture-button").hover();
  await page.locator("#fixture-button").click();
  const firstClipboard = await readClipboard(page, "Sample page action");
  assert.equal(firstClipboard, '<button id="fixture-button" type="button">Sample page action</button>');
  assert.doesNotMatch(firstClipboard, /Attached Element Context|data-boxteam-ref|```/);
  assert.equal(await page.locator(".edge-element-tools-copy-toast").textContent(), "已复制元素 HTML");

  await page.locator("#fixture-heading").hover();
  await page.locator("#fixture-heading").click();
  const secondBasicClipboard = await readClipboard(page, "Extension interaction fixture");
  assert.equal(secondBasicClipboard, '<h1 id="fixture-heading">Extension interaction fixture</h1>');

  const richPopup = await openPopup(context, extensionId, fixtureUrl);
  await richPopup.locator("#pick-rich").click();
  await richPopup.close().catch(() => {});
  await page.locator("#fixture-button").hover();
  await page.locator("#fixture-button").click();
  const richClipboard = await readClipboard(page, "Attached Element Context from Integrated Browser");
  assert.equal(await page.locator(".edge-element-tools-copy-toast").textContent(), "已复制完整元素上下文");
  assert.match(richClipboard, /Element: button#fixture-button/);
  assert.match(richClipboard, /HTML Path: html > body > main > button#fixture-button/);
  assert.match(richClipboard, /<button id="fixture-button"[^>]*>Sample page action<\/button>/);
  assert.match(richClipboard, /Outer HTML:\r?\n```html/);
  assert.match(richClipboard, /CSS:\r?\n```css/);
  assert.match(richClipboard, /Dimensions:\r?\n- top: \d+px\r?\n- left: \d+px\r?\n- width: \d+px\r?\n- height: \d+px/);
  assert.doesNotMatch(richClipboard, /data-boxteam-ref/);

  await page.locator("#fixture-heading").hover();
  await page.locator("#fixture-heading").click();
  const secondRichClipboard = await readClipboard(page, "Element: h1#fixture-heading");
  assert.match(secondRichClipboard, /HTML Path: html > body > main > h1#fixture-heading/);
  assert.match(secondRichClipboard, /<h1 id="fixture-heading">Extension interaction fixture<\/h1>/);

  const copyPopup = await openPopup(context, extensionId, fixtureUrl);
  await copyPopup.waitForFunction(() => Number.parseInt(document.querySelector("#log-count")?.textContent, 10) >= 3);
  await copyPopup.locator("#copy-log").click();
  const logs = await readClipboard(page, "fixture console log");
  await copyPopup.close().catch(() => {});
  assert.match(logs, /log: fixture console log/);
  assert.match(logs, /warning: fixture console warning/);
  assert.match(logs, /error: fixture console error/);
  assert.doesNotMatch(logs, /element_selected|选择元素/);

  await page.locator("#fixture-hover").hover();
  const hoverIconBox = await page.locator("#hover-icon").boundingBox();
  assert.ok(hoverIconBox, "悬停图标没有显示");
  const screenshotPopup = await openPopup(context, extensionId, fixtureUrl);
  await screenshotPopup.locator("#capture-screenshot").click();
  await screenshotPopup.close();
  const editor = page.locator("#edge-element-tools-screenshot-editor");
  await editor.waitFor();
  const status = editor.locator("#status");
  await status.waitFor();
  await page.waitForFunction(() => document.querySelector("#edge-element-tools-screenshot-editor")?.shadowRoot?.querySelector("#status")?.textContent.includes("截图已加载"));
  const canvas = editor.locator("#screenshot-canvas");
  const originalCanvasSize = await canvas.evaluate((canvas) => ({
    width: canvas.width,
    height: canvas.height
  }));
  assert.ok(originalCanvasSize.width > 0 && originalCanvasSize.height > 0, "截图画布没有图像");
  const hoverPixel = await canvas.evaluate((canvas, { x, y }) => {
    const context = canvas.getContext("2d");
    return Array.from(context.getImageData(Math.round(x), Math.round(y), 1, 1).data);
  }, {
    x: hoverIconBox.x + hoverIconBox.width / 2,
    y: hoverIconBox.y + hoverIconBox.height / 2
  });
  assert.ok(hoverPixel[0] > 150 && hoverPixel[1] < 100, `截图没有保留悬停图标像素：${hoverPixel}`);
  const canvasBox = await canvas.boundingBox();
  assert.ok(canvasBox, "截图画布不可交互");
  const selectionProbeBefore = await canvas.evaluate((canvas) => {
    const context = canvas.getContext("2d");
    return Array.from(context.getImageData(100, 100, 1, 1).data);
  });
  await page.mouse.move(canvasBox.x + 20, canvasBox.y + 20);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + Math.min(220, canvasBox.width - 20), canvasBox.y + Math.min(160, canvasBox.height - 20));
  await page.mouse.up();
  const selectionProbeAfter = await canvas.evaluate((canvas) => {
    const context = canvas.getContext("2d");
    return Array.from(context.getImageData(100, 100, 1, 1).data);
  });
  assert.deepEqual(selectionProbeAfter, selectionProbeBefore, `截图选区没有保留原图像素：${selectionProbeBefore} -> ${selectionProbeAfter}`);
  await editor.locator("#apply-crop").click();
  await page.waitForFunction(() => document.querySelector("#edge-element-tools-screenshot-editor")?.shadowRoot?.querySelector("#status")?.textContent.includes("已裁剪"));
  const croppedCanvasSize = await canvas.evaluate((canvas) => ({
    width: canvas.width,
    height: canvas.height
  }));
  assert.ok(croppedCanvasSize.width < originalCanvasSize.width, "裁剪没有改变截图宽度");
  await editor.locator("#download").click();
  await page.waitForFunction(() => document.querySelector("#edge-element-tools-screenshot-editor")?.shadowRoot?.querySelector("#status")?.textContent.includes("已保存到下载目录"));
  const downloadId = Number(await status.getAttribute("data-download-id"));
  assert.ok(Number.isInteger(downloadId) && downloadId > 0, "截图没有返回下载 ID");
  const download = await waitForDownload(serviceWorker, downloadId);
  await editor.locator("#close").click();
  await page.waitForFunction(() => !document.querySelector("#edge-element-tools-screenshot-editor"));
  const screenshotPath = download.filename;
  const screenshotBytes = await fs.readFile(screenshotPath);
  assert.equal(screenshotBytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.ok(screenshotBytes.length > 100, "截图 PNG 不应为空");

  const countPopup = await openPopup(context, extensionId, fixtureUrl);
  assert.ok(Number.parseInt(await countPopup.locator("#log-count").textContent(), 10) >= 3);
  await countPopup.close();

  console.log("✓ Edge 扩展隔离 E2E 通过：Outer HTML、完整上下文、截图 PNG、剪贴板和网页控制台日志均已验证");
} finally {
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(userDataDir, { recursive: true, force: true });
  await fs.rm(downloadsDir, { recursive: true, force: true });
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

async function waitForDownload(worker, downloadId) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const downloads = await worker.evaluate((id) => new Promise((resolve) => {
      chrome.downloads.search({ id }, resolve);
    }), downloadId);
    const download = downloads?.[0];
    if (download?.state === "complete" && download.filename) {
      return download;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("截图在 5 秒内没有完成下载");
}
