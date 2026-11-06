# 数据运维 / Data operations

[文档导航](index.md) · [安装与升级](installation.md) · [FAQ](faq.md)

当前 SQLite **v9**；默认目录 `~/.dsh/evolve/<repoId>/`，显式 `dataDir` 优先。目录包含经验、应用、反馈、版本、来源、任务、私有快照与提炼授权/使用记录。另行运行的 API 试验预算账本可能在其他目录，**不等于插件数据库里的提炼次数**，需分别保留。

Current schema is SQLite v9. An explicit `dataDir` overrides the default above. Keep the whole directory, including source snapshots and extraction grant/usage history. Separate API experiment budget ledgers may live elsewhere and must be preserved separately.

## 升级前 / Before upgrading

源码新增的任务准备/owner条件功能仍保留主库v9，首次写入另建 `owner-inputs-v1.sqlite`（独立schema1）和 `owner-inputs-v1.identity.json`（仓库/存储身份锚）。完整停机备份必须同时保留它们；单个文件丢失或身份不符时不能清空重建，也不能与不理解条件的新旧进程混用目录。128条回执的保留上限不删除永久任务分类；4096条分类到限会拒绝新提交，不靠删除旧分类绕过限制。见[来源、恢复和不可自动重放规则](evaluation/owner-intake-v1.md)。两份元数据一同被手工删除/替换无法凭原v9主库辨认，不承诺抵抗目录级篡改。

The source-only owner-input feature keeps main SQLite v9 and lazily adds `owner-inputs-v1.sqlite` (separate schema1) plus its repository/store identity anchor `owner-inputs-v1.identity.json`. Include both in stopped whole-directory backups. Never reset a missing half or share the directory with older code unaware of the rules. Receipt pruning preserves permanent task classifications; capacity exhaustion rejects new submissions. Deleting/replacing both metadata files cannot be detected from the unchanged v9 main database.

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

## alpha.2工具 / Alpha.2 tools

以下命令属于alpha.2，旧alpha.1没有它们。示例使用已构建源码目录（先 `npm run build`）；若已自行将alpha.2 CLI安装在PATH，可用 `dsh-reforge` 替换 `node dist/src/cli.js`。DSH profile内安装插件不等于安装了全局CLI。公开发行状态见[版本状态](release-status.md)。

```powershell
node dist/src/cli.js doctor --config 'C:\local-config\reforge.json'
# 确认已停止相关 DSH、面板和活动工作后：
node dist/src/cli.js backup --config 'C:\local-config\reforge.json' --output 'C:\private-backups\reforge-20261104' --stopped
node dist/src/cli.js restore --input 'C:\private-backups\reforge-20261104' --output 'C:\private-data\reforge-restored' --repo 'C:\work\my-python-project' --stopped
```

目的父目录需存在，输出目录必须不存在；工具不覆盖或合并。`--stopped` 是 owner 对停机的明确声明，程序不能跨平台检测所有仍连接但空闲的宿主。存在运行中任务、任何 WAL/SHM/journal、符号链接/目录联接、超限数据或文件变化时拒绝；**不要删除这些文件绕过检查**。异常停机先人工复制完整现场，再在兼容程序下诊断。工具最多10,000个条目/512MiB，超限失败而非截断。

备份包含 dataDir 内全部常规文件、空目录与私有快照，不过滤或重置 unknown、grant 和已用次数。不得把配置/profile/Key 放在 dataDir；位于其中的配置文件会被拒绝。数据目录之外的配置、凭据、DSH profile 和独立财务账本需另作私人备份。清单的 SHA256 用于完整性核对，不是安全签名。

恢复核对清单、全部文件、SQLite v9 与原仓库身份后，只写新目录，不改配置、不启动任务。路径不同导致身份不符时拒绝，不支持自动跨仓库迁移。首次检查副本时使用新建的**全关闭权限配置**，保留原授权记录；确认计数、来源、unknown 和已用次数后，再由 owner 决定后续启用。不要直接启动原本开启自动学习的配置，以免接续已排队工作。

失败的输出目录会保留不完整现场；缺有效清单的目录不能恢复。原件不自动修改或删除；解决问题后换一个新目录重做。旧完整备份和故障现场应保留到恢复验收结束。

若诊断为 `wal_mode_requires_manual_private_copy_no_database_opened`，说明文件头处于持久 WAL 模式，即使没有 sidecar，只读 SQLite 连接也可能创建辅助文件。本工具会在打开数据库前拒绝；先停机人工复制整个 dataDir 保存现场，再交由熟悉 SQLite 的维护者在副本诊断。不要删除 WAL/SHM、改文件头或直接转换原件的 journal 模式来通过检查。此工具支持核心默认的 DELETE journal 模式。

These commands belong to the alpha.2 CLI; check publication status and build first when using source. All destination directories must be new with existing parents. `--stopped` is an owner assertion, not reliable detection of every idle host. Active work, any WAL/SHM/journal sidecar, links, file changes or limits (10,000 entries / 512 MiB) cause rejection. Never delete sidecars to bypass checks: privately copy the full failed state and diagnose with compatible software.

Persistent WAL format is also rejected by checking the file header before opening SQLite, even if sidecars are absent: a read-only WAL connection can create auxiliary files. Make a stopped whole-directory private copy for manual diagnosis; never convert or edit the original merely to pass checks. Tooling supports the core's default DELETE journal mode.

The whole data directory, including snapshots, unknowns and consumed grants, is retained. Keep config/profile/keys outside it and back up separate financial ledgers separately. Hash manifests check integrity, not authenticity. Restore validates every file, SQLite v9 and the original repository identity, writes only a new directory, changes no configuration and executes no tasks. Inspect the restored copy using a new all-permissions-disabled config before deciding whether to resume queued work. Failed outputs are retained; retry only into another new directory after diagnosis.
