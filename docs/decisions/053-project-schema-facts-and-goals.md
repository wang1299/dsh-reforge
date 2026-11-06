# ADR053：工程Schema事实获取与明确目标检查

2026-11-06，T059，[Issue #131](https://github.com/wang1299/dsh-reforge/issues/131)，基线main `284e5b397063112ba0a56eb169b140d982d65971`。属于持续的用户体验/实际效果双线，不能用本轮离线结果替代最终真实任务收益。

## 问题与来源

T057的事实由作者填写，48条留出仅正确提供12/24正例，原正确丢失2条；同事实但不同目标仍误选1条。需要分别检验从工程获取事实的可靠性/覆盖，以及明确目标这一额外输入的贡献。T056/T057已用数据和方法保持冻结，不再改写并称为新留出。

依据官方[JSON Schema对象/required/null](https://json-schema.org/understanding-json-schema/reference/object)、[注解/default](https://json-schema.org/understanding-json-schema/reference/annotations)、[Ajv方言](https://ajv.js.org/json-schema.html)及[数据修改选项](https://ajv.js.org/guide/modifying-data.html)。Schema只声明合法输入，不证明程序实现遵守它；可选字段不能推出保留旧值，default不能推出标准校验会补值，目标输入不能冒充自动自然语言理解。

## 新接口与信任边界

新模块与冻结旧模块分离，不改默认DSH/SQLite v9/旧经验/授权/预算。调用者明确给出工程根、相对Schema路径、目标属性和任务身份/修订；读取端口返回新读到的文件字节，核对namespace/taskId/revision/path/SHA256。只接受一个<=8192字节的UTF-8无重复键JSON；路径必须为非隐藏、非敏感命名的`.schema.json`，拒绝越界、符号链接/junction、非普通文件和多硬链接。不执行源文件，不读profile/环境凭据，不进行网络引用解析，不缓存跨请求事实；端口/工程根/调用者仍是信任边界，不宣称可抵御主动并发改写目录的本机攻击者。

首版支持显式draft-07、根object、1–32个已声明属性、唯一required列表和布尔additionalProperties。属性支持标准type或唯一type数组，根/属性仅另允许有限title/description/default注解；所有属性均验证该有限格式。不支持ref/composition/enum/const/条件/范围/嵌套约束/未知关键字或其他方言，整份投影保持unknown，不能静默忽略它们。required须指向已声明属性。支持范围是预先声明的工程子集，不是完整JSON Schema实现。

输出3项事实及有界引用：`field_required`、`field_nullable`、`field_type`（非null声明类型：单一类型本名、无非null类型为null、多种为union）。类型分类仅描述声明，不声称任意值必然通过校验；不导出缺失值/默认/强转行为。事实引用含相对路径/摘要/属性和JSON pointer；不回传原始Schema、title/description/default值或绝对路径。无效/过期来源使整包失效，不能沿用部分旧事实。

新的实验经验明确声明targetProperty、旧式有限条件和allowedGoals；目标为显式owner输入的validate_payload/change_contract/present_ui/generate_docs之一，并绑定相同任务身份与修订。缺失/未知/不匹配的身份不当成已确认目标；不从自然语言或模型自报补目标。程序调用方负责保证此输入确实来自owner，本轮CLI只能证明参数显式给入，不能授予真实性认证。目标检查单独报告，不能将owner目标指向Schema来伪造来源。旧经验没有这些元数据，不能自动补齐或迁移。

## 预登记对照

先提交新作者可见合成数据，再独立只读审查标签/边界，之后冻结方法才评分。实际时序：数据ce22567冻结后，有限投影核心开发与独立标签审查并行；审查在方法冻结及任何检索评分/向量推理前完成，未据评分修标签。96查询：8个不同工程Schema工件，开发/工件留出各4个，每工件12条（6正6负）；不是未见JSON空值问题族、外部盲测或独立真实用户样本。每组含直接/中文/次经验/低重合、不支持但语义相关正例、缺明确目标正例，以及单事实反例、UI目标、缺来源、过期摘要、受enum约束的负例、文档目标。反事实同文字复用同一向量。各来源为新合成字节，工件/属性名称跨分区分离；模板和领域重复如实披露。标签和人工参考事实不进入自动方法。

五臂共享同一文本候选排序/原dense门槛0.5、间隔0.025、top3，不调整新阈值：dense_only、manual_facts、auto_facts、auto_facts_goal、manual_facts_goal。后四臂额外得到显式目标属性身份；人工臂得到作者事实，自动臂从绑定工件获取，带goal两臂才使用显式目标。manual/auto对比固定其他信息，auto/auto+goal隔离额外目标输入，manual+goal显示支持边界损失。候选筛选和门槛沿用旧纯函数，不改旧源码，不用标签重排或搜索第4位补答案。

所有事实臂共享来源可用/身份/修订/字节摘要/有界JSON完整性门槛；manual只在共同门槛通过后使用经独立oracle核对的作者事实，不能绕过missing/stale。原始Schema不在支持子集但共同完整性成立时，manual可使用额外解释，auto保持未知。missing/stale单列完整性探针，不混作语义不相关。每个controlled pairId有literal/single_fact_negative/ui_goal三项，分别报告literal→事实翻转和literal→目标翻转；不能套两项配对口径或将额外输入优势叫语义改善。

独立Ajv固定开发依赖验证工件、输入省略/null与类型探针，关闭useDefaults/coerceTypes/removeAdditional，无loadSchema/自定义关键字；它不是运行路径依赖。对3事实区分两项行为校验与声明类型检查，保留所有unsupported及无效来源分母。新数据/源码/策略/模型/固定向量摘要绑定，先公开开发结果再首次运行留出；不据留出修方法。复用固定本地ONNX模型，仅本地推理，付费API0。

报告每臂正确/错误提供、漏选、拒选、覆盖、precision、原正确保留/丢失/新增；自动事实的支持率、各事实一致率、未知原因和来源探针单列。数据中缺目标正例的损失必须保留。字段/文件/目标仍由调用者提供，不能将减少手写事实项说成零配置或真人省时。若没有改善，保留实际结果。

## 交付和后续

可运行源码入口提供真实文件读取、事实/来源/未知/需补信息的有界展示，不回传原文、不写原工程，不调用模型。首轮CLI/静态检查报告用于验证输入流程；正常DSH自动获得目标、旧经验条件编写及默认选择接入仍需产品验收与另行ADR，不能把离线原型说成已在正常对话生效。T058的现有工作台/Tabler保持，后续将同一投影解释接入owner操作界面，而非增加难读的手写JSON。

要求针对测试、全check/compat、Windows/Linux两宿主矩阵、独立稳定SHA审查及文档后合并。不发布包/Release/部署，不重开旧10元试验。最终真实任务三组成功率/返工/时间/费用实验另作预登记与新费用授权，持续目标保持开放。
