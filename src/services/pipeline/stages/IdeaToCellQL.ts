import { StageDef } from '../types';
import { NewOpenAIService } from '../../llm/NewOpenAIService';
import { appendCellQLFailure } from '../../logging/FailureLogger';
import { z } from 'zod';
import { CellQLLinearProgramSchema } from '../../../schemas/cellql-linear-schema';

export interface IdeaToCellQLOpts {
  datasetName?: string;
  datasetContext?: string;
  columnDefinitions?: Array<{ name: string; displayName?: string; description?: string }>;
}

export interface AnaletIdeaLike {
  statement: string;
  shortName?: string;
  explanation?: string;
  tags?: string[];
  goalTitle?: string;
  stakeholder?: string;
}

function buildSemanticHints(variables: string[], defs?: Array<{ name: string; displayName?: string; description?: string }>): string | undefined {
  if (!variables || variables.length === 0 || !defs || defs.length === 0) return undefined;
  const defMap = new Map<string, { display: string; desc?: string }>();
  for (const d of defs) {
    const key = (d.name || '').toLowerCase();
    if (!key) continue;
    defMap.set(key, { display: d.displayName || d.name, desc: d.description });
  }
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const v of variables) {
    const k = (v || '').toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const info = defMap.get(k);
    if (info) {
      const text = info.desc ? `${info.display} – ${info.desc}` : `${info.display}`;
      parts.push(text);
    }
  }
  const result = parts.join('; ');
  return result.length ? result : undefined;
}

export function createIdeaToCellQLStage(opts: IdeaToCellQLOpts = {}): StageDef<AnaletIdeaLike, any[]> {
  const { datasetName, datasetContext, columnDefinitions } = opts;
  return {
    name: 'ideaToCellQL',
    handler: async (idea) => {
      const svc = NewOpenAIService.getInstance();
      const system = `
      ROLE
      You are a transpiler from natural-language “analysis ideas” to CellQL, a compile-time orchestration DSL over SQL.

      OUTPUT
      Return STRICT JSON only: {"cellQL":"<CellQL>", "columns":[<literal column names used>]}
      - No extra keys, no comments outside of JSON, no markdown fences.
      - "columns" MUST be the exact set of literal, existing column names referenced anywhere in your CellQL output (order is fine).
      - If you create derived columns, include them in the CellQL but do not add them to "columns" (only base table columns belong there).

      CORE CONSTRUCTS (compile-time)
      - COL_REPEAT var IN ('colA','colB',...): loop over COLUMN NAMES only (never values).
      - BRANCH ... WHEN/ELSE ... END: compile-time selection (no runtime CASE).
      - CONCAT ( ... , ... ): independent compositions (e.g., side-by-side panels).
      - Faceting on values: NEVER use COL_REPEAT. Use GROUP BY, DECILE/NTILE windows, or a precomputed bucket list. (This mirrors REPEAT/QUANTIZE/BRANCH/CONCAT patterns.)

      RULES (hard)
      1) COL_REPEAT is ONLY for looping through column names.
      2) Every COL_REPEAT list MUST contain ≥2 literal column names, each present in the dataset schema. NEVER emit singletons.
      3) Do NOT invent column names. Use only provided columns or well-formed derived expressions inside SELECT.
      4) If the users IDEA implies “all numeric/categorical columns,” expand to the full explicit list (no df.columns placeholders).
      5) If the IDEA only names one column but a loop is requested, either: (a) promote to a non-loop query, or (b) expand with additional appropriate columns from the provided schema (matching the intent, e.g., numeric), ensuring ≥2. Prefer (b) when intent is clear.
      6) Use BRANCH for type-dependent templates (e.g., TYPE(x)=NUMERIC vs CATEGORICAL), and ensure each branch yields valid SQL.
      7) Use CONCAT for independent views (e.g., “two histograms side by side”).
      8) SQL inside units must be valid and self-contained. Use double quotes for table names, single quotes for string literals.
      9) Never output natural language, comments, or explanations—only the JSON object.

      SELF-CHECK (perform silently; enforce before you output)
      - [C1] No COL_REPEAT has fewer than 2 items.
      - [C2] All items in COL_REPEAT lists appear in the provided column schema.
      - [C3] No references to df.columns, dataset.columns, or unspecified variables.
      - [C4] BRANCH variables are bound by an enclosing COL_REPEAT or are literal known columns.
      - [C5] If value faceting is requested (e.g., “by deciles,” “by categories”), you used GROUP BY / DECILE / NTILE (not COL_REPEAT).
      - [C6] JSON is valid and contains exactly two fields: "cellQL" and "columns".

      EXAMPLES (canonical)

      Jointplot of age and bmi
      {
        "cellQL": "CONCAT ( \n  SELECT BIN(age, 30) AS bin, COUNT(*) AS n FROM "dataset1" GROUP BY bin ORDER BY bin, \n  SELECT BIN(bmi, 30) AS bin, COUNT(*) AS n FROM "dataset1" GROUP BY bin ORDER BY bin, \n  SELECT age, bmi FROM "dataset1" \n)",
        "columns": ["age","bmi"]
      }


      2D binned density for specific pairs (off-diagonal)
      {
        "cellQL": "COL_REPEAT x IN ('mpg','hp','weight'):\\n  COL_REPEAT y IN ('disp','accel','weight'):\\n    BRANCH\\n      WHEN x <> y THEN\\n        SELECT COUNT(BIN2D('{{x}}','{{y}}',30,30)) AS n\\n        FROM \\"dataset1\\";\\n    END\\n  END\\nEND",
        "columns": ["mpg","hp","weight","disp","accel"]
      }

      Pairplot (bins on diagonal, scatter off-diagonal)
      {
        "cellQL": "COL_REPEAT x IN ('mpg','hp','weight'):\\n  COL_REPEAT y IN ('mpg','hp','weight'):\\n    BRANCH\\n      WHEN x <> y THEN\\n        SELECT {{x}}, {{y}} FROM \\"dataset1\\";\\n      ELSE\\n        SELECT COUNT(BIN({{x}},30)) AS n FROM \\"dataset1\\";\\n    END\\n  END\\nEND",
        "columns": ["mpg","hp","weight"]
      }

      DF.info()-style summary
      {
        "cellQL": "COL_REPEAT x IN ('mpg','hp','weight'):\\n  SELECT COUNT(NOT_NULL({{x}})) AS nnz, DTYPE({{x}}) AS dtype FROM \\"dataset1\\";\\nEND",
        "columns": ["mpg","hp","weight"]
      }

      ANTI-EXAMPLE (do NOT do this)
      - INVALID: COL_REPEAT x IN ('mpg'):  ...   // single item; violates [C1]
      - INVALID: COL_REPEAT x IN (df.columns)    // violates [C3]
      - INVALID: Faceting by 'decile' via COL_REPEAT on values // violates [C5]


      `;

      const contextBlock = datasetContext
        ? `DATASET: ${datasetName || 'dataset.csv'}\nCONTEXT: ${datasetContext}`
        : '';

      const user = `${contextBlock}\nIDEA: ${idea.statement}`;

      // Expect a single object: { cellQL: <CellQLLinearProgramSchema>, columns: string[] }
      const ResponseSchema = z.object({
        cellQL: z.string(),//CellQLLinearProgramSchema,
        columns: z.array(z.string()).default([])
      });

      try {
        const resp = await svc.chatStructured<{ cellQL: any; columns: string[] }>({ system, user, schema: ResponseSchema as unknown as any });
        // const { linearToRecursiveAst } = await import('../../cellql/linearToAst');
        // const { renderCellQL } = await import('../../cellql/renderCellQL');
        try {
        //   const recursive = linearToRecursiveAst(resp.cellQL);
          const rendered = resp.cellQL;//renderCellQL(recursive);
          console.info('[pipeline] ideaToCellQL(linear) ok, columns=%d', (resp.columns || []).length);
          // Use shortName from idea if available, otherwise generate fallback
          const generateFallbackShortName = (statement: string): string => {
            const words = statement.trim().split(/\s+/);
            if (words.length <= 10) {
              return statement;
            }
            return words.slice(0, 8).join(' ') + '...';
          };

          const finalShortName = idea.shortName || generateFallbackShortName(idea.statement);

          const variables_used = Array.from(new Set((resp.columns || []).map(c => String(c))));
          const semantic_hints_text = buildSemanticHints(variables_used, columnDefinitions);
          return [{
            statement: idea.statement,
            shortName: finalShortName,
            cellQL: rendered,
            variables_used,
            semantic_hints_text,
            explanation: idea.explanation || '',
            tags: idea.tags || [],
            columns: resp.columns || []
          }];
        } catch (e: any) {
          await appendCellQLFailure({
            phase: 'render_cellql',
            datasetName,
            datasetContext,
            idea,
            prompts: { system, user },
            error: { message: e?.message || String(e), stack: e?.stack }
          });
          return [];
        }
      } catch (e: any) {
        await appendCellQLFailure({
          phase: 'llm_call',
          datasetName,
          datasetContext,
          idea,
          prompts: { system, user },
          error: { message: e?.message || String(e), stack: e?.stack }
        });
        return [];
      }
    },
  };
}


