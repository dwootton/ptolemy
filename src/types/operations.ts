/**
 * Core operation management types for modular REST API-like architecture
 */

export type OperationType = 'dataset-load' | 'dataset-analyze' | 'dataset-restore' | 'dataset-clear' | 
                           'analet-generate' | 'analet-update' | 'analet-delete' |
                           'embedding-generate' | 'dimension-generate';

export type OperationStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface OperationCheckpoint {
  operationId: string;
  stage: string;
  progress: number;
  data: any;
  timestamp: string;
  nextStage?: string;
}

export interface OperationConfig {
  type: OperationType;
  data: any;
  options?: {
    priority?: 'low' | 'normal' | 'high';
    timeout?: number;
    retries?: number;
    checkpointInterval?: number;
  };
}

export interface DatasetOperation {
  id: string;
  type: OperationType;
  status: OperationStatus;
  progress: number;
  stage: string;
  startTime: number;
  endTime?: number;
  error?: string;
  checkpoint?: OperationCheckpoint;
  abortController: AbortController;
  dependencies?: string[];
  config: OperationConfig;
  result?: any;
}

export interface OperationStatusInfo {
  id: string;
  type: OperationType;
  status: OperationStatus;
  progress: number;
  stage: string;
  error?: string;
  estimatedTimeRemaining?: number;
  canCancel: boolean;
  canPause: boolean;
  canResume: boolean;
}

export interface PipelineStage {
  name: string;
  execute(operation: DatasetOperation, signal: AbortSignal): Promise<OperationCheckpoint>;
  canSkip?(operation: DatasetOperation): Promise<boolean>;
  rollback?(operation: DatasetOperation): Promise<void>;
}

export class OperationCancelledError extends Error {
  constructor(operationId: string) {
    super(`Operation ${operationId} was cancelled`);
    this.name = 'OperationCancelledError';
  }
}

export class OperationTimeoutError extends Error {
  constructor(operationId: string, timeout: number) {
    super(`Operation ${operationId} timed out after ${timeout}ms`);
    this.name = 'OperationTimeoutError';
  }
}

// Event types for operation updates
export interface OperationEvent {
  type: 'operation-started' | 'operation-progress' | 'operation-completed' | 'operation-failed' | 'operation-cancelled';
  operationId: string;
  operation: DatasetOperation;
  timestamp: string;
}

// State synchronization types
export interface StateEntity {
  id: string;
  type: string;
  data: any;
  version: number;
  lastModified: string;
}

export interface StateSubscriber {
  id: string;
  onStateChange(entity: StateEntity): Promise<void>;
}

export interface StateSyncEvent {
  entityId: string;
  entityType: string;
  changeType: 'created' | 'updated' | 'deleted';
  data: any;
  timestamp: string;
}