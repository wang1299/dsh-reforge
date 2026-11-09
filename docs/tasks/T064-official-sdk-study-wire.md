# T064：官方SDK线路与同一修复控制器

2026-11-09 / [Issue #141](https://github.com/wang1299/dsh-reforge/issues/141)，分支`codex/t064-official-sdk-study-wire`，基于T063 `8533377e28a35f0d9cb0fd1adc0443d095124c44`，叠在PR #140。

- 设计先提交`7c99464`：[ADR058](../decisions/058-official-sdk-study-wire.md)，无live/Key/旧授权。
- 初次接线日志`.probe-work/t064-target-initial.log`暴露官方SDK构造时立即访问Files服务；改为新空索引和拒绝联网的fetch。下一次`.probe-work/t064-target-sdk-files.log`暴露只覆stream未观察prepareCall，调用计数0、准入阻止请求。修正真实prepared通道后`.probe-work/t064-target-prepared-call.log`30项：29pass、0fail、1本机文件symlink权限skip。初期失败不隐去，没有真实provider HTTP。
- 第一实现`607fe864769f1a5630c00696b261b523fa6089a9`的`study:wire`完整36/72/72，日志`.probe-work/t064-wire-initial.log`，回执`.probe-work/t064-sdk-rehearsal/run-Zzj7Iv/sdk-wire-result.json`。另审计36个独立session、每trial两轮、raw wire摘要与账本72行次序、来源/源码/实际执行摘要一致；三组提供参考0/12/10。账本33120微元为模拟数，实际费用0。
- 独立只读607审查两项P2：controller结果不可用时漏请求计数；SDK锁变化破坏T059历史图严格重放。先提交修订设计`73cf3d3`，再实现`5b183e3674b49f6a49abd64dd02f849c7bffa1cb`。逐trial attempt在finally取计数，清理未知总数null；历史锁按原字节归档，原method/数据/源码/向量/成绩不改，当前图回归另入口。补SDK实际挂起close、响应后结果丢失和旧依赖漂移反例。
- 针对日志`.probe-work/t064-target-review-fixes.log`36项35pass、0fail、1文件symlink权限skip；之后补corpus摘要与独立oracle核对，完整check/compat、修正后完整线路、旧脚本线路与四组合CI仍须取最终实际结果，不能沿用607回执。
- 最终源码/文档的稳定SHA评审和CI以关联PR检查页及最终验收记录为准；本文件保留编写时的准备/失败快照。没有合并main、部署官网、发布npm/Release或付费调用。真实owner授权入口、完整live冻结和进程限制仍未完成。

[中英运行说明及历史/当前图区别](../evaluation/official-sdk-wire.md)。持续UX和真实收益目标未完成，演练结果不作为模型提升数字。
