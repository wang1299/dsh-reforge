# T067：运行检查耗时与可解释性

[公开逐次测量](t067-20261109/benchmark.json) · [设计 ADR061](../decisions/061-runtime-inventory-concurrency-and-timing.md) · [任务与检查](../tasks/T067-runtime-guard-performance.md) · [真实任务基线](benefit-live-20261109.md)

2026-11-09在干净源码 **e96f425002d03de1cadbfc00b14e80b106c82cc4** 上实测。T065真实研究的trial阶段416.521秒中，guard为320.755秒；它暴露了运行清单逐项等待的开销。本轮改为最多16个活动walk，保留每个独立路径的实际位置、身份、时间/大小、链接和关键内容检查；每次重新读取，不缓存上次通过结果。

## 同一环境的实际数字

Windows x64、Node24.19.0、默认4线程FS池。每种方法先预热，随后交替执行5对；表中是**清单元数据＋关键文件字节核对**的观测中位数。串行oracle的源码来自55d7089，原文SHA256为`2b3024b4183153fa282dbf759a3422a5ecd43e68a6fc4a6c619c6cf94dcbaa3d`，不是用新实现模拟旧耗时。

| 检查对象 | 条目／文件 | 关键文件 | 串行P50 | 并发P50 | 中位数减少 |
|---|---:|---:|---:|---:|---:|
| 1000文件合成树 | 1021／1000 | 1 | 287.06ms | 119.96ms | 58.2% |
| 10000文件合成树 | 10201／10000 | 1 | 3082.57ms | 1316.58ms | 57.3% |
| 当前公开Node运行闭包 | 14520／13532 | 160 | 5546.97ms | 2845.58ms | **48.7%** |

公开Node闭包246486400字节，包含跟踪源码、编译文件、Node依赖和Node可执行文件；**不包含Python、vendor、候选包、来源库或整个OS**，不是完整live计划。逐次数据和观测最大值都公开，未只挑最快一次：该组串行最大5622.33ms、并发最大2898.79ms。仅metadata的辅助测量为4639.98→1889.67ms；生产仍核对关键字节，不能用这一省略hash的数字代替上表。

三种对象的新旧完整manifest（路径、group、身份、摘要及边界）在本机同次运行中均一致，full-byte核对也均通过。完整hash仅另测一对，不能当分布或端到端加速。绝对路径、文件系统身份、私人配置和模型原文不公开。

## 能用于什么结论

可以说明：在这台机器、上述公开闭包和5对预热检查中，在相同独立路径/关键字节核对条件下，单次检查P50降低48.7%。这是一项有对照的工程性能结果。

不能说明：整场T065从416秒变成多少秒、纯模型推理变快、费用减少、经验使成功率提高，或其他机器/平台有相同收益。T065仍是三组均10/12、0个百分点改善。不同CI运行的耗时也不是受控A/B对照。

## 如何重跑

从所要测量的源码提交建立干净工作区，使用Node24.19.0和固定lock，先安装与编译，再运行：

```powershell
npm ci --ignore-scripts
npm run build
npm run study:freeze-benchmark
```

仅在仓库自己的`.probe-work/t067-freeze-benchmark/run-*`新建合成文件和本机JSON；不读旧profile/Key、不操作预算账本、不调用模型。运行时不要同时编译、改源码或依赖。结果记录实际源码提交、dirty状态、条目/字节与所有观测；不同环境应产生自己的记录，不覆盖本次数字。此开发命令不随公开alpha.2提供。

## 结果页怎样说明等待

源码工作台的“效果对照”新增默认折叠的“时间花在哪里”：显示试验阶段总时间，以及运行检查、请求至完整响应、其余流程的秒数与比例。安装、准备及启动前核对未计入。请求边界包括网络和完整响应接收，不能标为纯推理；其余流程不猜测组成。旧报告缺完整计时会明示未知，清除时移除投影。仍只在本页内存读取，不上传、授权或重放。

## English

On clean source `e96f425002d03de1cadbfc00b14e80b106c82cc4`, five warm alternating pairs compared an immutable serial oracle with a maximum16-walk queue on Windows x64 / Node24.19.0 (default FS pool4). For the14520-entry /246486400-byte public Node closure with160 critical files, metadata plus critical-byte verification P50 fell from5546.97ms to2845.58ms (**48.7%**). Observed maxima were5622.33/2898.79ms. All three fixture/runtime manifests matched exactly within the run and full-byte checks passed; public per-observation data accompanies the report.

The closure excludes Python, vendor, candidate, source bank and OS. This is a small local filesystem benchmark, not end-to-end study speed, pure inference latency, cost savings or memory-quality improvement. The original real-model baseline remains10/12 in every arm. Production still re-reads paths/metadata and verifies critical bytes; metadata-only measurements are profiling controls. Timing disclosure in the unpublished workbench separates guard, request-to-complete-response and other protocol time, with missing timing explicitly unknown. No paid calls or old authorization reuse.
