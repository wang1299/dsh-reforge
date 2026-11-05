# DSH-Reforge 中英文介绍

适用版本：`dsh-reforge@0.1.0-alpha.2`，2026-11-04。公开发行核验见[版本状态](release-status.md)与[发行记录#113](https://github.com/wang1299/dsh-reforge/issues/113)。以下文案可用于仓库介绍和后续社区投稿；建立文案不表示已经投稿或更改网页简介。详细行为以[安装指南](installation.md)、[产品需求](product.md)和实际验收为准。

## GitHub About

简介（中英文共用）：

> DSH-Reforge (dsh-reforge) — DeepSeek Harness plugin for traceable experience from test-verified Python bug fixes. 从有测试依据的 Python 修复中积累可追溯经验。Experimental alpha · DSH 0.2.0-rc.2 / 0.2.1-rc.5.

网站入口：[官网](https://wang1299.github.io/dsh-reforge/)与[中英文文档导航](https://wang1299.github.io/dsh-reforge/docs/)。实际公开部署和可访问性以[官网发布回执#116](https://github.com/wang1299/dsh-reforge/issues/116)为准。

主题标签：`dsh-reforge`、`deepseek`、`deepseek-harness`、`dsh-plugin`、`experience-learning`、`agent-memory`、`bug-fix`、`python`、`pytest`、`verification`、`typescript`。

## 中文短介绍

DSH-Reforge（npm：`dsh-reforge`）是 DeepSeek Harness 的社区插件，从有测试依据的 Python Bug 修复中积累可追溯经验，记录适用条件、来源和使用历史，并在后续相似任务中选择适用经验作为参考。alpha.2精确支持 DSH 0.2.0-rc.2 / 0.2.1-rc.5，提供可运行案例、工作台与保守配置/诊断；学习默认关闭。

## 中文完整介绍

DSH-Reforge 面向使用 DeepSeek Harness 修复 Python 仓库的开发者。用户上次的纠正可能只留在旧会话里；插件将有限的请求摘要、明确纠正和受限代码快照与修复测试关联，形成可以查看来源、限制适用范围并停用的经验。

仓库所有者显式配置执行信任、模型共享、独立验收和提炼次数后，正常直接请求会形成执行片段。插件在临时工作区重放原始失败、修复验收及回归测试；材料与授权齐备后，使用 DSH 已注册的指定模型提炼候选，再独立复核来源。后续请求按仓库、代码、依赖条件与相关度选择少量经验。使用者可在 DSH 插件页查看学习进度、来源和应用记录，提供反馈、修订或停用经验。

alpha.2聚焦单仓库 Python + pytest 修复，采用独立DSH适配层及双平台双宿主矩阵；公开安装以版本状态为准。学习默认关闭；开启后会执行受信任仓库代码，并向选定模型发送有限修复材料。本地工作区隔离不是强安全沙箱，提炼次数也不是整个 DSH 会话的金额上限。[本轮真实合成自动闭环](evaluation/t049-20261104/README.md)通过；对照题中两检索均拒选，未测到实际使用经验的效果。来源验证不代表未来收益。本项目由社区独立开发，不代表 DeepSeek 官方审核、推荐或安全认证。

## English short introduction

DSH-Reforge (`dsh-reforge` on npm) is a community plugin for DeepSeek Harness. It builds traceable experience from test-verified Python bug fixes, records applicability conditions, sources, and usage history, and selects relevant experience as context for later tasks. Experimental alpha.2 supports exactly DSH 0.2.0-rc.2 and 0.2.1-rc.5, with a runnable example, workbench and conservative setup/diagnostics. Learning is off by default.

## English full introduction

DSH-Reforge is for developers using DeepSeek Harness to repair Python repositories. Corrections from an earlier task may remain buried in an old conversation. The plugin links bounded request summaries, explicit corrections, and limited code snapshots to repair tests, producing experience whose source and applicability can be inspected and whose use can be disabled.

After the repository owner explicitly configures execution trust, model sharing, independent acceptance tests, and an extraction allowance, normal direct requests create execution segments. The plugin replays the original failure, acceptance tests for the fix, and regression tests in temporary workspaces. With the required evidence and authorization, it uses a specified model registered with DSH to extract a candidate, then independently checks its source evidence. Later requests receive a small amount of applicable experience based on repository, code, dependencies, and relevance. The DSH plugin page supports progress and source inspection, usage records, feedback, revisions, and deactivation.

Alpha.2 focuses on Python + pytest repairs within one repository, with an independent DSH adapter and a two-host Windows/Linux matrix; check actual publication status before installing. Learning is off by default. Enabling it allows trusted repository code to execute and bounded repair material to be sent to the selected model. Workspace isolation is not a strong security sandbox, and the extraction allowance is not a monetary cap for the full DSH session. The [bounded real-model automatic loop](evaluation/t049-20261104/README.md) passed, but both retrieval arms abstained in the held-out pilot: no effect of using memory was measured. Source verification does not establish future-task benefit. This independent community project is not officially reviewed, endorsed, or security certified by DeepSeek.

## 安装 / Install

需要 / Requires: Node.js ≥24.10、DSH 0.2.0-rc.2 / 0.2.1-rc.5。来源修复验证另需 / Repair verification additionally requires: Git、Python ≥3.10、pytest（CI: 9.1.1）。

```sh
dsh plugin --profile web add dsh-reforge@0.1.0-alpha.2
```

使用同一 profile 重启 Web，从「插件 → dsh-reforge」打开；首次配置见[安装指南](installation.md)。Restart Web with the same profile, then open Plugins → dsh-reforge. See the [English README](README.en.md) for initial setup.

## 公开链接 / Public links

- [GitHub](https://github.com/wang1299/dsh-reforge)
- [npm 0.1.0-alpha.2](https://www.npmjs.com/package/dsh-reforge/v/0.1.0-alpha.2)
- [GitHub Release](https://github.com/wang1299/dsh-reforge/releases/tag/v0.1.0-alpha.2)
- [实际发行核验 / Publication verification](release-status.md)
- [Issues](https://github.com/wang1299/dsh-reforge/issues)

## 文案维护边界

不要写成“DeepSeek 官方插件”“自动提升正确率”“无限学习”“零模型费用”“适用所有语言/DSH 版本”或“自动生成原生 Skill”。当前产品积累结构化修复经验，不发布原生 Skill 草稿。后续截图、动图或视频只使用重新生成的合成案例，并标注版本和演示范围；不得公开真实会话、凭据、认证地址、私人路径或经验库。
