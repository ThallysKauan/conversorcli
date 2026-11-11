import { resolveInclude } from './resolve.ts';
import Engine from 'php-parser';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

type Node = { kind: string; [key: string]: any };
export async function renderPhp(rootInput: string, entry: string) {
  const root = await realpath(rootInput);
  const variables = new Map<string, string>();
  const active = new Set<string>();
  const included = new Set<string>();
  const dependencies = new Set<string>();
  let bytes = 0;
  const parser = new Engine.Engine({ parser: { suppressErrors: false }, lexer: { short_tags: true }, ast: { withPositions: true } });
  function value(n: Node, file: string): string {
    if (n.kind === 'string') return String(n.value);
    if (n.kind === 'number' && /^(0|[1-9][0-9]*)$/.test(n.value) && Number.isSafeInteger(Number(n.value))) return String(n.value);
    if (n.kind === 'variable' && typeof n.name === 'string' && variables.has(n.name)) return variables.get(n.name)!;
    if (n.kind === 'bin' && n.type === '.') return value(n.left,file) + value(n.right,file);
    if (n.kind === 'magic' && n.value === '__DIR__') return path.dirname(file);
    throw new Error('Expressão PHP não suportada: ' + n.kind);
  }
  async function file(input: string, once = false): Promise<string> {
    const resolved = await realpath(input);
    const relative = path.relative(root,resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Include fora da origem bloqueado.');
    if (!/\.php$/i.test(resolved)) throw new Error('Include precisa ser PHP.');
    if (once && included.has(resolved)) return '';
    if (active.has(resolved) || active.size >= 32) throw new Error('Ciclo ou profundidade excessiva de includes.');
    active.add(resolved); included.add(resolved); dependencies.add(relative);
    const source = await readFile(resolved,'utf8');
    bytes += Buffer.byteLength(source);
    if (bytes > 2_000_000) throw new Error('Limite de análise excedido.');
    const ast = parser.parseCode(source,resolved) as unknown as Node;
    let html = '';
    for (const node of ast.children) {
      if (node.kind === 'inline') html += node.value;
      else if (node.kind === 'echo') html += node.expressions.map((n: Node) => value(n,resolved)).join('');
      else if (node.kind === 'expressionstatement') {
        const expr = node.expression;
        if (expr.kind === 'assign' && expr.operator === '=' && expr.left.kind === 'variable' && typeof expr.left.name === 'string') variables.set(expr.left.name,value(expr.right,resolved));
        else if (expr.kind === 'include') html += await file(await resolveInclude(root,resolved,value(expr.target,resolved)),expr.once);
        else throw new Error('Instrução PHP não suportada: ' + expr.kind + ' em ' + relative + ':' + (expr.loc?.start.line ?? '?') + (expr.kind === 'call' ? ' (' + (expr.what?.name ?? 'função') + ')' : ''));
      } else throw new Error('Instrução PHP não suportada: ' + node.kind);
    }
    active.delete(resolved);
    return html;
  }
  return { html: await file(path.resolve(root,entry)), dependencies: [...dependencies] };
}



