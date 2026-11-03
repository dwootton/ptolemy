/**
 * Base adapter interface for generating analets from different input types
 * All input adapters must implement this interface
 * 
 * NEW ARCHITECTURE: Adapters now call OpenAI directly and return BaseAnalet objects
 * instead of going through the old NormalizedAnaletInput → CoreGenerationService pipeline
 */

import { ValidationResult, AdapterResponse } from '../../types';

export interface AnaletInputAdapter<TInput = any> {
  /**
   * The type of input this adapter handles
   */
  readonly inputType: string;
  
  /**
   * Generate base analets by calling OpenAI directly
   * This replaces the old adapt() → normalize → generate pipeline
   */
  generateBaseAnalets(input: TInput): Promise<AdapterResponse>;
  
  /**
   * Validate the input before generation
   */
  validate(input: TInput): ValidationResult;
  
  /**
   * Check if this adapter can handle the given input
   */
  canHandle(input: any): input is TInput;
}

/**
 * Abstract base class for adapters with common functionality
 */
export abstract class BaseAnaletInputAdapter<TInput = any> implements AnaletInputAdapter<TInput> {
  abstract readonly inputType: string;
  
  abstract generateBaseAnalets(input: TInput): Promise<AdapterResponse>;
  abstract validate(input: TInput): ValidationResult;
  abstract canHandle(input: any): input is TInput;
  
  /**
   * Helper to create validation results
   */
  protected createValidationResult(errors: string[] = [], warnings: string[] = []): ValidationResult {
    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }
  
  /**
   * Helper to generate unique request ID
   */
  protected generateRequestId(): string {
    return `${this.inputType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * Helper to create timestamp
   */
  protected createTimestamp(): string {
    return new Date().toISOString();
  }
}