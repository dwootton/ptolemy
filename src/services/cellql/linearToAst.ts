import type { z } from 'zod';
import { CellQLLinearProgramSchema, LinearNode as LinearNodeSchema } from '../../schemas/cellql-linear-schema';
import { CellQLSchema } from '../../schemas/cellql-schema';

type LinearNode = z.infer<typeof LinearNodeSchema>;
type LinearProgram = z.infer<typeof CellQLLinearProgramSchema>;

export function linearToRecursiveAst(linear: LinearProgram): z.infer<typeof CellQLSchema> {
  const byId = new Map<number, LinearNode>(linear.nodes.map((n) => [n.id, n]));

  const build = (id: number): any => {
    const n = byId.get(id);
    if (!n) throw new Error(`Missing node id=${id}`);
    switch (n.kind) {
      case 'sql':
        return { kind: 'sql', text: n.text, expects: n.expects ?? undefined };
      case 'repeat': {
        // Normalize nullable table field in column refs if present
        const over = ((): any => {
          if ((n as any).over?.kind === 'list') {
            const items = (n as any).over.items?.map((it: any) => {
              if (it && typeof it === 'object' && 'name' in it) {
                return { ...it, table: it.table ?? undefined };
              }
              return it;
            }) || [];
            return { ...((n as any).over), items };
          }
          if ((n as any).over?.kind === 'quantize') {
            const q = (n as any).over;
            return { ...q, column: { ...q.column, table: q.column.table ?? undefined } };
          }
          return (n as any).over;
        })();
        return { kind: 'repeat', symbol: (n as any).symbol, over, body: build((n as any).body) };
      }
      case 'branch':
        return {
          kind: 'branch',
          cases: n.cases.map((c) => ({ when: c.when ?? undefined, body: build(c.body) }))
        };
      case 'concat':
        return {
          kind: 'concat',
          children: n.children.map((cid) => build(cid))
        };
      default:
        throw new Error(`Unknown node kind ${(n as any).kind}`);
    }
  };

  const ast = { version: linear.version, root: build(linear.root) } as any;
  // Validate using recursive schema to ensure integrity
  const parsed = CellQLSchema.safeParse(ast);
  if (!parsed.success) {
    throw new Error(`Recursive AST validation failed: ${parsed.error.message}`);
  }
  return parsed.data;
}


