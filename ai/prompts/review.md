# Edge 扩展 AI 审查提示词

请审查这个 Microsoft Edge Manifest V3 扩展，重点关注：

1. 权限是否最小化，`host_permissions` 是否可以收缩。
2. Service worker、content script、popup 的消息和存储边界是否清晰。
3. 是否存在 XSS、动态代码执行、远程代码、敏感数据泄漏或未清理的调试输出。
4. 设置异常、页面不存在、扩展上下文失效时是否能安全退化。
5. 是否有可重复运行的 Node 测试和手工测试步骤。

先给出按 P0/P1/P2 分级的问题，再给出最小修复建议。完成后运行：

```bash
npm run validate
npm run review
npm test
```

不要直接修改文件；如需修改，请另行输出符合 `ai/prompts/modify.md` 的 JSON 变更计划。
