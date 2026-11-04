# 数据运维 / Data operations

[文档导航](index.md) · [安装与升级](installation.md) · [FAQ](faq.md)

当前 SQLite **v9**；默认目录 `~/.dsh/evolve/<repoId>/`，显式 `dataDir` 优先。目录包含经验、应用、反馈、版本、来源、任务、私有快照与提炼授权/使用记录。另行运行的 API 试验预算账本可能在其他目录，**不等于插件数据库里的提炼次数**，需分别保留。

Current schema is SQLite v9. An explicit `dataDir` overrides the default above. Keep the whole directory, including source snapshots and extraction grant/usage history. Separate API experiment budget ledgers may live elsewhere and must be preserved separately.

## 升级前 / Before upgrading

1. 停止使用此数据目录的 DSH 和独立面板，确认无学习、提炼或验证任务正在执行；未知任务保留为未知，不重放。
2. 在本机私密位置复制**完整 dataDir**，而不是只复制主 `.sqlite`。停机后仍存在的 WAL/SHM、快照与其他文件一并保留；副本不上传 Git/Issue。
3. 另备份配置、profile、自定义 patch 和独立预算账本，作为私人备份保存。凭据沿用 DSH 的本机管理方式，不写进问题报告。
4. 记录 schema、经验/应用/反馈计数、grantId/已用次数、未知占额和文件摘要，安装准确版本后逐项核对。数字或授权有变化时停机检查。

Stop every process using the directory and confirm no active work. Copy the entire stopped directory, including any remaining WAL/SHM and snapshots. Privately back up configuration/profile and separate financial ledgers. Record schema, counts, grants, usage and unknown holds before/after; stop if they differ.

## 恢复失败 / Recovery after failure

保留故障原件和完整副本。恢复到**新的目录**，核对摘要和绑定仓库，再在兼容程序中只读检查；不要覆盖唯一原件，不直接用旧版程序打开新版数据库。改变 repoRoot 可能改变仓库身份，不能靠清空数据“修复”。未知调用不能自动重试；按原记录核对费用与授权，必要恢复是追加操作，不是重置。

Keep the failed original. Restore into a new directory, verify hashes and repository binding, then inspect with a compatible program. Never overwrite the only copy or downgrade a database in place. A changed repository path may change identity. Unknown calls are not retries; recovery appends history rather than resetting it.

## 卸载与保留 / Uninstall and retention

先停宿主/面板，再通过同一 profile 的官方插件移除命令卸载代码。插件不自动删除 dataDir、外部验收、私有快照、独立预算或凭据；重新安装也不授予新次数。当前没有“安全彻底遗忘所有关联数据”的一键功能；要删除时先核对备份、记录保留需求和确切目录，勿删除整个 `.dsh`。

Stop the host/panel before removing code through the same official profile. Data, external acceptance, snapshots and separate budgets are retained; reinstalling does not add authorization. There is no one-click complete erasure of all linked data. Inspect exact paths and retention requirements before manual deletion; do not remove the entire `.dsh` directory.

当前以上为停机人工流程；配置引导、只读诊断与可校验备份工具由 T048 实现后另记实际验证，不能把本说明当成已经存在的 CLI 命令。

These are currently manual stopped-process procedures. T048 tracks validated setup, passive diagnostics and backup tooling; this guide does not claim those CLI commands already exist.
