import postcss from 'postcss';
import type {LegacyNode} from '../../validation/legacy.ts';
// Deixa o JSX gerado legível: a indentação do HTML da origem não vira texto e strings simples dispensam {"..."}.
// O navegador colapsa espaços em branco, então só sai o que não aparece na tela; o espaço visível entre elementos em linha fica.
export interface WhitespaceRules {inline:Set<string>;preserve:Set<string>}

const blockTags=new Set('address article aside blockquote body caption center colgroup contact-form datalist dd details dialog dir div dl dt fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html legend li main menu nav ol optgroup option p search section select summary table tbody td tfoot th thead tr ul circle clipPath defs ellipse filter g image line linearGradient marker mask path pattern polygon polyline radialGradient rect stop svg symbol use'.split(' '));
const preservedTags=new Set(['pre','textarea','listing','xmp','plaintext','script','style']);
const hiddenTags=new Set(['script','style','link','meta','template']);
// Caracteres invisíveis e marcadores de variável só podem existir dentro de uma string JavaScript.
const needsExpression=/[{}<>\x00-\x08\x0b-\x1f\x7f-\x9f\u00ad\u200b-\u200f\u2028\u2029\ufeff\ue000-\uf8ff]|&[#\w]+;/;
const compound=(selector:string)=>{
 const last=selector.trim().split(/[\s>+~]+/).pop()||'';
 return last.match(/\.[\w-]+/)?.[0]||last.match(/#[\w-]+/)?.[0]||last.match(/^[a-zA-Z][\w-]*/)?.[0];
};
/** Lê do CSS quais seletores deixam elementos em linha (o espaço entre eles aparece) ou preservam espaços (white-space: pre). */
export function whitespaceRules(stylesheets:string[]):WhitespaceRules{
 const rules:WhitespaceRules={inline:new Set(),preserve:new Set()};
 for(const css of stylesheets){
  try{postcss.parse(css).walkRules(rule=>{
   const inline=rule.nodes.some(n=>n.type==='decl'&&n.prop==='display'&&/^(inline|contents)/i.test(n.value));
   const preserves=rule.nodes.some(n=>n.type==='decl'&&n.prop==='white-space'&&/^(pre|break-spaces)/i.test(n.value));
   for(const selector of rule.selectors){const token=compound(selector);if(!token)continue;if(inline)rules.inline.add(token);if(preserves)rules.preserve.add(token);}
  });}catch{}
 }
 return rules;
}
const matches=(node:LegacyNode,tokens:Set<string>)=>tokens.has(node.tag)||(node.props.id&&tokens.has('#'+node.props.id))||String(node.props.className||'').split(/\s+/).some(name=>name&&tokens.has('.'+name));
const domTag=(node:LegacyNode)=>node.tag.startsWith('react:')?String(node.props.as||''):node.tag;
const isPreserved=(node:LegacyNode,rules:WhitespaceRules)=>preservedTags.has(domTag(node))||/^(pre|break-spaces)/i.test(String(node.props.style?.whiteSpace||''))||matches(node,rules.preserve);
// Classe "inline" costuma vir de CSS externo (CDN), que não é lido aqui.
const isInline=(node:LegacyNode,rules:WhitespaceRules)=>/^(inline|contents)/i.test(String(node.props.style?.display||''))||/(^|[\s-])inline([\s-]|$)/.test(String(node.props.className||''))||matches(node,rules.inline);
const isBlock=(node:LegacyNode,rules:WhitespaceRules)=>blockTags.has(domTag(node))&&!isInline(node,rules);
const isHidden=(node:LegacyNode|string)=>typeof node!=='string'&&hiddenTags.has(node.tag);
const breaksLine=(node:LegacyNode|string,rules:WhitespaceRules)=>typeof node!=='string'&&(node.tag==='br'||isBlock(node,rules));
function tidy(node:LegacyNode,rules:WhitespaceRules,start:boolean,end:boolean):LegacyNode{
 if(isPreserved(node,rules))return node;
 // Bloco e botão começam e terminam a própria linha; elemento em linha herda as bordas de quem o contém.
 if(isBlock(node,rules)||node.tag==='button')start=end=true;
 const merged:(LegacyNode|string)[]=[];
 for(const item of node.children){const last=merged.length-1;if(typeof item==='string'&&typeof merged[last]==='string')merged[last]+=item;else merged.push(item);}
 const kept:(LegacyNode|string)[]=[];
 merged.forEach((item,index)=>{
  if(typeof item!=='string'){kept.push(item);return;}
  let text=item.replace(/[ \t\r\n\f]+/g,' ');
  let before=kept.length-1;while(before>=0&&isHidden(kept[before]))before--;
  if(before<0?start:breaksLine(kept[before],rules))text=text.replace(/^ /,'');
  let after=index+1;while(after<merged.length&&(isHidden(merged[after])||typeof merged[after]==='string'&&!String(merged[after]).trim()))after++;
  if(after>=merged.length?end:breaksLine(merged[after],rules))text=text.replace(/ $/,'');
  if(text)kept.push(text);
 });
 const children=kept.map((item,index)=>typeof item==='string'?item:tidy(item,rules,index===0?start:breaksLine(kept[index-1],rules),index===kept.length-1?end:breaksLine(kept[index+1],rules)));
 return {...node,children};
}
/** Remove do body os espaços que o navegador não exibe e reduz os demais a um único espaço. */
export function tidyDocument(doc:LegacyNode,rules:WhitespaceRules):LegacyNode{
 return {...doc,children:doc.children.map(item=>typeof item!=='string'&&item.tag==='body'?tidy(item,rules,true,true):item)};
}
/** Texto simples entra direto no JSX; o que tem significado especial na sintaxe continua como string. */
export function jsxText(text:string){
 if(needsExpression.test(text)||/[\t\r\n\f]| {2}/.test(text))return '{'+JSON.stringify(text)+'}';
 return text.replace(/\u00a0/g,'&nbsp;');
}
/** Atributo de texto simples usa aspas, como no HTML: className="menu". Entre aspas o JSX não interpreta \n, então quebras de linha ficam numa string. */
export function jsxAttribute(value:string){
 if(needsExpression.test(value)||/["\\\t\n\r\f]/.test(value))return '{'+JSON.stringify(value)+'}';
 return JSON.stringify(value);
}
/** CSS e JSON-LD em várias linhas (template string), sem a indentação comum da origem. */
export function jsxRaw(text:string){
 const lines=text.replace(/\r\n?/g,'\n').replace(/^\s*\n|\s+$/g,'').split('\n');
 const indent=Math.min(...lines.filter(l=>l.trim()).map(l=>l.match(/^[ \t]*/)![0].length));
 const body=lines.map(l=>l.slice(Math.min(indent,l.match(/^[ \t]*/)![0].length))).join('\n');
 // Marcadores de variável continuam numa string "..." dentro de ${}: placeholderCode os troca por settings.variaveis.
 return '`'+body.replace(/\\/g,'\\\\').replace(/`/g,'\\`').replace(/\$\{/g,'\\${').replace(/\d+|\d+/g,m=>'${"'+m+'"}')+'`';
}
