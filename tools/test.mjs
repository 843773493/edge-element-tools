import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testDirectory = path.join(root, "tests");
const testFiles = (await fs.readdir(testDirectory))
  .filter((file) => file.endsWith(".test.mjs"))
  .map((file) => path.join("tests", file));

const testProcess = spawn(process.execPath, ["--test", ...testFiles], {
  cwd: root,
  stdio: "inherit",
  shell: false
});

testProcess.on("exit", (code, signal) => {
  if (signal) {
    console.error(`测试进程被信号终止: ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
