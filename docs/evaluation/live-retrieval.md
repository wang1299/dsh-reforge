# 实际检索路径与选择依据

[文档导航](../index.md) · [设计](../decisions/048-live-retrieval-index-and-diagnostics.md)、[请求内读取](../decisions/049-request-local-scope-read.md) · [任务](../tasks/T055-live-retrieval.md) · [English](#english)

2026-11-06源码工具，尚未发行。普通DSH和自动学习使用的 `EvolveService.select` 已接入相同BM25规则的索引复用；实验 `strategy-v2` 仍只离线。每次先重新核对来源/引用、仓库、代码、依赖与反馈，再决定是否复用索引。修改、停用、恢复或外部数据库更新不会沿用不合格经验。

工作台“参考记录”显示最近8次选择，每次最多5条候选，提供版本、命中字段和固定拒绝原因；评分和耗时在技术详情中。只保留本次服务实例的有界内存记录，重启清空；页面读取不会选择、写入应用、提炼或重跑。选中不等于送达模型、被采用或改善结果。

缓存单服务单快照，最多1万文档/2MiB输入，超限使用原版完整检索。资格变化重建或清空；不缓存来源资格与反馈效用。SQLite v9、原财务账本、未知占额与授权均保持。

同一次同步选择共用任务归属检查刚读取的仓库/依赖快照，按路径读取、校验条件文件并复用本次哈希；一个缺失路径只影响依赖它的经验。下一次选择创建全新的读取器，绝不跨请求缓存资格。这不是文件系统原子快照，不能防止外部进程在检查之后修改文件。

## 可复现测量

```powershell
npm ci --ignore-scripts
npm run retrieval:live-benchmark
```

命令只在本仓库 `.probe-work/t054-live-benchmark`（历史工作目录名）创建新合成Git/SQLite工程，实际pytest验证一个来源修复。1条/10条文本变体共享此来源，不是10个独立策略；每方法独立相同库，1次冷请求、2轮×8查询交错测量，三组轮换且第二轮反转执行顺序。记录完整 `service.select` 外部耗时（含Git/资格/SQLite/应用写入及解释），不含任务创建、面板序列化、模型与网络；原版构建包括在查询时间。保留全部原始样本、实际选择/分数一致性与环境，不断言完整链路一定加速。

## 首次实际结果与证据范围

首版索引单独接入的[全部原始结果](t055-index-only-20261106.json)保留：1条P50 292.41→291.05ms，10条1476.96→1491.26ms，几乎没有整体收益。没有将纯文本微基准当成实际请求提速。

据此先提交ADR049，再提交三组方法/源码 `15a319342f2c73896baf395d42d0aff68a79527a`，干净工作树运行，[全部冷请求、102次选择、分阶段时间与原始样本](t055-live-20261106.json)公开；没有据结果换查询、删慢样本或重跑选最好一次。Windows x64、Node24.19.0、AMD Ryzen9 7945HX，本机单次测量，模型调用0。

| 合成经验数 | 原版P50/P95 | 仅索引复用P50 | 索引＋请求内读取P50/P95 | P50下降 |
|---|---:|---:|---:|---:|
| 1 | 283.65 / 340.08ms | 286.86ms | 151.57 / 192.82ms | 46.56% |
| 10 | 1556.79 / 1709.98ms | 1542.89ms | 142.96 / 171.28ms | 90.82% |

102次服务选择的经验/版本、分数与拒绝原因均逐项相同。优化组每个规模16次重复查询都命中相同合格库索引；仓库快照调用数（含任务归属）从1条的2次、10条的11次均变为1次，相同条件路径本次检查1次。减少的是同请求重复读取，不是跳过资格。一次测量中10条比1条稍快属于时序/调度噪声，不能解释为规模越大越快。

这些是同一个合成修复文本变体上的工程延迟，不是线上用户分布、10个独立策略、模型响应速度、任务成功率或费用改善。每组16个重复样本不足以给出稳定尾延迟或统计显著性。冷请求单独保留在JSON，不将首次建索引成本藏进热查询均值；`timings.totalMs`在加入有界内存说明前截取，外部 `wallMs` 还包括此开销，表格使用后者。[T053微基准](retrieval-v2.md)的13.44倍属于1万条固定库纯文本重复查询，与本页分开。

## English

Unreleased source integrates exactly equivalent BM25 indexing into actual `EvolveService.select`. Evidence/provenance/status/scope/feedback are checked afresh on every request. Only within one synchronous selection is its fresh repository/dependency view and per-path condition hash reused; this is not an atomic filesystem snapshot. Cross-request cache retains only an unchanged eligible text index. SQLitev9 and financial authorization are unchanged.

The authenticated workbench shows up to8 process-local decisions with5 candidate explanations each,24KiB total limit, no full queries/config/paths. Reading does not select, persist or call models. Selection is separate from provider delivery, adoption and benefit. Restarting the service clears these diagnostics.

An initial index-only full-chain experiment showed negligible/negative change and is retained. After ADR049, three-arm source15a3193 was committed before measurement. One cold and16 interleaved repeated selections per arm/size: legacy per-experience scope reads, index-only reuse, and index plus request-local reads. All102 decisions/scores/reasons match;0 model calls. Local Windows/Node24 repeated-query P50:1 record283.65→151.57ms;10 variants1556.79→142.96ms, with index-only1542.89ms. Full cold samples and P95 are retained. One synthetic repair and16 repeated observations do not establish production tail latency, model quality, task success or financial savings.
