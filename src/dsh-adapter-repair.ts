/** Optional example adapter only; never loaded by the production plugin entry. */
import type { Context } from '@deepseek-ai/cordis';
import { defineTool, type ParameterSchemaSpec } from '@deepseek-ai/dsh-tools';
import type { RepairAgent } from './repair-agent.js';
import type { RepairTool } from './repair-agent-contract.js';

const step = { revision: { type: 'integer', required: true }, stepId: { type: 'string', required: true } } as const;
const tools: { name: RepairTool; description: string; parameters: ParameterSchemaSpec }[] = [
  { name: 'repair_plan', description: 'Submit a dependency-ordered repair plan. The host owns all states and acceptance; replan only after known test failure.',
    parameters: { revision: { type: 'integer', required: true }, steps: { type: 'array', required: true, items: { type: 'object', additionalProperties: false,
      properties: { id: { type: 'string', required: true }, action: { type: 'string', enum: ['read', 'reproduce', 'patch', 'verify'], required: true },
        dependsOn: { type: 'array', items: { type: 'string' }, required: true } } } } } },
  { name: 'repair_read', description: 'Read only target.py with its exact current digest. Cannot read other files or tests.',
    parameters: { ...step, path: { type: 'string', const: 'target.py', required: true } } },
  { name: 'repair_patch', description: 'Replace the bounded repair function after reading it, using its exact digest. No tests, paths or permissions can be changed.',
    parameters: { ...step, path: { type: 'string', const: 'target.py', required: true }, expectedDigest: { type: 'string', required: true }, code: { type: 'string', required: true } } },
  { name: 'repair_check', description: 'Run host-fixed independent tests for the planned reproduce/verify step. Tool transport or assistant text cannot certify acceptance.', parameters: step },
];

export function bindRepairTools(ctx: Context, agent: RepairAgent) {
  for (const tool of tools) ctx.tools.register(defineTool({ ...tool,
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, execution) {
      if (execution.signal.aborted) { agent.cancel(); return { ok: false, reason: 'cancelled' }; }
      const cancelled = () => agent.cancel();
      execution.signal.addEventListener('abort', cancelled, { once: true });
      try {
        const result = await agent.dispatch(String(execution.callId), tool.name, args);
        // History is SDK-owned. This bounded projection does not claim to limit the entire history.
        return JSON.parse(JSON.stringify({ result, context: agent.context() }));
      } finally { execution.signal.removeEventListener('abort', cancelled); }
    },
  }));
}
