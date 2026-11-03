import type { z } from 'zod';
import { CellQLSchema, ColumnRef as ColumnRefSchema } from '../../schemas/cellql-schema';

type CellQLAst = z.infer<typeof CellQLSchema>;
type ColumnRef = z.infer<typeof ColumnRefSchema>;

function renderColumnRef(col: ColumnRef): string {
  return col.table ? `${col.table}.${col.name}` : `${col.name}`;
}

function indent(text: string, by: number = 2): string {
  const pad = ' '.repeat(by);
  return text
    .split('\n')
    .map((l) => (l.length ? pad + l : l))
    .join('\n');
}

function isColumnRef(obj: any): obj is ColumnRef {
  return obj && typeof obj === 'object' && 'name' in obj && typeof obj.name === 'string';
}

function renderNode(node: any): string {
  switch (node?.kind) {
    case 'sql': {
      return node.text;
    }
    case 'repeat': {
      const symbol = node.symbol;
      const over = node.over;
      let overText = '';
      if (over.kind === 'list') {
        const items = (over.items || []).map((it: any) => {
          if (isColumnRef(it)) return renderColumnRef(it);
          if (typeof it === 'string') return `'${it}'`;
          return String(it);
        });
        overText = `(${items.join(', ')})`;
      } else if (over.kind === 'quantize') {
        const qcol = renderColumnRef(over.column);
        if (over.spec?.type === 'DECILES') {
          overText = `QUANTIZE('${over.table}.${qcol}', DECILES=>${over.spec.k})`;
        } else if (over.spec?.type === 'EQUAL_WIDTH') {
          overText = `QUANTIZE('${over.table}.${qcol}', BINS=>${over.spec.bins})`;
        } else {
          overText = `QUANTIZE('${over.table}.${qcol}', SPEC)`;
        }
      }
      const body = renderNode(node.body);
      return `REPEAT ${symbol} IN ${overText}:
${indent(body)}
END`;
    }
    case 'branch': {
      const parts = (node.cases || []).map((c: any) => {
        let cond = '';
        if (c.when) {
          if (c.when.kind === 'eqSymbols') {
            cond = `${c.when.left.symbol} = ${c.when.right.symbol}`;
          } else if (c.when.kind === 'neqSymbols') {
            cond = `${c.when.left.symbol} != ${c.when.right.symbol}`;
          } else if (c.when.kind === 'typeIs') {
            cond = `TYPE(${c.when.symbol}) == ${c.when.dtype}`;
          } else {
            cond = 'COND';
          }
          return `WHEN ${cond}:
${indent(renderNode(c.body))}`;
        }
        return `ELSE:
${indent(renderNode(c.body))}`;
      });
      return `BRANCH
${indent(parts.join('\n'))}
END`;
    }
    case 'concat': {
      const children: string[] = (node.children || []).map((n: any) => renderNode(n));
      const args = children
        .map((c) => `(
${indent(c)}
)`)
        .join(', ');
      return `CONCAT(${args})`;
    }
    default:
      return `-- UNKNOWN NODE`;
  }
}

export function renderCellQL(ast: CellQLAst): string {
  if (!ast || ast.version !== 'lite-1.0') {
    return '-- Invalid AST';
  }
  return renderNode(ast.root);
}


