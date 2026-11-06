import type { EvolveService } from './service.js';
import type { OwnerTaskCarrier } from './owner-task-input.js';

/** Called only behind the existing token/same-origin or official owner authentication. */
export async function ownerInputRequest(service: EvolveService, path: string, method: string, input?: unknown,
  carrier: OwnerTaskCarrier | null = null): Promise<{ status: number; value: unknown } | null> {
  if (!path.startsWith('/api/owner-input/')) return null;
  const owner = service.ownerInput;
  if (method === 'GET' && path === '/api/owner-input/state') return { status: 200, value: owner.state(carrier) };
  if (method !== 'POST') return { status: 404, value: { error: 'Not found' } };
  if (path === '/api/owner-input/source-preview') return { status: 200, value: owner.sourcePreview(input) };
  if (path === '/api/owner-input/task-preview') return { status: 200, value: owner.taskPreview(input, carrier) };
  if (path === '/api/owner-input/declare') return { status: 200, value: owner.declare(input) };
  if (path === '/api/owner-input/disable') return { status: 200, value: owner.disable(input) };
  if (path === '/api/owner-input/submit') return { status: 200, value: await owner.submit(input, carrier) };
  return { status: 404, value: { error: 'Not found' } };
}
