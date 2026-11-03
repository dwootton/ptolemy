import { EngineOptions, LineageNode, LoggingHooks, PipelineDefinition, PipelineNodeDef, RunId, RunOutcome, StageContext, TaskId } from './types';

function generateId(prefix: string = 'task'): TaskId {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export class PipelineEngine {
  private options: EngineOptions;
  private hooks: LoggingHooks;
  private totalTasks: number = 0;
  private successes: number = 0;
  private errorsAcc: RunOutcome['errors'] = [];

  constructor(options?: EngineOptions, hooks?: LoggingHooks) {
    this.options = { emitPartialResults: false, logLevel: 'info', ...options } as EngineOptions;
    this.hooks = hooks || {};
  }

  public async run<T = any>(definition: PipelineDefinition, params?: { runId?: RunId; signal?: AbortSignal }): Promise<RunOutcome<T>> {
    const runId: RunId = params?.runId || generateId('run');
    const startedAt = Date.now();
    this.errorsAcc = [];
    this.totalTasks = 0;
    this.successes = 0;

    // For this MVP, the pipeline starts with an implicit single empty input; the first node must be a 'via' that produces roots
    const roots: LineageNode[] = [];

    // Execute the full definition starting from an implicit seed (undefined)
    const forest = await this.executeDefinition(definition, runId, params?.signal, undefined, undefined);
    roots.push(...forest);

    const finishedAt = Date.now();
    const durationMs = finishedAt - startedAt;
    this.hooks.onPipelineCompleted?.({ runId, totalTasks: this.totalTasks, successes: this.successes, errors: this.errorsAcc.length, durationMs });
    return {
      resultTree: roots,
      errors: this.errorsAcc,
      stats: { totalTasks: this.totalTasks, successes: this.successes, errors: this.errorsAcc.length, startedAt, finishedAt, durationMs }
    };
  }

  private async executeDefinition(def: PipelineDefinition, runId: RunId, signal?: AbortSignal, parentTaskId?: TaskId, seedInput?: any): Promise<LineageNode[]> {
    // Execute nodes in order; carry forward the current set of lineage leaves
    const roots: LineageNode[] = [];
    let current: LineageNode[] = [];
    // Start with a single seed leaf
    const startLeaf: LineageNode = { id: generateId('t'), stage: `${def.name}:start`, children: [], input: undefined, output: seedInput };
    roots.push(startLeaf);
    current.push(startLeaf);

    for (const node of def.nodes) {
      const next: LineageNode[] = [];
      // For each leaf, execute node on its output
      await Promise.all(
        current.map(async (leaf) => {
          const results = await this.execNodeWithCarry(node, leaf.output, runId, signal, leaf.id);
          // Attach results as children of the leaf
          leaf.children.push(...results);
          next.push(...results);
        })
      );
      current = next;
    }

    return roots;
  }

  private async execNodeWithCarry(node: PipelineNodeDef, input: any, runId: RunId, signal?: AbortSignal, parentTaskId?: TaskId): Promise<LineageNode[]> {
    const ctx: StageContext = { runId, parentTaskId, signal, logLevel: this.options.logLevel };
    if (node.type === 'via' && node.stage) {
      const taskId = generateId('t');
      const start = Date.now();
      try {
        this.totalTasks++;
        const out = await node.stage.handler(input, ctx);
        const outputs = Array.isArray(out) ? out : [out];
        this.successes++;
        const durationMs = Date.now() - start;
        this.hooks.onStageCompleted?.({ runId, taskId, stage: node.stage.name, durationMs, outputsCount: outputs.length });
        return outputs.map((o) => ({ id: taskId, stage: node.stage!.name, input, output: o, children: [] }));
      } catch (e: any) {
        const durationMs = Date.now() - start;
        this.errorsAcc.push({ taskId, stage: node.stage.name, error: e?.message || String(e), parentTaskId });
        this.hooks.onStageCompleted?.({ runId, taskId, stage: node.stage.name, durationMs, outputsCount: 0 });
        return [{ id: taskId, stage: node.stage.name, input, output: undefined, children: [] }];
      }
    }

    if (node.type === 'flatMap' && node.buildChild) {
      const items: any[] = Array.isArray(input) ? input : (input ? [input] : []);
      const parent = parentTaskId || generateId('t');
      const children: LineageNode[] = [];
      for (const item of items) {
        const childDef = node.buildChild(item);
        const sub = await this.executeDefinition(childDef, runId, signal, parent, item);
        children.push(...sub);
      }
      this.hooks.onBranchCreated?.({ runId, parentTaskId: parent, stage: node.name, childrenCount: children.length });
      return children;
    }

    if (node.type === 'aggregate') {
      return [
        {
          id: parentTaskId || generateId('t'),
          stage: node.name,
          input,
          output: input,
          children: []
        }
      ];
    }
    return [];
  }
}


