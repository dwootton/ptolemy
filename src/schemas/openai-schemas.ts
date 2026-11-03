import { z } from 'zod';
import { CellQLLinearProgramSchema } from './cellql-linear-schema';

// Stakeholder schema
export const StakeholderSchema = z.object({
  role: z.string(),
  description: z.string(),
  interests: z.string(),
  questions: z.array(z.string()),
});

export const StakeholdersResponseSchema = z.object({
  stakeholders: z.array(StakeholderSchema),
});

// Goals schema
export const GoalSchema = z.object({
  stakeholder: z.string(),
  goalTitle: z.string(),
  description: z.string(),
  viewTypeHints: z.array(z.string()), // ["smallMultiples","trend","groupCompare"]
  transforms: z.array(z.enum(["bin","groupby","filter","derive","ntile"])),
  columnsUsed: z.array(z.string()),
  // priority: z.enum(['high', 'medium', 'low']),
});

export const GoalsResponseSchema = z.object({
  goals: z.array(GoalSchema),
});

// Analet Ideas schema
export const AnaletIdeaSchema = z.object({
  goalTitle: z.string(),
  stakeholder: z.string(),
  statement: z.string(),
  shortName: z.string(),
  explanation: z.string(),
});

export const AnaletIdeasResponseSchema = z.object({
  analetIdeas: z.array(AnaletIdeaSchema),
});

// Simplified DSL Translation schema
export const DSLAnaletSchema = z.object({
  statement: z.string(),
  shortName: z.string(),
  cellQL: z.string(),
  explanation: z.string(),
  tags: z.array(z.string()),
  columns: z.array(z.string()),
});

export const DSLResponseSchema = z.object({
  analets: z.array(DSLAnaletSchema),
});


// Enhanced Analet schema (for final translation)
export const EnhancedAnaletSchema = z.object({
  statement: z.string(),
  shortName: z.string(),
  cellQL: z.string(),
  columns: z.array(z.string()),
  explanation: z.string(),
  tags: z.array(z.string()),
});

export const EnhancedAnaletsResponseSchema = z.object({
  analets: z.array(EnhancedAnaletSchema),
});

// Hypotheses schema
export const HypothesisSchema = z.object({
  stakeholder: z.string(),
  hypothesis: z.string(),
});

export const HypothesesResponseSchema = z.object({
  hypotheses: z.array(HypothesisSchema),
});

// Column Definitions schema
export const ColumnDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  unit: z.string(),
});

export const ColumnDefinitionsResponseSchema = z.object({
  columns: z.array(ColumnDefinitionSchema),
});

// Enhanced Column Definitions schema
export const EnhancedColumnDefinitionSchema = z.object({
  name: z.string(),
  displayName: z.string(),
  type: z.enum(['string', 'int', 'float', 'boolean', 'date']),
  unit: z.string(),
  description: z.string(),
  example: z.string(),
});

export const EnhancedColumnDefinitionsResponseSchema = z.object({
  columns: z.array(EnhancedColumnDefinitionSchema),
});

// Variable Relationships schema
export const VariableRelationshipSchema = z.object({
  source: z.string(),
  target: z.string(),
  relationship: z.enum([
    'correlates with',
    'depends on', 
    'influences',
    'varies with',
    'inversely related',
    'groups by',
    'precedes'
  ]),
  description: z.string(),
  strength: z.enum(['weak', 'moderate', 'strong']),
});

export const VariableRelationshipsResponseSchema = z.object({
  relationships: z.array(VariableRelationshipSchema),
});


// Code parsing response schema
export const CodeParsingResponseSchema = z.object({
  statement: z.string(),
  shortName: z.string(),
  cellQL: z.string(),
  explanation: z.string(),
});

// Linear AST variant (non-recursive) for providers that require strict JSON Schema
export const DSLAnaletLinearSchema = z.object({
  statement: z.string(),
  shortName: z.string(),
  cellQL: CellQLLinearProgramSchema,
  explanation: z.string(),
  tags: z.array(z.string()),
  columns: z.array(z.string()),
}).strict();

export const DSLResponseLinearSchema = z.object({
  analets: z.array(DSLAnaletLinearSchema),
});

// Type exports
export type Stakeholder = z.infer<typeof StakeholderSchema>;
export type StakeholdersResponse = z.infer<typeof StakeholdersResponseSchema>;
export type Goal = z.infer<typeof GoalSchema>;
export type GoalsResponse = z.infer<typeof GoalsResponseSchema>;
export type AnaletIdea = z.infer<typeof AnaletIdeaSchema>;
export type AnaletIdeasResponse = z.infer<typeof AnaletIdeasResponseSchema>;
export type DSLAnalet = z.infer<typeof DSLAnaletSchema>;
export type DSLResponse = z.infer<typeof DSLResponseSchema>;
export type EnhancedAnalet = z.infer<typeof EnhancedAnaletSchema>;
export type EnhancedAnaletsResponse = z.infer<typeof EnhancedAnaletsResponseSchema>;
export type Hypothesis = z.infer<typeof HypothesisSchema>;
export type HypothesesResponse = z.infer<typeof HypothesesResponseSchema>;
export type ColumnDefinition = z.infer<typeof ColumnDefinitionSchema>;
export type ColumnDefinitionsResponse = z.infer<typeof ColumnDefinitionsResponseSchema>;
export type EnhancedColumnDefinition = z.infer<typeof EnhancedColumnDefinitionSchema>;
export type EnhancedColumnDefinitionsResponse = z.infer<typeof EnhancedColumnDefinitionsResponseSchema>;
export type VariableRelationship = z.infer<typeof VariableRelationshipSchema>;
export type VariableRelationshipsResponse = z.infer<typeof VariableRelationshipsResponseSchema>;
export type CodeParsingResponse = z.infer<typeof CodeParsingResponseSchema>;