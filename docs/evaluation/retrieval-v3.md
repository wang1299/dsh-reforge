# 多语言检索：本地向量改善召回，误选仍高

[文档导航](../index.md) · [设计ADR050](../decisions/050-offline-multilingual-hybrid.md) · [复现说明](../../compat/retrieval-embedding/README.md) · [任务T056](../tasks/T056-hybrid-retrieval.md) · [English](#english)

2026-11-06。新增120条作者编写合成查询，比较未修改的BM25、本地多语言向量与加权混合。**这不是独立人工盲测或真实Agent收益试验。默认DSH继续使用原BM25，本实验没有接入用户经验或公开npm包。**

## 方法与冻结顺序

- 数据：12个任务族各2条提醒（英文主提醒、中文相关但不同的次提醒）、10条查询（5正5负）。开发/任务族留出各6族、12提醒、60查询、30正30负；每分区24条正例指向主提醒、6条指向次提醒。数据与理由公开，作者可见；旧36/100查询不再充当新留出。
- `61165f3` 初始冻结数据；独立只读AI标签审查指出一条NDJSON查询缺少明确换行协议，`34e1b15` 在算法/评分前澄清，最终数据SHA256 `ae6a132ac1658a218e5770989246608ed7ab9ba5b766b751123958dd017db5ea`。AI审查不能替代外部人工标注。
- [原作者MiniLM](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2)，Apache-2.0，固定revision与量化ONNX/分词器摘要，384维，attention-mask mean＋L2＋7位小数。模型权重留在忽略目录；仅公开合成向量。全部原始身份见[模型清单](../../compat/retrieval-embedding/model.json)。
- `705a57f` 独立代码预审通过后首次真实向量开发校准；早期测试曾以常量向量执行开发语料路径，未读取结果调参，后换为纯虚构toy，故不能声称此前完全未评分或盲测。只用预登记的24项dense/72项hybrid网格，错误提供不超过同开发BM25，再最大化正确数；完整网格保留在[校准](../../compat/retrieval-embedding/calibration.json)。
- 初始`281df3e`的Windows导出末尾CRLF与Git LF摘要不一致。`407e4d4` 在任何留出生成/评分前只修复输出换行，72条向量数值及元数据不变，重新校准参数/网格完全一致；`d062cda`重新冻结参数与摘要，`c5b5b90`冻结全部开发结果。独立AI复核确认未据结果改方法。未覆盖原始首次开发回执，留存于忽略目录。
- 冻结后才首次生成留出向量，`d53ae2e641bbd84da3571342a59879b0bb051f8a` 的干净工作树执行首次留出，`7fd4f99`保存完整结果。没有根据留出调参；本轮留出已用尽，后续方法需新留出。

混合分数为 `w*通过原门槛的BM25分数＋(1-w)*max(0,余弦)`，无概率含义。合格性先过滤，再算BM25 IDF和余弦；这里的过期/外仓资格只是标签声明，并非真实来源证明。dense阈值0.5、top1-top2间隔0.025；hybrid关键词权重0.15、阈值0.4、间隔0.1。默认生产门槛没有变化。

## 完整分母与错误

| 分区 / 方法 | 正例正确提供 | 错误提供 / 全部查询 | 拒绝 / 全部 | 提供精确率 |
|---|---:|---:|---:|---:|
| 开发BM25 | 7/30（23.3%） | 13/60 | 40/60 | 35.0% |
| 开发dense | 15/30（50.0%） | 10/60 | 35/60 | 60.0% |
| 开发hybrid | 12/30（40.0%） | 12/60 | 36/60 | 50.0% |
| 留出BM25 | 3/30（10.0%） | 18/60 | 39/60 | 14.3% |
| 留出dense | 18/30（60.0%） | 16/60 | 26/60 | 52.9% |
| 留出hybrid | 12/30（40.0%） | 18/60 | 30/60 | 40.0% |

留出dense正确提供率增加50个百分点；本轮hybrid比dense更差，不能宣传“混合总是更好”。dense仍误选16次，包含3次正例选错提醒与13次负例提供，**34次提供中只有18次正确**，不能作为默认策略上线依据。这些作者合成标签也不能外推真实误用率。

| 留出正例类别（各6条） | BM25正确 | dense正确 | hybrid正确 |
|---|---:|---:|---:|
| 英文直接描述→英文主提醒 | 2/6 | 4/6 | 4/6 |
| 中文直接描述→英文主提醒 | 0/6 | 4/6 | 2/6 |
| 英文改述→英文主提醒 | 1/6 | 3/6 | 2/6 |
| 中文情境描述→英文主提醒 | 0/6 | 1/6 | 0/6 |
| 英文描述→中文次提醒 | 0/6 | 6/6 | 4/6 |

主提醒合计3/24、12/24、8/24；次提醒0/6、6/6、4/6。跨语言三个方向/类别合计0/18、11/18、6/18；中文情境描述依然薄弱，不能只展示6/6。

| 留出负例类别 | BM25错误提供 | dense错误提供 | hybrid错误提供 |
|---|---:|---:|---:|
| 明确不适用约束 | 6/6 | 2/6 | 6/6 |
| 相似词但不同任务 | 3/6 | 2/6 | 2/6 |
| 信息不足 | 0/6 | 1/6 | 1/6 |
| 语义/意图负例合计 | 9/18 | 5/18 | 9/18 |
| 过期资格探针 | 3/6 | 4/6 | 2/6 |
| 其他仓库资格探针 | 1/6 | 4/6 | 3/6 |

不合格目标已从候选库排除，但dense仍可能选择另一条不相关提醒，资格探针反而从4/12恶化到8/12；不能将“排除了目标”写成“拒选成功”。12条资格探针占全部负例40%，与18条语义负例分开报告。

留出门槛前Recall@3：BM25 43.3%、dense/hybrid 100%；MRR分别0.4451/0.9000/0.8667。它们计算完整合格排名，包含零分及ID同分排序，**不经过提供门槛**，不代表实际提供正确率100%。门槛后的正确数、误选与漏选以上表及逐条JSON为准。

## 重放、耗时与实际边界

[开发完整查询/分数/选择](retrieval-v3-development.json)、[首次留出完整查询/分数/选择](retrieval-v3-holdout.json)保留每条错误/漏选及所有合格候选。测试从公开向量重算完整网格、聚合、每条排名/提供/拒选，数值容差1e-12；CI无需下载模型。它验证评分重放，不能独立证明神经推理或真实任务收益。模型文件逐项核验后在本机CPU实际推理，可按复现说明另行复做。

每分区72段文本、9次batch forward；开发0.396秒，留出0.385秒，合计144段/18次forward，**付费API调用0**。这些单次本地推理耗时不含模型下载、依赖安装、模型加载，也不是线上延迟。首次留出60查询批量打分：BM2516.30ms、dense23.10ms、hybrid21.26ms；使用预计算向量，dense还计算了未使用的BM25诊断，不能当优化过的独立向量延迟或据此声称提速。未重复测量性能分位数。

可复现：`npm run retrieval:hybrid -- development` 与 `npm run retrieval:hybrid -- holdout`。无需Key，不读Store/profile；完整本地推理、锁文件、错误失效与缓存绑定见[说明](../../compat/retrieval-embedding/README.md)。检索质量与可执行来源验证、后续任务成功率、成本改善分别验收。下一步优先新困难负例/外部标签与拒选机制；是否接入默认DSH、做真实任务对照和发布包另行决定。

## English

120 new author-visible synthetic relevance queries cover12 families, with60 development and60 family-holdout queries,30 positives/30 negatives per split. Label rationales were frozen before implementation; a missing newline-protocol precondition was corrected after an independent AI audit and before scoring. This is not human blind annotation or downstream Agent evaluation.

Pinned local quantized multilingual MiniLM embeddings use384 dimensions, masked mean pooling, L2 normalization and7-decimal output. Development-only preregistered grid calibration selected dense(score≥0.5, margin≥0.025) and hybrid(lexical weight0.15, score≥0.4, margin≥0.1). Method/config/development decisions were committed before first holdout. A Windows LF-artifact correction occurred before holdout and preserved every vector value, grid metric and selected parameter. No holdout tuning occurred.

Holdout correct offers: BM25 3/30(10%), dense18/30(60%), hybrid12/30(40%). Wrong offers:18/60,16/60,18/60. Dense gains50 percentage points in positive offer recall but has only18 correct out of34 offers(52.9% precision). Semantic/intention negatives:9/18,5/18,9/18 wrong; eligibility probes:4/12,8/12,5/12 wrong. Cross-language positives:0/18,11/18,6/18 correct. Mixed retrieval is worse than dense here; default DSH remains BM25.

Pre-gate Recall@3/MRR include all eligible rankings and zero-score ties, not post-gate acceptance. Both full reports and public synthetic vectors support deterministic scoring replay without ML dependencies. Actual local inference processed144 texts in18 batch forwards, with0 paid API calls; no real task, source validity, financial improvement or production latency is established. The holdout is now spent.
