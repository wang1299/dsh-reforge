# ADR066：经验维护检查与复验建议

2026-11-23，T074 / [Issue #160](https://github.com/wang1299/dsh-reforge/issues/160)。在实现前确定契约；从未合并 PR159 的 `64eb0bf` 创建增量分支，不合并父成果或部署。

## 问题与决定

现有选择器在请求时核对来源和代码/依赖条件，但没有集中列出哪些经验需要维护。借鉴 Anthropic [agent memory](https://www.anthropic.com/research/components-of-agent-memory) 的持续整理思路，本轮只实现所有者显式启动的只读检查与建议，不实现自动总结、语义合并、后台调度或模型调用。

1. 新增 `memory-review --config <file> --stopped [--after <experience-uuid>] [--limit <1..50>]`。复用所有者配置、路径/链接拒绝、SQLite header/WAL/sidecar、v9、仓库绑定、完整性及未完成工作检查。数据库以只读模式打开，在同一读事务中投影；不使用会创建目录/迁移/恢复的 createService。`--stopped` 是所有者明确声明，不能据此声称验证了所有系统进程。
2. UUID 顺序分页，默认/最多50条，返回页内计数、总数及下一游标。仅输出经验UUID/期望revision、固定状态/原因/下一步及当前检查commit；不输出经验正文、纠正、文件名、私人路径、配置、授权或任意异常。读取JSON按现行schema校验；坏库/未知schema停止且给脱敏错误，不把缺失条目算成功。
3. 先区分 candidate、disabled，再检查来源任务/报告身份、verified及完整事实引用；之后用当前仓库及请求内新文件读取核对依赖和代码摘要。四类投影状态为 `source_scope_current`、`needs_revalidation`、`not_qualified`、`unknown`。失效需显式修订新candidate后独立验证；条件不可读是unknown，不猜测为已变更。每页重读，不缓存来源资格。
4. `source_scope_current` 只表示本次历史来源及环境条件检查通过，不证明事实语义真、当前测试重跑通过、具体新任务适用、owner条件、模型采用或未来收益。报告不能授予检索资格、创建Application、改经验状态/版本、调用verify、恢复任务或占用预算。现有disabled及unknown费用不变；旧来源证明不自动转移到新条件。
5. 事实引用验证抽成只读结构接口，生产校验规则保持。核心维护检查复用相同引用及applicability函数；SQLite适配只提供查询。仓库检查与文件读取不是文件系统原子快照；外部变化后应重跑，游标不是跨运行冻结快照。

## 验收与边界

真实合成pytest来源作为正控制；代码/依赖变化、不可读条件、缺失/错误来源、候选/停用、修订、分页及旧数据全表/字节不变作为负控制。提供零模型调用的可运行演练，分别展示current、漂移及unknown；报告工程结果，不声称真实模型记忆收益。目标测试、完整check、compat、双宿主/双平台矩阵、同包安装和稳定SHA独立只读审查以任务/PR实际回执为准。

不读取生产经验/凭据，不扩展为完整会话采集。SQLite v9、DSH默认行为、公开alpha.2和所有历史授权均保持；无发布、Release、部署或付费调用。更完整的维护Agent、跨任务归并及反例修订执行器须另立契约和独立收益评测。
