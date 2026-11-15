# Agent岗位与公开项目的能力映射

2026-11-15，只读研究。公开简历/作品页的指标属于作者自述，未独立复现；这里只参考技术问题和实现组织，不复制其数字。

| 一手来源 | 展示的Agent技术 | 本项目的对应落点 |
| --- | --- | --- |
| [ORCA公开简历](https://jchung02.github.io/papers/resume_public_2603.pdf) | 专家角色、共享状态、人审、诊断驱动算法选择和评测 | 解释每个组件的决策与验证职责 |
| [CV Generator作品与源码入口](https://ckcinnabar.github.io/projects/cv-generate.html) | 检索摘要与按需全文、人审、事实监督及渲染检查循环 | 检索结果转模型上下文时的预算、来源和原子性 |
| [GenomicsCopilot源码](https://github.com/ankurgenomics/agentic-genomics) | 类型化步骤、领域计算、LLM合成和证据critic | 确定性检查与模型推断分开，不靠模型自评验收 |
| [Perplexity Agent Evals & Efficiency岗位](https://jobs.ashbyhq.com/Perplexity/f3814af2-55a3-49a5-b0cb-67199a2a45fb) | 上下文/工具/技能效率，成功率、延迟与每成功任务成本 | 同条件测量上下文开销和下游结果，保留负例 |

据此优先做[ADR063](../decisions/063-agent-context-compiler.md)：保留宿主AgentLoop与已有来源门槛，增加我们自己的上下文决策算法及实际请求接入。MMR参考[Goldstein/Carbonell原文](https://aclanthology.org/X98-1025/)，字节成本密度是本实现的有界贪心适配，不声称新算法或最优解。

面试应能解释：为什么一个top-1经验仍需内容规划；必需条件为什么不能截断；事实与引用如何原子保留；MMR和相关性排序有什么取舍；字节预算和Token统计的区别；预算拒选如何避免错误应用记录；实际GenerateOptions如何核验；合成上下文指标为何不代表真实Agent成功率。
