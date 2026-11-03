/**
 * Domain events for analet operations
 * These represent things that have happened in the system
 */

import { Analet } from '../../../types/analet';

export interface BaseAnaletEvent {
  type: string;
  timestamp: string;
  requestId?: string;
  metadata?: Record<string, any>;
}

export interface AnaletGenerationStartedEvent extends BaseAnaletEvent {
  type: 'analet_generation_started';
  command: any; // GenerationCommand type
}

export interface AnaletGenerationCompletedEvent extends BaseAnaletEvent {
  type: 'analet_generation_completed';
  analets: Analet[];
  generationTime: number;
  source: string;
  inputSummary: string;
}

export interface AnaletGenerationFailedEvent extends BaseAnaletEvent {
  type: 'analet_generation_failed';
  error: string;
  command: any; // GenerationCommand type
}

export interface AnaletCreatedEvent extends BaseAnaletEvent {
  type: 'analet_created';
  analet: Analet;
  source: 'generation' | 'update' | 'import';
}

export interface AnaletUpdatedEvent extends BaseAnaletEvent {
  type: 'analet_updated';
  analet: Analet;
  previousAnalet?: Analet;
  changes: string[]; // List of changed fields
}

export interface AnaletDeletedEvent extends BaseAnaletEvent {
  type: 'analet_deleted';
  analetId: number;
  deletedAnalet: Analet;
}

export interface AnaletsBulkUpdatedEvent extends BaseAnaletEvent {
  type: 'analets_bulk_updated';
  analets: Analet[];
  updateType: 'sync' | 'projection' | 'bulk_edit';
}

export interface StateSyncEvent extends BaseAnaletEvent {
  type: 'state_sync';
  syncType: 'to_workspace' | 'to_frontend' | 'from_notebook';
  analetCount: number;
  success: boolean;
  error?: string;
}

export type AnaletEvent = 
  | AnaletGenerationStartedEvent
  | AnaletGenerationCompletedEvent
  | AnaletGenerationFailedEvent
  | AnaletCreatedEvent
  | AnaletUpdatedEvent
  | AnaletDeletedEvent
  | AnaletsBulkUpdatedEvent
  | StateSyncEvent;

/**
 * Event listener type
 */
export type AnaletEventListener = (event: AnaletEvent) => void | Promise<void>;

/**
 * Event bus interface
 */
export interface AnaletEventBus {
  emit(event: AnaletEvent): Promise<void>;
  subscribe(eventType: AnaletEvent['type'], listener: AnaletEventListener): () => void;
  subscribeToAll(listener: AnaletEventListener): () => void;
  getEventHistory(limit?: number): AnaletEvent[];
}