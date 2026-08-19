import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const planArgumentIndex = args.indexOf("--plan");
const positionalPlan = args.find((argument) => !argument.startsWith("-"));
const planPath = planArgumentIndex >= 0 ? args[planArgumentIndex + 1] : positionalPlan;
const shouldApply = args.includes("--apply");
const shouldOverwrite = args.includes("--overwrite");

if (!planPath) {
  console.error("用法: node tools/ai-modify.mjs --plan ai/changes/your-change.json [--apply] [--overwrite]");
  process.exit(1);
}

function resolveSafe(relativePath) {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes("..")) {
    throw new Error(`不安全的项目内路径: ${relativePath}`);
  }
  const absolutePath = path.resolve(root, relativePath);
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
    throw new Error(`路径超出模板目录: ${relativePath}`);
  }
  return absolutePath;
}

function countMatches(content, search) {
  return search === "" ? 0 : content.split(search).length - 1;
}

const plan = JSON.parse(await fs.readFile(resolveSafe(planPath), "utf8"));
if (!Array.isArray(plan.operations) || plan.operations.length === 0) {
  throw new Error("变更计划必须包含非空 operations 数组");
}

const changes = [];
for (const [index, operation] of plan.operations.entries()) {
  const type = operation.type;
  const target = resolveSafe(operation.file);

  if (!["create", "replace", "append"].includes(type)) {
    throw new Error(`第 ${index + 1} 个操作类型不支持: ${type}`);
  }

  if (type === "create") {
    let exists = true;
    try {
      await fs.access(target);
    } catch {
      exists = false;
    }
    if (exists && !shouldOverwrite) {
      throw new Error(`文件已存在，若确认覆盖请加 --overwrite: ${operation.file}`);
    }
    changes.push({ target, type, content: String(operation.content ?? ""), file: operation.file });
    continue;
  }

  const original = await fs.readFile(target, "utf8");
  if (type === "append") {
    changes.push({ target, type, content: `${original}${String(operation.content ?? "")}`, file: operation.file });
    continue;
  }

  const search = String(operation.search ?? "");
  const replacement = String(operation.replace ?? "");
  const matches = countMatches(original, search);
  if (matches !== 1 && !operation.allowMultiple) {
    throw new Error(`${operation.file} 的 search 命中 ${matches} 次，要求恰好 1 次`);
  }
  changes.push({
    target,
    type,
    content: operation.allowMultiple ? original.split(search).join(replacement) : original.replace(search, replacement),
    file: operation.file
  });
}

console.log(`变更计划: ${plan.description ?? "未命名"}`);
for (const change of changes) {
  console.log(`  ${shouldApply ? "应用" : "预览"} ${change.type}: ${change.file}`);
}

if (!shouldApply) {
  console.log("未写入文件。确认计划后追加 --apply 执行。");
  process.exit(0);
}

for (const change of changes) {
  await fs.mkdir(path.dirname(change.target), { recursive: true });
  await fs.writeFile(change.target, change.content, "utf8");
}

console.log(`✓ 已应用 ${changes.length} 个变更。建议立即运行 npm run check。`);
