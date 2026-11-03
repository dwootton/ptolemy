import { StageDef } from '../types';
import { NewOpenAIService } from '../../llm/NewOpenAIService';
import {
    StakeholdersResponseSchema,
    GoalsResponseSchema,
    AnaletIdeasResponseSchema,
    type StakeholdersResponse,
    type GoalsResponse,
    type AnaletIdeasResponse,
    type AnaletIdea,
    type Goal,
} from '../../../schemas/openai-schemas';
import type { BaseAnalet } from '../../analet/types/base';
import { AnaletEnrichmentService } from '../../analet/domain/AnaletEnrichmentService';
import type { EnrichmentConfig } from '../../analet/types/base';

export interface FramingDatasetInput {
    datasetName?: string;
    datasetContext: string;
    columnDefinitions?: any[];
}

export function createExtractStakeholdersStage(ds: FramingDatasetInput): StageDef<FramingDatasetInput, any[]> {
    return {
        name: 'extractStakeholders',
        handler: async (input) => {
            const svc = NewOpenAIService.getInstance();
            const system = 'You are a data analysis expert.';
            const user = `Identify exactly 5 distinct stakeholders who would be interested in analyzing this dataset.

DATASET: ${ds.datasetName || 'dataset.csv'}
DESCRIPTION:
${ds.datasetContext}


For each stakeholder:
- role (distinct from others)
- primary_interests (tie at least one interest to fields in SCHEMA.all)
- example_questions (2)
Constraints:
- roles must be mutually distinct; no synonyms.
- output strict JSON only.`;
            const resp = await svc.chatStructured<StakeholdersResponse>({ system, user, schema: StakeholdersResponseSchema });
            const stakeholders = resp.stakeholders || [];
            console.info('[pipeline] extractStakeholders → count=%d', stakeholders.length);
            return stakeholders;
        },
    };
}

export function createGenerateGoalsStage(ds: FramingDatasetInput): StageDef<any, any[]> {
    return {
        name: 'generateAnalysisGoals',
        handler: async (stakeholder) => {
            const svc = NewOpenAIService.getInstance();
            const system = 'You are a data analysis strategist.';
            const user = `Generate 3 analysis goals for the stakeholder that emphasize forming and testing meaningful hypotheses via views of the data.

DATASET: ${ds.datasetName || 'dataset.csv'}
DESCRIPTION:
${ds.datasetContext}

STAKEHOLDER:
role: ${stakeholder.role}
interests: ${stakeholder.interests || stakeholder.description || ''}

Constraints:
- Goals should suggest hypotheses to evaluate through views (e.g., subgroup differences, relationships, temporal shifts, rank/compare segments).
- Encourage minimal transformations to support views (derive, filter, group, bin/facet) without heavy modelling jargon.
`;
            const resp = await svc.chatStructured<GoalsResponse>({ system, user, schema: GoalsResponseSchema });
            const goals = resp.goals || [];
            // Attach stakeholder role for lineage clarity
            goals.forEach((g: any) => { if (!g.stakeholder) g.stakeholder = stakeholder.role; });
            console.info('[pipeline] generateAnalysisGoals(%s) → %d', stakeholder.role, goals.length);
            return goals;
        },
    };
}

export function createGenerateIdeasStage(ds: FramingDatasetInput): StageDef<Goal, AnaletIdea[]> {
    return {
        name: 'generateAnaletIdeas',
        handler: async (goal) => {
            const svc = NewOpenAIService.getInstance();
            const system = 'You are a data analysis expert.';
            const user = `

            DATASET: ${ds.datasetName || 'dataset.csv'}
            DESCRIPTION:
            ${ds.datasetContext}

            Generate 4–6 *EDA ideas* that reflect the kind of questions an *experienced analyst* would ask to explore the data and test the goal below. These ideas should go beyond simple SQL walks — they should show intention, comparison, and structure.

            GOAL:
            ${goal.goalTitle}: ${goal.description}


            For the goal below, generate 4-6 specific analet ideas focused on testing a hypothesis through a meaningful view of the data.

stakeholder: ${goal.stakeholder || ''}`;
            // Post-constraints injected to steer content
            const  strictUser = user + `
Generate 4–6 ideas. Each idea must be a single English sentence and follow this JSON shape:
{ "shortName": "<6-10 words>",
  "statement": "<one sentence>",
  "viewType": "<histogram|scatter|bar|line|heatmap|smallMultiples|pairplot|table>",
  "transforms": ["bin"|"groupby"|"filter"|"derive"|"ntile"...],
  "columnsUsed": ["<existing columns only>"],
  "derived": [{"name":"<new_col>","formula":"<col expression>"}] // optional
}

Coverage requirements (enforced):
- ≥1 univariate check, ≥1 bivariate/groupwise comparison, ≥1 idea with a derived column, ≥1 idea with multi-variable structure (faceting or column loop).
Rules:
- columnsUsed ⊆ SCHEMA.all
- do not reference df.columns or unspecified columns
- no markdown, bullets, or labels
Self-check before returning:
- each idea is one sentence; required coverage achieved; all fields present; strict JSON array only.
`;
// //
// Examples (adapt to dataset columns):
// - Create a pairplot of the data
// - Create df.info() to get the schema of the data
// - Derive price_per_carat = price / carat; histogram of price_per_carat faceted by cut to compare distributions.
// - Carat deciles via ; bar of avg price_per_carat by decile to check monotonicity.
// - Filter Ideal cut; VALUE_COUNT of clarity to examine composition differences.
// - Scatter carat vs price colored/faceted by color to inspect relationship shifts.
            // Enforce single-sentence statements with no auxiliary text
//             const strictUser = constrainedUser + `

// Output rules:
// - Each analet idea's statement must be a single English sentence.
// - Generate a concise shortName (6-10 words) that's skimmable and captures the essence of the analysis.
// - No bullets, numbering, labels, markdown, or extra commentary.`;
            const resp = await svc.chatStructured<AnaletIdeasResponse>({ system, user: strictUser, schema: AnaletIdeasResponseSchema });
            const ideas = resp.analetIdeas || [];
            console.info('[pipeline] generateAnaletIdeas(%s) → %d', goal.goalTitle, ideas.length);
            return ideas;
        },
    };
}

// Removed: createTransformToCellQLStage in favor of generic ideaToCellQL stage

export function createBaseAnaletStage(): StageDef<any, BaseAnalet> {
    return {
        name: 'createBaseAnalet',
        handler: async (dslAnalet: any) => {
            const base: BaseAnalet = {
                statement: dslAnalet.statement,
                shortName: dslAnalet.shortName,
                cellQL: dslAnalet.cellQL,
                variables_used: dslAnalet.variables_used,
                semantic_hints_text: dslAnalet.semantic_hints_text,
                explanation: dslAnalet.explanation,
                tags: dslAnalet.tags || ['framing'],
            };
            console.info('[pipeline] createBaseAnalet → %s', (base.statement || '').slice(0, 60));
            return base;
        },
    };
}

export function createEnrichAnaletStage(ds: FramingDatasetInput): StageDef<BaseAnalet, any> {
    return {
        name: 'enrichAnalet',
        handler: async (base: BaseAnalet) => {
            const enrichment = new AnaletEnrichmentService();
            const config: EnrichmentConfig = {
                source: 'framing',
                startPosition: undefined,
                generateEmbeddings: true,
                additionalMetadata: {
                    datasetName: ds.datasetName,
                },
            };
            const result = await enrichment.enrichAnalets([base] as any, config);
            const enriched = (result.success && result.analets && result.analets[0]) ? result.analets[0] : undefined;
            console.info('[pipeline] enrichAnalet → %s', enriched?.statement?.slice(0, 60) || 'failed', enriched);
            return enriched;
        },
    };
}


