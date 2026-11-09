# 阅读本机效果对照

[真实基线](benefit-live-20261109.md) · [研究命令与权限](authorized-benefit-study.md) · [设计 ADR060](../decisions/060-actionable-study-feedback-and-report.md) · [实际检查](../tasks/T066-actionable-study-feedback.md)

此功能在T066未发行源码中提供，公开alpha.2不包含这一增量。编译源码后打开现有工作台，选择“效果对照”，再选择本机研究生成的`study-result.json`。同一页面适用于独立面板和原生DSH插件页。

读取文件不需要模型Key或新预算；不上传文件、不写入产品数据库，不授权或重放任何任务。仅接受最大1MiB、schema1、live/fixture研究结果，并核对行、固定分母和用于显示的汇总一致性。不支持旧的脚本演练报告或plan文件。文件标记不证明其来源；**结构核对不等于独立复核原始测试、账本或服务商账单**。关闭或“清除本页报告”会移除内存中的投影。

源码T069增加“查看合成示例”：没有报告文件时，也可先了解流程、验收、费用的阅读顺序。示例刻意保留失败、一次未知和未尝试，数据、请求数、金额与计时均为预制；未读取本机研究、运行任务或产生费用。它不是T065的真实结果，也不是用户账户预算；示例中的准入诊断不解释历史模型输出。

打开示例会替换当前投影，先前未完成的文件读取不能迟到覆盖它。导入自己的JSON会恢复“本机文件”标识和结构核验说明；文件即使自称“示例”也不会变成内置示例。清除后移除本页报告、金额、计时和筛选，并将键盘焦点交还对应入口。公开alpha.2尚不包含这些源码增量；实际核对见[T069](../tasks/T069-report-first-run.md)及关联PR。

按这个顺序看：

1. **研究流程**：记录了多少计划任务，是否完整结束。流程完成也可以有已知失败。
2. **任务验收**：通过多少固定检查。模型自述、正常响应或代码准入通过都不能替代验收。
3. **费用**：峰值单价费用上界、完整响应及未知预留；夹具金额始终标明模拟，不作为真实成本或节省。
4. **三组比较**：每组固定12项，首轮/最终通过、返工/请求、提供参考和费用分列。通过率差是这批小样本的描述，不是泛化结论。
5. **同题配对**：按任务和重复并排查看，筛选含失败、未知或未尝试的行。展开“查看检查过程”，区分输出格式、代码准入、测试失败和基础设施未知。旧记录没有准入诊断时明确显示无法追溯，不推测原因。

T067增加折叠的“时间花在哪里”：试验阶段总时间、运行检查、请求至完整响应、其余流程分别显示秒数和比例；安装、准备和启动前核对未计入。它不是纯模型推理计时；缺少完整字段时显示未知，不按调用次数推算。相关工程测量见[运行检查性能](runtime-freeze-performance.md)。

新版本只在已知拒绝后的原有第二轮中补规则枚举和静态允许子集；准入白名单、首轮输入、固定验收和两轮上限保持。它改变了未来反馈条件，所以必须以新冻结计划研究，不能给旧结果补造诊断或复用旧10元许可。

## English

T069 adds **查看合成示例** (View synthetic example) to the source workbench. No local report is needed. Its incomplete states, one unknown hold, requests, amounts and timing are predefined teaching data; it reads no private study and performs no task or paid call. It is not T065 evidence or an account ledger. Example diagnostics do not reconstruct historical model syntax. Switching to the example invalidates pending reads; importing JSON restores file provenance and cannot impersonate the built-in example. Clear removes the projection and returns focus to its entry. These source additions are absent from public alpha.2; actual verification is recorded in the [T069 task and PR](../tasks/T069-report-first-run.md).

T067 adds a collapsed timing breakdown for the trial stage: guard checks, request-to-complete-response and other protocol time, with seconds and proportions. Installation, preparation and pre-launch checks are excluded. Missing timing stays unknown; request-boundary time is not pure model inference. See the separate [guard performance benchmark](runtime-freeze-performance.md#english).

In the unpublished T066 workbench, open **效果对照** and select a locally generated `study-result.json` (schema1, live/fixture, up to1MiB). This works in standalone and native panels. The browser keeps an allowlisted projection in page memory without uploads, database writes, grants, execution or paid requests. Clear or close the page to remove it.

Read protocol completion, task acceptance and cost separately. Compare fixed12-trial arm denominators, first/final acceptance, rework, references and peak cost upper bounds. Filter matched task/repetition rows for failure, unknown or unattempted outcomes, then expand the attempt details. Legacy admission failures have no recorded reason; no reason is inferred retroactively. Imported scope labels and structural consistency are not independently verified provenance, execution, ledger settlement or invoices. Fixture amounts are simulated. Future diagnostic feedback interventions need a new frozen plan and explicit funding scope.
