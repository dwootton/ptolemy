import { FeatureFlags } from '../../../utils/featureFlags';

/**
 * Domain Message Handlers - Export all implemented handlers
 *
 * This index file provides a single entry point for all domain-specific message handlers
 * in the modular messaging architecture. Each handler focuses on a specific domain of
 * functionality while maintaining consistent patterns and error handling.
 */

export { AnaletMessageHandler } from './AnaletMessageHandler';
export { AnalysisNoteMessageHandler } from './AnalysisNoteMessageHandler';
export { DatasetMessageHandler } from './DatasetMessageHandler';
export { FileSystemMessageHandler } from './FileSystemMessageHandler';
export { SystemMessageHandler } from './SystemMessageHandler';
export { UIStateMessageHandler } from './UIStateMessageHandler';
export { SemanticLayerMessageHandler } from './SemanticLayerMessageHandler';
export { NotebookMessageHandler } from './NotebookMessageHandler';
export { CheckpointMessageHandler } from './CheckpointMessageHandler';
export { HierarchyMessageHandler } from './HierarchyMessageHandler';
export { WorkspaceMessageHandler } from './WorkspaceMessageHandler';
export { BearingMetricsMessageHandler } from './BearingMetricsMessageHandler';

// Study handler is conditionally imported at runtime, not exported here

/**
 * Handler registry for validation and debugging
 */
// Base handler registry
const BASE_HANDLER_REGISTRY = {
  'analet': 'AnaletMessageHandler',
  'analysis-note': 'AnalysisNoteMessageHandler',
  'dataset': 'DatasetMessageHandler',
  'filesystem': 'FileSystemMessageHandler',
  'system': 'SystemMessageHandler',
  'ui-state': 'UIStateMessageHandler',
  'semantic': 'SemanticLayerMessageHandler',
  'notebook': 'NotebookMessageHandler',
  'checkpoint': 'CheckpointMessageHandler',
  'hierarchy': 'HierarchyMessageHandler',
  'workspace': 'WorkspaceMessageHandler'
} as const;


// Conditionally add study handler to registry
export const HANDLER_REGISTRY = (() => {
  const registry = { ...BASE_HANDLER_REGISTRY };

  if (FeatureFlags.STUDY_MODE_ENABLED) {
    (registry as any)['study'] = 'StudyApplicationMessageHandler';
  }

  return registry;
})();

/**
 * Base message types covered by the modular handlers
 */
const BASE_COVERED_MESSAGE_TYPES = [
  // AnaletMessageHandler (9 types)
  'generate-analyses',
  'add-waypoint-analets',
  'create-analet',
  'derive-analet',
  'delete-analet',
  'update-analet',
  'perturb-analet',
  'accept-ai-explanation',
  'generate-analets-from-statement',

  // AnalysisNoteMessageHandler (7 types)
  'create-analysis-note',
  'update-analysis-note',
  'delete-analysis-note',
  'get-analysis-notes',
  'restore-analysis-note',
  'create-note-from-cell',
  'create-note',

  // DatasetMessageHandler (8 types)
  'analyze-dataset',
  'clear-dataset',
  'request-dataset-data',
  'get-column-values',
  'generate-column-definitions',
  'generate-column-descriptions',
  'generate-variable-relationships',
  'save-dataset',

  // FileSystemMessageHandler (6 types)
  'getFiles',
  'openFile',
  'create-folder',
  'delete-file',
  'rename-file',
  'moveFile',

  // SystemMessageHandler (9 types)
  'purge-all-data',
  'cancel-all-operations',
  'telemetry-event',
  'track-activity',
  'ready',
  'webview-initialized',
  'error',
  'get-extension-info',
  'clear-cache',

  // UIStateMessageHandler (7 types)
  'save-ui-state',
  'save-hierarchy-state',
  'load-hierarchy-state',
  'save-analet-constraints',
  'load-analet-constraints',
  'save-materialized-analets',
  'load-materialized-analets',

  // SemanticLayerMessageHandler (9 types)
  'save-semantic-layer',
  'load-semantic-layer',
  'export-semantic-layer-yaml',
  'save-conceptual-statements',
  'save-variable-modifications',
  'generate-value-annotations',
  'generate-embedding-description',
  'generate-bearing-embedding',
  'modify-variable-value',

  // NotebookMessageHandler (5 types - REFACTORED)
  'create-notebook-from-analet',
  'create-notebook',
  'notebook-cell-selected',
  'sync-notebooks',
  'load-notebook-hierarchy',
  'reconcile-notebook-metadata',

  // CheckpointMessageHandler (5 types)
  'checkpoint-operation',
  'get-checkpoints',
  'restore-checkpoint',
  'save-checkpoint',
  'delete-checkpoint'
  ,
  // HierarchyMessageHandler
  'edges-list',
  'edges-add',
  'edges-remove',
  'edges-reorder',
  'edges-move',
  'edges-clear',
  'hierarchy-children',
  'hierarchy-view',
  'hierarchy-snapshot-save',
  'hierarchy-snapshot-load'
  ,
  // WorkspaceMessageHandler
  'workspace:choose',
  'workspace:switch',
  'workspace:info'
  ,
  // BearingMetricsMessageHandler
  'bearing-metrics-load',
  'bearing-metrics-update',
  'bearing-jump'
] as const;

// Study message types (only included in study builds)
const STUDY_MESSAGE_TYPES = [
  'study:initialize',
  'study:initialize-with-code',
  'study:get-current-config',
  'study:get-progress',
  'study:get-restore-info',
  'study:restore-session',
  'study:advance-stage',
  'study:goto-stage',
  'study:switch-workspace',
  'study:finish-condition',
  'study:reset',
  'study:export-config'
] as const;

/**
 * All message types covered by the modular handlers
 * Conditionally includes study types based on build mode
 */
export const COVERED_MESSAGE_TYPES = (() => {
  let types: string[] = [...BASE_COVERED_MESSAGE_TYPES];

  // Add study message types if in study build
  if (FeatureFlags.STUDY_MODE_ENABLED) {
    types = [...types, ...STUDY_MESSAGE_TYPES];
  }

  return types as readonly string[];
})();

/**
 * Handler configuration for the MessageRouter
 */
export interface HandlerConfig {
  handler: string;
  messageTypes: string[];
  consolidationNotes?: string[];
}

/**
 * Base handler map
 */
const BASE_HANDLER_MAP: Record<string, string> = {
    // AnaletMessageHandler
    'generate-analyses': 'AnaletMessageHandler',
    'add-waypoint-analets': 'AnaletMessageHandler',
    'create-analet': 'AnaletMessageHandler',
    'derive-analet': 'AnaletMessageHandler',
    'delete-analet': 'AnaletMessageHandler',
    'update-analet': 'AnaletMessageHandler',
    'perturb-analet': 'AnaletMessageHandler',
    'accept-ai-explanation': 'AnaletMessageHandler',
    'generate-analets-from-statement': 'AnaletMessageHandler',

    // AnalysisNoteMessageHandler
    'create-analysis-note': 'AnalysisNoteMessageHandler',
    'update-analysis-note': 'AnalysisNoteMessageHandler',
    'delete-analysis-note': 'AnalysisNoteMessageHandler',
    'get-analysis-notes': 'AnalysisNoteMessageHandler',
    'restore-analysis-note': 'AnalysisNoteMessageHandler',
    'create-note-from-cell': 'AnalysisNoteMessageHandler',
    'create-note': 'AnalysisNoteMessageHandler',
    'create-blank-note': 'AnalysisNoteMessageHandler',
    'create-map-note': 'AnalysisNoteMessageHandler',
    'clear-all-notes': 'AnalysisNoteMessageHandler',

    // DatasetMessageHandler
    'analyze-dataset': 'DatasetMessageHandler',
    'clear-dataset': 'DatasetMessageHandler',
    'request-dataset-data': 'DatasetMessageHandler',
    'get-column-values': 'DatasetMessageHandler',
    'generate-column-definitions': 'DatasetMessageHandler',
    'generate-column-descriptions': 'DatasetMessageHandler',
    'generate-variable-relationships': 'DatasetMessageHandler',
    'save-dataset': 'DatasetMessageHandler',

    // FileSystemMessageHandler
    'getFiles': 'FileSystemMessageHandler',
    'openFile': 'FileSystemMessageHandler',
    'create-folder': 'FileSystemMessageHandler',
    'delete-file': 'FileSystemMessageHandler',
    'rename-file': 'FileSystemMessageHandler',
    'moveFile': 'FileSystemMessageHandler',

    // SystemMessageHandler
    'purge-all-data': 'SystemMessageHandler',
    'cancel-all-operations': 'SystemMessageHandler',
    'telemetry-event': 'SystemMessageHandler',
    'track-activity': 'SystemMessageHandler',
    'rrweb-event': 'SystemMessageHandler',
    'instrumentation-event': 'SystemMessageHandler',
    'set-instrumentation-enabled': 'SystemMessageHandler',
    'get-instrumentation-status': 'SystemMessageHandler',
    'ready': 'SystemMessageHandler',
    'webview-initialized': 'SystemMessageHandler',
    'error': 'SystemMessageHandler',
    'get-extension-info': 'SystemMessageHandler',
    'clear-cache': 'SystemMessageHandler',

    // UIStateMessageHandler
    'save-ui-state': 'UIStateMessageHandler',
    'save-hierarchy-state': 'UIStateMessageHandler',
    'load-hierarchy-state': 'UIStateMessageHandler',
    'save-analet-constraints': 'UIStateMessageHandler',
    'load-analet-constraints': 'UIStateMessageHandler',
    'save-materialized-analets': 'UIStateMessageHandler',
    'load-materialized-analets': 'UIStateMessageHandler',

    // SemanticLayerMessageHandler
    'save-semantic-layer': 'SemanticLayerMessageHandler',
    'load-semantic-layer': 'SemanticLayerMessageHandler',
    'export-semantic-layer-yaml': 'SemanticLayerMessageHandler',
    'save-conceptual-statements': 'SemanticLayerMessageHandler',
    'save-variable-modifications': 'SemanticLayerMessageHandler',
    'generate-value-annotations': 'SemanticLayerMessageHandler',
    'generate-embedding-description': 'AnaletMessageHandler',
    'generate-bearing-embedding': 'SemanticLayerMessageHandler',
    'modify-variable-value': 'SemanticLayerMessageHandler',

    // NotebookMessageHandler (REFACTORED)
    'create-notebook': 'NotebookMessageHandler',
    'create-notebook-from-analet': 'NotebookMessageHandler',
    'notebook-cell-selected': 'NotebookMessageHandler',
    'sync-notebooks': 'NotebookMessageHandler',
    'load-notebook-hierarchy': 'NotebookMessageHandler',
    'reconcile-notebook-metadata': 'NotebookMessageHandler',

    // CheckpointMessageHandler
    'checkpoint-operation': 'CheckpointMessageHandler',
    'get-checkpoints': 'CheckpointMessageHandler',
    'restore-checkpoint': 'CheckpointMessageHandler',
    'save-checkpoint': 'CheckpointMessageHandler',
    'delete-checkpoint': 'CheckpointMessageHandler',

    // HierarchyMessageHandler
    'edges-list': 'HierarchyMessageHandler',
    'edges-add': 'HierarchyMessageHandler',
    'edges-remove': 'HierarchyMessageHandler',
    'edges-reorder': 'HierarchyMessageHandler',
    'edges-move': 'HierarchyMessageHandler',
    'edges-clear': 'HierarchyMessageHandler',
    'hierarchy-children': 'HierarchyMessageHandler',
    'hierarchy-view': 'HierarchyMessageHandler',
    'hierarchy-snapshot-save': 'HierarchyMessageHandler',
    'hierarchy-snapshot-load': 'HierarchyMessageHandler',

    // WorkspaceMessageHandler
    'workspace:choose': 'WorkspaceMessageHandler',
    'workspace:switch': 'WorkspaceMessageHandler',
    'workspace:info': 'WorkspaceMessageHandler'
    ,
    // BearingMetricsMessageHandler
    'bearing-metrics-load': 'BearingMetricsMessageHandler',
    'bearing-metrics-update': 'BearingMetricsMessageHandler',
    'bearing-jump': 'BearingMetricsMessageHandler'
};

// Study handler mappings (only in study builds)
const STUDY_HANDLER_MAP: Record<string, string> = {
    'study:initialize': 'StudyApplicationMessageHandler',
    'study:initialize-with-code': 'StudyApplicationMessageHandler',
    'study:get-current-config': 'StudyApplicationMessageHandler',
    'study:get-progress': 'StudyApplicationMessageHandler',
    'study:get-restore-info': 'StudyApplicationMessageHandler',
    'study:restore-session': 'StudyApplicationMessageHandler',
    'study:advance-stage': 'StudyApplicationMessageHandler',
    'study:goto-stage': 'StudyApplicationMessageHandler',
    'study:switch-workspace': 'StudyApplicationMessageHandler',
    'study:finish-condition': 'StudyApplicationMessageHandler',
    'study:reset': 'StudyApplicationMessageHandler',
    'study:export-config': 'StudyApplicationMessageHandler'
};

/**
 * Utility function to get handler by message type
 */
export function getHandlerForMessageType(messageType: string): string | null {
  // Create the complete handler map conditionally
  let handlerMap = { ...BASE_HANDLER_MAP };

  // Add study handlers if in study build
  if (FeatureFlags.STUDY_MODE_ENABLED) {
    handlerMap = { ...handlerMap, ...STUDY_HANDLER_MAP };
  }

  return handlerMap[messageType] || null;
}

/**
 * Utility function to validate message coverage
 */
export function validateMessageCoverage(requiredTypes: string[]): {
  coverage: number;
  missing: string[];
  extra: string[];
} {
  const covered = new Set(COVERED_MESSAGE_TYPES as readonly string[]);
  const required = new Set(requiredTypes);

  const missing = requiredTypes.filter(type => !covered.has(type));
  const extra = (COVERED_MESSAGE_TYPES as readonly string[]).filter(type => !required.has(type));

  return {
    coverage: (requiredTypes.length - missing.length) / requiredTypes.length,
    missing,
    extra
  };
}
