import { BaseAnaletInputAdapter } from './base/AnaletInputAdapter';
import { ValidationResult, AdapterResponse } from '../types';
import { NewOpenAIService } from '../../llm/NewOpenAIService';
import { DatasetSummarizerService } from '../../DatasetSummarizerService';
import { createIdeaToCellQLStage } from '../../pipeline/stages/IdeaToCellQL';
import { createBaseAnaletStage, createEnrichAnaletStage } from '../../pipeline/stages/FramingStages';

export interface HierarchyGenerationCommand {
  type: 'from_hierarchy';
  path: string[];
  depth: number;
  parentContext?: {
    kind: 'analet' | 'bearing' | 'note';
    title: string;
    data: any;
  };
  siblingContext: Array<{
    kind: 'analet' | 'bearing' | 'note';
    title: string;
    data: any;
  }>;
  ancestorContext: Array<{
    kind: 'analet' | 'bearing' | 'note';
    title: string;
    data: any;
  }>;
  ordinalDistances: Array<{
    targetId: string;
    targetTitle: string;
    targetKind: 'analet' | 'bearing' | 'note';
    distance: number;
    relationship: 'sibling' | 'ancestor' | 'descendant';
    description: string;
  }>;
  similarAnalets: any[];
  maxCount?: number;
  position?: { x: number; y: number };
  metadata?: Record<string, any>;
}

export class HierarchyAdapter extends BaseAnaletInputAdapter<HierarchyGenerationCommand> {
  readonly inputType = 'from_hierarchy';
  private openAIService?: NewOpenAIService;

  canHandle(input: any): input is HierarchyGenerationCommand {
    return input?.type === 'from_hierarchy';
  }

  validate(input: HierarchyGenerationCommand): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!input.path || !Array.isArray(input.path)) {
      errors.push('Path must be a non-empty array');
    }

    if (typeof input.depth !== 'number' || input.depth < 0) {
      errors.push('Depth must be a non-negative number');
    }

    if (!input.siblingContext || !Array.isArray(input.siblingContext)) {
      errors.push('Sibling context must be an array');
    }

    if (!input.ancestorContext || !Array.isArray(input.ancestorContext)) {
      errors.push('Ancestor context must be an array');
    }

    if (!input.ordinalDistances || !Array.isArray(input.ordinalDistances)) {
      errors.push('Ordinal distances must be an array');
    }

    if (!input.similarAnalets || !Array.isArray(input.similarAnalets)) {
      errors.push('Similar analets must be an array');
    }

    if (input.maxCount && (typeof input.maxCount !== 'number' || input.maxCount <= 0)) {
      errors.push('Max count must be a positive number');
    }

    if (input.position && (!input.position.x || !input.position.y)) {
      warnings.push('Position should have both x and y coordinates');
    }

    return this.createValidationResult(errors, warnings);
  }

  async generateBaseAnalets(input: HierarchyGenerationCommand): Promise<AdapterResponse> {
    try {
      // Initialize OpenAI service if needed
      if (!this.openAIService) {
        this.openAIService = NewOpenAIService.getInstance();
      }

      // 1) Generate a contextual idea based on hierarchy position
      const ideaPrompt = this.createHierarchyPrompt(input);
      const dsSvc = DatasetSummarizerService.getInstance();
      const datasetInfo = dsSvc.getDatasetInfo();
      const datasetContext = dsSvc.getDatasetContext();
      const system = `You are a data analysis expert. You must only propose ideas using the currently loaded dataset${datasetInfo?.name ? ` (${datasetInfo.name})` : ''}. Use only variables/columns present in the dataset. Return exactly one sentence, nothing else.`;
      const user = `${ideaPrompt}\n\nDataset context (for allowed fields only):\n${datasetContext}\n\nConstraints:\n- Use only dataset variables and values\n- One sentence only`;
      const ideaStatement = await this.openAIService.chatText({
        system,
        user,
        model: 'gpt-4o-mini'
      });

      const cleanIdea = (ideaStatement || '').trim().replace(/^"|"$/g, '');
      // 2) Transform idea → CellQL via pipeline stage
      // reusing datasetInfo/datasetContext from above
      const transform = createIdeaToCellQLStage({ datasetName: datasetInfo?.name, datasetContext });
      const toBase = createBaseAnaletStage();
      const enrich = createEnrichAnaletStage({ datasetName: datasetInfo?.name, datasetContext });
      const dslAnalets = await transform.handler({ statement: cleanIdea, explanation: '', tags: ['hierarchy'] } as any, { runId: 'hierarchy-adapter' });
      const baseAnalets = Array.isArray(dslAnalets)
        ? await Promise.all(dslAnalets.map(async (a: any) => await toBase.handler(a, { runId: 'hierarchy-adapter' })))
        : [];
      const enrichedAnalets = Array.isArray(baseAnalets)
        ? await Promise.all(baseAnalets.map(async (a: any) => await enrich.handler(a, { runId: 'hierarchy-adapter' })))
        : [];
      const flattened: any[] = [];
      for (const entry of enrichedAnalets) {
        if (Array.isArray(entry)) flattened.push(...entry); else flattened.push(entry);
      }
      // Log the complete first analet structure


      return {
        success: true,
        baseAnalets: flattened,
        metadata: {
          requestId: this.generateRequestId(),
          source: 'hierarchy',
          processingTime: Date.now(),
          context: {
            path: input.path,
            depth: input.depth,
            parentContext: input.parentContext,
            siblingCount: input.siblingContext.length,
            similarAnaletsCount: input.similarAnalets.length
          }
        }
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error in hierarchy generation',
        baseAnalets: []
      };
    }
  }

  private createHierarchyPrompt(input: HierarchyGenerationCommand): string {
    // Build prompt strictly from local hierarchy context: parent -> ancestors -> siblings
    const parentStatements: string[] = [];
    const ancestorStatements: string[] = [];
    const siblingStatements: string[] = [];

    if (input.parentContext?.kind === 'analet' && input.parentContext.data?.statement) {
      parentStatements.push(String(input.parentContext.data.statement));
    }

    for (const anc of input.ancestorContext.slice(0, 3)) {
      if (anc.kind === 'analet' && anc.data?.statement) {
        ancestorStatements.push(String(anc.data.statement));
      }
    }

    for (const sib of input.siblingContext.slice(0, 6)) {
      if (sib.kind === 'analet' && sib.data?.statement) {
        siblingStatements.push(String(sib.data.statement));
      }
    }

    // Debug
    try {
      if (siblingStatements.length === 0 && input.ordinalDistances?.length) {
        const sibOrd = input.ordinalDistances.filter(d => d.relationship === 'sibling' && d.targetKind === 'analet').map(d => d.targetTitle).slice(0, 3);
      }
    } catch {}

    const lines: string[] = [];
    parentStatements.forEach((s) => lines.push(s));
    ancestorStatements.forEach((s) => lines.push(s));
    siblingStatements.forEach((s) => lines.push(s));

    if (lines.length === 0) {
      // If absolutely no local context, avoid global fallbacks
      const fallback = `You are positioned at depth ${input.depth} in the hierarchy, but no parent or sibling analyses are available at this location. Propose a single analysis idea consistent with this depth.`;
      return fallback;
    }

    const analetsText = lines
      .slice(0, 6)
      .map((statement, index) => `${index + 1}. ${statement}`)
      .join('\n');

    // If requested as a follow-up under a parent, pivot the instruction
    const mode = input.metadata?.generationMode === 'followup' ? 'followup' : 'sibling';
    if (mode === 'followup' && input.parentContext?.kind === 'analet' && input.parentContext.data?.statement) {
      const parentStmt = String(input.parentContext.data.statement);
      const prompt = `Write exactly ONE follow-up question that adds nuance or depth to the parent analysis (one sentence, no quotes).\n\nPARENT:\n${parentStmt}\n\nRelated context for inspiration (optional):\n${analetsText}`;
      return prompt;
    }
    const prompt = `Generate analysis questions related to these analyses at this hierarchy location (parent/lineage/same-level siblings):\n\n${analetsText}\n\nCreate questions that explore similar concepts or build upon these ideas.`;
    return prompt;
  }
}
