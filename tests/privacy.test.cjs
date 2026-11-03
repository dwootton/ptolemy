const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { transformSync } = require('esbuild');

const root = path.resolve(__dirname, '..');

// Run the real service code with isolated VS Code, filesystem and network boundaries.
function harness({ settings = {}, env = {}, dotenv = {} } = {}) {
  const calls = { writes: [], directories: [], firebase: [], messages: [], recordings: [], errors: [] };
  const listeners = new Map();
  const timers = new Set();
  const cache = new Map();
  const vscode = {
    workspace: {
      getConfiguration: (namespace) => ({
        get: (key, fallback) => settings[`${namespace}.${key}`] ?? fallback,
      }),
      onDidChangeConfiguration: () => ({ dispose() {} }),
    },
    window: { showErrorMessage: async (message) => { calls.errors.push(message); } },
  };
  const mocks = {
    vscode,
    fs: {
      existsSync: (file) => file.endsWith('.env') && Object.keys(dotenv).length > 0,
      readFileSync: () => Object.entries(dotenv).map(([key, value]) => `${key}=${value}`).join('\n'),
      mkdirSync: (dir) => calls.directories.push(dir),
      appendFileSync: (file, text) => calls.writes.push({ file, text }),
      promises: { appendFile: async (file, text) => calls.writes.push({ file, text }) },
    },
    dotenv: {
      parse: () => ({ ...dotenv }),
      config: () => ({ parsed: { ...dotenv } }),
    },
    'firebase/app': { initializeApp: (config) => { calls.firebase.push(['initializeApp', config]); return {}; } },
    'firebase/firestore': {
      getFirestore: () => { calls.firebase.push(['getFirestore']); return {}; },
      connectFirestoreEmulator: () => calls.firebase.push(['emulator']),
      setLogLevel() {},
      collection: () => ({}),
      doc: () => ({}),
      writeBatch: () => ({ set() {}, commit: async () => calls.firebase.push(['commit']) }),
    },
    './ActiveWorkspaceManager': { ActiveWorkspaceManager: { getInstance: () => ({
      getActiveRoot: () => '/workspace', getLogsDir: () => '/workspace/.meridian/logs/sessions',
    }) } },
    './StudyWorkspaceManager': {},
    './MessageService': { MessageService: { getInstance: () => ({
      onMessage: (type, callback) => listeners.set(type, callback),
      sendMessage: (type, data) => calls.messages.push({ type, data }),
    }) } },
    './StudyConfigurationService': { StudyConfigurationService: { getInstance: () => ({ getConfiguration: () => null }) } },
    rrweb: { record: (options) => { calls.recordings.push(options); return () => {}; } },
  };
  const globals = {
    console: { log() {}, warn() {}, error() {} }, process: { env }, Buffer,
    setInterval: (callback) => { timers.add(callback); return callback; },
    clearInterval: (callback) => timers.delete(callback),
    setTimeout: (callback) => callback(),
  };
  globals.window = { setInterval: globals.setInterval, innerWidth: 1000, innerHeight: 800, localStorage: { getItem: () => null } };
  function load(file) {
    const absolute = path.resolve(root, file);
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const module = { exports: {} };
    cache.set(absolute, module);
    const { code } = transformSync(fs.readFileSync(absolute, 'utf8'), { loader: 'ts', format: 'cjs', target: 'node18', define: { 'import.meta.env': JSON.stringify({ ...env, DEV: false }) } });
    const localRequire = (id) => {
      if (Object.hasOwn(mocks, id)) return mocks[id];
      if (id.startsWith('.')) return load(path.resolve(path.dirname(absolute), `${id}.ts`));
      return require(id);
    };
    vm.runInNewContext(code, { ...globals, module, exports: module.exports, require: localRequire, __dirname: path.dirname(absolute) }, { filename: absolute });
    return module.exports;
  }
  return { load, calls, listeners, timers, settings, env };
}

function keys(h) {
  const environment = h.load('src/services/EnvironmentService.ts').EnvironmentService.getInstance();
  environment.initialize('/extension');
  return { environment, getOpenAIKey: h.load('src/config/apiKey.ts').getOpenAIKey };
}

for (const scenario of [
  { name: 'settings override process environment and dotenv', settings: { 'meridian.openaiApiKey': ' configured-value ' }, env: { OPENAI_API_KEY: 'environment-value' }, dotenv: { OPENAI_API_KEY: 'file-value' }, expected: 'configured-value' },
  { name: 'process environment overrides dotenv', env: { OPENAI_API_KEY: ' environment-value ' }, dotenv: { OPENAI_API_KEY: 'file-value' }, expected: 'environment-value' },
  { name: 'dotenv is used when no explicit key exists', dotenv: { OPENAI_API_KEY: 'file-value' }, expected: 'file-value' },
  { name: 'blank settings fall back to environment', settings: { 'meridian.openaiApiKey': '   ' }, env: { OPENAI_API_KEY: 'environment-value' }, expected: 'environment-value' },
  { name: 'missing credentials have no embedded fallback', expected: undefined },
]) {
  test(scenario.name, () => {
    const { environment, getOpenAIKey } = keys(harness(scenario));
    // Compare without printing a credential if the implementation regresses.
    assert.ok(environment.getOpenAIApiKey() === scenario.expected, 'environment resolver returned the expected source');
    assert.ok(getOpenAIKey() === scenario.expected, 'public resolver returned the expected source');
  });
}

test('settings changes are reflected without retaining a stale configured key', () => {
  const h = harness({ settings: { 'meridian.openaiApiKey': 'first-value' }, env: { OPENAI_API_KEY: 'environment-value' } });
  const { environment, getOpenAIKey } = keys(h);
  h.settings['meridian.openaiApiKey'] = '';
  assert.ok(environment.getOpenAIApiKey() === 'environment-value');
  assert.ok(getOpenAIKey() === 'environment-value');
});

test('Firebase is not initialized or contacted by default', async () => {
  const h = harness();
  const firebase = h.load('src/services/FirebaseLoggingService.ts').FirebaseLoggingService.getInstance();
  await firebase.uploadTelemetryEvents([{ sessionId: 'test', timestamp: 1, type: 'test', data: {} }]);
  await firebase.flushQueue();
  assert.equal(h.calls.firebase.length, 0);
  assert.equal(firebase.isFirebaseEnabled(), false);
});

test('Firebase opt-in without supplied configuration stays disabled', () => {
  const h = harness();
  const firebase = h.load('src/services/FirebaseLoggingService.ts').FirebaseLoggingService.getInstance();
  firebase.setEnabled(true);
  assert.equal(firebase.isFirebaseEnabled(), false);
  assert.equal(h.calls.firebase.length, 0);
});

test('invalid Firebase configuration fails closed without initialization', () => {
  for (const config of ['not-json', '{}', 'null']) {
    const h = harness({ env: { FIREBASE_CONFIG: config } });
    const firebase = h.load('src/services/FirebaseLoggingService.ts').FirebaseLoggingService.getInstance();
    firebase.setEnabled(true);
    assert.equal(firebase.isFirebaseEnabled(), false);
    assert.equal(h.calls.firebase.length, 0);
  }
});

test('Firebase requires explicit enablement even when configured', async () => {
  const h = harness({ env: { FIREBASE_CONFIG: JSON.stringify({ projectId: 'test-project', apiKey: 'test-key', appId: 'test-app' }) } });
  const firebase = h.load('src/services/FirebaseLoggingService.ts').FirebaseLoggingService.getInstance();
  assert.equal(h.calls.firebase.length, 0);
  firebase.setEnabled(true);
  assert.equal(firebase.isFirebaseEnabled(), true);
  assert.equal(h.calls.firebase[0][1].projectId, 'test-project');
  await firebase.uploadTelemetryEvents([{ sessionId: 'test', timestamp: 1, type: 'test', data: {} }]);
  assert.ok(h.calls.firebase.some(([operation]) => operation === 'commit'));
  firebase.setEnabled(false);
  const previous = h.calls.firebase.length;
  await firebase.uploadTelemetryEvents([{ sessionId: 'test', timestamp: 2, type: 'test', data: {} }]);
  assert.equal(h.calls.firebase.length, previous);
});

test('backend drops every event type while recording is off', async () => {
  const h = harness();
  const telemetry = h.load('src/services/TelemetryService.ts').TelemetryService.getInstance({ subscriptions: [] });
  telemetry.recordTelemetryEvent('test', { private: 'content' });
  telemetry.recordRRWebEvent({ private: 'snapshot' });
  telemetry.recordInstrumentationEvent({ eventType: 'interaction', category: 'general', action: 'test', details: {}, viewport: { width: 1, height: 1 } });
  telemetry.recordAnaletEvent('analet_created', 1, { private: 'analysis' });
  telemetry.recordCellEvent('cell_executed', '/notebook', 'cell-1', 0, undefined, { private: 'variables' });
  await telemetry.flushAll();
  telemetry.dispose();
  assert.equal(telemetry.isInstrumentationActive(), false);
  assert.equal(h.calls.writes.length, 0);
  assert.equal(h.calls.firebase.length, 0);
});

test('backend records only after opt-in and discards queued events on opt-out', async () => {
  const h = harness();
  const telemetry = h.load('src/services/TelemetryService.ts').TelemetryService.getInstance({ subscriptions: [] });
  telemetry.setInstrumentationEnabled(true);
  telemetry.recordTelemetryEvent('first', { selected: 'content' });
  await telemetry.flushAll();
  assert.equal(h.calls.writes.length, 1);
  telemetry.recordTelemetryEvent('discard', { private: 'queued' });
  telemetry.setInstrumentationEnabled(false);
  await telemetry.flushAll();
  telemetry.dispose();
  assert.equal(h.calls.writes.length, 1);
  assert.equal(h.calls.firebase.length, 0);
});

test('webview sends no telemetry or replay until recording is enabled', () => {
  const h = harness();
  const telemetry = h.load('webview-ui/src/services/TelemetryService.ts').TelemetryService.getInstance();
  telemetry.recordEvent('test', { private: 'content' });
  telemetry.sendRRWebEvents([{ private: 'snapshot' }]);
  for (const tick of h.timers) tick();
  telemetry.dispose();
  assert.equal(h.calls.recordings.length, 0);
  assert.deepEqual(h.calls.messages.map(({ type }) => type), ['get-instrumentation-status']);
});

test('webview opt-out discards queued events and replay', () => {
  const h = harness();
  const telemetry = h.load('webview-ui/src/services/TelemetryService.ts').TelemetryService.getInstance();
  telemetry.setInstrumentationEnabled(true);
  telemetry.recordEvent('discard', { private: 'queued' });
  h.calls.recordings[0].emit({ private: 'snapshot' });
  telemetry.setInstrumentationEnabled(false);
  for (const tick of h.timers) tick();
  telemetry.dispose();
  assert.deepEqual(h.calls.messages.map(({ type }) => type), ['get-instrumentation-status']);
});

test('enabled webview replay masks text and input values', () => {
  const h = harness();
  const telemetry = h.load('webview-ui/src/services/TelemetryService.ts').TelemetryService.getInstance();
  telemetry.setInstrumentationEnabled(true);
  assert.equal(h.calls.recordings[0].maskAllInputs, true);
  assert.equal(h.calls.recordings[0].maskTextSelector, '*');
  telemetry.dispose();
});


test('study features require an explicit build flag on both sides', () => {
  for (const file of ['src/utils/featureFlags.ts', 'webview-ui/src/utils/featureFlags.ts']) {
    assert.equal(harness().load(file).FeatureFlags.STUDY_MODE_ENABLED, false);
    assert.equal(harness({ env: { STUDY_MODE: 'true', VITE_STUDY_MODE: 'true' } }).load(file).FeatureFlags.STUDY_MODE_ENABLED, true);
    assert.equal(harness({ env: { STUDY_MODE: 'false', VITE_STUDY_MODE: 'false' } }).load(file).FeatureFlags.STUDY_MODE_ENABLED, false);
  }
});

test('explicit study opt-out overrides an enabled study build', () => {
  const h = harness({ settings: { 'meridian.disableStudyMode': true }, env: { STUDY_MODE: 'true' } });
  assert.equal(h.load('src/utils/featureFlags.ts').FeatureFlags.STUDY_MODE_ENABLED, false);
});

test('failure logs do not persist prompts or dataset content by default', async () => {
  const h = harness();
  await h.load('src/services/logging/FailureLogger.ts').appendCellQLFailure({ phase: 'llm_call', prompts: { user: 'private input' }, datasetContext: 'private data' });
  assert.equal(h.calls.writes.length, 0);
  assert.equal(h.calls.directories.length, 0);
});

test('failure logs follow the current recording opt-in and workspace log path', async () => {
  const h = harness();
  const telemetry = h.load('src/services/TelemetryService.ts').TelemetryService.getInstance({ subscriptions: [] });
  const { appendCellQLFailure } = h.load('src/services/logging/FailureLogger.ts');
  telemetry.setInstrumentationEnabled(true);
  await appendCellQLFailure({ phase: 'llm_call', prompts: { user: 'selected input' } });
  assert.equal(h.calls.writes.length, 1);
  assert.equal(h.calls.writes[0].file, '/workspace/.meridian/logs/sessions/cellql-failures.log.jsonl');
  telemetry.setInstrumentationEnabled(false);
  await appendCellQLFailure({ phase: 'llm_call', prompts: { user: 'private input' } });
  assert.equal(h.calls.writes.length, 1);
  telemetry.dispose();
});

test('configured Firebase still requires the recording opt-in', async () => {
  const h = harness({
    settings: { 'meridian.firebase.enabled': true },
    env: { FIREBASE_CONFIG: JSON.stringify({ projectId: 'test-project', apiKey: 'test-key', appId: 'test-app' }) },
  });
  const telemetry = h.load('src/services/TelemetryService.ts').TelemetryService.getInstance({ subscriptions: [] });
  telemetry.recordTelemetryEvent('discard', {});
  await telemetry.flushAll();
  assert.equal(h.calls.firebase.length, 0);
  assert.equal(h.calls.writes.length, 0);
  telemetry.setInstrumentationEnabled(true);
  telemetry.recordTelemetryEvent('selected', {});
  await telemetry.flushAll();
  assert.equal(h.calls.writes.length, 1);
  assert.ok(h.calls.firebase.some(([operation]) => operation === 'commit'));
  telemetry.setInstrumentationEnabled(false);
  const previous = h.calls.firebase.length;
  telemetry.recordTelemetryEvent('discard', {});
  await telemetry.flushAll();
  assert.equal(h.calls.firebase.length, previous);
  telemetry.dispose();
});
