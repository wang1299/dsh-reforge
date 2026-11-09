# T062：有界Agent修复控制器与真实尝试计数

2026-11-09 / [Issue #137](https://github.com/wang1299/dsh-reforge/issues/137)，分支`codex/t062-bounded-agent-study-runner`，基于T061待审源码；持续目标仍包含UX和真实模型收益。

- 设计先提交`945527c`：[ADR056](../decisions/056-bounded-agent-repair-study.md)。
- 第一实现`00e5c3e`针对4/4、36项/72脚本请求演练通过，但仅为早期控制流程，不覆盖后续安全/数据绑定修正。
- 独立审查发现目标链接写入、验证器基础设施错误误当invalid_code两项P2，以及JSON重复键、调用别名和实际执行摘要缺口。修订设计先提交`82dc4f9`，修正实现`349a2c7e1d0cb8aba3e49443393c745974b95fa4`后独立复审无P0/P1/P2；AI不是GitHub批准。
- 349a针对9项：8通过、1项因本机Windows无文件符号链接权限跳过；硬链接target/contract拒绝且外部哨兵保持已实测。缺解释器为execution_unknown，实际AgentLoop仅1请求、0执行、0返工；重复/转义别名JSON键及AST调用别名被拒。完整350项检查348通过、0失败、2项符号链接权限跳过（另1项是旧workspace-snapshot测试）；日志`.probe-work/t062-check-reviewed-fixes.log`。这不替代后续上游测试增量的全套结果。
- 上游T061另修旧进程恢复测试：子进程退出不等于恢复时PID确定不存在；确定ESRCH单元断言与真实OS探针分开，保守保留其它身份，不改生产恢复逻辑。独立审查/9项通过见[T061末节](T061-benefit-preparation.md)。合入`5dbb0f9`后controller源码与349a完全相同；更新后的全check与最终36项演练正在核对，不能算作已通过。

[运行/边界说明](../evaluation/bounded-repair-controller.md)。矩阵在完整check之后顺序执行`study:rehearse`，覆盖两平台×两宿主；不把大量合成工程演练并发塞进核心测试。每个trial新上下文、来源选择/执行共用新合成仓库，source/index/bank保持。全部脚本参考答案不代表真实效果；真实provider/费用账本/完整依赖冻结/新预算仍未完成。

本轮不部署官网、不发布npm/Release、不读取或改写旧配置/Key/学习库/费用/提炼授权。不因控制器就绪结束持续目标。
