# 语义记忆规划：首次冻结对照、拒选与代价

2026-11-16 / T072 / [Issue156](https://github.com/wang1299/dsh-reforge/issues/156)。这是对单候选语义准入策略的离线评测，**没有接入默认DSH，没有真实Agent解题、API费用或生产误用率结论**。[设计](../decisions/064-semantic-memory-admission.md) · [方法](semantic-memory-v1-method.md) · [复现](../../compat/semantic-memory/README.md)。

## 数据、冻结和实际执行

- 12个作者可见任务族，开发/评测各6族，每族中英文各含修复/文档/矛盾需求，合计72查询。通用编程原语可重叠；语言、负例类型平衡仍不等于外部盲测或真实用户分布。事实顺序在推理前按族索引循环移位。
- 初稿a23476c先冻结48查询；只读预审后在任何真实推理前修正为72、明确POSIX路径域、缓存身份、事实位置和正确提供定义。19b2985冻结初始实现；预评分审查再修复缺失负例被当拒选、方法闭包遗漏，于13549bac75a4bc41fc9408701f0cc3ac42f5e485通过审查后首次开发推理/校准。旧提交和全部修订保留。
- 数据SHA256 `0868e6bf93014503a7f2cbfbec7ae765d1bc1eabd0923281aed434e3cd3f23df`。本地固定模型为T056原384维量化多语言MiniLM，模型清单SHA256 `df4e61b1967fc089cbcec5ad3c9207d5f1f5a8ffeb670a47b14c4cceaf0f6193`。168个输入（含重复锚点），22次CPU batch forward，paidHttpCalls0。开发/评测各84输入，batch推理0.419/0.431秒，均不含初始化，不是端到端Agent时延或稳定吞吐测量。
- 开发15/45项完整网格按预定规则择优，各至少保留9/12个含相关事实正例。16d4fee提交向量/完整参数，979302a提交全部开发结果与实际契约控制，再生成评测向量；a06363920eb615981d2070c48ab8dde3da22576f干净树首次评分。没有据评测结果改阈值或题目。
- 最终阈值：文档0.55、事实0.55；意图臂另需repair-anchor与nonRepair-anchor余弦差>=0.1。全部参数和网格见[calibration](../../compat/semantic-memory/calibration.json)；全部[开发](semantic-memory-v1-development.json)/[评测](semantic-memory-v1-holdout.json)/[契约回执](semantic-memory-v1-contracts.json)公开。
- 12族×原始/参考/错误实现=36次实际pytest控制均匹配：12参考通过，24错误控制被拒。它们验证作者的Python契约，不是模型生成任务；sourceQualifiedExperiences=0，经验/引用为独立schema样例，不是实际Store来源链。

## 必须先理解基线

**这里从作者指定的一条经验开始，不执行经验库检索、实际仓库资格或owner条件检查。**源顺序/MMR臂只做原预算打包，没有新增语义准入，所以不适用查询也会获得mandatory策略notice。其24次负例提供不能当成当前DSH插件的真实误用率；新增门控与单纯打包职责不同。

“正例提供”只要求适用查询有notice；“含相关事实的正例”额外要求至少一条作者标注的相关observedFact。源顺序原本已提供12/12正例的策略，只是其中6条没有选入相关事实，**不能把6/12→10/12写成经验召回或Agent成功率提升**。语义白名单允许跨语言但零词面重叠的事实，而两个旧打包臂保留原词面过滤；这是公开的方法差异。实际来源与语义真仍需调用者/后续研究核验。

## 首次评测集全部汇总

评测36查询：12正、24负，来自6个族；每条同一mandatory+1000字节预算。

| 方法 | 总提供 | 正例提供 | 含相关事实正例 | 负例误供 | 缺相关事实/拒绝正例 | 相关facet | 正例被选无关事实 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| source-order | 36/36 | 12/12 | 6/12 | 24/24 | 6/12 | 11/24 | 3 |
| mmr-density | 36/36 | 12/12 | 7/12 | 24/24 | 5/12 | 11/24 | 3 |
| cosine-gate | 30/36 | 12/12 | 12/12 | 18/24 | 0/12 | 19/24 | 1 |
| intent-gate | 17/36 | 10/12 | 10/12 | 7/24 | 2/12 | 15/24 | 1 |

全部臂0字节预算超限、0已选事实引用绑定错误。单纯余弦臂保留12/12相关事实正例，但仍误供18/24；意图臂误供7/24，同时丢失2个正例。以完整余弦臂为对照，**意图差门槛减少11次误供，牺牲2次正例提供和4个相关facet**。意图臂17次提供仅10次为含相关事实正例（58.8%）；误供仍高，维持离线实验，不上线默认。

源顺序/MMR/余弦/意图总notice字节为49299/49241/46762/26843。意图臂更少提供，主要是拒选导致的总量减少；不能称相同信息的压缩率、全模型Token或费用节省。

## 分层与保留的失败

修复行报告含相关事实的正例，文档/矛盾行报告误供；每格分母6。

| 语言/类型 | 源顺序 | MMR | 余弦 | 意图 |
| --- | ---: | ---: | ---: | ---: |
| en / repair | 5/6 | 6/6 | 6/6 | 5/6 |
| en / documentation | 6/6 | 6/6 | 6/6 | 2/6 |
| en / contradiction | 6/6 | 6/6 | 5/6 | 3/6 |
| zh / repair | 1/6 | 1/6 | 6/6 | 5/6 |
| zh / documentation | 6/6 | 6/6 | 2/6 | 0/6 |
| zh / contradiction | 6/6 | 6/6 | 5/6 | 2/6 |

意图臂漏选均为json_lines-q0/q1。文档相似度0.814/0.718已经很高，但意图差0.0788/-0.0042低于固定0.1，仍被拒。不能根据这两条放宽阈值后重称首次结果。

意图臂七次误供全部保留：`cache_presence-q2`、`cache_presence-q3`、`cache_presence-q5`、`nullable_deadline-q2`、`nullable_deadline-q3`、`outbox_ack-q3`、`outbox_ack-q5`。包括2条英文文档请求和5条相反行为需求，说明相似度及两个锚点仍不能可靠理解否定/逻辑条件。语言/类型模板和人工标签可能有利于锚点设计；需要更多独立标注和不同任务来源，不能据此宣称跨项目泛化。

开发结果与评测分开：源顺序/MMR/余弦/意图含相关事实正例5/6/9/9（各12正），误供24/24/10/8（各24负）。开发用于择参，不冒充评测成绩。

## 工程保证与下一阶段

公开工件整理曾误选一份旧演练报告替代契约回执，含本机路径，短暂进入本次公开开发分支。独立审查发现后，已从本分支相关提交链移除错误文件，在新的修正提交才加入正确的36项脱敏回执，并新增严格的工件种类/字段/代码与验收摘要校验。原始本机首轮报告及历史SHA私下保留；文中979302a/a063639为真实首轮记录，新公开等价提交分别为b78d9d3/033d659，方法/参数/数据/向量与全部逐条成绩未变。当前分支历史清理不保证第三方或GitHub历史缓存同步消失。

首次Linux CI发现可选Windows wheel锁的检出换行与最初Windows工作树不同。为该单一非执行锁文件固定Git检出CRLF，使所有平台都重现原始59f239c5摘要；新增Git实际checkout-filter回归。没有改摘要校验逻辑、方法源码、原始校准、参数、向量或首轮成绩，也未重新推理/调参。该修复只固定版本控制中的文件传输字节。

- 所有84个预期request先验证模型/数据/namespace/ID/revision/精确文字和有限有效向量。缺失负例、错字摘要或无关条目凑数均停止研究，不能以缓存缺失“获得拒选收益”。runtime planner单独返回invalid_vectors，不暴露原始异常/私人文本。
- 来源/条件/身份不可截断；只用原事实索引白名单，事实与全部引用原子保留。既有白名单只收窄，默认不传时T071首次完整结果逐字段相同。没有Store写入或Application增加。
- 冻结闭包包含输入fixture、domain、旧模型asset helper、tsconfig/Python锁；另绑定zod/TypeScript版本和integrity，两个DSH锁保持核心依赖相同。评测前重算整个开发网格核对参数来源。CI仅重放公开向量，不重新运行神经模型。
- 实际检查和最终独立审查/矩阵见[T072](../tasks/T072-semantic-memory-planner.md)及关联PR，不把未结束检查写通过。后续先扩大独立标注和明确的适用条件，再考虑宿主接线；真实任务对照需新的冻结计划和单独预算，本轮不复用历史许可。

## English

Source-only local single-candidate admission/fact-planning experiment.72 author-visible synthetic queries across12 family IDs, split6/6; common programming primitives may overlap. All36 authored Python contract controls matched; these are neither Agent-generated repairs nor Store-qualified experiences. Model inputs exclude labels, reference code and test answers.

Frozen evaluation has36 queries:12 positive/24 negative. Source-order/MMR/cosine-gate/intent-gate provide useful labeled facts for6/7/12/10 positives and offer on24/24/18/7 negatives. Both packing baselines already provide strategies for all12 positives and lack the new admission stage: this is not a production retrieval or Agent-success comparison. Adding the fixed intent gate to cosine removes11 false offers but loses2 positives (bothJSON-lines) and4 relevant facets. Intent precision under this definition is10/17,58.8%, still insufficient for default rollout. All byte-budget and selected-fact citation-binding violations are zero. Lower total bytes mostly reflect abstention, not equivalent-information compression or paid cost savings.168 local text inputs,22 CPU forward batches, zero paid API calls; CI replays fixed vectors only. No new model-quality, deployment or publication claim.
