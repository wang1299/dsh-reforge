# T074：经验维护检查与复验建议

2026-11-23 / [Issue #160](https://github.com/wang1299/dsh-reforge/issues/160)。基于 PR159 的64eb0bf；分支 `codex/t074-memory-maintenance-review`，增量PR以父分支为目标。设计先于实现见 [ADR066](../decisions/066-memory-maintenance-review.md)。

交付：所有者只读维护检查、固定来源/条件诊断与复验建议、UUID分页、实际合成来源演练。没有模型总结、自动修订/复验、任务接受、数据迁移或生产数据操作。

## 实际检查

- 31acedb先提交ADR；32032ea实现只读CLI/分页、固定诊断与建议、共享来源校验的只读接口、SQLite读事务和真实合成来源演练。仅改变开发分支，未修改生产数据/SQLite v9或历史授权。
- 首轮针对性检查10/10通过：维护检查与既有owner操作，包含数据库字节、配置、目录清单和所有旧表/已用unknown grant不变。该轮未含随后增加的无库/错误参数和Git stderr反例，不冒充最终SHA完整检查。
- 独立只读审查在32032ea指出证据/引用错误按条返回not_qualified、主行错误停止的文档差异；51b677f修正文档并补异常路径控制，复审无新增问题。随后复现P2：Git execFileSync失败可自动输出私人路径，已显式捕获stdio并增加真实CLI损坏.git负例；最终固定提交仍须复审及完整CI。
- [Draft PR #161](https://github.com/wang1299/dsh-reforge/pull/161)以PR159分支为基线，保持草稿。最终目标/完整/两宿主兼容、四组合CI及同包安装结果以该PR固定SHA的实际回执为准；未结束不写通过。不把设计/离线控制当作Agent收益。
