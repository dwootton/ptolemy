/**
 * GenerationExecutor - Generic service for executing LLM generation stages
 * 
 * This service is completely generic and just executes stages sequentially.
 * Each adapter is responsible for providing stages that result in final analets.
 */

import { NewOpenAIService } from './NewOpenAIService';
import { StateManagementService } from '../StateManagementService';

export interface GenerationContext {
  stage: string;
  system: string;
  user: string;
  schema: any;
  dependencies?: string[];
}

export interface GenerationOptions {
  dataset?: string;
  requestId?: string;
  maxConcurrency?: number;
}

export interface GenerationExecutorResult {
  success: boolean;
  finalResult: any; // The final stage result
  stageResults?: Record<string, any>;
  error?: string;
  metadata?: {
    generationTime: number;
    stagesExecuted: number;
    totalLLMCalls: number;
  };
}

export class GenerationExecutor {
  private static instance: GenerationExecutor;
  private newOpenAIService: NewOpenAIService | null = null;

  private constructor() {}

  public static getInstance(): GenerationExecutor {
    if (!GenerationExecutor.instance) {
      GenerationExecutor.instance = new GenerationExecutor();
    }
    return GenerationExecutor.instance;
  }

  /**
   * Execute a complete generation pipeline from structured contexts
   */
  public async runGeneration(
    contexts: GenerationContext[],
    options: GenerationOptions = {}
  ): Promise<GenerationExecutorResult> {
    const startTime = Date.now();
    const { dataset = 'dataset.csv', requestId, maxConcurrency = 1 } = options;
    try {
      // Initialize OpenAI service
      if (!this.newOpenAIService) {
        this.newOpenAIService = NewOpenAIService.getInstance();
      }

      // Execute stages in dependency order
      const stageResults: Record<string, any> = {};
      let totalLLMCalls = 0;
      let finalResult: any = null;

      for (const context of contexts) {
        // Check if dependencies are met
        if (context.dependencies && context.dependencies.length > 0) {
          for (const dep of context.dependencies) {
            if (!stageResults[dep]) {
              throw new Error(`Missing dependency '${dep}' for stage '${context.stage}'`);
            }
          }
        }

        // Substitute dependency results in user prompt
        let userPrompt = context.user;
        if (context.dependencies) {
          for (const dep of context.dependencies) {
            const placeholder = `{{${dep}_result}}`;
            if (userPrompt.includes(placeholder)) {
              const depResult = this.formatDependencyResult(stageResults[dep], dep);
              userPrompt = userPrompt.replace(placeholder, depResult);
            }
          }
        }

        // Execute LLM call
        const stageStart = Date.now();
        const result = await this.newOpenAIService.chatStructured({
          system: context.system,
          user: userPrompt,
          schema: context.schema
        });
        totalLLMCalls++;

        const stageTime = Date.now() - stageStart;
        // Store result and save to persistent state if needed
        stageResults[context.stage] = result;
        finalResult = result; // Last stage result becomes the final result
        await this.saveStageResult(context.stage, result, dataset);
      }

      const totalTime = Date.now() - startTime;
      return {
        success: true,
        finalResult,
        stageResults,
        metadata: {
          generationTime: totalTime,
          stagesExecuted: contexts.length,
          totalLLMCalls
        }
      };

    } catch (error) {
      const totalTime = Date.now() - startTime;
      console.error(`💥 [GenerationExecutor] Generation failed after ${totalTime}ms:`, error);
      
      return {
        success: false,
        finalResult: null,
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          generationTime: totalTime,
          stagesExecuted: 0,
          totalLLMCalls: 0
        }
      };
    }
  }

  /**
   * Format dependency results for insertion into prompts
   */
  private formatDependencyResult(result: any, stage: string): string {
    switch (stage) {
      case 'stakeholders':
        if (result.stakeholders && Array.isArray(result.stakeholders)) {
          return result.stakeholders.map((s: any, i: number) => 
            `${i + 1}. ${s.role}: ${s.interests}`
          ).join('\n');
        }
        break;
      
      case 'goals':
        if (result.goals && Array.isArray(result.goals)) {
          return result.goals.map((g: any, i: number) => 
            `${i + 1}. ${g.stakeholder} - ${g.goalTitle}: ${g.description}`
          ).join('\n\n');
        }
        break;
      
      case 'analet_ideas':
        if (result.analetIdeas && Array.isArray(result.analetIdeas)) {
          return result.analetIdeas.map((idea: any, i: number) => 
            `${i + 1}. ${idea.statement} (${idea.explanation || ''})`
          ).join('\n');
        }
        break;
    }
    
    // Fallback to JSON string
    return JSON.stringify(result, null, 2);
  }

  /**
   * Save stage results to persistent state
   */
  private async saveStageResult(stage: string, result: any, dataset: string): Promise<void> {
    try {
      const stateService = StateManagementService.getInstance();
      if (!stateService) return;

      switch (stage) {
        case 'stakeholders':
          if (result.stakeholders && Array.isArray(result.stakeholders)) {
            await stateService.saveStakeholderDescriptions(result.stakeholders, dataset);
          }
          break;
        
        case 'goals':
          if (result.goals && Array.isArray(result.goals)) {
            const formattedGoals = result.goals.map((goal: any, index: number) => ({
              id: `goal-${Date.now()}-${index}`,
              stakeholderRole: goal.stakeholder,
              goalTitle: goal.goalTitle,
              description: goal.description,
              priority: goal.priority || 'medium'
            }));
            await stateService.saveAnalysisGoals(formattedGoals, dataset);
          }
          break;
        
        // Don't save final analets here - that's handled by AnaletController and enrichment service
      }
    } catch (error) {
      console.warn(`⚠️ [GenerationExecutor] Failed to save stage '${stage}' to persistent state:`, error);
    }
  }
}