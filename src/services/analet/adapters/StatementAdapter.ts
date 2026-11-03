/**
 * Adapter for generating analets from conceptual statements
 * 
 * NEW ARCHITECTURE: Calls OpenAI directly to generate BaseAnalet objects
 * instead of going through the old NormalizedAnaletInput pipeline
 */

import { StatementGenerationCommand } from '../types/commands';
import { ValidationResult, AdapterResponse } from '../types';
import { BaseAnaletInputAdapter } from './base/AnaletInputAdapter';
import { NewOpenAIService } from '../../llm/NewOpenAIService';
import { EnvironmentService } from '../../EnvironmentService';
import { zodResponseFormat } from 'openai/helpers/zod';
import { DSLResponseSchema } from '../../../schemas/openai-schemas';

export class StatementAdapter extends BaseAnaletInputAdapter<StatementGenerationCommand> {
  readonly inputType = 'from_statement';
  private openAIService: NewOpenAIService | null = null;
  
  canHandle(input: any): input is StatementGenerationCommand {
    return (
      input &&
      typeof input === 'object' &&
      input.type === 'from_statement' &&
      typeof input.statement === 'string'
    );
  }
  
  validate(input: StatementGenerationCommand): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // Required field validation
    if (!input.statement || typeof input.statement !== 'string') {
      errors.push('Statement is required and must be a string');
    } else if (input.statement.trim().length === 0) {
      errors.push('Statement cannot be empty');
    } else if (input.statement.trim().length < 10) {
      warnings.push('Statement is very short - may not generate meaningful analets');
    } else if (input.statement.length > 2000) {
      warnings.push('Statement is very long - may be truncated during processing');
    }
    
    // Optional field validation
    if (input.maxCount !== undefined) {
      if (typeof input.maxCount !== 'number' || input.maxCount < 1) {
        errors.push('maxCount must be a positive number');
      } else if (input.maxCount > 20) {
        warnings.push('maxCount > 20 may take a long time to generate');
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
  
  /**
   * Generate base analets by calling OpenAI directly
   */
  async generateBaseAnalets(input: StatementGenerationCommand): Promise<AdapterResponse> {
    const startTime = Date.now();
    const requestId = this.generateRequestId();
    try {
      // Initialize OpenAI service
      await this.initializeOpenAIService();
      
      if (!this.openAIService) {
        return {
          success: false,
          baseAnalets: [],
          error: 'OpenAI service not available'
        };
      }
      
      // Build prompts for statement-based generation
      const systemPrompt = this.buildSystemPrompt();
      const userPrompt = this.buildUserPrompt(input);
      
      // Call OpenAI with structured output
      const response = await this.openAIService.chatStructured({
        system: systemPrompt,
        user: userPrompt,
        schema: DSLResponseSchema,
        model: 'gpt-4.1-mini'
      });
      
      // Extract base analets from response
      const baseAnalets = (response.analets || []).map((a: any) => ({
        statement: a.statement,
        shortName: a.shortName,
        cellQL: a.cellQL,
        explanation: a.explanation,
        tags: a.tags || []
      }));
      
      const processingTime = Date.now() - startTime;
      return {
        success: true,
        baseAnalets,
        metadata: {
          requestId,
          source: 'statement',
          processingTime,
          context: {
            originalStatement: input.statement,
            maxCount: input.maxCount,
            statementId: input.statementId
          }
        }
      };
      
    } catch (error) {
      console.error('❌ [StatementAdapter] Error generating analets:', error);
      return {
        success: false,
        baseAnalets: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  /**
   * Initialize OpenAI service for API calls
   */
  private async initializeOpenAIService(): Promise<void> {
    if (this.openAIService) {
      return; // Already initialized
    }
    
    try {
      const environmentService = EnvironmentService.getInstance();
      const apiKey = await environmentService.getOpenAIApiKey();
      
      if (!apiKey) {
        throw new Error('OpenAI API key not available');
      }
      
      this.openAIService = NewOpenAIService.getInstance(apiKey);
    } catch (error) {
      console.error('❌ [StatementAdapter] Failed to initialize OpenAI service:', error);
      throw error;
    }
  }
  
  /**
   * Build system prompt for statement-based analet generation
   */
  private buildSystemPrompt(): string {
    return `You are a transpiler from natural-language analysis statements to CellQL. Produce valid CellQL and list referenced columns. Keep explanations to a single concise sentence.`;
  }
  
  /**
   * Build user prompt for the specific statement
   */
  private buildUserPrompt(input: StatementGenerationCommand): string {
    const maxCount = input.maxCount || 3;
    
    return `Generate ${maxCount} specific analysis tasks from this conceptual statement:

STATEMENT: "${input.statement}"

For each analysis task, provide:
1. statement: A clear, specific analysis question or task
2. shortName: A concise 8-10 word skimmable version of the statement
3. cellQL: a single fenced block labeled cellql, containing only CellQL
4. columns: string[] of referenced columns
5. explanation: One short sentence explaining what this analysis accomplishes and why it's valuable
6. tags: 2-4 relevant tags for categorization

Focus on creating actionable, measurable analysis tasks that can be executed on real data.

Examples of good analysis tasks:
- statement: "Calculate average price by product category", shortName: "Average price by category"
- statement: "Identify customers with purchase frequency above 90th percentile", shortName: "High frequency customers"
- statement: "Compare conversion rates between marketing channels", shortName: "Channel conversion comparison"

The shortName should be clear, concise, and immediately understandable without reading the full statement. Avoid vague or unmeasurable tasks like "understand the data" or "explore patterns".`;
  }
}