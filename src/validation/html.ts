import { parse } from 'parse5';
type HtmlNode = { nodeName: string; tagName?: string; value?: string; attrs?: {name:string;value:string}[]; childNodes?: HtmlNode[]; namespaceURI?: string };
export type ElementData = string | { tag: string; props: Record<string,string|boolean>; children: ElementData[] };
const voids = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
const aliases: Record<string,string> = { class:'className', for:'htmlFor', charset:'charSet', 'http-equiv':'httpEquiv', tabindex:'tabIndex', colspan:'colSpan', rowspan:'rowSpan', crossorigin:'crossOrigin', srcset:'srcSet' };
export function documentData(html: string) {
  const errors: string[] = [];
  const tree = parse(html,{onParseError:e=>errors.push(e.code)}) as unknown as HtmlNode;
  if (errors.some(e=>e !== 'missing-doctype')) throw new Error('HTML inválido: ' + errors.join(', '));
  const doc = tree.childNodes?.find(n=>n.tagName==='html');
  if (!doc) throw new Error('Documento HTML ausente.');
  function convert(n: HtmlNode): ElementData[] {
    if (n.nodeName==='#text') return [n.value || ''];
    if (!n.tagName) return [];
    if (n.namespaceURI && n.namespaceURI !== 'http://www.w3.org/1999/xhtml') throw new Error('SVG/MathML inline ainda não suportado.');
    if (['script','form','input','textarea','select','button','iframe','object','embed','base','template','noscript','style'].includes(n.tagName)) throw new Error('Elemento precisa de regra específica: ' + n.tagName);
    const props: Record<string,string|boolean> = {};
    for (const a of n.attrs || []) {
      if (/^on/i.test(a.name) || a.name==='style' || a.name==='srcdoc' || /^(javascript|vbscript):/i.test(a.value.trim())) throw new Error('Atributo não suportado: ' + a.name);
      props[aliases[a.name] || a.name] = ['hidden','disabled','checked','multiple','required','autofocus'].includes(a.name) ? true : a.value;
    }
    return [{tag:n.tagName,props,children:voids.has(n.tagName)?[]:(n.childNodes||[]).flatMap(convert)}];
  }
  return convert(doc)[0] as Exclude<ElementData,string>;
}
