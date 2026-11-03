/**
 * Adapter for generating framing analets from dataset context
 *
 * NEW ARCHITECTURE: Uses stakeholder→goals→analets pipeline with direct OpenAI calls
 */

import { FramingGenerationCommand } from '../types/commands';
import { ValidationResult, AdapterResponse } from '../types';
import { BaseAnaletInputAdapter } from './base/AnaletInputAdapter';
import { EnhancedColumnDefinition } from '../../../schemas/openai-schemas';
import { SchemaCardService } from '../../SchemaCardService';
import { StateManagementService } from '../../StateManagementService';
import { NewOpenAIService } from '../../llm/NewOpenAIService';
import { EnvironmentService } from '../../EnvironmentService';
import { zodResponseFormat } from 'openai/helpers/zod';
import * as Schemas from '../../../schemas/openai-schemas';
import { PipelineEngine } from '../../pipeline/PipelineEngine';
import { buildFramingPipeline } from './FramingAdapterPipeline';
import { ConfigManager } from '../../../config';
import { AnaletEnrichmentService } from '../domain/AnaletEnrichmentService';
import type { EnrichmentConfig } from '../types';

export class FramingAdapter extends BaseAnaletInputAdapter<FramingGenerationCommand> {
  readonly inputType = 'from_framing';
  private openAIService: NewOpenAIService | null = null;

  canHandle(input: any): input is FramingGenerationCommand {
    return (
      input &&
      typeof input === 'object' &&
      input.type === 'from_framing' &&
      typeof input.datasetContext === 'string'
    );
  }

  validate(input: FramingGenerationCommand): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Required field validation
    if (!input.datasetContext || typeof input.datasetContext !== 'string') {
      errors.push('Dataset context is required and must be a string');
    } else if (input.datasetContext.trim().length === 0) {
      errors.push('Dataset context cannot be empty');
    } else if (input.datasetContext.length < 50) {
      warnings.push('Dataset context is quite short - may not generate comprehensive framing analets');
    } else if (input.datasetContext.length > 10000) {
      warnings.push('Dataset context is very long - may be truncated during processing');
    }

    // Optional fields validation
    if (input.columnDefinitions) {
      if (!Array.isArray(input.columnDefinitions)) {
        errors.push('Column definitions must be an array');
      } else if (input.columnDefinitions.length === 0) {
        warnings.push('Column definitions array is empty');
      } else {
        // Validate column definition structure using semantic definitions
        for (let i = 0; i < input.columnDefinitions.length; i++) {
          const col = input.columnDefinitions[i];
          if (!col || typeof col !== 'object') {
            errors.push(`Column definition ${i} must be an object`);
          } else {
            // Validate against EnhancedColumnDefinition structure
            if (!col.name || typeof col.name !== 'string') {
              errors.push(`Column definition ${i} must have a name (string)`);
            }
            if (col.type && !['string', 'int', 'float', 'boolean', 'date'].includes(col.type)) {
              warnings.push(`Column definition ${i} has unknown type: ${col.type}`);
            }
            if (col.description && typeof col.description !== 'string') {
              warnings.push(`Column definition ${i} description should be a string`);
            }
          }
        }
      }
    }

    if (input.datasetName && typeof input.datasetName !== 'string') {
      errors.push('Dataset name must be a string');
    }

    // Position validation
    if (input.position) {
      if (typeof input.position.x !== 'number' || typeof input.position.y !== 'number') {
        errors.push('Position must have numeric x and y coordinates');
      }
    }

    return this.createValidationResult(errors, warnings);
  }

  async generateBaseAnalets(input: FramingGenerationCommand): Promise<AdapterResponse> {
    try {
      // Initialize OpenAI service if needed
      if (!this.openAIService) {
        this.openAIService = NewOpenAIService.getInstance();
      }

      const cfg = ConfigManager.getInstance().getConfig();
      const useConcurrent = true; // feature-flag hook later if needed

      if (useConcurrent) {
        const engine = new PipelineEngine(
          { emitPartialResults: false, logLevel: cfg.debugMode ? 'debug' : 'info' },
          {
            onStageCompleted: (e) => void 0,
            onBranchCreated: (e) => void 0,
            onPipelineCompleted: (e) => void 0,
          }
        );

        const def = buildFramingPipeline({
          datasetName: input.datasetName,
          datasetContext: input.datasetContext,
          columnDefinitions: input.columnDefinitions,
        });

        const outcome = await engine.run(def);

        // Collect enriched, base, or raw DSL outputs from lineage
        const enriched: any[] = [];
        const bases: any[] = [];
        const dslAnalets: any[] = [];
        const visit = (node: any) => {
          if (!node) return;
          const stage = String(node.stage || '');
          if (stage.startsWith('enrichAnalet')) {
            if (Array.isArray(node.output)) enriched.push(...node.output);
            else if (node.output) enriched.push(node.output);
          } else if (stage.startsWith('createBaseAnalet')) {
            if (Array.isArray(node.output)) bases.push(...node.output);
            else if (node.output) bases.push(node.output);
          } else if (stage.startsWith('ideaToCellQL')) {
            if (Array.isArray(node.output)) dslAnalets.push(...node.output);
            else if (node.output) dslAnalets.push(node.output);
          }
          (node.children || []).forEach(visit);
        };
        outcome.resultTree.forEach(visit);

        // Prefer enriched → base → raw DSL
        if (enriched.length > 0) {
          return {
            success: true,
            baseAnalets: enriched as any,
            metadata: {
              requestId: this.generateRequestId(),
              source: 'framing',
              processingTime: Date.now(),
              context: {
                datasetName: input.datasetName,
                columnDefinitions: input.columnDefinitions,
                additionalContext: input.metadata,
                enrichedInAdapter: true,
              },
            },
          };
        }

        let baseAnalets = bases;
        if (baseAnalets.length === 0 && dslAnalets.length > 0) {
          baseAnalets = dslAnalets.map((a: any) => ({
            statement: a.statement,
            cellQL: a.cellQL || a.formalGrammar,
            explanation: a.explanation,
            tags: a.tags || ['framing'],
          }));
        }
        if (outcome.errors.length) {
          console.warn(`⚠️ [FramingAdapter] ${outcome.errors.length} stage errors encountered`);
        }

        // Enrich if we only have base analets
        if (baseAnalets.length === 0) {
          return {
            success: true,
            baseAnalets: [],
            metadata: {
              requestId: this.generateRequestId(),
              source: 'framing',
              processingTime: Date.now(),
              context: {
                datasetName: input.datasetName,
                columnDefinitions: input.columnDefinitions,
                additionalContext: input.metadata,
              },
            },
          };
        }

        try {
          const enrichment = new AnaletEnrichmentService();
          const enrichmentConfig: EnrichmentConfig = {
            source: 'framing',
            startPosition: input.position,
            generateEmbeddings: true,
            additionalMetadata: {
              requestId: this.generateRequestId(),
              datasetName: input.datasetName,
            },
          };
          const enrStart = Date.now();
          const enrichmentResult = await enrichment.enrichAnalets(baseAnalets as any, enrichmentConfig);
          const enrElapsed = Date.now() - enrStart;
          if (enrichmentResult.success) {
            return {
              success: true,
              baseAnalets: enrichmentResult.analets as any,
              metadata: {
                requestId: this.generateRequestId(),
                source: 'framing',
                processingTime: Date.now(),
                context: {
                  datasetName: input.datasetName,
                  columnDefinitions: input.columnDefinitions,
                  additionalContext: input.metadata,
                  enrichedInAdapter: true,
                },
              },
            };
          }
        } catch (e) {
          console.warn('⚠️ [FramingAdapter] Enrichment stage failed, returning base analets only:', e);
        }

        return {
          success: true,
          baseAnalets,
          metadata: {
            requestId: this.generateRequestId(),
            source: 'framing',
            processingTime: Date.now(),
            context: {
              datasetName: input.datasetName,
              columnDefinitions: input.columnDefinitions,
              additionalContext: input.metadata,
            },
          },
        };
      }

      // Fallback to legacy sequential (unreachable with current flag)
      throw new Error('Concurrent pipeline disabled by feature flag');

    } catch (error) {
      console.error(`💥 [FramingAdapter] Failed to generate analets:`, error);
      return {
        success: false,
        baseAnalets: [],
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          requestId: this.generateRequestId(),
          source: 'framing',
          processingTime: Date.now()
        }
      };
    }
  }

  /**
   * Format stage results for template replacement
   */
  private formatStageResult(result: any, stage: string): string {
    switch (stage) {
      case 'stakeholders':
        return result.stakeholders?.map((s: any, i: number) =>
          `${i + 1}. ${s.role}: ${s.interests}`
        ).join('\n') || '';

      case 'goals':
        return result.goals?.map((g: any, i: number) =>
          `${i + 1}. ${g.stakeholder || g.stakeholderRole} - ${g.goalTitle}: ${g.description}`
        ).join('\n\n') || '';

      case 'analet_ideas': {
        // Fixed: use analetIdeas not ideas
        const ideas = result.analetIdeas || result.ideas || [];
        return ideas.map((idea: any, i: number) =>
          `${i + 1}. GOAL: ${idea.goalTitle} | STATEMENT: ${idea.statement} | EXPLANATION: ${idea.explanation}`
        ).join('\n\n') || '';
      }

      default:
        return JSON.stringify(result, null, 2);
    }
  }

  /**
   * Generate context for the stakeholder→goals→analets pipeline
   * Returns structured context ready for LLM generation
   */
  public async generateContext(input: FramingGenerationCommand): Promise<{
    contexts: Array<{
      stage: string;
      system: string;
      user: string;
      schema: any;
      dependencies?: string[];
    }>;
    success: boolean;
    error?: string;
  }> {
    try {
      const schemaCard = SchemaCardService.getInstance();

      // Build dataset context using SchemaCardService
      const datasetInfo = {
        name: input.datasetName,
        description: input.datasetContext,
        columns: input.columnDefinitions
      };
      const contextToUse = schemaCard.buildDatasetSchemaCard(datasetInfo, { compactMode: false });

      // Check for existing stakeholders and goals
      let hasStakeholders = false;
      let hasGoals = false;
      let stakeholderText = '';
      let goalText = '';

      try {
        const stateService = StateManagementService.getInstance();

        // Check for saved stakeholders
        const savedStakeholders = await stateService.loadStakeholderDescriptions();
        if (savedStakeholders && savedStakeholders.length > 0) {
          hasStakeholders = true;
          stakeholderText = savedStakeholders.map((s: any, i: number) =>
            `${i + 1}. ${s.role}: ${s.interests}`
          ).join('\n');
        }

        // Check for saved goals
        const savedGoals = await stateService.loadAnalysisGoals();
        if (savedGoals && savedGoals.length > 0) {
          hasGoals = true;
          goalText = savedGoals.map((g: any, i: number) =>
            `${i + 1}. ${g.stakeholderRole} - ${g.goalTitle}: ${g.description}`
          ).join('\n\n');
        }
      } catch (error) {
        console.warn('⚠️ [FramingAdapter] Could not load saved context:', error);
      }

      const contexts = [];

      // Stage 1: Stakeholder generation (if needed)
      if (!hasStakeholders) {
        contexts.push({
          stage: 'stakeholders',
          system: 'You are a data analysis expert.',
          user: `You are a senior data analyst helping identify key stakeholders for a dataset analysis project.

DATASET CONTEXT:
- Dataset: ${input.datasetName || 'dataset.csv'}
- Description: ${contextToUse}

TASK:
Generate exactly 5 distinct stakeholders who would be interested in analyzing this dataset. For each stakeholder, provide:
1. Role/title
2. Primary interests and goals
3. Types of questions they would want to explore

RULES:
- Exactly 5 stakeholders
- Diverse perspectives (business, technical, research, regulatory, consumer)
- Realistic roles relevant to the dataset domain
- Questions should be specific to the dataset columns`,
          schema: Schemas.StakeholdersResponseSchema
        });
      }

      // Stage 2: Goals generation (if needed)
      if (hasStakeholders && !hasGoals) {
        contexts.push({
          stage: 'goals',
          system: 'You are a data analysis strategist.',
          user: `You are identifying high-level analysis goals for different stakeholders that emphasize forming and testing meaningful hypotheses via views of the data.

DATASET CONTEXT:
- Dataset: ${input.datasetName || 'dataset.csv'}
- Description: ${contextToUse}

STAKEHOLDERS:
${stakeholderText}

TASK:
For each stakeholder, generate 2-4 high-level analysis goals that represent their key interests.
Each goal should be:
- Strategic and conceptual (not specific analysis questions yet)
- Relevant to that stakeholder's role and interests
- Focused on hypotheses evaluated through views; encourage minimal transforms (derive/filter/group/bin/facet)
- Achievable with the available dataset

RULES:
- 2-4 goals per stakeholder (10-20 total goals)
- Goals should be conceptual frameworks, not specific questions
- Use actual column names from the dataset description when relevant`,
          schema: Schemas.GoalsResponseSchema,
          dependencies: ['stakeholders']
        });
      }

      // Stage 3: Analet ideas generation (if we have goals)
      if (hasGoals) {
        contexts.push({
          stage: 'analet_ideas',
          system: 'You are a data analysis expert.',
          user: `You are generating specific analysis ideas for high-level goals, centered on testing a hypothesis through a meaningful view of the data.

DATASET CONTEXT:
- Dataset: ${input.datasetName || 'dataset.csv'}
- Description: ${contextToUse}

ANALYSIS GOALS:
${goalText}

TASK:
For each analysis goal above, generate 2-4 specific analet ideas.
Each analet idea should be:
- A specific, actionable statement embedding a hypothesis to test
- Directly related to the parent goal
- Use actual column names from the dataset description
- Include only minimal transforms needed to test the hypothesis (derive/filter/group/bin/facet), and specify the target view

RULES:
- 2-4 analet ideas per goal
- Statements should be specific and actionable
- Use actual column names from dataset
- Prefer VALUE_COUNT, BIN_COUNT1D/2D, DECILE, BIN, REPEAT, QUANTIZE
- Each idea should contribute to its parent goal

Examples (adapt names):
- Derive price_per_carat = price / carat; histogram by cut to compare distributions (test: higher clarity → higher price_per_carat within Ideal cuts)
- Carat deciles; avg price_per_carat by decile (test: monotonic relationship)
- Filter Ideal cut; value_count of clarity (test: composition)
- Scatter carat vs price, faceted by color (test: relationship shift across color)`,
          // Enforce single-sentence statements with no auxiliary text
          userPost: `
Output rules:
- Each analet idea's statement must be a single English sentence.
- Generate a concise shortName (6-10 words) that's skimmable and captures the essence of the analysis.
- No bullets, numbering, labels, markdown, or extra commentary.`,
          schema: Schemas.AnaletIdeasResponseSchema,
          dependencies: []
        });
      }

      // If we have no saved context at all, start the full pipeline
      if (!hasStakeholders && !hasGoals) {
        // Add goals stage that will wait for stakeholders
        contexts.push({
          stage: 'goals',
          system: 'You are a data analysis strategist.',
          user: `You are identifying high-level analysis goals for different stakeholders that emphasize forming and testing meaningful hypotheses via views of the data.

DATASET CONTEXT:
- Dataset: ${input.datasetName || 'dataset.csv'}
- Description: ${contextToUse}

STAKEHOLDERS:
{{stakeholders_result}}

TASK:
For each stakeholder, generate 2-4 high-level analysis goals that represent their key interests.
Each goal should be:
- Strategic and conceptual (not specific analysis questions yet)
- Relevant to that stakeholder's role and interests
- Focused on hypotheses evaluated through views; encourage minimal transforms
- Achievable with the available dataset

RULES:
- 2-4 goals per stakeholder (10-20 total goals)
- Goals should be conceptual frameworks, not specific questions
- Use actual column names from the dataset description when relevant`,
          schema: Schemas.GoalsResponseSchema,
          dependencies: ['stakeholders']
        });

        // Add analet ideas stage that will wait for goals
        contexts.push({
          stage: 'analet_ideas',
          system: 'You are a data analysis expert.',
          user: `You are generating specific analysis ideas for high-level goals, centered on testing a hypothesis through a meaningful view of the data.

DATASET CONTEXT:
- Dataset: ${input.datasetName || 'dataset.csv'}
- Description: ${contextToUse}

ANALYSIS GOALS:
{{goals_result}}

TASK:
For each analysis goal above, generate 2-4 specific analet ideas.
Each analet idea should be:
- A specific, actionable statement embedding a hypothesis to test
- Directly related to the parent goal
- Use actual column names from the dataset description
- Include only minimal transforms needed and the target view

RULES:
- 2-4 analet ideas per goal
- Statements should be specific and actionable
- Use actual column names from dataset
- Prefer VALUE_COUNT, BIN_COUNT1D/2D, DECILE, BIN, REPEAT, QUANTIZE
- Each idea should contribute to its parent goal`,
          schema: Schemas.AnaletIdeasResponseSchema,
          dependencies: ['goals']
        });
      }

      // Always add the final DSL conversion stage
      contexts.push({
        stage: 'dsl_conversion',
        system: 'You are a transpiler from natural-language analysis ideas to CellQL. Produce valid CellQL and list referenced columns for every idea.',
        user: `Convert ALL the analysis ideas below into CellQL analets. You must return an analet for EVERY idea listed.

DATASET CONTEXT:
- Dataset: ${input.datasetName || 'dataset.csv'}
- Description: ${contextToUse}

ANALET IDEAS TO CONVERT (convert ALL of these):
{{analet_ideas_result}}

CRITICAL: Return an analet for EVERY idea above. Do not skip any ideas.

For EACH analet idea, return JSON fields:
1. statement: Clear, actionable analysis statement (e.g., "Distribution of diamond prices by cut quality")
2. cellQL: a single fenced block labeled cellql, containing only CellQL
3. columns: string[] of referenced columns used by the CellQL
4. explanation: Brief description (2-3 sentences) of what this analysis reveals
5. tags: 3-5 relevant keywords

CellQL mapping guidelines:
- Distributions → BIN_COUNT1D("table", column, bins)
- Cross-tabulations → BIN_COUNT2D("table", x, y, x_bins, y_bins)
- Value counts → VALUE_COUNT("table", column)
- Aggregations → SELECT aggregation FROM "table" GROUP BY column
- Multiple similar analyses → REPEAT variable IN (values): SQL_TEMPLATE; END

Expected output: ${input.datasetName === 'diamonds' ? '25-35' : '15-25'} analets (one per idea provided).`,
        schema: Schemas.DSLResponseSchema,
        dependencies: ['analet_ideas']
      });
      return { contexts, success: true };

    } catch (error) {
      console.error(`💥 [FramingAdapter] Failed to build context:`, error);
      return {
        contexts: [],
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Enhance dataset context with semantic column definitions
   */
  private enhanceDatasetContext(
    baseContext: string,
    columnDefinitions?: EnhancedColumnDefinition[]
  ): string {
    if (!columnDefinitions || columnDefinitions.length === 0) {
      return baseContext;
    }
    // Create structured column descriptions using semantic definitions
    const columnsText = columnDefinitions
      .filter(col => col && col.name) // Ensure valid column objects
      .map(col => {
        const parts = [col.displayName || col.name];

        if (col.type) parts.push(`(${col.type})`);
        if (col.description) parts.push(`: ${col.description}`);
        if (col.unit) parts.push(`[Unit: ${col.unit}]`);
        if (col.example) parts.push(`[Example: ${col.example}]`);

        return `${col.name} - ${parts.join(' ')}`;
      })
      .join('\n');

    return `${baseContext}\n\nSEMANTIC COLUMN DEFINITIONS:\n${columnsText}`;
  }

  /**
   * Create a truncated preview of text for logging
   */
  private preview(text: unknown, limit: number = 200): string {
    try {
      const str = typeof text === 'string' ? text : JSON.stringify(text);
      return str.length > limit ? str.slice(0, limit) + '…' : str;
    } catch {
      return '[preview failed]';
    }
  }
}
