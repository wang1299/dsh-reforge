# ADR058：共享修复控制器中的官方SDK、本机线路与取消

2026-11-09，T064，承接ADR055–057。先于实现。T062脚本adapter和T063离线transport均不足以说明真实官方SDK的参数、解析与重试路径已核对。

## 同一控制器、固定依赖

固定开发依赖`@deepseek-ai/dsh-llm-deepseek`，rc.2/rc.5均使用各自完整锁定SDK图，不绕过peer或浮动安装。它只供研究脚本，不加入插件运行时依赖。抽出内部driver协议/请求摘要校验，共用原最多两轮的AgentLoop、JSON/AST准入、目标写入与固定pytest；保留旧脚本入口/结果语义。新增官方DeepSeekAdapter driver，仅固定本机relay地址、flash、非思考、温度0、2048输出、零provider重试、显式静态模型列表，禁Files/模型目录联网。driver API不是可信授权入口，不因调用内部方法就取得付费资格。

## 本机线路与原始字节

本机server仅监听127.0.0.1随机端口/nonce路由，检查Host、POST、固定合成Bearer、不接受并发/额外路由。SDK使用真实fetch到loopback；必须分别报告`loopbackRequests`与`providerHttpRequests=0`，不能把本机HTTP称为零HTTP。内存中有界收集请求≤262144字节，不持久化完整会话/原始HTTP体或凭据。T063增加严格raw-wire入口：先拒绝重复JSON键/未知字段再准入，原始字节摘要与transport收到字节一致，不静默重排/改写实际SDK请求。

合成transport只返回预先规定的原错误/作者修复、自述、非法代码、HTTP失败/截断等响应。费用账本approval仍是测试夹具；先commit完整占额，完整最终usage才结算。报告SDK尝试、实际本机请求、模拟响应、真实provider HTTP和模拟金额，不能把参考答案的100%通过当真实模型收益或价格测量。

## 取消与停机

guard增加显式AbortSignal及有限deadline，冻结检查前中止不占额；占额后取消/超时为unknown全额保留，绝不重试。响应等待与冻结检查可被取消；传输晚到不能再结算。relay跟踪自己的请求/控制器；client断开或关闭relay会abort并等待guard操作结束，不终止其他进程。已结算但SDK未消费完成仍不算任务通过，不自动重放。旧脚本adapter未知语义保持。

## 演练与后续门槛

新零费用命令只允许显式offline-wire，完整36项三组顺序，每题新上下文，至多72个本机请求；来源验证/选择方式/题目/验收不变。每轮实际输入摘要（含assistant历史）和原始wire摘要分别留存，研究起止源码/执行入口摘要核对；来源库/HEAD/index保持。核心check后顺序跑完整线路演练，不并发挤入大工程测试。

针对检查覆盖原字节不变、重复键、参数、SDK不重试、两轮独立pytest、截断/HTTP异常/取消不重放、额度/模型工具拒绝和driver卸载；四组合验证两个SDK图。稳定SHA独立只读审查，记录真实失败/跳过，不以旧绿灯代新提交。

尚缺真实网络/Key隔离入口、完整实际依赖与候选包冻结、唯一固定账本的可信新授权、生成代码进程/环境限制。未完成前不读Key或请求预算，不使用旧T049授权；本次不发布/部署/合并main，不声明live就绪。
