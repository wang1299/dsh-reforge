# 验收驱动的修复 Agent 演练

这个源码示例把结构化计划、原生 Tool Calling、上下文投影和来源验证后的经验参考连接起来。**模型响应由脚本生成，工具实际执行，pytest 实际验收**；不能当作模型自主规划、真实任务成功率或记忆收益的实验。DSH 负责模型循环，本项目负责计划与工具准入、状态和验收。

## 运行

在仓库根目录准备 Node 24.19.0、Python 3.10 和已安装的项目依赖。Python 需可运行 pytest 9.1.1；文件操作与验收仅发生在仓库忽略的 `.probe-work/t073-repair-agent/run-*` 新目录。

```powershell
$env:EVOLVE_PYTHON = 'C:\你的Python310目录\python.exe'
npm run agent:demo -- happy
npm run agent:demo -- replan
npm run agent:demo -- self_report
npm run agent:demo -- unknown
```

不需要模型 Key；入口只接受这四个固定场景，不接受 endpoint、真实 provider、配置文件或用户工程目录。受限测试 worker 从仓库所带哈希锁定 wheels 安装到新的本地 vendor，不更新用户 Python、不联网安装。

| 场景 | 脚本行为 | 正确结果 |
|---|---|---|
| happy | 计划→读文件→复现失败→写入参考修复→测试 | 第1版计划独立验收通过，5次原生工具调用 |
| replan | 第1版写回错误代码，测试失败后重规划 | 第2版通过，共10次工具调用；原始失败基线仍冻结 |
| self_report | 只输出“已经完成” | incomplete_turn，不通过；0次工具调用 |
| unknown | 复现工具抛出未知结果 | execution_unknown，停止；3次工具调用，不重试 |

报告路径在终端输出。报告只保留来源控制结果、计数、摘要、计划状态及固定原因；不会写入完整会话、生成代码、任意 stdout 或本机路径。临时合成源文件和 pytest 工件保留在忽略目录中，不能整个目录公开上传。

## 四项技术各负责什么

1. **计划**：模型提交最多8步的依赖 DAG，宿主检查读取/复现/修补/验证的必要依赖。执行结果推进状态，已知失败允许最多2次重规划。完成文本和会话 idle 不验收。
2. **工具**：`repair_plan/read/patch/check` 严格校验。计划 revision 防止旧步骤串入；读文件摘要约束修补版本；相同调用 ID 的回执只在本次进程内重用，参数冲突拒绝，未知停止。新进程没有接续入口，不能宣称跨进程 exactly-once。
3. **上下文**：固定目标、完整当前计划、验收身份必需保留；合格经验 notice 原子加入或省略。最终 UTF-8 投影不超过8192字节。该上限不涵盖 SDK 保留的历史/工具结果，不等于模型 Token 硬预算。
4. **记忆**：新建3个合成来源，实际重放原始失败、独立修复与回归；使用已有 EvolveService 来源/范围检索。每次投影重新核对选中版本、完整来源和代码/依赖条件；引用与事实由已有编译器绑定。只证明脚本请求实际得到参考，不证明模型遵循或任务收益。

工具只能替换 `target.py` 的受限 `repair` 函数；测试由宿主固定，不能被模型读取或修改。比较替换、链接拒绝、AST 准入和受资源限制的 Python worker 用于作者受控合成任务，**不是运行任意恶意代码的安全沙箱**。

## 当前边界与后续

未接入默认 DSH UI/插件行为，未发行新 npm 包；旧 SQLite v9、私人经验、费用占额、授权和提炼次数不读取或修改。多候选语义扩展、反例学习、全历史上下文压缩和真实模型收益仍待后续任务。

后续应冻结未见任务、验收与预算，再用真实模型比较无记忆/普通检索/条件检索，并消融规划与上下文机制。现在只能使用报告中的工程验证计数，不能编造成功率、Token节约或费用收益。

参考：[ADR065](../../docs/decisions/065-acceptance-agent-runner.md) · [T073实际检查](../../docs/tasks/T073-acceptance-agent-runner.md) · [已有语义取舍](../../docs/evaluation/semantic-memory-v1.md)。

## English

This source-only example combines host-validated plans, four native tools, bounded context projections and source-qualified memory. Responses are scripted; the official DSH AgentLoop and restricted Python acceptance actually run. It is not an autonomous-model or task-benefit benchmark. Run the four commands above from the repository root; no model API key, endpoint or paid provider is accepted. The 8192-byte limit covers only the context projection, not the SDK conversation or model tokens. No production data, grants, budgets or published artifacts change.
