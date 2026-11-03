/**
 * Adapter for generating embedding-based analets from cursor position
 * 
 * NEW ARCHITECTURE: Direct OpenAI calls to generate contextual analets
 */

import { EmbeddingGenerationCommand } from '../types/commands';
import { ValidationResult, AdapterResponse } from '../types';
import { BaseAnaletInputAdapter } from './base/AnaletInputAdapter';
import { NewOpenAIService } from '../../llm/NewOpenAIService';
import { EnvironmentService } from '../../EnvironmentService';
import { zodResponseFormat } from 'openai/helpers/zod';
import { DSLResponseSchema } from '../../../schemas/openai-schemas';
import { createIdeaToCellQLStage } from '../../pipeline/stages/IdeaToCellQL';
import { createBaseAnaletStage } from '../../pipeline/stages/FramingStages';
import { DatasetSummarizerService } from '../../DatasetSummarizerService';

export class EmbeddingAdapter extends BaseAnaletInputAdapter<EmbeddingGenerationCommand> {
  readonly inputType = 'from_embedding';
  private openAIService: NewOpenAIService | null = null;
  
  canHandle(input: any): input is EmbeddingGenerationCommand {
    return (
      input &&
      typeof input === 'object' &&
      input.type === 'from_embedding' &&
      Array.isArray(input.nearestAnalets) &&
      input.cursorPosition &&
      typeof input.cursorPosition.x === 'number' &&
      typeof input.cursorPosition.y === 'number'
    );
  }
  
  validate(input: EmbeddingGenerationCommand): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // Required field validation
    if (!Array.isArray(input.nearestAnalets)) {
      errors.push('Nearest analets must be an array');
    } else if (input.nearestAnalets.length === 0) {
      errors.push('At least one nearest analet is required');
    } else if (input.nearestAnalets.length > 10) {
      warnings.push('Using more than 10 nearest analets may impact performance');
    } else {
      // Validate analet structure
      for (let i = 0; i < input.nearestAnalets.length; i++) {
        const analet = input.nearestAnalets[i];
        if (!analet || typeof analet !== 'object') {
          errors.push(`Nearest analet ${i} must be an object`);
        } else {
          if (!analet.id || typeof analet.id !== 'number') {
            errors.push(`Nearest analet ${i} must have a numeric id`);
          }
          if (!analet.statement || typeof analet.statement !== 'string') {
            errors.push(`Nearest analet ${i} must have a statement`);
          }
          if (!analet.embedding || !Array.isArray(analet.embedding)) {
            warnings.push(`Nearest analet ${i} missing embedding data`);
          }
        }
      }
    }
    
    if (!input.cursorPosition) {
      errors.push('Cursor position is required');
    } else {
      if (typeof input.cursorPosition.x !== 'number' || typeof input.cursorPosition.y !== 'number') {
        errors.push('Cursor position must have numeric x and y coordinates');
      }
    }
    
    // Optional field validation
    if (input.count !== undefined) {
      if (typeof input.count !== 'number' || input.count < 1) {
        errors.push('Count must be a positive number');
      } else if (input.count > 10) {
        warnings.push('Generating more than 10 embedding-based analets may take time');
      }
    }
    
    if (input.position) {
      if (typeof input.position.x !== 'number' || typeof input.position.y !== 'number') {
        errors.push('Position must have numeric x and y coordinates');
      }
    }
    
    return this.createValidationResult(errors, warnings);
  }
  
  async generateBaseAnalets(input: EmbeddingGenerationCommand): Promise<AdapterResponse> {
    try {
      // Initialize OpenAI service if needed
      if (!this.openAIService) {
        this.openAIService = NewOpenAIService.getInstance();
      }

      // 1) Generate a single concise idea statement based on nearest analets
      const ideaPrompt = this.createContextualPrompt(input.nearestAnalets, input.cursorPosition);
      const ideaStatement = await this.openAIService.chatText({
        system: 'You are a data analysis expert. Return exactly one single-sentence analysis idea only.',
        user: ideaPrompt + '\n\nReturn only the idea sentence, no extra text.',
        model: 'gpt-4.1-mini'
      });

      const cleanIdea = (ideaStatement || '').trim().replace(/^"|"$/g, '');

      // 2) Transform idea → CellQL via pipeline stage
      const dsSvc = DatasetSummarizerService.getInstance();
      const datasetInfo = dsSvc.getDatasetInfo();
      const datasetContext = dsSvc.getDatasetContext();
      const transform = createIdeaToCellQLStage({ datasetName: datasetInfo?.name, datasetContext });
      const toBase = createBaseAnaletStage();

      const dslAnalets = await transform.handler({ statement: cleanIdea, explanation: '', tags: ['embedding'] } as any, { runId: 'embedding-adapter' });
      const baseAnalets = Array.isArray(dslAnalets)
        ? await Promise.all(dslAnalets.map(async (a: any) => await toBase.handler(a, { runId: 'embedding-adapter' })))
        : [];

      const flattened: any[] = [];
      for (const entry of baseAnalets) {
        if (Array.isArray(entry)) flattened.push(...entry); else flattened.push(entry);
      }

      return {
        success: true,
        baseAnalets: flattened,
        metadata: {
          requestId: this.generateRequestId(),
          source: 'embedding',
          processingTime: Date.now(),
          context: {
            sourceAnalets: input.nearestAnalets,
            cursorPosition: input.cursorPosition,
            additionalContext: { ...(input.metadata || {}), idea: cleanIdea }
          }
        }
      };

    } catch (error) {
      console.error(`💥 [EmbeddingAdapter] Failed to generate analets:`, error);
      return {
        success: false,
        baseAnalets: [],
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          requestId: this.generateRequestId(),
          source: 'embedding',
          processingTime: Date.now()
        }
      };
    }
  }
  
  /**
   * Create a contextual prompt based on nearest analets
   */
  private createContextualPrompt(nearestAnalets: any[], cursorPosition: { x: number; y: number }): string {
    const analetsText = nearestAnalets
      .slice(0, 3) // Use top 3 for prompt
      .map((analet, index) => `${index + 1}. ${analet.statement}`)
      .join('\n');
    
    return `Generate analysis questions related to these nearby analyses:\n\n${analetsText}\n\nCreate questions that explore similar concepts or build upon these ideas.`;
  }
  
  /**
   * Create context description from analets
   */
  private createAnaletContext(nearestAnalets: any[]): string {
    const statements = nearestAnalets.map(a => a.statement).join('; ');
    return `Related analyses: ${statements}`;
  }
}