# 开发流程

[文档导航](docs/index.md) · [新人任务](docs/community/newcomers.md) · [真实外部试用](docs/community/pilot.md) · [安全报告](SECURITY.md)。问题与功能建议请用 [Issue 表单](https://github.com/wang1299/dsh-reforge/issues/new/choose)，只提供脱敏最小复现。零模型费用的完整入口是 [customer-form](examples/customer-form/README.md)；`npm run demo` 是另一个事务回滚案例。

1. 在 `docs/tasks/` 记录问题、范围、验收、依赖和必要验证。有远端后同步为 Issue。
2. 从对应依赖分支创建 `codex/` 任务分支，记录比较基线。
3. 行为变化先保留失败测试／复现，然后做最小完整实现。
4. 运行相关检查，同步文档和实际证据，自审。
5. 推送分支并创建 Draft PR；无远端时保存 `docs/development/` 下的 PR 提案，明确远端未创建。
6. 独立 Agent 只读评审稳定 SHA，记录基线、范围、成立证据和影响。不能代替分支保护要求的正式 Review。
7. 修复 P0/P1，以及可复现并影响当前验收、数据、安全或主要流程的 P2，必要时复审。
8. 验收、CI、无阻塞评审问题、文档和保护规则都满足后，转 Ready 并 squash merge。缺少任何一项均不能宣称合并。

不按 PR 数量衡量进度。普通实现细节自行判断；公开接口、持久化、重大架构先写短 ADR。

不提交真实会话、凭据、数据目录、测试运行日志或临时源码 checkout。公开示例仅用人工合成数据。
