import { z } from "zod";

/* ========= Shared ========= */
const Ident = z.string().min(1);

/** A column reference you can reuse elsewhere (you'll bind/validate values later). */
export const ColumnRef = z.object({
  table: z.string().min(1).optional(), // e.g., "cars"
  name: z.string().min(1)              // e.g., "mpg"
}).strict();

/** Data types for type-based branching (metadata-resolved outside this schema). */
export const DataType = z.enum(["NUMERIC", "CATEGORICAL"]);

/* ========= REPEAT domains ========= */
const RepeatOverList = z.object({
  kind: z.literal("list"),
  /** Items to iterate. Keep it generic: columns or literals (e.g., pairs, buckets). */
  items: z.array(z.union([ColumnRef, z.string(), z.number()])).min(1)
}).strict();

const QuantizeDeciles = z.object({
  type: z.literal("DECILES"),
  k: z.number().int().positive()
}).strict();

const QuantizeEqualWidth = z.object({
  type: z.literal("EQUAL_WIDTH"),
  bins: z.number().int().positive()
}).strict();

const RepeatOverQuantize = z.object({
  kind: z.literal("quantize"),
  /** Source of buckets (resolved at compile time in your engine). */
  table: z.string().min(1),
  column: ColumnRef,                   // which column to bucket
  spec: z.union([QuantizeDeciles, QuantizeEqualWidth])
}).strict();

export const RepeatOver = z.union([RepeatOverList, RepeatOverQuantize]);

/* ========= BRANCH conditions (compile-time) ========= */
/** Compare loop symbols (not values) like row vs col. */
const CondEqSymbols = z.object({
  kind: z.literal("eqSymbols"),
  left:  z.object({ symbol: Ident }).strict(),
  right: z.object({ symbol: Ident }).strict()
}).strict();

const CondNeqSymbols = z.object({
  kind: z.literal("neqSymbols"),
  left:  z.object({ symbol: Ident }).strict(),
  right: z.object({ symbol: Ident }).strict()
}).strict();

/** TYPE(symbol) == dtype (your binder will check symbol→column→dtype). */
const CondTypeIs = z.object({
  kind: z.literal("typeIs"),
  symbol: Ident,
  dtype: DataType
}).strict();

export const BranchCond = z.union([CondEqSymbols, CondNeqSymbols, CondTypeIs]);

/* ========= Leaves: SQL templates only ========= */
/** Leaf node: pure SQL template with {{placeholders}}; no structure beyond text. */
export const SqlTemplateLeaf = z.object({
  kind: z.literal("sql"),
  text: z.string().min(1),
  /**
   * Optional: declare which placeholders the template expects (for preflight checks).
   * Example: ["row","col","b","x"]. Your runtime can validate {{...}} against this.
   */
  expects: z.array(Ident).nonempty().optional()
}).strict();

/* ========= Combinator nodes ========= */
export const RepeatNode = z.object({
  kind: z.literal("repeat"),
  symbol: Ident,        // loop symbol (e.g., "c", "row", "col", "x")
  over: RepeatOver,
  body: z.lazy(() => NodeSchema)
}).strict();

export const BranchNode = z.object({
  kind: z.literal("branch"),
  cases: z.array(
    z.union([
      z.object({ when: BranchCond, body: z.lazy(() => NodeSchema) }).strict(),
      z.object({ body: z.lazy(() => NodeSchema) }).strict() // else
    ])
  ).min(1)
}).strict().refine(
  (b) => b.cases.filter((c: any) => !("when" in c)).length <= 1,
  { message: "branch may have at most one else-case" }
);

export const ConcatNode = z.object({
  kind: z.literal("concat"),
  children: z.array(z.lazy(() => NodeSchema)).min(1)
}).strict();

/** Union of all CellQL-lite nodes */
export const NodeSchema: z.ZodType<any> = z.lazy(() =>
  z.union([SqlTemplateLeaf, RepeatNode, BranchNode, ConcatNode])
);

/* ========= Program root ========= */
export const CellQLSchema = z.object({
  version: z.literal("lite-1.0"),
  root: NodeSchema
}).strict();

