# 2026-11-04：真实自动学习与三组小规模验证

**自动闭环通过；没有得到使用经验提高成功率的证据。** 两种检索在全部对照题中都拒选，因此三组实际均未携带经验，不能把结果解释为经验的效果对照。[有界原始指标](results.json)保留全部12项、数字回执、请求/代码摘要与合成提案；不包含完整会话、Key、私人配置或路径。

## 固定条件与可复现入口

- 设计先于调用：[ADR043](../../decisions/043-real-model-pilot.md)、[运行指南](../real-model-pilot.md)。执行源码 `2a44f4801aba5b3e59292fa06e74ea45b2ec9f04`，完整计划摘要 `7788271a433920de997b819abe235690eb7dd9adfbefb864642c139b2515a844`。
- Node 24.19.0、Python 3.10 / pytest 9.1.1、官方 DSH 0.2.1-rc.5 实际安装的 alpha.2 候选；包摘要在 results.json。包内产品JS与执行源码逐文件相同；这次候选不等于日后公开发行制品，文档变化会改变tgz摘要。
- 模型别名 `deepseek-flash`，非思考、最多2048输出token、自动重试0。没有记录服务商实际模型revision，无法承诺将来别名仍指向同一模型。
- 先完整离线预检，零HTTP；再用全新的合成工程真实修复。对照固定2项未进入学习阶段的任务、每项2次重复、3组，共12次单次生成。顺序/提示/验收在调用前冻结，不看结果后换题、强制检索或补正面样本。
- 合成来源与外部验收见执行提交的 `scripts/pilot-fixtures.ts`，三组请求和固定顺序见 `scripts/pilot-comparison.mjs`。本目录保留[模型来源修复](source-repair.py)和全部不同的有界提案；逐项对应文件及SHA256见 results.json。重新运行从新研究目录开始，须另行明确授权；不能重放已完成授权或删除账本。

## 自动闭环的实际验收

正常AgentLoop调用受限文件工具修复一个新的 `ledger.py`，没有调用插件的显式记录工具。插件自动采集修复前后私有快照，验证原始失败1/1、修复通过1/1、回归通过1/1；一次提炼生成候选，再独立复核为来源验证经验。后续正常请求的实际provider文本包含完整经验、应用ID与版本，并产生1条应用记录。

阶段结束：**1条经验、1条应用、0反馈，提炼已用1次，4次HTTP请求**。合成Git HEAD及index字节保持。turn完成、模型自述或工具成功都没有替代外部验收。此为实际安装包与官方SDK的受限合成集成，不能代表任意真实仓库任务都能自动学习。

## 三组结果

| 组 | 外部验收全部通过 | 实际提供经验 | 无效生成 / 需返工 | 负路径失败 | token费用保守上界（元） |
|---|---:|---:|---:|---:|---:|
| 无经验 | 4/4 | 0/4 | 0 / 0 | 0 | 0.005552 |
| 普通词项检索 | 4/4 | 0/4 | 0 / 0 | 0 | 0.005552 |
| Reforge选择 | 4/4 | 0/4 | 0 / 0 | 0 | 0.005552 |

每项均实际生成并运行固定外部测试；库存每次4项、表单每次5项。成功率没有差异。源经验的标题是“Validate failure before mutating shared state”，策略是在已知失败条件下先抛错再修改余额。库存查询没有足够词项锚点；表单有策略词项但没有标题锚点。事后只读诊断分别为 `insufficient_anchors`、`no_title_anchor`，未修改经验、阈值或提示重跑。

因此这次只观察到**检索流水线在这两题中没有供给经验**；没有测到实际使用经验的收益，也不能推断经验无用。模型已能独立解决这些小题，4次/组、单条有效经验且没有失效/干扰库，也不足以支持普遍结论。没有实际返工回合、人工额外编辑为0；“需返工”和负路径失败是观察指标，不是节省工时或错误复用的因果证据。

## 费用与保留

全程16次HTTP均有合法最终累计回执，未知占额0。按官方峰值未命中输入2元/百万token、输出8元/百万token计算：

- 学习与后续参考4次开销：**0.020472元**。
- 12项对照合计：**0.016656元**。
- 实际研究合计保守上界：**0.037128元**，上限10元；不是服务商账单，不重复计算学习开销。

本次独立固定财务账本已标completed，不再授额或重放；原准备历史保留。旧体验及历史预算的6项受保护文件前后哈希一致，未操作默认Desktop配置。SQLite v9、私有快照、历史未知占额与已使用的授权均未重置。公开材料仅来自本轮合成工程。

下一轮应先改善并独立验证候选表达/跨任务检索覆盖，预先固定更有区分度的未见题与干扰库，再决定是否另行授权真实试验；不得将本轮作为正面收益宣传。

## English

The actual installed alpha.2 candidate and official DSH 0.2.1-rc.5 SDK completed the automatic path: model repair, original failing acceptance, passing fixed/regression checks, one extraction, independent source re-verification and one later provider-context/application record. Counts: one experience, one application, no feedback, one extraction used; four HTTP requests.

All three arms passed 4/4 held-out trials, but **both retrieval arms abstained on every trial**. The experiment therefore observed no memory treatment and cannot estimate the effect of using experience. The post-run lexical diagnostics were insufficient anchors for stock and no title anchor for the customer form. No thresholds, candidate text, prompts or tasks were changed to obtain positive results. All12 trials and three distinct bounded proposals are published in results.json and this directory.

Sixteen complete numerical receipts give a peak-price token cost upper bound of CNY0.037128: CNY0.020472 learning/reference overhead plus CNY0.016656 trial generation, with no unknown hold. This is not a provider invoice. The one-shot CNY10 ledger is completed; historical data, unknown liabilities and used grants were retained. The model alias may change, actual provider revision was not recorded, n=4 per arm is small, no stale/distractor corpus was tested and actual rework cost was not measured. No general benefit is claimed.
