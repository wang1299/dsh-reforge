# T061：下一轮真实收益研究的题目与送达预检

2026-11-06 / [Issue #135](https://github.com/wang1299/dsh-reforge/issues/135)，基于T060冻结源码`d5a98ae545770cf1e2b54bc2f934ea0716d03eec`的独立分支`codex/t061-benefit-study-preparation`。不修改PR #134，不合并或部署；完整持续目标仍包括真实模型效果和用户体验。

## 事前材料

- 设计先于实现：`751868f` [ADR055](../decisions/055-new-task-benefit-study-preparation.md)。
- 题目/策略/参考与错误控制/36项计划先于runner：`be525db` [fixture](../../scripts/benefit-study-cases.ts)。
- 结果解释及复现：[新任务准备报告](../evaluation/benefit-preparation-v1.md)。

## 已观察与待验

首轮针对测试4/4通过，发现并修正新来源库克隆时丢失候选→已验证版本历史的实现错误，保留真实revision2，不伪装revision1。全部6题原始/参考/错误控制具有预定区分；18个实际脚本请求中none/plain/reforge携带经验0/6、6/6、5/6，严格必填不可null的题被owner条件拒选。

实现提交`4cb29376718dfa65a225abd5b08a0df63ffb286d`另补实际系统说明、温度、上限和无工具断言，以及运行时版本记录。它的完整check正在核对；上述首轮通过不替代最终提交的检查。兼容/最终CI/独立审查结果待记录，不能算作通过。

公开数据仅为本轮合成控制/结构化摘要，不上传旧profile或私人日志。脚本固定输出没有修复，不提供真实模型成功、返工、耗时节省或费用数字；后续live runner和新预算尚缺。本轮不读旧账本、不授额、不发送付费HTTP、不更新发行物。
