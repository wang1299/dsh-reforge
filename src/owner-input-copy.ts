/** Browser-safe presentation data; no filesystem, hashing or storage imports. */
export const ownerGoals = ['repair_behavior', 'validate_payload', 'change_contract', 'present_ui', 'generate_docs'] as const;
export const ownerGoalLabels: Record<(typeof ownerGoals)[number], string> = { repair_behavior: '修复代码行为', validate_payload: '修复输入校验',
  change_contract: '修改接口契约', present_ui: '调整界面展示', generate_docs: '编写说明文档' };
