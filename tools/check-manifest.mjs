import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "manifest.json");

function fail(message) {
  console.error(`✗ ${message}`);
  process.exitCode = 1;
}

function checkFile(relativePath) {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes("..")) {
    fail(`入口路径不安全: ${relativePath}`);
    return;
  }

  return fs.access(path.join(root, relativePath)).catch(() => {
    fail(`Manifest 引用的文件不存在: ${relativePath}`);
  });
}

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));

if (manifest.manifest_version !== 3) fail("必须使用 Manifest V3");
if (!manifest.name) fail("缺少 name");
if (!/^\d+\.\d+\.\d+$/.test(manifest.version ?? "")) fail("version 必须是 x.y.z 格式");
if (!manifest.action?.default_popup) fail("缺少 action.default_popup");
if (!manifest.background?.service_worker) fail("缺少 background.service_worker");
if (!manifest.permissions?.includes("storage")) fail("示例需要 storage 权限");

const files = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  ...(manifest.content_scripts ?? []).flatMap((entry) => [
    ...(entry.js ?? []),
    ...(entry.css ?? [])
  ])
];

await Promise.all(files.map(checkFile));

if (process.exitCode) {
  process.exit(1);
}

console.log(`✓ Manifest 校验通过（${files.length} 个入口文件）`);
