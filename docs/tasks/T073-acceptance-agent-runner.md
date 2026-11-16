# T073：验收驱动的修复 Agent

2026-11-16 / [Issue #158](https://github.com/wang1299/dsh-reforge/issues/158)。分支 codex/t073-acceptance-agent-runner，基于未合并 PR157 的 9c2e24f；增量 PR 目标为父分支，不暗中合并 PR155/157。

设计先于实现见 [ADR065](../decisions/065-acceptance-agent-runner.md)。本任务先完成严格计划/工具/上下文核心、受限文件与固定验收端口、官方 AgentLoop 零 provider HTTP 演练和失败控制。既有经验源验证/检索接入新的合成数据，旧数据库/预算/unknown不变。多候选语义排序和真实模型效果不在本轮冒充完成。

检查与结果将在实际运行后补充；当前尚无本增量测试/CI/审查通过结论。
