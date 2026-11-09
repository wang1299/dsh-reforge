# T065：冻结计划、一次授权与受限真实执行入口

2026-11-09 / [Issue #143](https://github.com/wang1299/dsh-reforge/issues/143)，分支`codex/t065-frozen-authorized-live-study`，基于T064的PR #142。持续UX/真实效果目标仍开放。

- 设计先行：ADR059及审查修订均在对应实现前提交。真实执行许可尚未取得，不使用T049旧预算；没有真实Key读取或付费provider请求。
- 第一资源层`bf03c8b`经独立只读审查无P0/P1/P2；进一步核对Windows Job ABI和实际CPU限制，定向真实OS限制/超内存/环境隔离通过。固定9个纯Python wheel按官方PyPI摘要在新vendor安装，第一实际原始/参考/错误三项验收通过，主动放置的conftest未加载。
- `d68a34c`独立审查发现中间路径别名、遗漏critical、只按原SSE字符串过滤Key三项P2。先修订ADR，再在`4ddf9da`修复并增加反例；16项定向测试通过、0skip。原三P2独立静态复核已解决。
- `4ddf9da`完整路径审查又发现输出写入冻结bank、首次价格未绑定已审原文、Key删除前Git默认继承环境三项P2。首次完整模拟回执实际记录首项transport unknown、provider0/占额0，冻结inventory新增bank/run-*；日志保留`.probe-work/t065-live-qualification-first.log`及原目录，不改标成功。
- `745d795`的后续模拟在独立复审发现二进制Git/来源版本探针遗漏后主动中止；`.probe-work/t065-live-qualification-fixed.log`及其原目录、锁和模拟账本保留，不恢复、重放或称为完整通过。修正后另建新目录运行最终资格。
- 后续修订分别分开controller输出parent与严格project owner、绑定再次人工核对的官方价格原文摘要、为研究调用增加异步作用域Git白名单环境；普通产品Git默认不变。完整模拟加入首轮通过/两轮已知失败控制，预期36项/71模拟请求，不能删除已知失败。

## 稳定代码与本机实测

生产代码`98fd9a0089332a8317402d3333a45718d07dd719`已完成独立只读复审，无剩余P0/P1/P2。最后发现的二进制Git和Python版本探针遗漏由先行设计`c9803f8`、实现`98fd9a0`修复；普通产品调用默认行为保持。此前393项检查结果保留，不当作最终代码成绩。

- `.probe-work/t065-check-final-isolation.log`：type/lint/build通过，全套396项，394pass/0fail/2既有Windows文件symlink权限skip；compat10/10、0skip。`.probe-work/t065-current-graph-final-isolation.log`独立核对历史锁/方法/向量资产不变、当前两SDK图和两分区完整结果匹配；没有重写历史ML成绩。
- 完整资格`.probe-work/t065-live-path-fixture/run-DXALIy/authority/preparations/run-55YOB2/study-result.json`和外层`qualification.json`实际完成。36个独立session、每组12项、12组题/重复配对，1首过/35最终过/1预设两轮知败/0unknown，71次SDK/本机HTTP/fake-provider及71笔顺序一致的raw摘要/占额。参考数none/plain/reforge为0/12/10；23项控制、3份来源证明。
- 主控审计日志`.probe-work/t065-audit-local-final.log`及外层`qualification-audit.json`独立复算上述分母、原始摘要、unique session和ledger；账本completed，32660微元为模拟已结算、unknown0。真实provider HTTP/模型费用0，不是模型收益。原子审批、未知重开及污染环境反例另在定向测试和完整检查覆盖。
- 冻结15148项/269757965字节，全量起止检查及独立纯FS核验当前metadata/全部SHA256、来源snapshot和3条重建experience摘要一致。trial阶段513.020秒、guard438.801秒、fake-provider0.396秒，仅本机协议耗时，不作为模型延迟改善。
- 本机候选SHA1`5dec55c94d8ffe2776a4f6b38e641b1d160dd127`、SHA256`06dab16800f13022a7b0e2f396b36046e29e5edb47cc588d6056908d16d2898e`，未发布。CI安装使用同一外层候选包；rc5资格在其实际SDK图/包元数据下另包的摘要不同，不能混称所有资格包字节相同。

文档收尾明确逐次元数据/起止全量内容的边界，不将98fd回执改标新SHA。最终文档头的四组合CI及具体真实未授权计划仍以[PR #144](https://github.com/wang1299/dsh-reforge/pull/144)实际终态为准。没有本轮main合并、部署、npm/Release发布或付费调用授权。[中英文运行指南](../evaluation/authorized-benefit-study.md)。
