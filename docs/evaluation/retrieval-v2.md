# 检索 v2：质量、逐条解释与重复查询性能

[文档导航](../index.md) · [设计](../decisions/047-retrieval-evaluation-v2.md) · [任务](../tasks/T053-retrieval-evaluation.md) · [English](#english)

**这是零模型调用的离线工程结果。实验候选没有替换默认 DSH 策略，未证明真实任务成功率或模型费用改善。**

## 实验顺序与可复现入口

1. `f5d9a04bf2b6ebaa80530002aea88b4cd6ac7ccf` 在实现前冻结设计与100条作者编写的合成查询。40条开发、60条任务族留出；每族5正例/5负例。经验库每区独立。数据 SHA256：`d0564001694cdf6137486de31ea88bcf619991e735940e3870dc6e2b22289636`。
2. 先运行开发集，未迭代参数。`636fba6f0f203c75e70cb331f1b4091193448e5d` 提交候选方法、实现与开发结果，再首次运行留出；首次留出记录 `sourceDirty:false`。方法摘要 `bfa18356106a48165d031b1f0ff92f24d932a0f92c981fbb8789af2c3bf14383`。未根据留出修改方法。
3. [开发全部结果](retrieval-v2-development.json)、[首次留出全部结果](retrieval-v2-holdout.json)、[本机性能原始样本](retrieval-v2-performance.json) 保留逐项失败和来源文件摘要。开发报告记录的是实现尚未提交时的工作树，不能将其 `sourceCommit` 当实现提交；逐文件源码摘要及后续冻结提交给出实际实现。

```powershell
npm ci --ignore-scripts
npm run retrieval:evaluate -- development --out .probe-work/retrieval-v2
npm run retrieval:evaluate -- holdout --out .probe-work/retrieval-v2
npm run retrieval:performance
```

前两个命令输出JSON，并在本仓库 `.probe-work/retrieval-v2` 生成对应 `.json`/`.html`。直接用浏览器打开 `development.html` 或 `holdout.html` 可查看卡片、所有查询、原版与候选选择、资格排除和可展开的命中字段/拒绝原因；页面没有外部资源或模型调用。报告不自动上传，不读用户数据库或配置。`npm run check` 重算确定性字段并与已保存报告比较；性能只记录实际时间，不对机器速度作CI断言。

本轮留出已使用，后续算法开发必须将它当作已见数据并另建新的任务族留出。

## 三种方法与真实分母

全部方法使用同一分区的经验、同一合成资格过滤、相同BM25基础分和 top-1；v1 与预建索引每一个分数、拒绝、顺序相同。候选允许至少3个正文词项且覆盖正文不同词项至少50%的无标题匹配，并拒绝特定、明确“仅文档且不改行为”的表述。它不是语义模型；规则、来源与局限完整在ADR和方法摘要中。

| 分区 / 方法 | 正例正确选择 | 错误提供 / 全部查询 | 负例提供 / 负例 | 拒绝 / 全部 |
|---|---:|---:|---:|---:|
| 开发 v1 / 预建 v1 | 12/20（60%） | 4/40（10%） | 4/20（20%） | 24/40 |
| 开发候选 | 13/20（65%） | 0/40 | 0/20 | 27/40 |
| 留出 v1 / 预建 v1 | 12/30（40%） | 6/60（10%） | 6/30（20%） | 42/60 |
| 留出候选 | 18/30（60%） | 0/60 | 0/30 | 42/60 |

留出正确选择增加6项，召回 **+20个百分点**，相对增加50%。补回的都是正文表达查询6/6；中文6/6、改述6/6仍漏选。不能用总体改善掩盖这12条失败。错误提供从6/60到0/60，改善全部来自同一个明确文档模板的拒绝，不能宣称普遍理解意图或真实误用率为0。重复模板和直接取自正文的正例降低了挑战性；作者可见、每区经验仅4/6条，需外部标注、多样困难反例与更大库复验。

两个T049历史查询独立复现原评分与拒绝，候选仍拒绝。已知非法输入的前置检查不等于持久化失败的恢复策略，适用性尚未证实；它们不进入这100条的正例，也没有被改写为命中。

## 性能：复用固定库的摊销收益

Windows x64、Node24.19.0、AMD Ryzen9 7945HX、32逻辑核、31.7GiB内存。8条查询各方法预热一次，再4轮交错测量，每方法32项；完整输出逐项相同，校验在计时之外。最邻近秩 P50/P95；全部原始时间在JSON。

| 合成文档数 | 原版每次建索引 P50/P95 | 复用索引 P50/P95 | P50倍数 | 单独建索引 |
|---|---:|---:|---:|---:|
| 1,000 | 5.31 / 7.32ms | 0.43 / 0.72ms | 12.37× | 14.01ms |
| 10,000 | 54.57 / 62.54ms | 4.06 / 5.18ms | 13.44× | 98.73ms |

这些是一次本机运行的**固定合格库重复查询**结果，不是线上延迟、单次冷请求或整段 Agent 提速。1万文档 P95 下降91.72%；另需付出98.73ms构建，库或资格变化必须重建。当前工具复用索引能力没有接到默认 DSH 的跨请求缓存；不得把这个倍数写成产品对话提速。报告不包含Git/来源检查、磁盘、模型及界面时间，也不代表恶意代码隔离性能。

## 可以怎样引用

可如实描述：构建100条作者编写的冻结合成检索评测，实验候选在60条任务族留出中将正例召回由12/30提高到18/30，保留12条中文/改述漏选；实现与原算法结果逐项一致的只读索引，在本机1万文档固定库重复查询中P50由54.57ms降至4.06ms，另计98.73ms构建。

不能据此声称：真实任务成功率提高20%、模型费用下降、通用语义检索、线上请求提速13倍、普遍零误用或独立盲测通过。下一步优先外部标注/更难检索集、跨语言方案对比；真实任务研究另作预登记、费用授权与独立验收。#114保持开放。

## English

100 author-visible synthetic queries were committed before implementation:40 development and60 task-family holdout. The candidate and its source were committed before the first holdout execution. This is not a blinded evaluation. The experimental body-coverage/documentation heuristic is offline-only; default DSH selection and SQLite/budgets are unchanged.

Development positive recall:12/20→13/20; wrong offers:4/40→0/40. Holdout recall:12/30→18/30, +20 percentage points; wrong offers:6/60→0/60. All six recovered positives reuse strategy wording, all six removed errors use one documentation template. All12 Chinese/paraphrase positives still miss. Full failures are preserved; no downstream Agent benefit is established.

The immutable prepared index exactly preserves v1 rankings/scores/rejections. One local Windows/Node24 run at10k synthetic documents measured repeated-query P50 54.57→4.06ms, P95 62.54→5.18ms, with98.73ms separate index construction. Eight warmups and32 interleaved measurements per method; raw samples included. This is an amortized fixed-corpus benchmark, not cold/production/Agent latency, and no default cross-request cache is deployed.
