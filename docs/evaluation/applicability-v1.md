# 三态适用性门槛：减少误选，同时保留拒选代价

[文档导航](../index.md) · [ADR051](../decisions/051-evidence-bound-applicability.md) · [复现与接口](../../compat/applicability/README.md) · [T057](../tasks/T057-applicability-gate.md) · [English](#english)

2026-11-06。本轮新增来源绑定的任务事实、经验适用/排除条件及三态判断，保持默认DSH/SQLitev9/旧数据/授权不变。**作者提供的正确结构化事实是额外信息，不是从自然语言自动提取，也不证明运行行为真实。下面是合成离线结果，不是实际Agent任务收益或已发行功能。**

## 冻结与数据

- ADR先于实现提交f4336fa；67c1f5f初始96查询。独立只读AI预审发现候选游标分页与旧T053重复，在任何新数据推理/评分/核心实现前8b9e506替换相关留出候选，6d02bfa进一步收窄HTML为惰性普通属性、澄清张量轴并删除位掩码多余前提。最终语料SHA256 `9946016730fc0c054b9ffaeb282d06854ba552a15cefd60ab9fc1b662d0ee3aa`。
- 8族、16提醒、96查询、104合成来源；开发/留出各4族、8提醒、48查询、24正24负。开发包含已见的重试/原子文件/JSON空值领域条件化扩展；留出为SQL左连接、张量行列归一化、位标志、惰性HTML属性/文本上下文。作者可见、不是外部人工盲测或与预训练知识隔离。
- 每族5条主提醒正例、1条中文次提醒正例；保留缺关键契约事实但语义相关的正例。负例包含单事实翻转、信息不足、相同事实但不同意图、证据冲突/过期、无适用候选。模板与事实重复带来关联性，不能按独立真实用户样本外推统计结论。
- 同文字literal/hard_contradiction配对只翻转一个事实；它们复用完全相同向量。纯向量因此无法区分这一受控对照，必须用纯条件消融隔离额外信息优势，不能拿配对改善宣传语义模型变强。
- 数据/设计与31b5c38核心代码两阶段独立AI审查通过（7项纯测试，额外畸形输入探针）；75690fa干净源码生成固定方法清单，99a881f冻结清单/开发向量，4c2cf06保存并公开完整开发结果。没有调参；阈值0.5/间隔0.025直接沿用T056，topK3预登记。
- 开发公开后才生成留出向量；a07f48c1f2ffc33b751aab170258c66b7b9532df干净源码执行首次留出，f00cf4f完整保存。此后不改方法/阈值/模型/数据；这批留出已使用。

## 判断边界与三个消融

有限JSON任务契约通过命名空间/任务/修订/相对路径/SHA256、UTF-8/格式/重复字段/大小检查后提供标量事实。条件全确认且没有排除条件才为applicable；已知矛盾为not_applicable；缺失、冲突、来源过期/无效为insufficient_information。来源完整性错误使整包失效，没有跨请求事实缓存。只证明值来自指定契约，不授予调用者/模型真实性认证；端口与契约提供者仍是信任边界。

1. **dense_only**：原本地MiniLM余弦、固定原门槛，不读取任务事实或条件。
2. **contracts_only**：检查完整8条库，恰好一条条件全确认时提供，其余可以未知；多条/零条已确认则拒选。没有相关性排序，不能判断用户意图。
3. **dense_top3_contracts**：仅在召回前3条中选择已确认适用项；更高排名未知则拒选，已确认不适用可跳过。仍比较原排名下一项（含未知或第4项），不能通过删竞争项放大分差。

状态针对检查范围而非所有可能经验。dense-only的applicable只表示分数通过。两分区门槛臂最终选择状态均没有not_applicable项（开发10适用/38信息不足，留出13/35）；因为未确认的跨领域候选使整体保守返回信息不足，不能将其说成已证明全库不适用。候选级矛盾仍逐项保留，not_applicable路径另由纯单测覆盖。比较运行共享来源和条件投影以供三个消融，不据此声称独立服务时延提升。

## 完整结果

| 分区/方法 | 正例正确提供 | 错误提供/全部查询 | 提供精确率 | 拒选/全部 |
|---|---:|---:|---:|---:|
| 开发dense | 8/24 | 16/48 | 8/24（33.3%） | 24/48 |
| 开发纯条件 | 20/24 | 4/48 | 20/24（83.3%） | 24/48 |
| 开发dense+条件 | 10/24 | 0/48 | 10/10（100%） | 38/48 |
| 留出dense | 11/24（45.8%） | 13/48 | 11/24（45.8%） | 24/48 |
| 留出纯条件 | 20/24（83.3%） | 4/48 | 20/24（83.3%） | 24/48 |
| 留出dense+条件 | 12/24（50.0%） | 1/48 | 12/13（92.3%） | 35/48 |

留出错误提供13→1，提供精确率45.8%→92.3%；这并不表示全部原正确项都保住：**原11项保留9项、丢2项，另补回3项，净增加1项**。覆盖率从24/48（50%）降到13/48（27.1%）；12/24正例仍未正确提供。不能只展示高精确率而隐藏拒选及漏选。

| 留出正例（各4条） | dense正确 | 纯条件正确 | dense+条件正确 |
|---|---:|---:|---:|
| 英文直接描述 | 2 | 4 | 2 |
| 中文描述 | 1 | 4 | 3 |
| 英文改述 | 1 | 4 | 1 |
| 英文→中文次提醒 | 3 | 4 | 4 |
| 相关但缺契约关键事实 | 2 | 0 | 0 |
| 低词面重合 | 2 | 4 | 2 |

两个失去的原正确提供都来自缺事实正例；门槛没有将它们改标负例以美化数字。纯条件正确更多，说明结构化信息本身贡献很大；它在相同事实/不同意图的4条负例上全部误选。

| 留出负例 | dense错误 | 纯条件错误 | dense+条件错误 |
|---|---:|---:|---:|
| 单事实矛盾 | 2/4 | 0/4 | 0/4 |
| 信息不足 | 0/4 | 0/4 | 0/4 |
| 事实匹配但仅改UI文字/图标 | 1/4 | 4/4 | 1/4 |
| 无适用候选 | 3/4 | 0/4 | 0/4 |
| 上述意图/条件负例合计 | 6/16 | 4/16 | 1/16 |
| 证据冲突 | 2/4 | 0/4 | 0/4 |
| 证据摘要过期 | 1/4 | 0/4 | 0/4 |
| 证据探针合计（独立报告） | 3/8 | 0/8 | 0/8 |

dense额外4次错误是正例选错提醒；门槛消除了这4次及8次负例误选，仍留下 `sql-join-preservation-irrelevant_same_facts`：只想改查询构建器的展示文字，却提供了SQL连接建议。可见条件成立仍不等于当前意图需要这条经验。单事实配对完整通过数分别0/4、4/4、2/4；另2对门槛没选错负例，但对应正例因检索/置信规则仍漏选。

## 重放与实际计算

[开发全部结果](applicability-v1-development.json)、[首次留出全部结果](applicability-v1-holdout.json)保留所有分数、条件状态、引用、提供/拒绝和失败；[固定方法](../../compat/applicability/method.json)绑定源码/数据/模型/策略。公开合成向量支持无ML依赖重算全部结果；标签/类别/理由/配对标识更改不影响决策的测试另外防止答案泄漏。CI重放不独立证明神经推理来源或用户任务收益。

实际本地CPU推理每区52段不同文字/56向量条目/7次batch forward；开发0.370秒、留出0.355秒，合计104段/112条目/14次forward、**付费API0**。复用固定模型资产、未下载新模型；时间不含模型/依赖准备与加载，是单次合成批次，不是线上延迟或性能分位数。本轮未测服务端到端时延、自然语言提取、真实用户误用或Agent任务成功率。

复现：`npm run retrieval:applicability -- development` / `holdout`。新原型未接默认DSH或公开npm，不改旧数据/授权。下一步是独立任务契约获取与意图验证，在新标注/新留出上测数据不足时的提问/拒选代价，再决定是否接入产品。

## English

96 author-visible synthetic queries cover8 families, with48 queries/24 positives per split and104 authored contract sources. Independent pre-scoring AI review replaced a reused cursor family, narrowed HTML to inert quoted attributes and clarified conditions before any new inference or core implementation. Development retains some known domains; the new holdout uses SQL joins, tensor axes, bit flags and inert HTML contexts. This is not human blind annotation.

Task facts are extra authored structured information, not natural-language extraction or proof of real behavior. Three fixed arms compare dense-only, unique-confirmed contracts-only and dense-top3+contracts, preserving original score/margin thresholds and higher unknown competitors. Same-text counterfactuals deliberately differ in one supplied fact and reuse identical vectors; dense cannot distinguish them. Method/development were committed and pushed before first holdout; no retuning occurred.

Holdout correct offers:11/24,20/24,12/24; wrong offers:13/48,4/48,1/48. Gated precision rises45.8%→92.3%, but coverage falls50%→27.1%. It retains9/11 prior correct offers, loses2 missing-fact positives and recovers3 other positives.12/24 positives still miss. Contract-only's4 errors are matching-fact/wrong-intent cases; the gate retains1 such error. Intent/condition negatives:6/16→1/16 wrong; evidence probes:3/8→0/8, reported separately. Pair success:0/4,4/4,2/4. These cannot establish general semantic or downstream Agent benefit.

Both full reports and public synthetic vectors support deterministic scoring/evidence replay without neural dependencies. Actual local inference processes104 unique texts into112 entries in14 batch forwards, with0 paid API calls. The default DSH policy, SQLite, existing data/budgets/grants and public package remain unchanged. This holdout is spent.
