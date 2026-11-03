/**
 * Command interfaces for analet generation
 * These represent the different ways analets can be created
 */

import { EnhancedColumnDefinition } from '../../../schemas/openai-schemas';

export interface BaseGenerationCommand {
  type: string;
  position?: { x: number; y: number };
  metadata?: Record<string, any>;
}

export interface StatementGenerationCommand extends BaseGenerationCommand {
  type: 'from_statement';
  statement: string;
  statementId?: string;
  maxCount?: number;
}

export interface NotebookGenerationCommand extends BaseGenerationCommand {
  type: 'from_notebook';
  cellContent: string;
  cellIndex: number;
  filePath: string;
  notebookMetadata?: {
    cellId?: string;
    changeType?: 'new' | 'modified';
    existingAnaletId?: number;
  };
}

export interface FramingGenerationCommand extends BaseGenerationCommand {
  type: 'from_framing';
  datasetContext: string;
  columnDefinitions?: EnhancedColumnDefinition[];
  datasetName?: string;
}

// Random generation removed - promoting framing analets is an edit operation, not generation

export interface EmbeddingGenerationCommand extends BaseGenerationCommand {
  type: 'from_embedding';
  nearestAnalets: any[]; // Analet type from main types
  cursorPosition: { x: number; y: number };
  count?: number;
}

export interface DerivationGenerationCommand extends BaseGenerationCommand {
  type: 'from_derivation';
  sourceAnalet: any; // Analet type from main types
  derivationPrompt: string;
  variationCount?: number;
}

export interface FocusGenerationCommand extends BaseGenerationCommand {
  type: 'from_focus';
  bearingId: number;
  bearingStatement: string;
  memberAnalets?: any[]; // Existing analets associated with the bearing
  count?: number;
}

export type GenerationCommand = 
  | StatementGenerationCommand
  | NotebookGenerationCommand  
  | FramingGenerationCommand
  | EmbeddingGenerationCommand
  | DerivationGenerationCommand
  | FocusGenerationCommand;

/**
 * Request wrapper for generation commands
 */
export interface GenerationRequest {
  command: GenerationCommand;
  requestId?: string;
  timestamp?: string;
}