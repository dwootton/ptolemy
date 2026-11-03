import { z } from 'zod';

// Reuse light atoms from the recursive schema to keep semantics aligned
export const LinearIdent = z.string().min(1);

export const LinearColumnRef = z.object({
  // Providers require required keys; allow null to indicate absence
  table: z.string().min(1).nullable(),
  name: z.string().min(1)
}).strict();

export const LinearDataType = z.enum(['NUMERIC', 'CATEGORICAL']);

// Repeat domains (non-recursive)
export const LinearRepeatOverList = z.object({
  kind: z.literal('list'),
  items: z.array(z.union([LinearColumnRef, z.string(), z.number()])).min(1)
}).strict();

export const LinearQuantizeDeciles = z.object({
  type: z.literal('DECILES'),
  k: z.number().int().positive()
}).strict();

export const LinearQuantizeEqualWidth = z.object({
  type: z.literal('EQUAL_WIDTH'),
  bins: z.number().int().positive()
}).strict();

export const LinearRepeatOverQuantize = z.object({
  kind: z.literal('quantize'),
  table: z.string().min(1),
  column: LinearColumnRef,
  spec: z.union([LinearQuantizeDeciles, LinearQuantizeEqualWidth])
}).strict();

export const LinearRepeatOver = z.union([LinearRepeatOverList, LinearRepeatOverQuantize]);

// Branch conditions (non-recursive)
export const LinearCondEqSymbols = z.object({
  kind: z.literal('eqSymbols'),
  left: z.object({ symbol: LinearIdent }).strict(),
  right: z.object({ symbol: LinearIdent }).strict()
}).strict();

export const LinearCondNeqSymbols = z.object({
  kind: z.literal('neqSymbols'),
  left: z.object({ symbol: LinearIdent }).strict(),
  right: z.object({ symbol: LinearIdent }).strict()
}).strict();

export const LinearCondTypeIs = z.object({
  kind: z.literal('typeIs'),
  symbol: LinearIdent,
  dtype: LinearDataType
}).strict();

export const LinearBranchCond = z.union([LinearCondEqSymbols, LinearCondNeqSymbols, LinearCondTypeIs]);

// Linear nodes reference children by id only
export const LinearSqlNode = z.object({
  id: z.number().int().nonnegative(),
  kind: z.literal('sql'),
  text: z.string().min(1),
  // Required but nullable to satisfy provider limitations
  expects: z.array(LinearIdent).nonempty().nullable()
}).strict();

export const LinearRepeatNode = z.object({
  id: z.number().int().nonnegative(),
  kind: z.literal('repeat'),
  symbol: LinearIdent,
  over: LinearRepeatOver,
  body: z.number().int().nonnegative()
}).strict();

export const LinearBranchNode = z.object({
  id: z.number().int().nonnegative(),
  kind: z.literal('branch'),
  cases: z.array(
    z.object({
      // Required but nullable signals else-case
      when: LinearBranchCond.nullable(),
      body: z.number().int().nonnegative()
    }).strict()
  ).min(1)
}).strict();

export const LinearConcatNode = z.object({
  id: z.number().int().nonnegative(),
  kind: z.literal('concat'),
  children: z.array(z.number().int().nonnegative()).min(1)
}).strict();

export const LinearNode = z.union([
  LinearSqlNode,
  LinearRepeatNode,
  LinearBranchNode,
  LinearConcatNode
]);

export const CellQLLinearProgramSchema = z.object({
  version: z.literal('lite-1.0'),
  root: z.number().int().nonnegative(),
  nodes: z.array(LinearNode).min(1)
}).strict();

export type CellQLLinearProgram = z.infer<typeof CellQLLinearProgramSchema>;


