/**
 * @module index
 *
 * Package entry point — re-exports shared utilities from core,
 * runner, and local library modules for external consumers.
 */

// jeeves-scripts — TypeScript runner scripts executed via tsx.
// Re-exports for shared library modules.

// General-purpose utilities — re-export from core
export type {
  AccountConfig,
  GoogleAuthOptions,
  RetryOptions,
  RunOptions,
  ServiceAccountFileConfig,
  SlackWorkspaceOptions,
} from '@karmaniverous/jeeves';
export {
  appendJsonl,
  createGoogleAuth,
  ensureDir,
  getArg,
  getChannelWorkspace,
  loadEnvFile,
  nowIso,
  parseArgs,
  readJson,
  readJsonl,
  run,
  runScript,
  runWithRetry,
  saveCache,
  sleepAsync,
  sleepMs,
  uuid,
  writeJsonAtomic,
  writeJsonl,
} from '@karmaniverous/jeeves';

// Runner-specific utilities — re-export from runner
export type {
  DispatchOptions,
  RunnerClient,
} from '@karmaniverous/jeeves-runner';
export {
  dispatchSession,
  getRunnerClient,
  runDispatcher,
} from '@karmaniverous/jeeves-runner';

// Local modules
export * from './lib/constants.js';
export * from './lib/dates.js';
export * from './lib/email.js';
export * from './lib/gateway-client.js';
export * from './lib/gh.js';
export * from './lib/gog.js';
export * from './lib/pipeline-config.js';
export * from './lib/silo-router.js';
export * from './lib/spawn-worker.js';
