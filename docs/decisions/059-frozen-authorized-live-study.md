# ADR059：冻结运行环境、一次授权与真实收益研究入口

2026-11-09，T065 / [Issue #143](https://github.com/wang1299/dsh-reforge/issues/143)。先于实现，承接ADR055–058。上一轮验证了官方SDK本机线路，本轮补可审查的真实执行入口；未取得新预算前只运行合成夹具，不读Key、不发付费请求。

## 研究与边界

- 不改变冻结6题、3份来源策略、none/plain/reforge三组、36trial（每组12）、顺序或两轮上限。不按模型结果换题/关键词/参考，不在研究中学习或改经验。新会话、统一系统/任务/反馈，独立固定pytest。来源验证与下游收益继续分开。
- shared controller增加明确live driver及受限执行port，CLI禁止live回落旧Python执行。普通确认失败最多修一次，第二轮已知失败仍进入下一trial；传输/执行/费用/清理/冻结未知则停止整个研究。保留未解决/未尝试分母，不能用模型自述认定成功。
- 新结果明确真实与合成模式，记录first/final-pass、返工、无效/未知、引用、实际用量、保守结算、未知占额、耗时及配对原始结果。小规模作者可见合成任务不是外部用户/盲测/泛化结论，模型别名也不证明底层版本永久固定。

## Python执行边界

新增专用worker：`-I -S -B`，显式固定pytest vendor路径、project路径和配置，禁site/.pth/用户插件及自动conftest，环境只传必要OS/临时目录字段，不传认证、代理、Python启动变量或父进程任意环境。生成函数仍须原JSON/AST准入，字节、节点和调用白名单保持；它不是通用代码沙箱。

执行前必须安装并核对本平台OS限制：[Windows Job Objects](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_extended_limit_information)限制进程内存512MiB、CPU8秒、活动进程1并kill-on-close；[Linux resource](https://docs.python.org/3.10/library/resource.html)限制地址空间512MiB、CPU8秒、文件1MiB、fd64、core0。Node另有15秒wall deadline、有界stdout/XML及取消。限制缺失/失败不运行模型代码，结果unknown；只支持验证过的Windows/Linux，不以弱fallback假装隔离成功。限制是资源保护，非完整OS文件/网络沙箱；AST禁止外部IO和任意调用，固定合成helper无真实副作用。

pytest及依赖用固定纯Pythonwheel URL/SHA256安装到新`.probe-work`vendor，pip隔离、无用户配置/缓存/旧虚拟环境，不自动升级。先以原始/参考/错误修复控制核对受限验收；准备不接触用户项目。worker、vendor、解释器/stdlib/本机动态模块均纳入冻结。

## 冻结与候选

在干净稳定提交上准备：未发布tgz与摘要/内容审核、所有仓库跟踪输入、实际dist、锁图中实际Node依赖代码/数据/native文件、Node可执行文件与版本、Python可执行/stdlib/native/vendor、worker、策略、模型参数、来源证明/库/HEAD/index和独立验收。没有用Git号替代实际文件字节。新增或链接/多硬链接/不支持路径拒绝或在明确闭包内记录，不读取用户home任意配置。

完整字节摘要在开始/结束核对。每次HTTP前重读并核对计划摘要、来源snapshot/schema/index，检查关键源码、worker、包锁和SDK入口字节，同时重新枚举全部冻结清单的路径/文件身份、size/mtime/ctime。dist、candidate及其余依赖逐次核对元数据，起止核对全部字节；不能把它描述成每次对所有JS/包文件重新计算内容摘要。出现变化停止，不重新推断或自动接受新版本。完整清单不包括整个OS/服务商内部实现，信任owner机器；不宣称抵抗owner篡改/时间戳回滚。guard和provider耗时分开，不能把离线/准备耗时称为模型延迟改善。

## 固定授权入口

live authority固定在本仓库`.probe-work/t065-benefit-live`，CLI没有替换root/ledger路径。prepare只产生新不可变plan和默认unapproved账本，列出预算建议而不授权。计划可在未授权时重新准备为独立新目录，旧计划/账本保留；固定authority只可批准其中一个，批准后不能新增/替换授权或提高cap。

owner明确执行authorize，必须给出完整plan摘要、cap和付费确认参数。固定approval文件以wx新建/同步，绑定studyId、planDigest、唯一ledger目录、cap及授权摘要；严格拒绝链接/截断/外来记录，不覆盖/删除旧批准。先持久approval再批准对应SQLite；中断只允许以相同记录补完尚未授权的零调用账本，不产生第二笔额度。live须同时核对固定approval、原计划及相同账本，不创建缺失账本，不接受拷贝到别处的额度。只读inspect不改变重启状态。

仍使用RF63独立账本：首笔reserve原子started；已经started的重新打开标unknown，不能恢复/自动重放。缺Key且未调用时保持prepared；真实费用回执未知仍保留全部预留，不用完成/超时猜退款。不能复用已完成T049的10元授权或旧产品预算/提炼次数。

## Provider与Key隔离

实际SDK继续只拿本机nonce路由及合成Bearer，Key只在独立backend内存。CLI只在授权/冻结/控制均通过后读取本次专用环境变量`DSH_REFORGE_STUDY_KEY`，随后从本进程环境移除；不索要聊天密钥、不打印、写入argv/plan/ledger/报告或传Python。缺失时给本机安全输入步骤。

backend只POST `https://api.deepseek.com/anthropic/v1/messages`、redirect error、无重试/工具/图片/搜索/Files/目录请求，连接/响应/wall期限及请求262144/响应1048576字节有界。收到完整最终usage才结算；超时、断流、错误、额外收费字段/模型标签变化均未知停止。读到Key出现在响应中也拒绝，不向SDK/磁盘交付。关闭本机服务会取消真实fetch并等待受控操作，晚回执不能结算。

价格依据为[2026-11-09官方flash峰值](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)输入2/输出8元每百万，非思考温度0、请求输出2048；保守每请求占5.345728元（模型输入1,100,000/output393,216边界），cap建议10元、最大72请求。使用缓存也按峰值非缓存计算上界；不是服务商账户硬限制或最终账单，不能把建议当已授权。执行前重新核对价格/能力，变更须新冻结/授权。

## 本轮验收与顺序

先做零费用的prepare/inspect/合成authorize/完整36 SDK线路，用与live相同的provider backend、受限验收和冻结检查，只注入fake fetch/合成Key。测试缺授权、路径/计划漂移、重复批准、未知重启、取消/超限、凭据不外泄、OS限制/环境隔离、失败计数。核心check后顺序跑完整准备，避免大工程并发争用。两SDK图/两系统实际验证，稳定SHA独立只读审查，原T059冻结资产及当前图回归保持。

只有形成完整可运行、检查通过的冻结真实plan和易读预算方案后，才请求本次新预算；没答复不调用。没有发布npm/Release、合并main、部署或写旧profile的授权。完成基础设施不等于目标已完成，真实对照及UX仍须继续。

组件独立审查后的修订（先于修正实现）：冻结清单必须在任何内容读取前核对root实际路径和显式files每项的全部父目录，不能通过中间junction/symlink把外部文件当普通文件；闭包内叶链接的实际目标也必须作为普通文件被清单覆盖。每一个critical路径都必须命中清单中的非目录条目，加载后的manifest同样验证；遗漏/拼错不能静默退化为未核对。补中间目录别名、别名下root、缺失/目录/未收录critical反例。

响应过滤审查修订（先于修正实现）：不能只在原始SSE字符串查找Key。交给SDK之前还核对每个JSON解码字符串、按协议顺序拼接的文本块，以及提案JSON解码后的code；覆盖分片和Unicode转义，失败保留未知占额，不把任何原响应写入诊断。该检查针对已知Key在实际协议中的表示，不声明能识别任意编码的秘密或恶意服务商的所有隐蔽通道。

完整入口审查修订（先于修正实现）：trial 的 checks、提案、XML和结果位于计划根下独立输出目录，不能写入已冻结的来源库目录；来源库仍完整枚举，只明确排除受协议管理的 target/schema/Git 内部字段。36项资格演练保留一个两轮均已知失败的控制，确认不会被删除、改题或阻止下一trial，统计仍以12/组为计划分母。

首次价格核对必须符合人工审阅的原始官方文档SHA256，而不只是在prepare和live之间相等。2026-11-09再核对官方文档flash峰值输入2/输出8元/百万、目录版本1017，并冻结该次原文摘要；任何页面字节变动都拒绝新计划或执行，须重新人工核对、提交和准备。仅有目录标签相同不能替代价格核验。

Key隔离审查修订（先于修正实现）：不仅Python，计划检查与研究helper的全部Git子进程也采用白名单环境，禁系统/用户Git配置、fsmonitor与hooks。repository的内部Git helper增加异步作用域执行上下文，只在本研究中指定环境和配置，不改变正常产品调用默认行为；避免在读取/删除Key之前经默认继承环境把它交给Git。研究自身的直接Git调用统一经该helper。用合成环境标记和真实Git子进程测试作用域及异步恢复，不能读真实Key。

同项复审补充（先于修正实现）：来源验证的二进制cat-file同样复用Git作用域配置，但必须保留原始Buffer和4MiB单blob上限，不能通过trim文本读取。VerificationPolicy增加仅供可信内部调用的可选probeEnvironment，来源证明传白名单，Python/pytest版本探针在该模式下用-I/-B、禁自动插件及有界超时/输出；正常产品无该字段时保留现有行为。不把环境内容写进Verification。覆盖binary roundtrip、实际Git子进程和父PYTEST_PLUGINS污染反例。
