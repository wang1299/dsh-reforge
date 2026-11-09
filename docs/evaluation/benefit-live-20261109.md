# T065：首次真实三组研究结果

[研究入口](authorized-benefit-study.md) · [冻结题目与方法](benefit-preparation-v1.md) · [PR #144](https://github.com/wang1299/dsh-reforge/pull/144) · [后续改进 #145](https://github.com/wang1299/dsh-reforge/issues/145)

2026-11-09，本机在源码 **e069a437bff9187c91c7d6f0fd37779a24962d90**、一次明确批准的10元上限内完成真实调用。冻结的6类作者可见合成任务、三组、各两次重复，共36个独立会话；每项最多两轮。普通检索和Reforge使用相同来源库，未根据结果换题、改验收或回写经验。

| 指标 | 无经验 | 普通检索 | Reforge |
|---|---:|---:|---:|
| 首轮通过 | 10/12 | 10/12 | 10/12 |
| 最终通过 | 10/12 | 10/12 | 10/12 |
| 返工尝试 | 2 | 2 | 2 |
| 实际请求 | 14 | 14 | 14 |
| 提供参考的任务 | 0/12 | 12/12 | 10/12 |
| 输入token（含缓存） | 3436 | 4792 | 4592 |
| 输出token | 1134 | 1119 | 1126 |
| 峰值单价费用上界（元） | 0.015944 | 0.018536 | 0.018192 |

本次**未观察到通过率或返工改善**，两种检索相对无经验的通过率差均为0个百分点。参考确实被提供，并不证明被采用或导致结果。成本上界均高于无经验；不能在简历中将这次实验写为成功率提升或费用节省。

## 流程、验收、费用分别核对

- 流程：36/36结果记录，42次真实provider请求、42份完整响应及42份完整用量，夹具请求0；没有未知或未尝试任务。独立只读审查复算了会话、请求、账本占额顺序与摘要，不是GitHub正式批准。
- 验收：30项接受的函数摘要与保留提案匹配，30份实际测试XML中60个用例通过。另6项均为`delivery_batch`，三组各2项；12次尝试均在AST准入阶段拒绝，未执行生成代码。旧记录只保留`invalid_code`，没有具体拒绝语法，不能把它解释为某种已知语义错误。
- 费用：总输入12820、输出3379token；按本计划冻结的峰值输入2/输出8元每百万token（缓存也按非缓存上界）计算，共52672微元，即**0.052672元上界**，未知预留0。账本completed。没有独立核对服务商发票或钱包扣费；此金额不能写成实际账单。剩余额度不是另一项研究的许可。

全部15148个冻结条目、269764754字节在结束核对与独立只读核对中匹配，来源经验库及Git/验收未改变。候选包SHA256为`06dab16800f13022a7b0e2f396b36046e29e5edb47cc588d6056908d16d2898e`，是未发行本机源码候选，不能当作npm上同版本号包的新结果。原始本机报告、占额、提案和XML继续保留；不公开私人路径、会话、授权或模型原文。

trial阶段耗时416.521秒，其中guard320.755秒、provider边界49.500秒；后者包括请求和完整响应，不等于纯推理时间。它与此前71次夹具请求的演练条件不同，不能相减宣称提速。

## 结论的范围与下一步

6类作者可见合成任务、每类2次重复，不是盲测、外部用户或真实仓库泛化。模型别名和温度0也不能固定服务商内部权重。当前结果反映了原受限准入与原反馈条件；不能删除失败或追溯补造诊断。

T066新增诊断和只读结果页的设计见[ADR060](../decisions/060-actionable-study-feedback-and-report.md)。后续若验证第二轮反馈干预，需要形成新的冻结方案、明确与本基线不同的实验条件，并重新批准具体预算。工程测试和模拟结果不冒充新模型结果。

## English

The first real study ran on source commit `e069a437bff9187c91c7d6f0fd37779a24962d90` on November 9, 2026 under a separately approved CNY10 ceiling. Six author-visible synthetic tasks, three arms and two repetitions produced36 distinct sessions and42 actual provider requests, with no fixture requests or unknown trials.

All arms achieved10/12 first and final acceptance with two rework attempts each: **zero percentage-point improvement and no observed rework benefit**. References were provided in0/12/10 trials. All six `delivery_batch` trials failed AST admission in both rounds without executing generated code; historical records do not identify the offending syntax. Thirty admitted proposals matched their stored hashes and passed60 actual pytest cases.

Total input/output was12820/3379 tokens. Peak uncached-price accounting gives a conservative CNY0.052672 upper bound, with zero unknown reservations; this is **not a verified invoice**. The ledger completed and the frozen runtime/source bank matched independent read-only review. Unused allowance is not permission for another experiment. The unpublished local candidate and CI fixtures must not be presented as the public npm artifact or additional real-model evidence. A new feedback intervention needs a new frozen plan and explicit spending scope.
