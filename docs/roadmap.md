# 路线与实际状态

2026-11-06最新：[T057适用条件/三态门槛](evaluation/applicability-v1.md)以作者结构化任务事实减少合成误选，保留拒选覆盖损失和纯条件消融。48留出误选13→1，但12/24正例仍漏；自然语言任务事实获取、意图验证、外部标注与真实收益仍待新评测，#114保持开放。原型未接默认DSH或公开npm。

2026-11-06最新源码研究：[T055实际链路与选择依据](evaluation/live-retrieval.md)及[T056多语言离线对照](evaluation/retrieval-v3.md)。T056的60查询任务族留出，dense正确提供3/30→18/30，但仍误选16/60，hybrid弱于dense；不切默认策略。新困难负例/外部标签与拒选、真实任务收益仍待后续，#114保持开放；alpha.2公开制品不包含这些未发行源码增量。

当前读者入口见[文档导航](index.md)、[版本状态](release-status.md)与[T046 八项补齐](tasks/T046-public-readiness.md)。2026-11-05，alpha.2 npm和GitHub Release已公开并完成制品核验。以下任务表保留早期阶段与历史分支，不作为当前发行清单。

最新：T047同款可运行工程/中英文导航、T048配置/诊断/备份恢复已合并；[T049真实合成自动闭环](evaluation/t049-20261104/README.md)通过，收益效果未测到（两检索均拒选）。[T050](tasks/T050-alpha2-release.md)已核验精确alpha.2公开制品；可变标签单独记录。下一项为[#114检索覆盖与更有区分度的试验](https://github.com/wang1299/dsh-reforge/issues/114)。公开[外部试用#112](https://github.com/wang1299/dsh-reforge/issues/112)参与仍为0，等待真实反馈；不把维护者或脚本计入人数。

| 任务 | 依赖 | 状态 | 分支 |
|---|---|---|---|
| T033 更名与首次发行 | T032 / Issue #75 | ADR035；包/CLI/品牌与兼容，制品审计与精确 tag 发行流程开发中；发布需实际远端核验 | codex/t033-reforge-release |
| T032 插件页入口与主题一致性 | T031 / Issue #73 | ADR034；官方插件详情操作页、内嵌紧凑布局与宿主主题；实际Web/草稿/保存/窄屏通过，最终检查/评审/CI及合并见关联PR | codex/t032-native-plugin-page，未发布 |
| T031 DSH 原生界面 | T028–T030 / Issue #71 | ADR033；原生设置/对话入口、同宿主认证通道与共享视图；完整 Web / 窄屏 / 重启及实际包通过，评审 P2 已修复复审，代码头双平台 CI 成功；最终门槛见 PR #72 | codex/t031-native-ui，未发布 |
| T030 学习进度中心与独立面板收尾 | T028/T029 / Issue #69 | ADR032；四阶段投影、配置/次数/原因与候选入口、CLI 独立复核已实现；恢复进度 P2 已修并复审，最终验证与合并见 [PR #70](https://github.com/wang1299/dsh-reforge/pull/70) | codex/t030-learning-progress |
| T029 正常对话自动学习 | T019/T020/T027/T028 / Issue #67 | ADR031；正常请求/未提交私有快照/一次提炼/候选独立再验/自动提供已实现；本地172通过1跳过、兼容8/8、实际包和浏览器通过，独立复审无阻塞。最终头CI与合并见[PR #68](https://github.com/wang1299/dsh-reforge/pull/68)；默认关闭，真实模型与收益未验证 | codex/t029-automatic-learning |
| T028 用户学习动态与渐进详情 | T027 / Issue #65 | 已实现、159项本地检查/兼容8项/实际包演练/界面验证及独立复审通过；最终CI与合并见[PR #66](https://github.com/wang1299/dsh-reforge/pull/66)，自动学习操作简化另拆任务 | codex/t028-learning-home |
| T001 需求、架构、ADR、验收和开发基线 | 无 | 已合并PR #2，Issue #1关闭 | codex/t001-baseline |
| T002 数据、来源验证、经验选择和生命周期 | T001 | 9项测试两平台CI和必要复审通过，已合并PR #9，Issue #3关闭 | codex/t002-core |
| T003 DSH 固定版本工具与正常会话兼容探针 | T002 | 11项两平台CI和独立评审通过，PR #10已合并 | codex/t003-dsh |
| T004 最小面板及完整合成开发案例 | T002,T003 | 两平台13项及独立映射通过，PR #11已合并 | codex/t004-panel |
| T005 三组评价记录与完整性检查 | T002,T004 CLI | PR #14已合并，15项两平台CI及独立映射通过，Issue #6关闭 | codex/t005-remote |
| T006a 实际tgz安装组件探针 | T003,T004,T005 | PR #16已合并；修复首轮YAML失败后，15项及实际安装／Loader两平台CI、必要复审通过，Issue #7关闭 | codex/t006a-install-probe |
| T006b Codex CLI执行器 | T002,T005 | PR #17已合并，24项两平台CI及实际安装／独立映射通过；历史预算不等，不判断收益 | codex/t006b-remote，Issue #8部分进展 |
| T006c 三组执行与诚实证据 | T006b,T005 | PR #18已合并，32项两平台CI、实际安装及独立评审通过；有效经验对照未完成 | codex/t006c-remote，Issue #8部分进展 |
| T006d 完整CLI/Web独立试装 | T006a,T008c | Windows完整官方0.2.0-rc.2安装、Web组件运行及停止重启通过；PR #26经两平台CI/独立评审合并，Issue #25关闭 | codex/t006d-dsh-preview |
| T006 真实Agent实验与完整应用安装 | T003,T004,T005,T006a,T006b | Codex合成接入及Windows完整CLI/Web试装已有；真实任务收益、DSH模型回合、Desktop/其他平台完整应用仍未完成 | Issue #8 |
| T007 开发工具依赖更新 | 当前功能PR | PR #13已squash合并，13项两平台CI及独立只读评审通过，Issue #12关闭 | codex/t007-tooling |
| T008 检索覆盖与有效经验对照 | T006c | T008a/b已交付；T008c两题三组有经验差异但无验收收益改善，更多真实任务和重复仍未完成 | Issue #15 |
| T008a 长任务检索与离线消融 | T006c | PR #20已合并，37项两平台CI/实际安装/独立评审通过；误选和退步保留 | codex/t008-retrieval，Issue #19关闭 |
| T008b 有来源的反馈检索记忆 | T008a | PR #22已合并，39项两平台CI/实际安装/独立评审通过，不属于收益实验 | codex/t008b-feedback-retrieval，Issue #21关闭 |
| T008c feedback-v1真实模型初步对照 | T008b,T006c | 7/7次真实调用，积累通过、两题三组均2/2，Evolve提供经验但无验收改善；PR #24经44项两平台CI/实际安装/独立评审合并，Issue #23关闭 | codex/t008c-feedback-evaluation |
| T009 详细需求与架构基线 | T001及当前实现/验证 | PR #28经当前头两平台CI与独立评审合并，Issue #27关闭；58项需求、15场景与G01–G10追踪 | codex/t009-design-baseline |
| T010 事实来源与历史保留 | T009，G01/G07切片 | SQLite v3最小证据/逐条引用、evidence-v1默认资格、六工具与面板；本地53项及界面通过；来源相同幂等，完整已验证来源锁定；当前头CI/包安装/独立评审见关联PR | 已合并PR #30，Issue #29关闭 |
| T011 有预算真实DSH验证 | T010、独立宿主、用户Key/5元 | 实际4请求、源码事后pytest通过；候选引用失败，预算unknown保留，partial；59项两平台代码CI通过，最终门槛见PR | codex/t011-dsh-live-validation，Issue #31 / PR #32 |
| T012 模型可见引用契约 | T010/T011 | 原生嵌套schema、引用顺序和错误重放；59项两平台CI/独立评审通过，已合并PR #35；不声明模型修复效果 | codex/t012-tool-input-contract，Issue #33关闭 |
| T013 数值用量回执 | T011/T012 | 已合并PR #36，65项两平台CI/必要增量独立复审；数值回执离线完成，真实采样待做；不回填旧unknown | codex/t013-numeric-receipts，Issue #34保持open |
| T014 原生Agent脚本演练 | T010–T013 | 已合并PR #38，Issue #37关闭；5场景、70项两平台CI及必要独立复审，零付费，不是模型或收益证据 | codex/t014-agent-rehearsal |
| T019 自动证据包与本地后台机制 | G01/G03切片、Issue #47 | finish去重入队、v4 Job/Attempt/lease/fencing、受授权pytest和面板；真实合成无候选案例/针对检查已通过，最终check/CI/评审/实际包见[T019验收](development/T019-acceptance.md)及关联PR；无模型提炼 | codex/t019-task-evidence |
| T020 自动候选经验提炼 | G02/G03切片、Issue #49、T019 | 独立owner授权、官方DSH LLM端口、宿主事实/引用/条件、v5单次资格/额度/原子候选发布与状态面板；默认关闭，仅离线适配器；最终验证/CI/评审见[T020任务](tasks/T020-auto-extraction.md) | codex/t020-auto-extraction |
| T021 安装包自动学习演练/独立试装 | T020、Issue #51 | 实际包/Loader/AgentLoop与脚本模型四场景、新完整Windowsprofile安装/加载/重启；零付费，真实连通/质量仍待；最终门槛见[T021验收](development/T021-acceptance.md) | codex/t021-packaged-learning |
| T022 候选发现与提醒 | T020/T021、Issue #53 | 第七只读工具/同session数量context/面板顶部提醒及安装包无手填ID流程；最终门槛与限制见[T022验收](development/T022-acceptance.md)及关联PR | codex/t022-candidate-discovery |
| T023 完整宿主内候选发现试装 | T022已合并6742214、Issue #55 | 新完整Windowsprofile/实际7次脚本Agent与1提炼/实际数量提醒与list回执、正常重启、同库面板；零模型HTTP，最终门槛/限制见[T023验收](development/T023-native-discovery.md) | codex/t023-native-discovery |
| T024 SSE消费者断连收尾 | T013/T018、Issue #57 | 终端后有界排空、正常EOF再判定，终端前取消及异常仍保留预留；离线预算15项通过，最终门槛见[T024验收](development/T024-acceptance.md) | codex/t024-sse-disconnect |
| T027 原生提炼启动竞态 | T020/T026，Issue #63 | active凭据服务门槛、固定失败原因/v8；本地154/兼容8、安装包与完整CLI两条离线路径通过；最终门槛见关联PR | codex/t027-native-extraction |
| T026 未知提炼后的显式新授权 | T020/T025，Issue #61 | ADR028、v7、owner排队、旧记录保留；本地151/兼容6/安装检查与独立复审通过；最终CI/合并见[PR #62](https://github.com/wang1299/dsh-reforge/pull/62) | codex/t026-explicit-extraction |
| T025 诊断事件截断与显式恢复 | T019/T020、Issue #59 | ADR027/v6、初始完整147项、最终增量5项/兼容6项、实际包离线演练与安装CLI恢复副本检查通过；独立评审无阻塞，最终门槛见[PR #60](https://github.com/wang1299/dsh-reforge/pull/60)；实际恢复另记、未发布 | codex/t025-observation-recovery |
| T018 显式standard用量兼容 | T017、Issue #45 | PR #46已合并30ed213，Issue #45关闭；文档standard分支/回执2，其他值拒绝；100项两平台CI/实际包/独立评审通过，零新增模型调用 | codex/t018-standard-tier |
| T017 最小单次真实采样 | T016、用户新增最多3元 | PR #44已合并，Issue #43关闭；一次HTTP200/987字节，字段指纹匹配service_tier，值/历史原因未知，2.232768元未知占额；两平台92项/实际包/独立评审通过，未重跑 | codex/t017-messages-sample |
| T016 未知usage结构诊断 | T013/T015、Issue #41 | 可选v2回执/固定拒绝位置/有限字段指纹，离线检查及最终CI/评审门槛见关联PR；没有新付费或真实字段认定 | codex/t016-usage-diagnostics |
| T015 追加预算真实学习回归 | T012–T014、用户另授权5元 | PR #40 / Issue #39；一次live共2个HTTP，start usage未兼容、来源仍open/经验0，partial；代码77项两平台检查、付费前及结果独立核对通过，当前提交CI/合并门槛见PR | codex/t015-live-learning |

远端：公开仓库wang1299/dsh-reforge。T019已合并PR #48（278f58a）；当前T020实现自动候选提炼，实际门槛/合并见[PR列表](https://github.com/wang1299/dsh-reforge/pulls?q=is%3Apr)。T017响应值/真实协议兼容仍未知，T011/T015真实学习仍partial，发布：无。

后续从[架构缺口G01–G10](architecture.md#16-缺口与实施依赖)继续拆任务。T020覆盖G02/G03有限自动候选/单次资格，真实模型质量仍待验；上下文预算/交付G04、正常真实DSH模型学习G05、公开重建/收益G06待完成。G08/G09/G10按风险推进。本次零付费调用，不重开历史预算/未知占额/一次资格；#34协议真实验证及父#8/#15保持open。

已有Codex真实合成接入；未见真实任务集的收益实验仍未完成，历史两组预算不等，不能据此判断收益。GitHub main当前无保护及ruleset，未修改权限或伪造正式Review；仍按验收、必要CI与AI独立评审条件合并。
