# 新任务收益研究：零费用前置验证 v1

2026-11-06，T061 / [Issue #135](https://github.com/wang1299/dsh-reforge/issues/135)。**这是题目与模型输入预检，没有真实模型修复成绩。** [ADR055](../decisions/055-new-task-benefit-study-preparation.md)在实现前提交；[题目、契约、参考/错误修复及顺序](../../scripts/benefit-study-cases.ts)在任何真实目标试验前固定。

## 为什么要重新准备

[T049](t049-20261104/README.md)中三组都4/4通过，但普通检索和Reforge均0/4提供经验，没有实际经验处理的效果对照。[T060](owner-intake-v1.md)证明输入绑定/明确条件的工作流，不证明Agent任务收益。本增量先让后续试验能回答问题，再实现真实执行并申请新的预算。

## 固定题目和独立验收

| 任务 | 当前契约的重点 | 作者预期来源建议适用 |
|---|---|---|
| preferences_patch | 批量设置/删除失败恢复，原字典别名和原异常保持 | 是 |
| role_batch | 批量角色写入失败移除新增键，保留旧角色；重复/空批次 | 是 |
| outbox_receipt | send成功后才记录回执，失败可重试，重复保持对象身份 | 是 |
| delivery_batch | 保留前半批已成功投递，失败项及后续可以重试 | 是 |
| nullable_deadline | 缺省、null、0分离，负值拒绝 | 是 |
| required_deadline | 必填且不可null，不能套用可空字段的默认策略 | 否 |

任务都是作者可见的合成新题，不是盲测，也不声称模型未在训练中见过类似题。每题2个外部pytest测试，覆盖多个明确契约断言；测试和参考修复不进入模型任务输入。原始代码必须真的失败，参考修复整套通过，有意不完整/错误迁移的修复必须失败。首轮结果是6/6原始故障可重现、6/6参考修复通过、6/6错误修复被拒；不是18次模型生成。

来源库是3个各自经过原始失败→修复通过→回归通过的独立修复：mapping、delivery、nullable。策略由作者预先撰写，不冒充真实模型提炼；独立来源验收摘要和版本保存在准备回执。来源正确不代表建议适用于目标任务。

## 三组公平输入和真实送达边界

三组共享完全相同的任务文字、原始函数、当前Schema、repair_behavior目标、系统说明和输出上限2048。plain在这3条来源文本上运行现有BM25；reforge通过实际owner提交/绑定路径，保留原服务的资格、第一候选及条件否决。没有匹配就记录拒选，不补选、不强制携带经验。

为了隔离输入差异，Reforge当前notice只投影实际经验的title/strategy；当前工程契约在三组公共任务中都已提供。应用ID/版本在回执里核对，统一模型片段使用同一封装。这是“实际服务选择→统一片段→实际脚本AgentLoop GenerateOptions”的准备证据，**不是生产host/安装包/Desktop完整端到端效果对照**。

| 组 | 实际脚本请求 | 实际输入中的经验 | 与作者标签相符 |
|---|---:|---:|---:|
| none | 6 | 0/6 | 不适用 |
| plain | 6 | 6/6 | 5/6 |
| reforge | 6 | 5/6 | 6/6 |

Reforge在required_deadline记录`owner_conditions_unconfirmed`。这些是6个作者可见例子的送达/拒选计数：不能称为真实任务正确率、错误减少或成功率提升。adapter只输出固定的“没有生成修复”说明；没有运行模型候选验收，也不编造token费用。完整脚本输入、系统说明、温度0、上限和无工具声明在adapter边界核对，回执只保留摘要和结构化计数。

实际收益计划为6题×3组×2轮=36项独立新上下文，六种顺序轮转并平衡位置；尚未启动。接下来真实runner需记录首次/最终通过、实际修复轮数、失败/无效/超时、耗时、全部拒选/提供、费用回执和未知占额。参考修复不能充当模型答案；三组全通过/全失败或没有改善也完整报告。不能事后看结果换题、改策略、加关键词或补正面样本。

## 本机复现

在当前仓库使用已配置的Python 3.10 / pytest，构建后执行：

```powershell
npm run build
node dist/scripts/benefit-study-preflight.js prepare
```

每次在本仓库`.probe-work/t061-study-preparation/run-*`创建新合成工程和`preparation.json`；旧目录不覆盖。输出记录fixture/method/实现摘要、运行时版本、3份来源、18项控制运行及18个脚本请求。入口只接受prepare，没有live/认证/付费实现，测试还禁用fetch确认本轮不联网；AST筛选是本合成工程的受限函数准入，不是通用不可信代码沙箱。

题目摘要：`25dbf5590b918e87a236a8b0b8f4b29e42f969e0668d4f744c76603d945788a3`。方法摘要与实际检查/公开回执以[T061](../tasks/T061-benefit-preparation.md)为准。四组合CI和独立审查属于各自的稳定提交，不能沿用T060的绿灯。

真实执行还缺有限修复回合、冻结的当前模型/候选包/执行依赖、独立新费用账本、当前官方价格核对和新增预算授权。本入口不能使用已完成的T049十元授权；本次未读旧profile/学习库/凭据/财务记录，不发布npm、Release或官网。

## English

This is a zero-HTTP study preparation, not a real-model benefit result. Six authored visible synthetic repair tasks cover in-place rollback, retryable outbox delivery and missing/null/zero semantics. Three independently source-verified repairs support pre-authored advice; source verification does not certify target applicability. All six original failures reproduce, all six reference repairs pass and all six deliberately incomplete/wrong-transfer controls fail their external tests. Reference code and test answers are excluded from task input.

Actual service selection is projected into a uniform snippet and observed in the official AgentLoop's scripted GenerateOptions. Common task, Schema, system text, temperature0 and output cap2048 are checked. The six requests per arm provide0/6,6/6 and5/6 references for none/plain/reforge; Reforge abstains on the required non-nullable timeout task. This is an authored delivery check, not a blind benchmark, production-host comparison, model repair or success-rate improvement.

The balanced36-trial real-model schedule is fixed but has not started. Run the build and `node dist/scripts/benefit-study-preflight.js prepare` for a fresh ignored local receipt. There is no live endpoint, credential loading or spending authorization. A bounded real execution runner, frozen dependencies/model/package, current pricing, new accounting and explicit new budget remain required. T049's completed one-shot authorization is not reusable. No public package, Release or deployment changes in this preparation.
