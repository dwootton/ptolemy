import { StageDef } from '../types';
import { NewOpenAIService } from '../../llm/NewOpenAIService';
import { DSLResponseSchema } from '../../../schemas/openai-schemas';
import { z } from 'zod';

export function createGenerateRelatedAnaletsStage(params: { statement: string; count?: number }): StageDef<void, any[]> {
  const { statement, count = 5 } = params;
  return {
    name: 'generateRelatedAnalets',
    handler: async () => {
      const svc = NewOpenAIService.getInstance();
      const system = 'You are a data analysis expert. Generate related analysis questions with CellQL.';
      const user = `Generate ${count} analysis items related to the given statement.

SOURCE STATEMENT:
${statement}

For each generated analysis, return:
- statement: Clear, specific analysis question
- cellQL: Valid CellQL for the analysis
- explanation: Brief rationale (1-2 sentences)
- tags: 2-5 keywords`;
      const resp = await svc.chatStructured<{ analets: any[] }>({ system, user, schema: DSLResponseSchema });
      const analets = resp.analets || [];
      console.info('[pipeline] generateRelatedAnalets → %d', analets.length);
      return analets.slice(0, count);
    }
  };
}

// New: two-step pipeline support (ideas → translation)
const RelatedIdeaSchema = z.object({
  statement: z.string(),
  explanation: z.string().optional(),
  tags: z.array(z.string()).optional(),
});
const RelatedIdeasResponseSchema = z.object({ ideas: z.array(RelatedIdeaSchema) });

export function createGenerateRelatedIdeasStage(params: { seed: { type: 'bearing' | 'analet'; name?: string; cellQL?: string }; count?: number }): StageDef<void, Array<{ statement: string; explanation?: string; tags?: string[] }>> {
  const { seed, count = 5 } = params;
  return {
    name: 'generateRelatedIdeas',
    handler: async () => {
      const svc = NewOpenAIService.getInstance();
      const system = 'You are a data analysis expert. Propose concrete analysis ideas (no code). Keep explanations to a single short sentence.';
      const seedBlock = seed.type === 'bearing'
        ? `BEARING NAME: ${seed.name || ''}`
        : `SOURCE CELLQL:\n${seed.cellQL || ''}`;
      const user = `Generate ${count} concrete analysis ideas related to the following source. Provide only ideas, not code.\n\n${seedBlock}

For each idea, include:
- statement
- explanation (exactly one short sentence)
- tags (2–5)`;
      const resp = await svc.chatStructured<{ ideas: any[] }>({ system, user, schema: RelatedIdeasResponseSchema });
      const ideas = resp.ideas || [];
      console.info('[pipeline] generateRelatedIdeas → %d', ideas.length);
      return ideas.slice(0, count);
    }
  };
}

export function createTransformIdeaToCellQLStage(): StageDef<{ statement: string; explanation?: string; tags?: string[] }, any> {
  return {
    name: 'transformIdeaToCellQL',
    handler: async (idea) => {
      const svc = NewOpenAIService.getInstance();
      const system = 'Convert analysis idea into exactly one CellQL analet. Ensure the explanation is a single concise sentence.';
      const user = `Convert the analysis idea into CellQL. Return exactly one analet.

IDEA STATEMENT: ${idea.statement}
EXPLANATION: ${idea.explanation || ''}

Output must include: statement, cellQL, explanation (one short sentence), tags`;
      const resp = await svc.chatStructured<{ analets: any[] }>({ system, user, schema: DSLResponseSchema });
      const one = (resp.analets && resp.analets[0]) ? resp.analets[0] : undefined;
      console.info('[pipeline] transformIdeaToCellQL → %s', one?.statement?.slice(0, 60) || 'none');
      return one ? one : [];
    }
  };
}


