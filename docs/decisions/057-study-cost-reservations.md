# ADR057：单次研究的持久费用占额与零网络调用边界

2026-11-09，T063 / [Issue #139](https://github.com/wang1299/dsh-reforge/issues/139)。先于实现，承接ADR055/056。

## 范围与授权

真实研究必须有新的、绑定冻结计划的授权。T049已完成的10元授权不能重用。本增量只实现独立账本及注入离线transport的调用边界；不提供live CLI、不读Key、不调用fetch、不接入真实SDK、不修改既有产品SQLite v9或财务数据。测试中的approval仅为合成夹具，不能作为用户授权。

新`.probe-work`研究目录以`studyId + planDigest`绑定账本。默认unapproved，无金额；显式approval记录新授权摘要和整数微元上限，不能追加、重置、换计划或迁移旧账本。未来owner入口仍须核对真实授权、完整冻结和运行环境；模块方法本身不能证明谁批准了它。

## 生命周期与持久性

新application_id RF63、user_version 1、DELETE journal、synchronous EXTRA。独占wx锁，无自动删旧锁或PID推断；拒绝链接、多硬链接、仓库外路径、异类/损坏数据库。已有库先只读核对header/标识/模式/完整性/唯一表和绑定，才允许写。状态以SQLite事务提交，不缓存可变余额；失败写入不能当作成功。

`unapproved → prepared → started → completed/incomplete/unknown`。第一笔reserve和started同事务，先持久化完整占额再调用transport。请求以`trialIndex(0..35), round(1..2), inputDigest`固定；每trial先1后2，禁止重复、乱序、跨trial返回、超过36trial/72次或cap。未结占额挡住下一笔。未知、超出请求输出或HTTP异常停止；未知保留全额。started后重开转unknown，保留已结费用及未结占额，不恢复/重试/清零；原始挂起原因保留。正常finish也不可继续。

金额为整数micro-CNY。2026-11-09核对[官方价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)：flash高峰非缓存输入2元/百万、输出8元/百万，全部按峰值、不享缓存折扣。保守边界1,100,000输入+393,216输出，每次先占5,345,728微元；请求输出2048。此为当前价格/模型边界下的本机保守控制，不是账户硬限额或账单。价格/能力变动须新冻结。

## 回执与离线调用边界

纯解析器只接受完整SSE：单个message_start、text内容块、单个有最终累计usage的message_delta、message_stop及完整末尾；拒绝错误/截断/重复终止/工具/未知收费字段。按[官方Anthropic兼容说明](https://api-docs.deepseek.com/guides/anthropic_api/)合计最终input_tokens与cache_read_input_tokens，不依赖开始帧临时用量。未知保守停机，不从模型自述或HTTP200推断费用。model字段仅为回执标签，不冒充底层版本固定。

包装器要求调用前冻结检查、唯一请求身份、严格text-only flash/stream/temperature0/thinking disabled/max_tokens2048，字节上限262144/1048576。仅显式注入离线transport，无网络默认值。请求在冻结检查前复制成固定序列，transport只收到固定字节；完整结算后才返回响应文本，SSE只在内存，不写账本。传输失败/不完整回执停止，绝不重试。真实网络超时/取消、Key隔离、无重试官方SDK、完整依赖冻结及代码进程隔离仍是后续付费前门槛。

## 验证与边界

覆盖未授权、绑定漂移、cap/72次、重复/乱序、传输失败、截断/无usage/额外收费、输出超请求、重开、锁冲突、旧库/链接、提交失败。合成transport核对调用时SQLite中已存在占额；真实HTTP为0。稳定SHA独立只读审查，check/build/compat及双系统双DSH版本CI。公开只报告结构性零费用验证，不声称成功率或省钱提升。

本次不合并main、不部署、不发布npm/Release。该基础设施不结束持续改善目标。

审查边界细化：仅接受回执model为请求的`deepseek-flash`，别名不证明底层版本；收费JSON重复键（含转义别名）拒绝。单文件账本不能防owner复制/回滚文件或在别处批准同一摘要，后续真实入口必须绑定唯一的固定账本路径和可信新授权，不允许调用者选择新路径重建额度；本模块尚不能独立充当live授权系统。

独立审查后的修订（先于修正实现）：SQLite原生VFS也会访问`cost-ledger.sqlite-journal/-wal/-shm`。在create/open任何SQLite连接之前、每次写事务之前及状态读取时拒绝任何已有sidecar（包括普通文件、硬/符号链接及悬空链接），不删除、不修复、不跟随。合法崩溃残留同样需要owner手工检查，不能借自动恢复回滚财务状态。验证链接journal指向的新合成哨兵保持字节不变，create/open/在途写入均拒绝；不声称抵抗检查后任意恶意并发替换。
