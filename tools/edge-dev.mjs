import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
  throw new Error("edge:dev 当前只支持 Windows");
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = root;
const profilePath = path.join(root, ".edge-dev-profile");
const configuredPath = process.env.EDGE_PATH;
const candidates = [
  configuredPath,
  path.join(process.env.ProgramFiles ?? "", "Microsoft", "Edge", "Application", "msedge.exe"),
  path.join(process.env["ProgramFiles(x86)"] ?? "", "Microsoft", "Edge", "Application", "msedge.exe"),
  path.join(process.env.LocalAppData ?? "", "Microsoft", "Edge", "Application", "msedge.exe")
].filter(Boolean);

const edgePath = await findFirst(candidates);
if (!edgePath) {
  throw new Error("找不到 msedge.exe，可通过 EDGE_PATH 环境变量指定路径");
}

await fs.mkdir(profilePath, { recursive: true });
const args = [
  `--user-data-dir=${profilePath}`,
  `--disable-extensions-except=${extensionPath}`,
  `--load-extension=${extensionPath}`,
  "--no-first-run",
  "--no-default-browser-check"
];

const edge = spawn(edgePath, args, {
  detached: true,
  stdio: "ignore",
  windowsHide: false
});
edge.unref();

console.log(`✓ 已从 Shell 启动 Edge 开发实例: ${edgePath}`);
console.log(`  独立用户目录: ${path.relative(root, profilePath)}`);
console.log("  扩展加载目录: 当前模板目录");
console.log("  关闭该实例即可结束本次开发会话；不会影响日常 Edge 配置。");

async function findFirst(paths) {
  for (const candidate of paths) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Continue through the known Edge installation locations.
    }
  }
  return undefined;
}
