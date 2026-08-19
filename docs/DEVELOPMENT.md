# 开发说明

## 代码边界

- `src/background` 只处理扩展生命周期、右键菜单和跨页面的后台逻辑。
- `src/content` 只负责页面 DOM 交互，避免读取不必要的页面数据。
- `src/popup` 只负责设置编辑和展示。
- `src/shared` 放可脱离浏览器环境测试的纯函数。

## 调试顺序

1. 修改 `manifest.json` 后执行 `npm run validate`。
2. 修改源码后执行 `npm run review` 和 `npm test`。
3. 在 `edge://extensions` 重新加载扩展。
4. 分别检查 popup、普通网页和 Service worker 控制台。

## 添加新权限的审查记录

每次添加权限时，在 PR 或变更说明中回答：

- 该权限解决什么用户场景？
- 是否能使用更小范围的权限替代？
- 权限对应的数据在哪里读取、保存和删除？
- 是否需要更新隐私声明？
