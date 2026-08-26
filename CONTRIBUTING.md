# 贡献指南

感谢你关注 Web 开发者工具。欢迎通过 Issue、文档改进和 Pull Request 参与项目。

## 开始开发

项目要求 Node.js 18 或更高版本：

```bash
npm install
npm run check
```

需要验证浏览器交互时，再运行 `npx playwright install chromium` 和 `npm run e2e`。请不要把 `.edge-dev-profile/`、`node_modules/`、`dist/`、浏览器导出的密钥或真实网页敏感数据提交到仓库。

## 提交变更

- 一个 Pull Request 尽量只解决一个问题，并说明行为变化和测试方式。
- 新增权限、外部请求或数据收集行为时，请同步更新 README 和隐私说明。
- 提交前运行 `npm run check`；涉及真实浏览器交互时补充 E2E 验证结果。
- 保持现有代码风格，不提交生成物或与问题无关的格式化变更。

## 报告问题

请提供 Edge 版本、扩展版本、复现步骤和预期/实际结果。安全漏洞请遵循 [安全策略](SECURITY.md)，不要直接发布到公开 Issue。
