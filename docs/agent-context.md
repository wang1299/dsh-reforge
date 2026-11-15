# Agent 经验上下文编译（开发分支，尚未发行）

DSH负责AgentLoop、工具运行与模型路由；Reforge负责经验的来源资格、适用性和提供内容。本模块将已通过原选择器的唯一经验编译成有来源、有字节上限的模型参考。实现见[ADR063](decisions/063-agent-context-compiler.md)，零费用对照方法见[冻结方法](evaluation/context-packing-v1-method.md)。

**实验限制：**[首次冻结对照](evaluation/context-packing-v1.md)中MMR未胜过源顺序，相关facet为16/36 vs18/36，无关事实2条vs0条。不建议根据本次合成数据替换既有默认策略；本功能保留为开发分支显式实验选项。字节上限与来源原子性是工程约束，不能当作任务质量收益。

仅在包含本功能的源码构建中，由所有者在原配置增加以下字段，然后重启该构建的DSH服务：

```json
{
  "memoryContext": { "policy": "evidence-mmr-v1", "maxNoticeBytes": 8192 }
}
```

这是原配置的局部增量，不要覆盖repoRoot、dataDir、已有授权或配额。仍需原有shareWithModel许可；本字段不会启用自动学习、提炼、测试执行或增加预算。不配置时完全保持原notice。512–65536字节；必需内容通常超过最小值，紧预算可能全部拒选。公开alpha.2尚不支持此字段，不能直接给旧版本配置。

流程：原选择器先核对来源证明、事实引用、仓库、代码/依赖和owner条件；编译器保留完整策略、适用文件摘要、经验/应用/验证身份与版本。再将每条原始事实及其全部引用作为一个单位，按查询相关性、Jaccard冗余和序列化成本贪心选择。与原文重复、无查询词重叠、预算不足或边际分不正的事实不提供。省略内容仍保存在本机原记录中；没有模型摘要改写。必需信息无法容纳则拒绝且不写Application，不改选其他经验。

上限只包含本插件**经验notice**的完整UTF-8文本（warning、JSON、条件和引用）。owner-confirmed任务事实notice、DSH系统提示/历史、其他工具结果、显式evolve_begin_task的原完整工具输出不在该上限内。因此不能据此承诺整个请求的Token或费用上限。事实引用只证明记录绑定，既不证明语义真，也不证明未来修复有效。

运行中的 `service.retrievalStatus()` 以原有最多8条/24KiB进程内记录保留context决策：算法、状态、预算、必需/完整/提供字节、保留索引和有限省略原因。进程重启不保留；不增加全文日志，不改变SQLite v9或历史授权。`context_budget_exceeded`表示必需包放不下；`context_invalid_source`表示编译前结构绑定无效。其他拒选仍查看原候选原因。

开发者可运行 `npm run context:evaluate` 重放公开合成数据，运行 `npm run check` 中的agent-context-runtime测试核对实际GenerateOptions。离线适配器不会连接模型；turn结束只用于等待请求完成，断言直接检查收到的notice及应用记录。合成facet覆盖与字节结果不能写成Agent成功率提升。
