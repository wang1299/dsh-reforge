# T062：有界Agent修复控制器与真实尝试计数

2026-11-09 / [Issue #137](https://github.com/wang1299/dsh-reforge/issues/137)，分支`codex/t062-bounded-agent-study-runner`，基于T061待审源码；持续目标仍包含UX和真实模型收益。

- 设计先提交`945527c`：[ADR056](../decisions/056-bounded-agent-repair-study.md)。
- 第一实现`00e5c3e`针对4/4、36项/72脚本请求演练通过，但仅为早期控制流程，不覆盖后续安全/数据绑定修正。
- 独立审查发现目标链接写入、验证器基础设施错误误当invalid_code两项P2，以及JSON重复键、调用别名和实际执行摘要缺口。修订设计先提交`82dc4f9`，修正实现`349a2c7e1d0cb8aba3e49443393c745974b95fa4`后独立复审无P0/P1/P2；AI不是GitHub批准。
- 349a针对9项：8通过、1项因本机Windows无文件符号链接权限跳过；硬链接target/contract拒绝且外部哨兵保持已实测。缺解释器为execution_unknown，实际AgentLoop仅1请求、0执行、0返工；重复/转义别名JSON键及AST调用别名被拒。完整350项检查348通过、0失败、2项符号链接权限跳过（另1项是旧workspace-snapshot测试）；日志`.probe-work/t062-check-reviewed-fixes.log`。这不替代后续上游测试增量的全套结果。
- 上游T061另修旧进程恢复测试：子进程退出不等于恢复时PID确定不存在；确定ESRCH单元断言与真实OS探针分开，保守保留其它身份，不改生产恢复逻辑。独立审查/9项通过见[T061末节](T061-benefit-preparation.md)。合入`5dbb0f9`后controller源码与349a完全相同。
- 最终本机`npm run check`351项：349通过、0失败、2项文件符号链接权限跳过，日志`.probe-work/t062-check-final-controller.log`。包括类型、lint、构建、上游恢复测试与本轮9项。`npm run compat`10/10、无跳过，日志`.probe-work/t062-compat-final-controller.log`。本机网站build/check22页、635处本地引用/锚与公开白名单通过，没有部署。
- 修正后的`npm run study:rehearse`真实终态complete=true、36个独立trial/72次脚本请求、无未知/缺失，来源head/index/bank、源码和实际JS起止核对均为true；日志`.probe-work/t062-rehearsal-final-controller.log`，原始有界回执`.probe-work/t062-study-rehearsal/run-kpKnzN/controller-result.json`。另逐项核对36个session不复用、每项恰好失败→通过两轮、参考数量none/plain/reforge为0/12/10。此为脚本oracle计数，**不是首次/最终模型成功率对照**，真实trial/HTTP均0。
- 此次fixture摘要`89b3f295621c2430ff449917ec4064c8b50efaf5799180e46939f5ddb6b1f602`、method摘要`4a21ed09801bd0f037be4a09184b9e71f67554d96929b61f3a9df710e90bf244`；Node24.19.0、Python3.10.11、SDK0.2.0-rc.2。本地回执与最终提交的矩阵结果分别核对，不把该方法当完整live冻结。
- [PR #138](https://github.com/wang1299/dsh-reforge/pull/138)叠在[PR #136](https://github.com/wang1299/dsh-reforge/pull/136)；后者0a8c07d新四组合已各342/342、compat10/10、同包安装/学习通过。PR138最终SHA仍须独立审查文档/回执及核对四组合CI；当前状态直接看[检查页](https://github.com/wang1299/dsh-reforge/pull/138/checks)，旧SHA成功不能代替新门槛。两个PR都未合并，部署须另有明确授权。

[运行/边界说明](../evaluation/bounded-repair-controller.md)。矩阵在完整check之后顺序执行`study:rehearse`，覆盖两平台×两宿主；不把大量合成工程演练并发塞进核心测试。每个trial新上下文、来源选择/执行共用新合成仓库，source/index/bank保持。全部脚本参考答案不代表真实效果；真实provider/费用账本/完整依赖冻结/新预算仍未完成。

本轮不部署官网、不发布npm/Release、不读取或改写旧配置/Key/学习库/费用/提炼授权。不因控制器就绪结束持续目标。
