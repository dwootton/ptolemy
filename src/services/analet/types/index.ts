/**
 * Barrel export for analet domain types
 */

export * from './commands';
export * from './inputs';
export * from './events';
export * from './base';

// Re-export common result types
export interface GenerationResult {
  success: boolean;
  analets: any[]; // Analet type from main types
  error?: string;
  metadata?: {
    generationTime: number;
    source: string;
    inputSummary: string;
    requestId?: string;
    // New architecture timing metadata
    adapterProcessingTime?: number;
    enrichmentTime?: number;
    embeddingsGenerated?: boolean;
  };
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}