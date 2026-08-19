import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8"));
const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
const packageName = String(packageJson.name || manifest.name || "edge-extension")
  .trim()
  .replace(/[^a-zA-Z0-9._-]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .toLowerCase();
const configuredOutput = process.env.EDGE_PACKAGE_OUTPUT;
const output = configuredOutput
  ? path.resolve(root, configuredOutput)
  : path.join(root, "dist", `${packageName}.zip`);
await fs.mkdir(path.dirname(output), { recursive: true });

const sourcePaths = ["manifest.json", "src"];
const command = process.platform === "win32" ? "powershell.exe" : "zip";
const commandArgs = process.platform === "win32"
  ? ["-NoProfile", "-NonInteractive", "-Command", `Compress-Archive -Force -Path ${sourcePaths.join(",")} -DestinationPath '${output}'`]
  : ["-r", output, ...sourcePaths];

const pack = spawn(command, commandArgs, { cwd: root, stdio: "inherit", shell: false });
pack.on("exit", (code) => {
  if (code !== 0) process.exit(code ?? 1);
  console.log(`✓ 扩展包已生成: ${path.relative(root, output)}`);
});
