# Agent经验上下文编译：冻结对照与限制

2026-11-15，T071 / [Issue #154](https://github.com/wang1299/dsh-reforge/issues/154)。先于首次评分冻结的代码、数据和方法：[45c2dba26a2fa8afac26c7a59a75fa5cae91480c](https://github.com/wang1299/dsh-reforge/commit/45c2dba26a2fa8afac26c7a59a75fa5cae91480c)。数据SHA256：`0e4e361a96af5edfd45e5d03e13a4f8088b3de69c0322cbbaa63bdbda0074006`。[方法](context-packing-v1-method.md) / [全量结构化结果](context-packing-v1-results.json)。

## 首次结果，未调参重选

6个相关人工场景×2预算=12条evaluation，另6条development；全部作者可见。下表是上下文选择，不是Agent完成任务的成功率。

| 方法（同预算） | 总提供字节 | 不同相关facet / 可用 | 无关事实 | 重复facet事实 | 超预算 | 引用绑定失败 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| source-order | 20880 | 18/36 | 0 | 6 | 0/12 | 0/12 |
| relevance-density | 20794 | 16/36 | 2 | 6 | 0/12 | 0/12 |
| mmr-density | 20795 | 16/36 | 2 | 6 | 0/12 | 0/12 |

**MMR未优于源顺序**：facet覆盖16/36，而源顺序18/36；无关事实2条，而源顺序0条。重复facet仍为6条，与两基线相同。MMR比相关性密度多1字节、覆盖和无关数相同；在少量案例改变了事实顺序/选择，没有更好的汇总结果。短的词面相关无关事实会被成本密度偏好；Jaccard只能观察词重合，不能判断任务语义。保留固定参数和全部失败，不把研究策略升级为默认。该策略仅显式启用，尚未合并/发行。

完整事实来源包总35838字节，12/12超出各自给定预算；MMR包20795字节，相对这个**新增完整包参照**减少41.97%。三种预算方法全部0超限，24条选中事实均保留原文和全部引用。此数字不能叫Token/模型费用节约：原旧notice每条261字节、合计3132字节，没有可选事实和完整来源/条件，本功能提供更多结构信息，实际比旧notice更大。

## 全部逐条结果

顺序统一为源顺序 / 相关性密度 / MMR。索引是该条数据的原事实索引，不是排序后编号。

| 案例 | 预算字节 | 完整包字节 | 提供索引（三方法） | 不同facet（三方法） |
| --- | ---: | ---: | --- | --- |
| eval-rollback-450 | 1318 | 3046 | 2 / 4 / 4 | 1 / 0 / 0 |
| eval-rollback-1400 | 2268 | 3046 | 0,1,2 / 0,1,4 / 0,1,4 | 2 / 1 / 1 |
| eval-idempotency-450 | 1318 | 2978 | 0 / 0 / 0 | 1 / 1 / 1 |
| eval-idempotency-1400 | 2268 | 2978 | 0,1,2 / 0,1,2 / 0,2,1 | 2 / 2 / 2 |
| eval-retry-450 | 1318 | 2982 | 0 / 1 / 1 | 1 / 1 / 1 |
| eval-retry-1400 | 2268 | 2982 | 0,1,2 / 1,0,2 / 1,0,3 | 2 / 2 / 2 |
| eval-schema-450 | 1318 | 2947 | 0 / 1 / 1 | 1 / 1 / 1 |
| eval-schema-1400 | 2268 | 2947 | 0,1,2 / 1,0,2 / 1,2,0 | 2 / 2 / 2 |
| eval-paths-450 | 1318 | 3001 | 0 / 0 / 0 | 1 / 1 / 1 |
| eval-paths-1400 | 2268 | 3001 | 0,1,2 / 0,1,3 / 0,1,3 | 2 / 2 / 2 |
| eval-chinese-450 | 1318 | 2965 | 0 / 1 / 1 | 1 / 1 / 1 |
| eval-chinese-1400 | 2268 | 2965 | 0,1,2 / 1,0,2 / 1,0,2 | 2 / 2 / 2 |

## 运行与可证明边界

首次运行从冻结构建执行 `node dist/scripts/context-evaluate.js`，结果写入忽略的本机文件；公开结构化结果与首次文件逐字段相同。复现可用 `npm run context:evaluate`，固定数据无网络/模型/DB入口。

真实官方AgentLoop测试另外检查实际GenerateOptions：自动与owner确认请求收到同一编译格式；预算拒选不写Application；共享关闭、引用摘要漂移、代码条件失效和owner veto均不越过原门槛；显式核心工具保持旧返回。单元测试覆盖UTF-8/转义、完整条件/引用、重复、中文词元和精确边界。实际检查/矩阵/评审回执以[T071任务](../tasks/T071-agent-context-compiler.md)和PR为准。

无真实模型调用、无新费用或私有配置修改。来源绑定不证明文本语义真，合成facet覆盖不证明后续任务收益。下一研究应先使用独立的语义标注与真实任务验收，测量任务成功、错误参考和每成功任务成本；本次不凭这些数据编造收益。

## English

The source-only, opt-in planner preserves mandatory strategy, complete applicability and provenance, selects atomic fact/citation units, and abstains before recording an application when the mandatory envelope does not fit. DSH owns the AgentLoop; the plugin owns this memory notice only.

Frozen author-visible synthetic comparison: 12 correlated cases from six families with two budgets, not blind evaluation. Source-order / relevance-density / MMR cover 18/36, 16/36, 16/36 distinct relevant facets, with 0,2,2 irrelevant facts. All have zero byte-budget violations or citation-binding failures. MMR does not beat the simple baseline and remains experimental. The full new provenance envelope totals35838 bytes; MMR totals20795 (41.97% lower than that reference). Legacy notices total3132 bytes with less information; no model-token, cost or task-benefit reduction is claimed. Actual provider options are separately inspected with a scripted official host; zero paid API calls.
