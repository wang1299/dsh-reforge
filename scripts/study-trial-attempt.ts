import { executeBenefitTrial, type StudyTrialInput } from './benefit-trial-controller.js';
import { createOfflineSdkDriver, type SdkFixtureMode } from './study-offline-sdk.js';
import type { StudyCostBinding, StudyCostLedger } from './study-cost-ledger.js';

/** Internal fault-test executor only; the CLI always uses the default shared controller. */
export async function runOfficialTrialAttempt(input: { trial: StudyTrialInput; mode: SdkFixtureMode; ledger: StudyCostLedger;
  binding: StudyCostBinding; trialIndex: number; checkFrozen: () => Promise<{ planDigest: string }> }, executor = executeBenefitTrial) {
  let sdk: Awaited<ReturnType<typeof createOfflineSdkDriver>> | null = null;
  let trial: Awaited<ReturnType<typeof executeBenefitTrial>> | null = null;
  let failureReason: string | null = null; let countsComplete = true;
  let wire = { loopbackRequests: 0, offlineTransportInvocations: 0, deniedRequests: 0, providerHttpRequests: 0,
    wireDigests: [] as string[], reservationIds: [] as string[] };
  try {
    sdk = await createOfflineSdkDriver({ ledger: input.ledger, binding: input.binding, trialIndex: input.trialIndex,
      item: input.trial.item, memory: input.trial.memory, mode: input.mode, checkFrozen: input.checkFrozen });
    trial = await executor(input.trial, sdk.driver);
  } catch { failureReason = sdk ? 'controller_result_unavailable' : 'driver_startup_failed'; }
  finally {
    if (sdk) {
      try { await sdk.close(); } catch { countsComplete = false; failureReason ??= 'driver_cleanup_unknown'; }
      wire = sdk.snapshot();
    }
  }
  const observedSdkRequests = sdk?.driver.adapter.calls ?? 0;
  return { trial, receipt: { index: input.trialIndex, resultRecorded: trial !== null, countsComplete, failureReason, observedSdkRequests,
    sdkRequests: countsComplete ? observedSdkRequests : null, loopbackRequests: countsComplete ? wire.loopbackRequests : null, wire } };
}
