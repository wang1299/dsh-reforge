# ADR042：owner 首次配置、被动诊断与停机备份

2026-11-04，T048 / [Issue #108](https://github.com/wang1299/dsh-reforge/issues/108)，依赖 T047。先于实现提交。

新增仅供本机 owner 使用的 CLI，不暴露给模型工具或 HTTP：`setup --repo <root> --output <new-config> [--python <executable>] [--data-dir <dir>]`、`doctor --config <file>`、`backup --config <file> --output <new-directory> --stopped`、`restore --input <backup> --output <new-data-directory> --repo <root> --stopped`。严格拒绝未知/重复参数。setup 生成全关闭的配置与下一步，独占创建文件，不覆盖已有配置，不注册模型、不生成 grant、不读取凭据。owner 再按指南分别授权。

doctor 不构造 Store 或 createService，不迁移/创建数据库，不启动宿主、不联网/调用模型。只检查本机 Node/Git、精确 Git 根、隔离解释器的 Python/pytest 可用性、验收位置、配置前置条件和只读 SQLite 版本/计数。报告为白名单类别与有限数字，不包含路径、原配置、凭据、provider 错误或测试输出。宿主支持清单来自适配策略；没有可靠检测完整宿主身份时明确须由 owner 核对，不能把某个 SDK 的版本冒充正在运行的 DSH。

backup/restore 是明确声明停机后的整目录操作，不声称能跨平台检测所有仍连接但空闲的宿主。必须 owner 提供 `--stopped`，并拒绝数据库中正在执行的学习/提炼/快照任务、任何残留 SQLite journal/WAL/SHM、符号链接/特殊文件、不支持 schema、目录嵌套或变化。残留 sidecar 即使为空也不打开，避免 SQLite 只读连接为 WAL 建辅助文件；异常现场先人工完整复制，不能删 sidecar 解锁。全目录复制包含私有快照、原始数据库和次数/unknown，不修改源目录。复制前后对文件集/字节散列复核，并检查副本数据库完整性、schema 和 repo 绑定。清单固定版本，列相对文件名、长度、SHA256、repoId 和 schema；只备份 dataDir，配置/profile/凭据不得存入其中。文件数/体积有限制，超限显式失败而非截断。失败的目的目录保留为不完整现场，没有有效清单不能恢复，不自动删除。

restore 只接受完整清单，核对全部文件集/散列、SQLite/schema/repo，再独占创建一个**不存在的新目录**；不覆盖、不合并、不迁移、不重放任务、不写配置。恢复后仍须手动将原配置的 dataDir 指向副本，保持原权限与 grant，不开自动任务。路径变更导致 repoId 不同则拒绝；跨仓库/路径迁移需另作明确设计。

这些工具只涵盖插件 dataDir，不包含 DSH profile、Key、JSON 配置和目录之外的独立 API 财务账本；它们必须另作私人备份。hash 清单检查完整性，不是攻击者不可伪造的签名或安全认证。旧数据、授权、未知占额和提炼次数保持，SQLite 仍 v9。

验证使用合成数据库/快照/unknown/消耗授权，比较所有表与文件；拒绝活动、变化、损坏、路径穿越、已存在目的地与错误 repo 绑定。运行静态、完整、兼容/双平台矩阵及稳定 SHA 独立评审后交付。真实私人数据不作测试材料。
