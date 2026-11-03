/**
 * Normalized input types that all adapters convert to
 * This provides a common interface for the generation service
 */

import { EnhancedColumnDefinition } from '../../../schemas/openai-schemas';

export interface NormalizedAnaletInput {
  // Core generation data
  type: AnaletInputType;
  source: AnaletSource;
  
  // Content for generation
  primaryContent: string;           // Main content (statement, code, etc.)
  contextContent?: string;          // Additional context (dataset info, etc.)
  
  // Generation parameters
  count?: number;                   // How many analets to generate
  position?: { x: number; y: number }; // Starting position
  
  // Source-specific metadata
  metadata: AnaletInputMetadata;
}

export type AnaletInputType = 
  | 'statement'      // Natural language statement
  | 'notebook'       // Python code from notebook
  | 'framing'        // Dataset framing analysis
  | 'embedding'      // Embedding-based exploration
  | 'derivation';    // Derived from existing analet

export type AnaletSource = 
  | 'pipeline'       // Initial dataset analysis pipeline
  | 'statement'      // Generated from conceptual statements
  | 'notebook'       // Created from notebook cells
  | 'embedding'      // Nearest neighbor embedding exploration
  | 'waypoint'       // Promoted from framing analets
  | 'perturbed'      // Perturbed variations
  | 'framing';       // Framing analets for UMAP training

export interface AnaletInputMetadata {
  // Common metadata
  requestId?: string;
  timestamp?: string;
  
  // Statement-specific
  statementId?: string;
  originalStatement?: string;
  
  // Notebook-specific
  cellIndex?: number;
  filePath?: string;
  cellId?: string;
  changeType?: 'new' | 'modified';
  existingAnaletId?: number;
  
  // Framing-specific
  datasetName?: string;
  columnDefinitions?: EnhancedColumnDefinition[];
  
  // Random-specific
  basePosition?: { x: number; y: number };
  
  // Embedding-specific
  sourceAnalets?: any[]; // Analet type
  cursorPosition?: { x: number; y: number };
  
  // Derivation-specific
  sourceAnalet?: any; // Analet type
  derivationPrompt?: string;
  variationCount?: number;
  parentAnaletId?: number;
  
  // Additional context
  additionalContext?: Record<string, any>;
}

/**
 * Validation result interface
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Input validation helpers
 */
export function validateNormalizedInput(input: NormalizedAnaletInput): string[] {
  const errors: string[] = [];
  
  if (!input.primaryContent?.trim()) {
    errors.push('Primary content is required');
  }
  
  if (!input.type) {
    errors.push('Input type is required');
  }
  
  if (!input.source) {
    errors.push('Source is required');
  }
  
  // Type-specific validations
  switch (input.type) {
    case 'notebook':
      if (!input.metadata.filePath) {
        errors.push('File path is required for notebook inputs');
      }
      if (typeof input.metadata.cellIndex !== 'number') {
        errors.push('Cell index is required for notebook inputs');
      }
      break;
      
    // Random generation removed - promoting framing analets is an edit operation
      
    case 'embedding':
      if (!input.metadata.sourceAnalets?.length) {
        errors.push('Source analets required for embedding-based generation');
      }
      break;
      
    case 'derivation':
      if (!input.metadata.sourceAnalet) {
        errors.push('Source analet required for derivation');
      }
      if (!input.metadata.derivationPrompt?.trim()) {
        errors.push('Derivation prompt is required');
      }
      break;
  }
  
  return errors;
}