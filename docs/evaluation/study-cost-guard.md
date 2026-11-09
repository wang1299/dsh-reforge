# 单次研究费用保护（离线验证）

[English below](#english) · [有界修复控制器](bounded-repair-controller.md) · [设计ADR057](../decisions/057-study-cost-reservations.md) · [实际检查记录](../tasks/T063-study-cost-reservations.md)

T063为下一轮真实模型对照补费用基础设施，目前只有注入式离线transport，**没有live执行入口、真实授权或模型效果结果**。插件原有经验、SQLitev9、预算和提炼授权保持。

| 情况 | 实际行为 |
|---|---|
| 新建研究 | 未授权，无额度；synthetic approval仅用于测试 |
| 首次请求 | 同一事务写入started和完整占额，提交后才调用transport |
| 请求重复/乱序/上一笔未结算 | 拒绝，不发起transport；每trial最多两轮、36trial共最多72次 |
| 完整最终usage | 按输入（含缓存命中）及输出的峰值价格结算保守上界 |
| HTTP异常、断流或收费字段未知 | 保留完整占额，立即停止，不自动重试 |
| 输出超过请求上限 | 完整usage可结算，但研究停止且不返回可接受生成 |
| 已开始研究重新打开 | 标为unknown，已结算费用及未知占额保留，不继续原研究 |
| 写入失败或旧锁存在 | 停止，不把未提交结算当退款，不自动删锁 |
| 外来库、文件链接或计划不符 | 拒绝；不迁移、不改写旧账本 |
| 已有journal/wal/shm（含链接） | create/open/写事务均拒绝，不自动恢复、删除或跟随 |

默认最多10元是模块可接受的**上限范围**，不是已获得10元授权。每次先占5.345728元是针对当前flash模型边界的保守预留，并非每次都会花这笔钱。只有完整最终usage才缩减预留；余量不足完整预留就停止，不以低估用量继续调用。[2026-11-09核对的官方价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)及[最终累计usage规则](https://api-docs.deepseek.com/guides/anthropic_api/#streaming-and-token-usage)是本次策略依据，未来执行前仍须重新核对并冻结。

零费用验证：在安装仓库固定依赖后执行：

```powershell
npm run build
node --test dist/test/study-cost.test.js
```

测试创建新的`.probe-work/t063-cost-test-*`合成账本，不读Key/旧授权，不调用真实HTTP。15项测试包括72请求边界、cap、请求快照、最终SSE/重复JSON键、失败提交、重启、并发调用和sidecar链接拒绝；模拟token及金额不进入真实收益报告。完整兼容与平台检查见实际任务记录，不能只引用此处测试数量断言CI已通过。

账本不是防owner篡改/复制/回滚的安全系统，也不独立证明谁批准了调用。真实执行仍须：可信的新授权入口绑定唯一固定账本路径；完整源码/实际依赖/计划/候选包冻结；同一个修复控制器接入无自动重试官方adapter；Key隔离和网络超时/取消；模型代码的独立进程/环境限制。完成这些可审查准备后再请求新预算，T049的10元授权不能复用。当前回执model只接受`deepseek-flash`别名，不能据此声称底层模型版本已固定。

## English

This is offline accounting infrastructure, not a real-model result or a live authorization system. A new ledger is unapproved and binds one study ID and plan digest. The first reservation and started state commit atomically before the injected transport runs. A unique trial/round identity prevents replay; at most 36 trials and 72 requests are allowed. Complete final cumulative usage settles a conservative peak-rate upper bound. Missing usage, transport failure and unknown fee fields retain the full reservation and stop the study. Reopening a started study never resumes it.

The module accepts caps up to CNY10; no actual budget has been granted. Its full per-request reservation is CNY5.345728 under the dated flash policy, not a claim about actual cost or a provider account limit. All tests use synthetic approvals, responses and amounts, with zero provider HTTP and no credentials. The 15 targeted tests do not prove Agent benefit, savings, real network behavior or SDK retry configuration. Pre-existing SQLite journal/wal/shm files, including links, are rejected without recovery, mutation or deletion.

Before paid execution, a separate owner entry point must bind fresh explicit authorization to one fixed ledger path and a frozen plan/runtime. Provider integration, cancellation, dependency and model identity checks, code isolation and independent review remain required. A local file cannot prevent its owner from copying or rolling it back. Historical grants and product data are never reused or migrated here.
