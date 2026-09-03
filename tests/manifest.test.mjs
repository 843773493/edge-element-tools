import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Manifest 指向的入口文件存在", async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8"));
  const referencedFiles = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    "src/screenshot/index.html",
    "src/screenshot/editor.js",
    "src/screenshot/editor.css",
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action.default_icon ?? {}),
    ...manifest.content_scripts.flatMap((entry) => [...entry.js, ...(entry.css ?? [])])
  ];

  for (const relativePath of referencedFiles) {
    await assert.doesNotReject(fs.access(path.join(root, relativePath)));
  }

  assert.ok(manifest.permissions.includes("downloads"), "截图功能需要 downloads 权限");
  assert.equal(manifest.commands?.["capture-and-edit-screenshot"]?.suggested_key?.default, "Ctrl+Shift+E");
});
