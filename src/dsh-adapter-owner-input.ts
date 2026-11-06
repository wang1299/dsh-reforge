import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import type { SessionId } from '@deepseek-ai/dsh-session';
import { digest } from './domain.js';
import { OwnerInputError } from './owner-input-domain.js';
import type { OwnerTaskCarrier } from './owner-task-input.js';
import type { EvolveService } from './service.js';

const identities = new WeakMap<Agent, string>();
/** Only bounded routing configuration is hashed; no credentials or conversation read. */
export function ownerAgentScope(agent: Agent, proposed?: Partial<LlmCallConfig>): string {
  let config = proposed;
  if (!config) {
    const header = agent.session?.requestHeader(); config = { ...(header?.config ?? agent.options) };
    // Match the official requestProposal layer, before adapter defaults are resolved again.
    if (header?.adapterDefaults?.maxTokens) delete config.maxTokens;
    if (header?.adapterDefaults?.reasoningEffort) delete config.reasoningEffort;
  }
  let identity = identities.get(agent); if (!identity) { identity = randomUUID(); identities.set(agent, identity); }
  return digest(JSON.stringify([identity, config.provider ?? null, config.model ?? null, config.reasoningEffort ?? null,
    config.maxTokens ?? null, config.temperature ?? null, config.stop ?? null]));
}
export function dshOwnerCarrier(ctx: Context, service: EvolveService, sessionId: string,
  active: () => boolean): OwnerTaskCarrier | null {
  const agent = ctx.get('agents')?.get(sessionId as SessionId); if (!agent) return null;
  const scopeKey = ownerAgentScope(agent); let maintenanceSignal: AbortSignal | null = null;
  const assertReady = (): void => {
    if (!active() || !service.sharingEnabled) throw new OwnerInputError('owner_sharing_disabled');
    maintenanceSignal?.throwIfAborted();
    const session = ctx.sessions.get(agent.id);
    if (ctx.get('agents')?.get(agent.id) !== agent || !session || String(session.id) !== sessionId
      || session.header.origin === 'subagent' || session.header.isSeeded) throw new OwnerInputError('owner_conversation_changed');
    try { if (!session.header.cwd || realpathSync.native(session.header.cwd) !== realpathSync.native(service.root)) throw new Error('scope'); }
    catch { throw new OwnerInputError('owner_repository_mismatch'); }
    if (ownerAgentScope(agent) !== scopeKey) throw new OwnerInputError('owner_model_changed');
    if (agent.status !== 'idle' || agent.inbox.nextTurn.length || agent.inbox.nextStep.length) throw new OwnerInputError('owner_conversation_busy');
  };
  return { sessionId, scopeKey, assertReady,
    async exclusive<T>(operation: () => T): Promise<T> {
      assertReady(); let entered = false;
      try {
        return await agent.runMaintenance(async signal => {
          entered = true; maintenanceSignal = signal;
          try { assertReady(); return operation(); } finally { maintenanceSignal = null; }
        });
      } catch (error) { if (error instanceof OwnerInputError) throw error; throw new OwnerInputError(entered ? 'owner_submission_unknown' : 'owner_conversation_busy'); }
    },
    message(text) {
      if (!maintenanceSignal) throw new OwnerInputError('owner_admission_required');
      const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] });
      return { id: String(message.id), send() { assertReady(); agent.followup(message); } };
    },
  };
}
