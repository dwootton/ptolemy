export type TaskId = string;
export type RunId = string;

export interface StageContext {
  runId: RunId;
  parentTaskId?: TaskId;
  signal?: AbortSignal;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

export interface RetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  factor: number;
  jitter: boolean;
}

export interface StageOptions {
  name: string;
  parallelism?: number;
  timeoutMs?: number;
  retryPolicy?: RetryPolicy;
}

export type Stage<I, O> = (input: I, ctx: StageContext) => Promise<O | O[]>;

export interface StageDef<I, O> extends StageOptions {
  handler: Stage<I, O>;
}

export interface PipelineNodeDef<I = any, O = any> {
  type: 'via' | 'flatMap' | 'aggregate';
  name: string;
  stage?: StageDef<I, O>;
  buildChild?: (input: any) => PipelineDefinition;
}

export interface PipelineDefinition {
  name: string;
  nodes: PipelineNodeDef[];
}

export interface EngineOptions {
  emitPartialResults?: false; // forced false per current requirement
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

export interface LineageNode<T = any> {
  id: TaskId;
  stage: string;
  input?: any;
  output?: any;
  children: LineageNode<T>[];
}

export interface RunOutcome<TLeaf = any> {
  resultTree: LineageNode<TLeaf>[]; // forest (roots may be multiple when flatMap at top)
  errors: Array<{ taskId: TaskId; stage: string; error: string; parentTaskId?: TaskId }>;
  stats: {
    totalTasks: number;
    successes: number;
    errors: number;
    startedAt: number;
    finishedAt: number;
    durationMs: number;
  };
}

export interface LoggingHooks {
  onStageCompleted?: (e: {
    runId: RunId;
    taskId: TaskId;
    stage: string;
    durationMs: number;
    outputsCount: number;
  }) => void;
  onBranchCreated?: (e: { runId: RunId; parentTaskId: TaskId; stage: string; childrenCount: number }) => void;
  onPipelineCompleted?: (e: {
    runId: RunId;
    totalTasks: number;
    successes: number;
    errors: number;
    durationMs: number;
  }) => void;
}


