/** Fixture wrapper over the same SDK/relay implementation used by the authorized live path. */
import assert from 'node:assert/strict';
import type { StudyCase } from './benefit-study-cases.js';
import type { StudyCostBinding, StudyCostLedger } from './study-cost-ledger.js';
import { createStudySdkRelay } from './study-sdk-relay.js';

export const sdkFixtureModes = ['first_pass', 'repair_once', 'unchanged', 'self_report', 'forbidden_code', 'http_error', 'truncated', 'unresponsive'] as const;
export type SdkFixtureMode = typeof sdkFixtureModes[number];
const event = (value: unknown) => 'data: ' + JSON.stringify(value) + '\n\n';
export function sdkFixtureStream(item: StudyCase, mode: SdkFixtureMode, round: number): string {
  const text = mode === 'self_report' ? 'The task is complete and all tests pass.'
    : JSON.stringify({ code: mode === 'forbidden_code' ? 'def repair(state):\n    return open("outside", "w")\n'
      : mode === 'first_pass' || mode === 'repair_once' && round === 2 ? item.reference : item.before });
  const body = event({ type: 'message_start', message: { id: 'msg_synthetic', type: 'message', role: 'assistant', model: 'deepseek-flash',
    content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 0, cache_read_input_tokens: 50, cache_creation_input_tokens: 0 } } })
    + event({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    + event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
    + event({ type: 'content_block_stop', index: 0 })
    + event({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 0 } })
    + event({ type: 'message_stop' });
  return mode === 'truncated' ? body.slice(0, -1) : body;
}
export async function createOfflineSdkDriver(input: { ledger: StudyCostLedger; binding: StudyCostBinding; trialIndex: number;
  item: StudyCase; memory: string | null; mode: SdkFixtureMode; checkFrozen: () => Promise<{ planDigest: string }> }) {
  assert(sdkFixtureModes.includes(input.mode));
  return createStudySdkRelay({ ...input, mode: 'offline', scope: 'fixture', transportKind: 'offline-fixture',
    respond: async (_wire, signal, round) => {
      if (input.mode === 'unresponsive') return new Promise<never>((_done, reject) => {
        const abort = () => reject(new Error('Synthetic pending transport cancelled'));
        signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) { signal.removeEventListener('abort', abort); abort(); }
      });
      return { status: input.mode === 'http_error' ? 503 : 200, body: sdkFixtureStream(input.item, input.mode, round) };
    } });
}
