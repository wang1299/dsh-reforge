# 新任务收益研究：零费用前置验证 v1.1

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

任务都是作者可见的合成新题，不是盲测，也不声称模型未在训练中见过类似题。每题2个外部pytest测试，覆盖多个明确契约断言；测试和参考修复不进入模型任务输入。v1.1共23项控制执行：6个原始故障、6个参考修复、11个不完整/错误实现。针对预检和独立纯内存复核均确认6/6原始故障可重现、6/6参考修复通过、11/11错误实现被拒；不是23次模型生成。

独立审查在原v1中复现了仅改副本、清空无关回执、成功后丢失完成状态、传入原对象及重复持久化等验收盲点。因此保留[原v1完整文件](../../test/fixtures/benefit-study-v1.ts.txt)，SHA256 `b0530361486e13cb994cf3ad1475eea34835b56f90c8460b90b1fdc605a21b3a`，在任何live结果前升级v1.1；增加5个错误控制及原位状态、嵌套常量、回调次数/副本身份/原异常与输入不变断言，不把旧版测试通过算作新版完整验收。

来源库是3个各自经过原始失败→修复通过→回归通过的独立修复：mapping、delivery、nullable。策略由作者预先撰写，不冒充真实模型提炼；独立来源验收摘要和版本保存在准备回执。来源正确不代表建议适用于目标任务。

## 三组公平输入和真实送达边界

三组共享完全相同的任务文字、原始函数、当前Schema、repair_behavior目标、系统说明和输出上限2048。plain在这3条来源文本上运行现有BM25；reforge通过实际owner提交/绑定路径，保留原服务的资格、第一候选及条件否决。两个检索都使用同一脱敏256字符摘要，另断言Reforge实际task.summary及三个queryDigest相同。没有匹配就记录拒选，不补选、不强制携带经验。

为了隔离输入差异，Reforge当前notice只投影实际经验的title/strategy；当前工程契约在三组公共任务中都已提供。应用ID/版本在回执里核对，统一模型片段使用同一封装。这是“实际服务选择→统一片段→实际脚本AgentLoop GenerateOptions”的准备证据，**不是生产host/安装包/Desktop完整端到端效果对照**。

| 组 | 实际脚本请求 | 实际输入中的经验 | 与作者标签相符 |
|---|---:|---:|---:|
| none | 6 | 0/6 | 不适用 |
| plain | 6 | 6/6 | 5/6 |
| reforge | 6 | 5/6 | 6/6 |

Reforge在required_deadline记录`owner_conditions_unconfirmed`。这些是6个作者可见例子的送达/拒选计数：不能称为真实任务正确率、错误减少或成功率提升。可空策略文字本身也提醒核对当前Schema，因此plain提供此段文字不等于模型会答错或策略完全无帮助。adapter只输出固定的“没有生成修复”说明；没有运行模型候选验收，也不编造token费用。实际system消息、公共任务、温度0、上限和无工具声明在adapter边界核对，回执只保留摘要和结构化计数。

实际收益计划为6题×3组×2轮=36项独立新上下文，全局覆盖六种组顺序、各位置平衡；每题只有两种顺序，第二轮每组都换位置，不是题内三位置完整平衡。尚未启动。接下来真实runner需记录首次/最终通过、实际修复轮数、失败/无效/超时、耗时、全部拒选/提供、费用回执和未知占额。参考修复不能充当模型答案；三组全通过/全失败或没有改善也完整报告。不能事后看结果换题、改策略、加关键词或补正面样本。

## 本机复现

在当前仓库使用已配置的Python 3.10 / pytest，构建后执行：

```powershell
npm run build
node dist/scripts/benefit-study-preflight.js prepare
```

每次在本仓库`.probe-work/t061-study-preparation/run-*`创建新合成工程和`preparation.json`；旧目录不覆盖。输出记录fixture/method/实现摘要、运行时版本、3份来源、23项控制运行及18个脚本请求。源文件和实际编译入口在起始/结束必须一致；这只是准备入口的记录，不等于live全部运行依赖冻结。入口只接受prepare，没有live/认证/付费实现，测试还禁用fetch确认本轮不联网；AST筛选是本合成工程的受限函数准入，不是通用不可信代码沙箱。

v1.1题目摘要：`89b3f295621c2430ff449917ec4064c8b50efaf5799180e46939f5ddb6b1f602`。原v1数据摘要25dbf559…保留在历史回执/归档，不覆盖。[完整有界合成回执](benefit-preparation-v1.1.json)对应实际准备代码`f0a85cf`，方法摘要`884c10dc93632dd55d2657b491a022e2739edb1f89444bd9e0819d886e995ca5`。本机Node24.19.0/Python3.10.11/开发SDK0.2.0-rc.2；完整check341项（340通过、0失败、1项旧symlink权限跳过）、compat10/10通过。另一宿主图和平台由各自矩阵验收。实际检查/审查见[T061](../tasks/T061-benefit-preparation.md)，不能沿用T060的绿灯。

真实执行还缺有限修复回合、冻结的当前模型/候选包/执行依赖、独立新费用账本、当前官方价格核对和新增预算授权。本入口不能使用已完成的T049十元授权；本次未读旧profile/学习库/凭据/财务记录，不发布npm、Release或官网。

## English

This is a zero-HTTP study preparation, not a real-model benefit result. Six authored visible synthetic repair tasks cover in-place rollback, retryable outbox delivery and missing/null/zero semantics. Three independently source-verified repairs support pre-authored advice; source verification does not certify target applicability. Independent review found gaps in v1; the complete original is archived and v1.1 adds five counterimplementations plus stronger caller-state, alias, receipt, copy, callback and input checks. All six originals fail, six references pass and eleven wrong controls fail:23 control executions, not model generations. Reference code and test answers are excluded from task input.

Actual service selection is projected into a uniform snippet and observed in the official AgentLoop's scripted GenerateOptions. Both retrieval arms use the same bounded256-character query. Common task, Schema, actual system-role text, temperature0 and output cap2048 are checked. The six requests per arm provide0/6,6/6 and5/6 references for none/plain/reforge; Reforge abstains on the required non-nullable timeout task. This is authored rule agreement, not model-answer correctness: the advice also warns about incompatible Schemas. It is not a blind benchmark, production-host comparison, model repair or success-rate improvement.

The36-trial schedule has globally balanced positions and two distinct orders per task, not complete within-task three-position balance; real trials have not started. Run the build and `node dist/scripts/benefit-study-preflight.js prepare` for a fresh ignored receipt. Source and compiled entry hashes must remain unchanged during preparation, but full live dependency freezing is still future work. There is no live endpoint, credential loading or spending authorization. A bounded real execution runner, frozen dependencies/model/package, current pricing, new accounting and explicit new budget remain required. T049's completed one-shot authorization is not reusable. No public package, Release or deployment changes in this preparation.
