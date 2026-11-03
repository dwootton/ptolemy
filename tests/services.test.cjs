const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { transformSync } = require('esbuild');

function loadService(file, mocks = {}, globals = {}) {
  const absolute = path.resolve(__dirname, '..', file);
  const module = { exports: {} };
  const { code } = transformSync(fs.readFileSync(absolute, 'utf8'), { loader: 'ts', format: 'cjs' });
  const localRequire = (id) => {
    if (Object.hasOwn(mocks, id)) return mocks[id];
    if (id.startsWith('.')) return loadService(path.resolve(path.dirname(absolute), `${id}.ts`), mocks, globals);
    return require(id);
  };
  vm.runInNewContext(code, {
    module, exports: module.exports, require: localRequire,
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, ...globals,
  }, { filename: absolute });
  return module.exports;
}

const llmMock = { '../../llm/NewOpenAIService': { NewOpenAIService: {} } };

async function semanticHandler(stateService) {
  const { SemanticLayerMessageHandler } = loadService('src/services/messaging/handlers/SemanticLayerMessageHandler.ts', llmMock);
  const handler = new SemanticLayerMessageHandler();
  const messages = [];
  const context = { stateService, messageRouter: { sendMessage: async (type, data) => messages.push({ type, data }) } };
  await handler.initialize(context);
  return { handler, context, messages };
}

test('pipeline carries outputs through branches and reports success/failure counts', async () => {
  const { PipelineEngine } = loadService('src/services/pipeline/PipelineEngine.ts');
  const engine = new PipelineEngine();
  const result = await engine.run({ name: 'root', nodes: [
    { type: 'via', name: 'seed', stage: { name: 'seed', handler: async () => [2, 3] } },
    { type: 'flatMap', name: 'branch', buildChild: () => ({ name: 'child', nodes: [
      { type: 'via', name: 'double', stage: { name: 'double', handler: async (n) => {
        if (n === 3) throw new Error('invalid input');
        return n * 2;
      } } },
    ] }) },
  ] });
  assert.equal(result.stats.totalTasks, 3);
  assert.equal(result.stats.successes, 2);
  assert.equal(result.stats.errors, 1);
  assert.equal(result.errors[0].error, 'invalid input');
  assert.equal(result.resultTree[0].children[0].children[0].children[0].output, 4);
});

test('notebook execution events coalesce and retain error details', () => {
  const timers = new Map();
  let timerId = 0;
  const { NotebookWatcherService } = loadService('src/services/NotebookWatcherService.ts', {
    vscode: {}, './TelemetryService': {}, './NotebookLinkService': {}, './ActiveWorkspaceManager': {},
  }, {
    setTimeout: (callback) => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: (id) => timers.delete(id),
  });
  const watcher = NotebookWatcherService.getInstance();
  const events = [];
  watcher.telemetryService = { recordCellEvent: (...event) => events.push(event) };
  watcher.queueExecutionEvent({ notebookPath: 'analysis.ipynb', cellId: 'cell-1', cellIndex: 0, action: 'execute', hasError: true, errorName: 'ValueError' });
  watcher.queueExecutionEvent({ notebookPath: 'analysis.ipynb', cellId: 'cell-1', cellIndex: 0, action: 'output_change', outputText: 'invalid value', hasError: false });
  assert.equal(timers.size, 1);
  [...timers.values()][0]();
  assert.equal(events.length, 1);
  assert.equal(events[0][6], 'invalid value');
  assert.equal(events[0][7], 'execute');
  assert.equal(events[0][8].hasError, true);
  assert.equal(events[0][8].errorName, 'ValueError');
  watcher.dispose();
});

test('semantic layer responses contain resolved persisted data', async () => {
  const statements = [{ id: 1, text: 'Explore revenue' }];
  const modifications = { revenue: { name: 'revenue', comments: [] } };
  const { handler, context, messages } = await semanticHandler({
    loadConceptualStatements: async () => statements,
    loadVariableModifications: async () => modifications,
  });
  await handler.handle('load-semantic-layer', {}, context);
  assert.equal(messages[0].data.semanticLayer.conceptualStatements, statements);
  assert.equal(messages[0].data.semanticLayer.variableModifications, modifications);
});

test('saving value annotations preserves existing modifications and waits for persistence', async () => {
  const modifications = { revenue: { name: 'revenue', comments: [], unit: 'USD' } };
  const annotations = { '0': { annotation: 'No revenue', isAIGenerated: false, isHumanEdited: true } };
  let persisted;
  let releaseSave;
  const saved = new Promise((resolve) => { releaseSave = resolve; });
  const { handler, context, messages } = await semanticHandler({
    loadVariableModifications: async () => modifications,
    saveVariableModifications: async (data) => { persisted = data; await saved; },
  });
  const operation = handler.handle('save-value-annotations', { column: 'revenue', annotations }, context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(messages.length, 0);
  releaseSave();
  await operation;
  assert.equal(persisted.revenue.unit, 'USD');
  assert.equal(persisted.revenue.valueAnnotations, annotations);
  assert.equal(messages[0].type, 'value-annotations-save-response');
});

test('workspace checkpoint switching routes restoration through the checkpoint handler', async () => {
  const calls = [];
  const { WorkspaceMessageHandler } = loadService('src/services/messaging/handlers/WorkspaceMessageHandler.ts', {
    vscode: {},
    '../../ActiveWorkspaceManager': { ActiveWorkspaceManager: { getInstance: () => ({ setActiveWorkspacePath: async (root) => calls.push(['workspace', root]) }) } },
    '../../TelemetryService': { TelemetryService: { getInstance: () => ({ refreshPathsFromActiveWorkspace: () => {} }) } },
    '../../AnaletCheckpointService': {},
  });
  const handler = new WorkspaceMessageHandler();
  const context = {
    stateService: { getContext: () => ({}) },
    messageRouter: {
      handleMessage: async (message) => calls.push(['restore', message.type, message.data.filePath]),
      sendMessage: async (type) => calls.push(['response', type]),
    },
  };
  await handler.initialize(context);
  await handler.handle('workspace:switch-to-checkpoint', { filePath: '/workspace/.meridian/checkpoints/sample.json' }, context);
  assert.deepEqual(calls, [['workspace', '/workspace'], ['restore', 'restore-checkpoint-file', '/workspace/.meridian/checkpoints/sample.json']]);
});

test('message requests handle VS Code thenables that reject without a catch method', async () => {
  const cleared = [];
  const { MessageRouter } = loadService('src/services/messaging/MessageRouter.ts', {}, {
    setTimeout: () => 1,
    clearTimeout: (timer) => cleared.push(timer),
  });
  const router = new MessageRouter({ postMessage: () => ({ then: (_resolve, reject) => reject(new Error('send failed')) }) }, {});
  await assert.rejects(router.sendRequest('fetch-state'), /send failed/);
  assert.equal(router.pendingRequests.size, 0);
  assert.deepEqual(cleared, [1]);
});
