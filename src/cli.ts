#!/usr/bin/env node
import { resolve } from 'node:path';
import { createService, loadConfig } from './config.js';
import { startPanel } from './panel.js';
import { readFile } from 'node:fs/promises';
import { evaluateExperiment } from './evaluation.js';
import { idSchema } from './domain.js';
import { ownerCommand, ownerError } from './owner-operations.js';

const [command, flag, configPath] = process.argv.slice(2);
if (command && ['setup', 'doctor', 'backup', 'restore'].includes(command)) {
  try { await ownerCommand(command, process.argv.slice(3)); }
  catch (error) { process.stderr.write(JSON.stringify({ error: ownerError(error), changedAuthorization: false }) + '\n'); process.exitCode = 1; }
} else if (command === 'evaluate' && flag === '--input' && configPath) {
  const report = evaluateExperiment(JSON.parse(await readFile(resolve(configPath), 'utf8')));
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
} else if ((command === 'recover-evidence' || command === 'reauthorize-extraction') && flag === '--config' && configPath) {
  const [taskFlag, taskId, jobFlag, jobId, ...extra] = process.argv.slice(5);
  if (taskFlag !== '--task-id' || jobFlag !== '--expected-job' || extra.length) throw new Error('Explicit task and expected job are required');
  const task = idSchema.parse(taskId); const job = idSchema.parse(jobId);
  const { service } = createService(loadConfig(resolve(configPath)));
  try {
    const recovered = command === 'recover-evidence' ? service.recoverEvidence(task, job) : service.reauthorizeExtraction(task, job);
    process.stdout.write(JSON.stringify({ taskId: task, originalJobId: job,
      ...(command === 'recover-evidence' ? { recoveryJobId: recovered.id } : { newJobId: recovered.id }), state: recovered.state, executed: false }) + '\n');
  }
  finally { service.store.close(); }
} else if (command === 'panel' && flag === '--config' && configPath) {
  const { service } = createService(loadConfig(resolve(configPath)));
  const stopAutomatic = service.automatic.start();
  const stopWorker = service.jobs.start();
  const stopExtraction = service.extraction.start(() => null);
  const panel = await startPanel(service);
  process.stdout.write(`DSH-Reforge local panel: ${panel.url}\nKeep this URL private. Learning data stays on this computer.\n`);
  const stop = (): void => { void panel.close().then(() => Promise.all([stopAutomatic(), stopWorker(), stopExtraction()])).then(() => { service.store.close(); process.exitCode = 0; }); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
} else {
  process.stderr.write('Usage: dsh-reforge panel --config <local-config.json> | setup --repo <root> --output <new-config> [--python <executable>] [--data-dir <dir>] | doctor --config <local-config> | backup --config <local-config> --output <new-directory> --stopped | restore --input <backup> --output <new-data-directory> --repo <root> --stopped | evaluate --input <results.json> | <recover-evidence|reauthorize-extraction> --config <local-config.json> --task-id <id> --expected-job <id>\n'); process.exitCode = 1;
}
