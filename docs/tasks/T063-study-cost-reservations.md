# T063：单次研究费用占额与离线调用保护

2026-11-09 / [Issue #139](https://github.com/wang1299/dsh-reforge/issues/139)，分支`codex/t063-study-cost-reservations`，基于PR #138的`7054515369959127785919332448bac6c8a0eee0`。

- 设计先提交`4861cca`：[ADR057](../decisions/057-study-cost-reservations.md)。新库RF63/schema1，单个计划、默认未授权；不接触T049或产品Store。
- 第一实现`c6182a02418c361ba513173926c51d03359883c7`：独占锁/只读识别、事务占额/结算、36×2顺序、重开停止；严格text-only请求和完整最终SSE，拒绝重复/转义JSON收费键和模型标签漂移。包装器只有显式离线transport，没有fetch、endpoint、Key或live CLI。
- 针对检查13/13通过、0跳过，包含独立连接观察占额已提交、72次合成请求、未知全额保留、并发锁、异类库字节不变、硬链接及Windows目录联接拒绝；实现后的最终SHA检查/审查/CI另记，旧结果不自动归属新提交。
- 完整check/build/compat、稳定SHA独立只读审查及四组合CI尚待完成。没有合并、部署、npm/Release或付费调用；真实controller/provider接入、依赖冻结、进程隔离和新owner授权入口仍待后续，不把本增量称为live就绪或效果提升。

[用户与开发者边界说明](../evaluation/study-cost-guard.md)。持续UX和真实收益目标未完成，当前数字仅为结构性离线验证。
