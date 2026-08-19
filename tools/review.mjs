import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// 这里审查扩展运行时代码；tools/ 中的命令行工具本身会有必要的日志输出。
const sourceRoots = ["src"];
const findings = [];

async function collectFiles(directory) {
  const entries = await fs.readdir(path.join(root, directory), { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(relativePath));
    } else if (/\.(js|mjs|html)$/.test(entry.name)) {
      files.push(relativePath);
    }
  }

  return files;
}

function addFinding(level, file, message) {
  findings.push({ level, file, message });
}

const manifest = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8"));
if (manifest.manifest_version !== 3) addFinding("error", "manifest.json", "必须使用 Manifest V3");
if ((manifest.permissions ?? []).includes("tabs")) {
  addFinding("warning", "manifest.json", "tabs 权限较宽，请确认是否能用 activeTab 替代");
}
if ((manifest.host_permissions ?? []).includes("<all_urls>")) {
  addFinding("warning", "manifest.json", "<all_urls> 会扩大访问范围，真实项目应收缩到必要域名");
}

for (const directory of sourceRoots) {
  for (const relativePath of await collectFiles(directory)) {
    const content = await fs.readFile(path.join(root, relativePath), "utf8");
    const checks = [
      [/\beval\s*\(/, "禁止使用 eval"],
      [/\bnew\s+Function\s*\(/, "禁止使用 new Function"],
      [/document\.write\s*\(/, "禁止使用 document.write"],
      [/console\.log\s*\(/, "提交前应清理 console.log"]
    ];

    for (const [pattern, message] of checks) {
      if (pattern.test(content)) addFinding("error", relativePath, message);
    }
  }
}

for (const finding of findings) {
  const marker = finding.level === "error" ? "✗" : "!";
  console.log(`${marker} [${finding.level}] ${finding.file}: ${finding.message}`);
}

const errorCount = findings.filter((finding) => finding.level === "error").length;
if (errorCount > 0) {
  console.error(`静态审查失败：${errorCount} 个错误`);
  process.exit(1);
}

console.log(`✓ 静态审查通过${findings.length ? `（${findings.length} 个提示）` : ""}`);
