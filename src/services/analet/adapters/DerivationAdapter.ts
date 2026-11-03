/**
 * Adapter for generating derived analets from existing analets
 *
 * NEW ARCHITECTURE: Direct OpenAI calls to generate derived analets
 */

import { DerivationGenerationCommand } from '../types/commands';
import { ValidationResult, AdapterResponse } from '../types';
import { BaseAnaletInputAdapter } from './base/AnaletInputAdapter';
import { NewOpenAIService } from '../../llm/NewOpenAIService';
import { EnvironmentService } from '../../EnvironmentService';
import { zodResponseFormat } from 'openai/helpers/zod';
import { DSLResponseSchema } from '../../../schemas/openai-schemas';

export class DerivationAdapter extends BaseAnaletInputAdapter<DerivationGenerationCommand> {
  readonly inputType = 'from_derivation';
  private openAIService: NewOpenAIService | null = null;

  canHandle(input: any): input is DerivationGenerationCommand {
    return (
      input &&
      typeof input === 'object' &&
      input.type === 'from_derivation' &&
      input.sourceAnalet &&
      typeof input.sourceAnalet === 'object' &&
      typeof input.derivationPrompt === 'string'
    );
  }

  validate(input: DerivationGenerationCommand): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Required field validation
    if (!input.sourceAnalet || typeof input.sourceAnalet !== 'object') {
      errors.push('Source analet is required and must be an object');
    } else {
      // Validate source analet structure
      if (!input.sourceAnalet.id || typeof input.sourceAnalet.id !== 'number') {
        errors.push('Source analet must have a numeric id');
      }
      if (!input.sourceAnalet.statement || typeof input.sourceAnalet.statement !== 'string') {
        errors.push('Source analet must have a statement');
      }
      if (!input.sourceAnalet.cellQL || typeof input.sourceAnalet.cellQL !== 'string') {
        warnings.push('Source analet missing CellQL - may affect derivation quality');
      }
    }

    if (!input.derivationPrompt || typeof input.derivationPrompt !== 'string') {
      errors.push('Derivation prompt is required and must be a string');
    } else if (input.derivationPrompt.trim().length === 0) {
      errors.push('Derivation prompt cannot be empty');
    } else if (input.derivationPrompt.trim().length < 10) {
      warnings.push('Derivation prompt is very short - may not provide clear guidance');
    } else if (input.derivationPrompt.length > 1000) {
      warnings.push('Derivation prompt is very long - may be truncated during processing');
    }

    // Optional field validation
    if (input.variationCount !== undefined) {
      if (typeof input.variationCount !== 'number' || input.variationCount < 1) {
        errors.push('Variation count must be a positive number');
      } else if (input.variationCount > 10) {
        warnings.push('Generating more than 10 variations may take time');
      }
    }

    if (input.position) {
      if (typeof input.position.x !== 'number' || typeof input.position.y !== 'number') {
        errors.push('Position must have numeric x and y coordinates');
      }
    }

    return this.createValidationResult(errors, warnings);
  }

  async generateBaseAnalets(input: DerivationGenerationCommand): Promise<AdapterResponse> {
    try {
      // Initialize OpenAI service if needed
      if (!this.openAIService) {
        this.openAIService = NewOpenAIService.getInstance();
      }

      const derivationPrompt = this.createDerivationPrompt(input.sourceAnalet, input.derivationPrompt);
      const result = await this.openAIService.chatStructured({
        system: 'You are a data analysis expert. Generate related analysis questions based on existing analyses.',
        user: derivationPrompt,
        schema: DSLResponseSchema,
        model: 'gpt-4.1-mini'
      });

      const derivedAnalets = result.analets;
      // Calculate position near source analet
      const effectivePosition = this.calculateDerivationPosition(input);

      // Transform to BaseAnalet format
      const baseAnalets = derivedAnalets.slice(0, input.variationCount || 1).map((analet: any, index: number) => ({
        statement: analet.statement,
        shortName: analet.shortName || analet.statement,
        cellQL: analet.cellQL,
        explanation: analet.explanation,
        tags: analet.tags || []
      }));

      return {
        success: true,
        baseAnalets,
        metadata: {
          requestId: this.generateRequestId(),
          source: 'perturbed',
          processingTime: Date.now(),
          context: {
            sourceAnalet: input.sourceAnalet,
            derivationPrompt: input.derivationPrompt,
            parentAnaletId: input.sourceAnalet.id,
            position: effectivePosition,
            additionalContext: input.metadata
          }
        }
      };

    } catch (error) {
      console.error(`💥 [DerivationAdapter] Failed to generate analets:`, error);
      return {
        success: false,
        baseAnalets: [],
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          requestId: this.generateRequestId(),
          source: 'perturbed',
          processingTime: Date.now()
        }
      };
    }
  }

  /**
   * Calculate position for derived analet near source
   */
  private calculateDerivationPosition(input: DerivationGenerationCommand): { x: number; y: number } {
    // Use provided position if available
    if (input.position) {
      return input.position;
    }

    // Position near source analet if it has a location
    if (input.sourceAnalet.location) {
      const offset = 100 + Math.random() * 50; // Random offset 100-150px
      const angle = Math.random() * 2 * Math.PI; // Random angle

      return {
        x: input.sourceAnalet.location.x + Math.cos(angle) * offset,
        y: input.sourceAnalet.location.y + Math.sin(angle) * offset
      };
    }

    // Default position if source has no location
    return { x: 500, y: 500 };
  }

  /**
   * Create derivation prompt combining source and user prompt
   */
  private createDerivationPrompt(sourceAnalet: any, derivationPrompt: string): string {
    return `Based on the analysis: "${sourceAnalet.statement}"

${derivationPrompt}

Create new analysis questions that ${derivationPrompt.toLowerCase()}.`;
  }

  /**
   * Create context description from source analet
   */
  private createSourceAnaletContext(sourceAnalet: any): string {
    const parts = [`Source: ${sourceAnalet.statement}`];

    if (sourceAnalet.explanation) {
      parts.push(`Context: ${sourceAnalet.explanation}`);
    }

    if (sourceAnalet.cellQL) {
      parts.push(`CellQL: ${sourceAnalet.cellQL}`);
    }

    return parts.join(' | ');
  }
}
