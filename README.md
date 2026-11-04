# DSH-Reforge

<p align="center">
  <img src="https://raw.githubusercontent.com/wang1299/dsh-reforge/main/docs/assets/dsh-reforge-hero-v3.png" alt="DSH-Reforge — Fix. Verify. Reforge." width="1000" />
</p>

<p align="center"><strong>修复有据，经验可循。</strong></p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-reforge/v/0.1.0-alpha.1"><img src="https://img.shields.io/npm/v/dsh-reforge/alpha?label=npm%20alpha" alt="npm alpha" /></a>
  <a href="https://github.com/wang1299/dsh-reforge/blob/main/docs/compatibility.md"><img src="https://img.shields.io/badge/DSH-0.2.0--rc.2-39424e" alt="DSH 0.2.0-rc.2" /></a>
  <a href="https://github.com/wang1299/dsh-reforge/actions/workflows/check.yml"><img src="https://github.com/wang1299/dsh-reforge/actions/workflows/check.yml/badge.svg?branch=main" alt="CI" /></a>
  <a href="https://github.com/wang1299/dsh-reforge/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT" /></a>
</p>

<p align="center">
  <a href="https://github.com/wang1299/dsh-reforge/blob/main/README.md">中文</a> ·
  <a href="https://github.com/wang1299/dsh-reforge/blob/main/docs/README.en.md">English</a> ·
  <a href="https://github.com/wang1299/dsh-reforge/blob/main/docs/index.md">文档导航</a> ·
  <a href="https://github.com/wang1299/dsh-reforge/blob/main/docs/installation.md">安装指南</a> ·
  <a href="https://github.com/wang1299/dsh-reforge/blob/main/docs/compatibility.md">兼容性</a> ·
  <a href="https://github.com/wang1299/dsh-reforge/blob/main/CHANGELOG.md">更新记录</a>
</p>

**DSH-Reforge（npm 包名 `dsh-reforge`）是 DeepSeek Harness 的社区插件，从有测试依据的 Python Bug 修复中积累可追溯经验，在后续相似任务中选择适用经验作为参考。**

DSH-Reforge is a DeepSeek Harness plugin for traceable experience from test-verified Python bug fixes, with scoped retrieval for later tasks.

**实验性 alpha：`dsh-reforge@0.1.0-alpha.1`。** 已于 2026-10-23 发布至 npm `alpha`，公开下载与安装检查通过。[GitHub Release](https://github.com/wang1299/dsh-reforge/releases/tag/v0.1.0-alpha.1) 的制品与摘要已核验，完整结果见 [Issue #75](https://github.com/wang1299/dsh-reforge/issues/75)。源码仓库现统一为 `wang1299/dsh-reforge`，原仓库地址由 GitHub 跳转。本项目由社区独立开发，不代表 DeepSeek 官方审核、推荐或安全认证。


T040 / 开发候选：当前源码准备 `0.1.0-alpha.2`，目标验证 DSH `0.2.0-rc.2` 和 `0.2.1-rc.5`。版本支持清单、适配层、矩阵与实际验收见 [兼容性指南](docs/dsh-version-matrix.md) / [Issue #93](https://github.com/wang1299/dsh-reforge/issues/93)。该候选尚未发布；上面的公开 alpha.1 仍只支持旧宿主，市场收录不代表它能安装到新版 DSH。

## 能做什么

- **自动记录**：首次由仓库所有者开启后，正常对话中的直接用户请求形成执行片段；保存有限摘要与受限 Python 代码快照。
- **验证来源**：在临时工作区重放原始失败、修复后的独立验收和回归测试。回合结束只触发检查，不能证明任务正确。
- **提炼候选**：使用 DSH 已注册的模型，从验证材料提炼有来源、适用条件和版本约束的候选，再执行独立来源复核。
- **适用时参考**：后续请求按仓库、代码、依赖条件和相关度选择少量经验；证据不足或不适用时可以不提供。
- **查看和纠正**：在 DSH 的插件详情中查看学习动态、经验、来源、历史和使用记录，记录反馈、修订、停用或恢复。

来源验证说明当时的修复通过检查，**不证明经验能改善未来任务**。已有小规模对照没有观察到验收成功率改善，不能宣传普遍有效；结果与失败见 [评价记录](https://github.com/wang1299/dsh-reforge/blob/main/docs/development/T008c-acceptance.md)。

## 演示视频：保存失败，也不丢输入

**亲自运行同款工程：** [examples/customer-form](examples/customer-form/README.md) 提供原始代码、补丁、外部验收和回归测试。运行 `npm run example:customer-form`，无需 Key 或 DSH，实际核对失败、修复和经验入库。[第一次配置与验证](docs/getting-started/quickstart.md)将体验、只读配置与学习授权串起来。

[![DSH-Reforge 首次任务演示：保存失败，也不丢输入](https://raw.githubusercontent.com/wang1299/dsh-reforge/main/docs/assets/demos/first-task-poster.jpg)](https://github.com/wang1299/dsh-reforge/raw/refs/heads/main/docs/assets/demos/first-task-demo-1080p.mp4)

[下载演示 MP4（2 分 02 秒，1080p）](https://github.com/wang1299/dsh-reforge/raw/refs/heads/main/docs/assets/demos/first-task-demo-1080p.mp4) · [中文字幕](https://github.com/wang1299/dsh-reforge/blob/main/docs/assets/demos/first-task.zh-CN.srt) · [案例与验收说明](https://github.com/wang1299/dsh-reforge/blob/main/docs/demos/first-task.md)

从客户表单丢失输入开始，演示明确纠正、实际补丁、独立验收和经验入库：原始版本 2 项验收失败，修复版本 2/2 通过，回归测试 3/3 通过。

**本片为合成数据的本地显式记录案例**，展示源码 alpha.2 的独立工作台；修复由 Codex 准备，示例页面应用补丁。没有录制 DSH 模型自主编码或自动提炼，没有付费模型调用，也没有评价后续任务收益。公开 npm alpha.1 的版本范围不变。

## 安装与打开

需要 **Node.js ≥24.10、DSH 0.2.0-rc.2**。修复验证还需要 Git、Python ≥3.10 和 pytest；CI 固定 pytest 9.1.1。只承诺该 DSH 版本，不适用于 DeepSeek 官方聊天网页。

在自己的 DSH 环境安装准确版本：

```sh
dsh plugin --profile web add dsh-reforge@0.1.0-alpha.1
```

停止原 DSH 进程，再使用同一 profile 启动 Web，打开启动器打印的完整认证地址。**左侧「插件」→「dsh-reforge」→ 详情操作页**即可查看；配置仓库中的已有会话，可从与「对话／轨迹」并列的「经验」标签进入。打开页面不调用模型。

学习默认关闭。启动前设置 `DSH_REFORGE_CONFIG` 为本机 JSON 配置的绝对路径。最小只读配置：

```json
{
  "repoRoot": "/absolute/path/to/your/repository"
}
```

完整安装、开启自动学习、独立验收和旧本地预览迁移步骤见 [安装指南](docs/installation.md)。旧 `DSH_EVOLVE_CONFIG` 仍兼容；两个变量同时存在时必须指向同一个文件。凭据只在 DSH 官方凭据配置中设置，不写入插件 JSON。

## 一次修复如何形成经验

1. 仓库所有者配置独立验收、执行信任、模型共享和提炼次数，开启学习。
2. 在 DSH 中照常提出 Python Bug 修复请求，并在需要时明确纠正。
3. 插件在临时工作区检查原始失败、修复结果和回归测试；材料与授权齐备后提炼候选，再独立复核。
4. 在插件页查看经验、适用范围和来源；后续相似请求可能获得参考，反馈或停用仍由使用者决定。

这是当前流程的文字说明；来源验证和后续参考记录不能证明任务收益。可复用的[中英文项目介绍](https://github.com/wang1299/dsh-reforge/blob/main/docs/public-introduction.md)单独维护。

## 当前边界

- 第一版聚焦**一个仓库内的 Python＋pytest 修复**，每个直接请求是独立执行片段，不做跨轮语义合并。新建 Python 文件、符号链接、交错请求、版本漂移或不支持的变更可能跳过学习。
- 自动学习须显式配置执行信任、模型共享、独立验收及提炼次数；`maxCalls` 是提炼次数，**不是整个 DSH 会话的人民币上限**。网络中断等未知调用不自动重试或退额。
- 本地验证会运行仓库代码，**不具备强沙箱**。只对自己信任的仓库开启；不自动回滚或提交用户代码。
- 默认数据继续保存在 `~/.dsh/evolve/<repoId>/evolve.sqlite`，当前 SQLite v9。保留旧历史、`evolve_` 工具和内部标识，改名不搬迁经验或重置授权。
- 不保存完整会话、附件或任意工具输出。自动模式保存有界摘要、少量明确纠正、来源标识及代码快照；目前没有自动彻底遗忘功能。模型共享开启后，有限修复材料会发送至所选模型服务。
- 已有 Windows 完整 Web、双平台核心与实际安装演练；脚本模型证明执行路径可运行，不能替代真实模型质量、Desktop、多版本或收益验证。

## 从源码开发

读者入口：[文档导航](docs/index.md) · [版本与发行状态](docs/release-status.md) · [FAQ](docs/faq.md) · [数据运维](docs/maintenance.md) · [参与试用](docs/community/pilot.md)。开发历史与公开发行分开记录，八项补齐进度见 [T046](docs/tasks/T046-public-readiness.md)。

```sh
npm ci --ignore-scripts
npm run check
npm run compat
npm run demo
```

`demo` 只生成合成案例。按输出中的配置路径运行 `node dist/src/cli.js panel --config <config.json>` 可打开独立面板；完整地址带本机访问令牌，请勿分享。开发检查和实际安装使用隔离 profile，不操作默认 DSH 配置。

[产品需求](https://github.com/wang1299/dsh-reforge/blob/main/docs/product.md) · [架构总纲](https://github.com/wang1299/dsh-reforge/blob/main/docs/architecture.md) · [路线](https://github.com/wang1299/dsh-reforge/blob/main/docs/roadmap.md) · [开发与贡献](https://github.com/wang1299/dsh-reforge/blob/main/CONTRIBUTING.md) · [更新记录](CHANGELOG.md)

本产品的数据、验证、选择及更新机制由本仓库独立实现。MIT License。 [品牌素材与使用说明](https://github.com/wang1299/dsh-reforge/blob/main/docs/branding.md)。
