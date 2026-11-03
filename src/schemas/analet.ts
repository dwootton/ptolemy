import { z } from 'zod';

/**
 * Core analet schema for LLM-generated analets
 * This ensures consistent structure across all analet generation
 */
export const AnaletSchema = z.object({
  statement: z.string().describe("Clear, specific analysis statement that this analet represents"),
  formalGrammar: z.string().describe("Formal grammar representation following the established formalism patterns"),
  explanation: z.string().describe("Brief explanation of what this analysis accomplishes and why it's valuable"),
  tags: z.array(z.string()).nullable().describe("Optional array of tags for categorization"),
});

/**
 * Schema for notebook cell-derived analets
 */
export const NotebookAnaletSchema = AnaletSchema.extend({
  // Inherits all base analet fields
});

/**
 * Schema for conceptual statement-derived analets
 */
export const ConceptualAnaletSchema = AnaletSchema.extend({
  // Inherits all base analet fields
});

/**
 * Schema for pipeline/framing analets
 */
export const PipelineAnaletSchema = AnaletSchema.extend({
  // Inherits all base analet fields
});

/**
 * Schema for random/generated analets
 */
export const RandomAnaletSchema = AnaletSchema.extend({
  // Inherits all base analet fields
});

/**
 * Schema for multiple analets response
 */
export const MultipleAnaletsSchema = z.object({
  analets: z.array(AnaletSchema)
});

/**
 * Schema for statements array response
 */
export const StatementsArraySchema = z.object({
  statements: z.array(z.string().describe("Specific analysis statement that represents data analysis"))
});

/**
 * Schema for cluster naming
 */
export const ClusterNameSchema = z.object({
  name: z.string().describe("A concise, descriptive name for the cluster of analets")
});

/**
 * Schema for derived analet generation
 */
export const DerivedAnaletSchema = AnaletSchema.extend({
  // Inherits all base analet fields
});

/**
 * Schema for simple string response
 */
export const StringResponseSchema = z.object({
  content: z.string().describe("The generated text content")
});

// Decision schema for updating analet representation from code changes
export const RepresentationDecisionSchema = z.object({
  decision: z.enum(['change', 'no_change']).describe('Whether to update the analet representation'),
  representation: z.string().nullable().describe('Updated analet representation/formal grammar when decision is change'),
  statement: z.string().nullable().describe('Optional updated concise statement/title'),
  explanation: z.string().nullable().describe('Optional updated explanation'),
  reason: z.string().nullable().describe('Brief reason for the decision')
});


export const PythonCodeResponseSchema = z.object({
  python_code: z.string().describe("The generated Python code for the analet described")
});

/**
 * Type exports for TypeScript usage
 */
export type AnaletSchemaType = z.infer<typeof AnaletSchema>;
export type NotebookAnaletSchemaType = z.infer<typeof NotebookAnaletSchema>;
export type ConceptualAnaletSchemaType = z.infer<typeof ConceptualAnaletSchema>;
export type PipelineAnaletSchemaType = z.infer<typeof PipelineAnaletSchema>;
export type RandomAnaletSchemaType = z.infer<typeof RandomAnaletSchema>;
export type MultipleAnaletsSchemaType = z.infer<typeof MultipleAnaletsSchema>;
export type StatementsArraySchemaType = z.infer<typeof StatementsArraySchema>;
export type ClusterNameSchemaType = z.infer<typeof ClusterNameSchema>;
export type DerivedAnaletSchemaType = z.infer<typeof DerivedAnaletSchema>;
export type StringResponseSchemaType = z.infer<typeof StringResponseSchema>;
export type RepresentationDecisionSchemaType = z.infer<typeof RepresentationDecisionSchema>;
export type PythonCodeResponseSchemaType = z.infer<typeof PythonCodeResponseSchema>;