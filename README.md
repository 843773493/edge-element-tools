# Web 开发者工具

这是一个基于 `edge-extension-template` 自动化模板开发的 Microsoft Edge Manifest V3 扩展。点击工具栏中的扩展图标会打开 Popup，提供三个操作：

- “选择元素”：在当前网页中选择一个元素，把清理后的 Outer HTML 复制到剪贴板。
- “选择元素+”：选择一个元素，把完整元素上下文复制到剪贴板。
- “复制控制台日志”：把当前网页捕获到的 Console 输出复制到剪贴板，最多保留 200 条。

选择过程中使用元素自身的 `outline` 高亮，不创建固定底部栏或额外的页面面板；按 `Esc` 可以取消选择。

## 开源与隐私

本项目以 [MIT License](LICENSE) 发布。贡献代码请先阅读 [贡献指南](CONTRIBUTING.md)；安全问题请遵循 [安全策略](SECURITY.md)；数据处理说明见 [隐私说明](docs/PRIVACY.md)。

## 目录结构

```text
web-developer-tools/
├─ manifest.json                 # Edge 扩展入口配置
├─ src/
│  ├─ assets/icons/              # Web 开发者工具图标资源
│  ├─ background/service-worker.js
│  ├─ content/console-capture.js # 网页 Console 捕获
│  ├─ content/content.js         # 元素选择、高亮和剪贴板逻辑
│  ├─ content/content.css        # 选择状态下的鼠标样式
│  └─ popup/                     # 点击扩展图标后的 Popup
├─ tests/                        # Node 原生测试
├─ tools/
│  ├─ e2e.mjs                    # 隔离浏览器 E2E 入口
│  ├─ check-manifest.mjs         # Manifest 与路径检查
│  ├─ review.mjs                 # 静态安全/质量审查
│  ├─ test.mjs                   # 测试入口
│  └─ package.mjs                # 生成可分发 zip
├─ .agent/
│  ├─ skills/                    # OpenSpec skills（Antigravity）
│  └─ workflows/                 # /opsx-* 工作流入口
├─ openspec/
│  ├─ config.yaml                # 项目上下文和工作流规则
│  ├─ specs/                     # 已实现能力的规范
│  └─ changes/                   # 进行中的变更及归档记录
└─ .github/workflows/ci.yml     # CI 自动校验
```

## 快速开始

要求 Node.js 18+。Manifest 校验、静态审查和单元测试无第三方依赖；后台浏览器 E2E 需要 Playwright：

```bash
npm run check
npm install
npx playwright install chromium
npm run e2e
npm run edge:dev
npm run package
```

在 Edge 中打开 `edge://extensions`，开启“开发人员模式”，点击“加载解压缩的扩展”，选择本目录即可。修改源码后，在扩展管理页点击“重新加载”。

`npm run e2e` 不会操作你日常使用的 Edge，也不会改动现有浏览器配置。它会启动 Playwright 自带的隔离 Chromium 临时用户目录，后台加载本扩展，打开测试页和 Popup，完成选择元素、选择元素+、剪贴板和复制控制台日志交互后自动关闭并清理临时数据。需要看到浏览器窗口时，可使用 `EDGE_E2E_HEADFUL=1 npm run e2e`。

性能调试可运行 `EDGE_PERF_SAMPLES=3 npm run e2e:performance`。该命令会在压力页面上分别执行当前基线和调试埋点版本，输出元素命中、Outer HTML、CSS 扫描、格式化和剪贴板阶段耗时，并生成 `dist/element-tools-performance-report.json`。调试埋点只有 URL 带有 `edge_element_tools_debug=1` 时启用。

如果你希望直接用本机安装的 Edge 做人工交互，可运行 `npm run edge:dev`。它只通过 Shell 启动一个使用 `.edge-dev-profile` 的独立开发实例，并把扩展加载进去，不会操作或污染日常 Edge 用户配置。`--load-extension` 是开发会话加载，不等同于向日常配置做静默永久安装。

由于新版 Microsoft Edge 已移除用于命令行侧载扩展的相关开关，Playwright 官方扩展测试方案使用其自带 Chromium，而不是静默注入你当前的 Edge 用户配置。这样可以稳定实现后台安装和测试，同时保持日常 Edge 不受影响。

## OpenSpec 工作流

本项目已内置 OpenSpec 的 Antigravity 集成。首次使用前安装 OpenSpec CLI：

```bash
npm install -g @fission-ai/openspec@latest
openspec --version
```

项目规范和变更记录保存在 `openspec/`；`.agent/` 保存 Antigravity 可识别的 skills 和 `/opsx-*` 工作流。一个典型变更按以下顺序进行：

```text
/opsx-explore <先澄清目标和方案>
/opsx-propose <创建可审查的 proposal/specs/design/tasks>
/opsx-apply <change-name>
/opsx-sync <change-name>
/opsx-archive <change-name>
```

`/opsx-explore` 和 `/opsx-propose` 只产生可审查的计划；确认后再用 `/opsx-apply` 修改代码。完成实现和验证后，用 `/opsx-sync` 更新主规范，再用 `/opsx-archive` 归档变更。具体命令也可以通过 `openspec --help` 查看。

每次变更仍应运行：

```bash
npm run check
```

审查工具会检查 Manifest 关键字段、危险 API、明显的调试代码和敏感权限。`<all_urls>` 在普通示例中是有意使用的，实际项目应尽量改成最小权限范围。

## 手工测试清单

- 安装扩展后打开普通网页，点击扩展图标确认 Popup 显示三个操作。
- 点击“选择元素”，在页面上移动并点击目标元素，检查剪贴板中是清理后的 Outer HTML。
- 选择完成后确认拾取状态仍保持，再点击另一个元素，确认当前模式继续生效。
- 再次点击“选择元素+”，选择一个元素，检查剪贴板中包含完整元素上下文、Outer HTML 和 CSS。
- 在 rich 模式下再次点击另一个元素，确认仍保持选择状态并复制新的完整上下文。
- 让测试页输出几条 Console 消息，点击“复制控制台日志”，检查剪贴板包含网页 Console 内容且不包含元素选择事件。
- 按 `Esc` 取消选择，确认网页不会留下固定底部栏或额外的选择面板。
- 打开 `edge://extensions` 的 Service worker 检查报错。
- 执行 `npm run check`，确认验证、审查和测试全部通过。
- 执行 `npm run e2e`，确认隔离浏览器中的真实交互路径通过。

## 扩展为真实项目时建议

- 将 `host_permissions` 和 `content_scripts.matches` 收缩到业务域名。
- 为 `src/` 增加 TypeScript、打包器和源映射（如项目确实需要）。
- 为关键交互增加 Edge 自动化测试；模板中的测试保持零依赖，只验证可移植的纯函数。
- 发布前审查权限、远程代码、隐私声明和商店包内容。
