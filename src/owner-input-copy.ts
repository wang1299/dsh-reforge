/** Browser-safe presentation data; no filesystem, hashing or storage imports. */
export const ownerGoals = ['repair_behavior', 'validate_payload', 'change_contract', 'present_ui', 'generate_docs'] as const;
export const ownerGoalLabels: Record<(typeof ownerGoals)[number], string> = { repair_behavior: '修复代码行为', validate_payload: '修复输入校验',
  change_contract: '修改接口契约', present_ui: '调整界面展示', generate_docs: '编写说明文档' };
const errors: Record<string, string> = {
  owner_source_unconfirmed: '无法确认字段事实。请检查字段名称和受支持的 .schema.json 文件；复杂组合或引用目前保留为未知。',
  owner_source_changed: '来源文件在预览后已变化，请重新检查文件并预览。',
  owner_rules_changed: '经验适用条件在预览后已更新，本次未提交。请重新预览后确认。',
  owner_preview_expired: '预览已过期、已消费或来自旧连接，请核对回执后重新准备。',
  owner_sharing_disabled: '当前未允许模型共享。请在本机核对插件配置，文件预览仍可使用。',
  owner_conversation_required: '请从当前对话的“经验”页提交。此入口可核对文件和管理条件。',
  owner_conversation_busy: '当前对话有待处理输入或正在维护，请等待结束后重新预览。',
  owner_conversation_changed: '当前对话或 Agent 已变化，请回到目标对话重新预览。',
  owner_repository_mismatch: '当前对话不属于配置的仓库，请切换到对应工作区。',
  owner_model_changed: '当前模型配置与确认时不同，已停止本次输入；请核对模型后重新准备。',
  owner_configuration_unavailable: '适用条件数据不可用或身份不符。请恢复完整数据目录；不会自动清空或重建。',
  owner_submission_unknown: '提交结果尚未确认。请核对原对话和下方回执，不要重复发送。',
  owner_request_conflict: '此请求标识已绑定其他内容，不会重复发送。请核对已有回执。',
  owner_preview_consumed: '这份预览已使用。请核对已有回执，不要重新发送。',
  owner_request_expired: '旧回执已超出保留范围，不能用旧请求重新发送任务。',
  owner_message_limit: '任务分类已达到保留上限，本次未提交；请备份并核对数据运维说明。',
  owner_receipt_limit: '当前未结束的回执较多，本次未提交。请先核对已有任务。',
};
export function ownerInputErrorMessage(code: string): string { return errors[code] ?? '未完成操作，请核对当前对话、来源文件与已有回执；结果未知时不要重复发送。'; }
