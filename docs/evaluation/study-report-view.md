# 阅读本机效果对照

[真实基线](benefit-live-20261109.md) · [研究命令与权限](authorized-benefit-study.md) · [设计 ADR060](../decisions/060-actionable-study-feedback-and-report.md) · [实际检查](../tasks/T066-actionable-study-feedback.md)

此功能在T066未发行源码中提供，公开alpha.2不包含这一增量。编译源码后打开现有工作台，选择“效果对照”，再选择本机研究生成的`study-result.json`。同一页面适用于独立面板和原生DSH插件页。

读取文件不需要模型Key或新预算；不上传文件、不写入产品数据库，不授权或重放任何任务。仅接受最大1MiB、schema1、live/fixture研究结果，并核对行、固定分母和用于显示的汇总一致性。不支持旧的脚本演练报告或plan文件。文件标记不证明其来源；**结构核对不等于独立复核原始测试、账本或服务商账单**。关闭或“清除本页报告”会移除内存中的投影。

按这个顺序看：

1. **研究流程**：记录了多少计划任务，是否完整结束。流程完成也可以有已知失败。
2. **任务验收**：通过多少固定检查。模型自述、正常响应或代码准入通过都不能替代验收。
3. **费用**：峰值单价费用上界、完整响应及未知预留；夹具金额始终标明模拟，不作为真实成本或节省。
4. **三组比较**：每组固定12项，首轮/最终通过、返工/请求、提供参考和费用分列。通过率差是这批小样本的描述，不是泛化结论。
5. **同题配对**：按任务和重复并排查看，筛选含失败、未知或未尝试的行。展开“查看检查过程”，区分输出格式、代码准入、测试失败和基础设施未知。旧记录没有准入诊断时明确显示无法追溯，不推测原因。

新版本只在已知拒绝后的原有第二轮中补规则枚举和静态允许子集；准入白名单、首轮输入、固定验收和两轮上限保持。它改变了未来反馈条件，所以必须以新冻结计划研究，不能给旧结果补造诊断或复用旧10元许可。

## English

In the unpublished T066 workbench, open **效果对照** and select a locally generated `study-result.json` (schema1, live/fixture, up to1MiB). This works in standalone and native panels. The browser keeps an allowlisted projection in page memory without uploads, database writes, grants, execution or paid requests. Clear or close the page to remove it.

Read protocol completion, task acceptance and cost separately. Compare fixed12-trial arm denominators, first/final acceptance, rework, references and peak cost upper bounds. Filter matched task/repetition rows for failure, unknown or unattempted outcomes, then expand the attempt details. Legacy admission failures have no recorded reason; no reason is inferred retroactively. Imported scope labels and structural consistency are not independently verified provenance, execution, ledger settlement or invoices. Fixture amounts are simulated. Future diagnostic feedback interventions need a new frozen plan and explicit funding scope.
