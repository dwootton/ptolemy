/**
 * Adapter for generating focus-based analets from bearings
 * 
 * NEW ARCHITECTURE: Direct OpenAI calls to generate bearing-focused analets
 */

import { FocusGenerationCommand } from '../types/commands';
import { ValidationResult, AdapterResponse } from '../types';
import { BaseAnaletInputAdapter } from './base/AnaletInputAdapter';
import { NewOpenAIService } from '../../llm/NewOpenAIService';
import { EnvironmentService } from '../../EnvironmentService';
import { zodResponseFormat } from 'openai/helpers/zod';
import { DSLResponseSchema } from '../../../schemas/openai-schemas';
import { PipelineEngine } from '../../pipeline/PipelineEngine';
import { buildFocusRelatedPipeline } from './FocusAdapterPipeline';

export class FocusAdapter extends BaseAnaletInputAdapter<FocusGenerationCommand> {
  readonly inputType = 'from_focus';
  private openAIService: NewOpenAIService | null = null;
  
  canHandle(input: any): input is FocusGenerationCommand {
    return (
      input &&
      typeof input === 'object' &&
      input.type === 'from_focus' &&
      typeof input.bearingId === 'number' &&
      typeof input.bearingStatement === 'string'
    );
  }
  
  validate(input: FocusGenerationCommand): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // Required field validation
    if (typeof input.bearingId !== 'number') {
      errors.push('Bearing ID is required and must be a number');
    } else if (input.bearingId <= 0) {
      errors.push('Bearing ID must be a positive number');
    }
    
    if (!input.bearingStatement || typeof input.bearingStatement !== 'string') {
      errors.push('Bearing statement is required and must be a string');
    } else if (input.bearingStatement.trim().length === 0) {
      errors.push('Bearing statement cannot be empty');
    } else if (input.bearingStatement.trim().length < 5) {
      warnings.push('Bearing statement is very short - may not provide enough context for focus generation');
    } else if (input.bearingStatement.length > 1000) {
      warnings.push('Bearing statement is very long - may be truncated during processing');
    }
    
    // Optional field validation
    if (input.count !== undefined) {
      if (typeof input.count !== 'number' || input.count < 1) {
        errors.push('Count must be a positive number');
      } else if (input.count > 10) {
        warnings.push('Count > 10 may take a long time to generate');
      }
    }
    
    if (input.memberAnalets) {
      if (!Array.isArray(input.memberAnalets)) {
        errors.push('Member analets must be an array');
      } else if (input.memberAnalets.length > 50) {
        warnings.push('Large number of member analets may affect generation quality');
      }
    }
    
    // Position validation
    if (input.position) {
      if (typeof input.position.x !== 'number' || typeof input.position.y !== 'number') {
        errors.push('Position must have numeric x and y coordinates');
      }
    }
    
    return this.createValidationResult(errors, warnings);
  }
  
  async generateBaseAnalets(input: FocusGenerationCommand): Promise<AdapterResponse> {
    try {
      // Concurrent pipeline: generate related analets from bearing statement only
      const engine = new PipelineEngine({ emitPartialResults: false, logLevel: 'info' }, {
        onStageCompleted: (e) => void 0,
        onBranchCreated: (e) => void 0,
        onPipelineCompleted: (e) => void 0,
      });
      // If bearingStatement looks like a placeholder (e.g., 'Focus Area <id>'), fall back to a generic hint
      const seed = { type: 'bearing' as const, name: input.bearingStatement };
      const def = buildFocusRelatedPipeline({ seed, count: input.count || 5 });
      const outcome = await engine.run(def);
      const baseAnalets: any[] = [];
      const visit = (node: any) => {
        if (node && node.stage && String(node.stage).startsWith('createBaseAnalet')) {
          if (Array.isArray(node.output)) baseAnalets.push(...node.output);
          else if (node.output) baseAnalets.push(node.output);
        }
        (node.children || []).forEach(visit);
      };
      outcome.resultTree.forEach(visit);

      return {
        success: true,
        baseAnalets,
        metadata: {
          requestId: this.generateRequestId(),
          source: 'focus',
          processingTime: Date.now(),
          context: {
            bearingId: input.bearingId,
            bearingStatement: input.bearingStatement,
            // Hierarchy handled by edges API
            memberAnaletCount: input.memberAnalets?.length || 0,
            position: input.position,
            additionalContext: input.metadata
          }
        }
      };

    } catch (error) {
      console.error(`💥 [FocusAdapter] Failed to generate analets:`, error);
      return {
        success: false,
        baseAnalets: [],
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          requestId: this.generateRequestId(),
          source: 'focus',
          processingTime: Date.now()
        }
      };
    }
  }
  
  /**
   * Create focused prompt for generating bearing-related analets
   */
  private createFocusPrompt(input: FocusGenerationCommand): string {
    let prompt = `Generate analysis questions focused on this research theme/bearing:

BEARING: ${input.bearingStatement.trim()}
`;
    
    if (input.memberAnalets && input.memberAnalets.length > 0) {
      prompt += `\nEXISTING RELATED ANALETS:\n`;
      
      // Include up to 8 most relevant member analets for context
      const relevantAnalets = input.memberAnalets.slice(0, 8);
      
      relevantAnalets.forEach((analet, index) => {
        prompt += `${index + 1}. ${analet.statement}`;
        if (analet.explanation && analet.explanation.trim().length > 0) {
          prompt += ` - ${analet.explanation}`;
        }
        prompt += `\n`;
      });
      
      if (input.memberAnalets.length > 8) {
        prompt += `... and ${input.memberAnalets.length - 8} more related analets\n`;
      }
    }
    
    prompt += `\nTASK:\nGenerate ${input.count || 5} new specific analysis questions that:\n1. Are conceptually related to this focus bearing\n2. Build upon or extend the existing analysis themes\n3. Include specific CellQL code for each analysis\n4. Use concrete dataset column names when possible\n\nFor each analysis:\n- **Statement**: Clear, specific analysis question\n- **CellQL**: Valid CellQL that compiles to SQL\n- **Explanation**: What insights this analysis provides\n- **Tags**: 2-5 relevant keywords`;
    
    return prompt;
  }

  /**
   * Build context for focus generation using bearing and member analets (LEGACY)
   */
  private buildFocusContext(input: FocusGenerationCommand): string {
    const contextParts = [`FOCUS BEARING: ${input.bearingStatement.trim()}`];
    
    if (input.memberAnalets && input.memberAnalets.length > 0) {
      contextParts.push('');
      contextParts.push('EXISTING RELATED ANALETS:');
      
      // Include up to 8 most relevant member analets for context
      const relevantAnalets = input.memberAnalets.slice(0, 8);
      
      relevantAnalets.forEach((analet, index) => {
        let analetsText = `${index + 1}. ${analet.statement}`;
        if (analet.explanation && analet.explanation.trim().length > 0) {
          analetsText += ` - ${analet.explanation}`;
        }
        contextParts.push(analetsText);
      });
      
      if (input.memberAnalets.length > 8) {
        contextParts.push(`... and ${input.memberAnalets.length - 8} more related analets`);
      }
    }
    
    contextParts.push('');
    contextParts.push('TASK: Generate new analets that are conceptually related to this focus bearing and build upon or extend the existing analysis themes.');
    
    return contextParts.join('\n');
  }
}