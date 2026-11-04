# 常见问题 / FAQ

[文档首页 / Documentation](index.md) · [版本状态 / Release status](release-status.md)

### 在 DeepSeek 聊天网页里可以用吗？ / Does it run in the chat website?

插件属于 DeepSeek Harness（DSH），不属于 DeepSeek 官方聊天网页。市场搜索到包不代表当前宿主兼容；先核对准确版本。

This is a DeepSeek Harness plugin, not an extension for the DeepSeek chat website. Marketplace visibility does not establish host compatibility.

### localhost 拒绝连接，或者旧链接打不开？ / Local connection refused or an old URL fails?

启动终端或宿主关闭后，本机服务也会停止。重启对应服务，用本次生成的完整认证地址；不要复用旧端口或认证链接。表单示例和经验面板是两个入口；独立面板不提供模型服务。不要公开完整认证 URL。

Keep the runner or host alive and use its freshly generated complete authentication URL. Old ports and tokens expire. The example form and experience panel are separate pages; the panel is not a model service. Never share token URLs.

### 提示“此对话不属于插件配置的仓库”？ / Conversation belongs to a different repository?

配置的 repoRoot 必须是实际 Git 根目录；在同仓库打开会话。插件不会因切换会话偷偷绑定其他仓库。迁移后路径改变需停机检查配置与数据绑定，不能通过新建空库掩盖旧记录。

Configure the actual Git root and open a conversation in that repository. Switching conversations does not rebind data. After moving paths, stop and inspect bindings; do not conceal old records with a new empty database.

### 还能正常对话吗？为什么没有经验？ / Can I chat normally? Why are there no experiences?

可以。插件默认关闭学习，不影响普通 DSH 对话。开启后也只有材料、权限、前失败/后通过/回归、提炼与独立复核齐全时才形成有资格的经验。空列表、跳过和失败都有可能是正确结果；到“学习进度”看具体原因。

Yes. Learning is off by default. Even when enabled, evidence, authorization, original failure, fixed acceptance, regressions, extraction and independent verification must qualify. An empty list, skip or failure can be correct; inspect learning progress.

### 模型能替我开权限、加预算或重试 unknown 吗？ / Can the model grant permissions or retry an unknown call?

不能。次数由 owner 明确授权，不是人民币上限。未知回执保留占额且不自动重放；不要通过删库、重启或换 grantId 退还次数。费用不明先停，按[数据运维](maintenance.md)保留现场。

No. Owner extraction grants are not currency limits. Unknown calls retain their holds and are not automatically replayed. Do not delete data, restart or change grant IDs to reclaim usage. Stop when billing is uncertain and retain the run.

### 来源通过就能证明更有效吗？ / Does source verification prove better future performance?

不能。它证明指定版本的修复通过指定检查。提供参考也不证明模型采用或因它成功；后续收益需同模型、同额度、未见题与多次重复的对照。目前不宣传已证明提升。

No. It proves that a particular repair passed particular checks. Offering a reference does not prove adoption or causation. Future benefit needs controlled repeated unseen-task comparisons; no proven improvement is claimed.

### 安装被拒绝或官方又升级了？ / Installation rejected after a host update?

先看[精确支持矩阵](dsh-version-matrix.md)，不要放宽 peer 范围强装。适配层减少改动范围，多版本测试提前发现问题，不能保证任意未来宿主兼容。保留数据并等经验证的新包；不同程序不要同时打开同一数据库。

Check the exact matrix instead of overriding peer ranges. Adapters and matrix tests reduce upgrade work, but cannot guarantee arbitrary future host compatibility. Preserve data and wait for a verified artifact; do not open the same database concurrently with different versions.
