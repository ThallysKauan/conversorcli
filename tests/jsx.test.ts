import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import path from 'node:path';
import {loadRules,writeNativePage,writeNativeSite} from '../src/targets/next/rules.ts';
import {jsxAttribute,jsxRaw,jsxText,tidyDocument,whitespaceRules} from '../src/targets/next/jsx.ts';
import {placeholderCode,placeholderToken} from '../src/conversion/php/placeholders.ts';
import type {LegacyNode} from '../src/validation/legacy.ts';

const el=(tag:string,children:(LegacyNode|string)[]=[],props:Record<string,any>={}):LegacyNode=>({tag,props,children});
const body=(children:(LegacyNode|string)[],css:string[]=[])=>(tidyDocument(el('html',[el('body',children)]),whitespaceRules(css)).children[0] as LegacyNode).children;

test('indentação entre blocos e nas bordas sai; espaço entre elementos em linha fica',()=>{
 assert.deepEqual(body(['\n\t',el('div'),'\n\t',el('div'),'\n']),[el('div'),el('div')]);
 assert.deepEqual(body([el('p',[el('a',['\n\t\tPRODUTOS\n\t']),'\n\t',el('a',['VENDAS']),'\n'])]),[el('p',[el('a',['PRODUTOS ']),' ',el('a',['VENDAS'])])]);
 assert.deepEqual(body([el('p',['Linha\n\t\tseguinte'])]),[el('p',['Linha seguinte'])]);
});

test('o CSS decide: inline-block mantém o espaço e white-space: pre mantém o texto',()=>{
 const items=()=>[el('li',['A'],{className:'item'}),'\n\t',el('li',['B'],{className:'item'})];
 assert.deepEqual(body([el('ul',items())]),[el('ul',[el('li',['A'],{className:'item'}),el('li',['B'],{className:'item'})])]);
 assert.deepEqual(body([el('ul',items())],['.menu .item{display:inline-block}']),[el('ul',[el('li',['A'],{className:'item'}),' ',el('li',['B'],{className:'item'})])]);
 const code=()=>[el('div',['\n  a\n  b\n'],{className:'code'})];
 assert.deepEqual(body(code(),['.code{white-space:pre-wrap}']),code());
 assert.deepEqual(body([el('pre',['\n  a\n'])]),[el('pre',['\n  a\n'])]);
});

test('texto e atributo simples ficam sem {"..."}; o que tem sintaxe especial continua como string',()=>{
 assert.equal(jsxText('PRODUTOS'),'PRODUTOS');assert.equal(jsxText('A\u00a0B'),'A&nbsp;B');assert.equal(jsxText('A < B {x}'),'{"A < B {x}"}');assert.equal(jsxText('&amp;'),'{"&amp;"}');assert.equal(jsxText('\n  a'),'{'+JSON.stringify('\n  a')+'}');assert.equal(jsxText('\uE0000\uE001'),'{"\uE0000\uE001"}');
 assert.equal(jsxAttribute('nav-link'),'"nav-link"');assert.equal(jsxAttribute('/a?x=1&y=2'),'"/a?x=1&y=2"');assert.equal(jsxAttribute('a"b'),'{'+JSON.stringify('a"b')+'}');assert.equal(jsxAttribute('&lt;'),'{"&lt;"}');assert.equal(jsxAttribute('a\\b'),'{'+JSON.stringify('a\\b')+'}');
});

test('página gerada não traz a indentação do HTML como texto',async()=>{
 const root=await mkdtemp(path.resolve('.work/jsx-'));const rules=await loadRules();
 const doc=el('html',[el('body',['\n\t',el('ul',['\n\t\t',el('li',['\n\t\t\t',el('a',['\n\t\t\t\tPRODUTOS\n\t\t\t'],{href:'/#catalogo',className:'nav-link'}),'\n\t\t']),'\n\t']),'\n'])]);
 await writeNativePage(root,'/',doc,doc,rules);
 const page=await readFile(path.join(root,'src/app/(paginas)/page.tsx'),'utf8');
 assert.match(page,/<a href="\/#catalogo" className="nav-link">\s*PRODUTOS\s*<\/a>/);assert.doesNotMatch(page,/\\n|\\t|\{"/);
});

test('classes com quebra de linha viram uma lista simples; CSS e JSON-LD saem em várias linhas',async()=>{
 const nl=String.fromCharCode(10),tab=String.fromCharCode(9),bs=String.fromCharCode(92);
 assert.equal(jsxAttribute('a'+nl+'b'),'{'+JSON.stringify('a'+nl+'b')+'}');
 assert.equal(jsxRaw(nl+tab+tab+'.a{color:red}'+nl+tab+tab+'.b{`x`}'+nl+tab),'`.a{color:red}'+nl+'.b{'+bs+'`x'+bs+'`}`');
 const token=placeholderToken('telefone');
 assert.equal(placeholderCode(jsxRaw('{"tel":"'+token+'"}')),'`{"tel":"${settings.variaveis["telefone"]}"}`');
 const root=await mkdtemp(path.resolve('.work/jsx-'));const rules=await loadRules();
 const doc=el('html',[el('head',[el('style',[nl+tab+'.rolado{color:red}'+nl])]),el('body',[el('div',['Texto'],{className:nl+tab+tab+'rolado'+nl+tab})])]);
 await writeNativePage(root,'/',doc,doc,rules);
 const page=await readFile(path.join(root,'src/app/(paginas)/page.tsx'),'utf8'),layout=await readFile(path.join(root,'src/app/layout.tsx'),'utf8');
 assert.match(page,/<div className="rolado">Texto<\/div>/);assert.match(layout,/__html: `\.rolado\{color:red\}`/);
});

test('seções que só mudam no título viram um componente com prop; imports não usados saem',async()=>{
 const root=await mkdtemp(path.resolve('.work/jsx-'));const rules=await loadRules();
 const cards=el('div',[el('p',['Produto '.repeat(1200)])],{className:'cards'});
 const page=(assunto:string)=>el('html',[el('body',[el('div',[el('h4',['Outros assuntos relacionados a '+assunto]),cards],{className:'produtos-relacionados'}),el('p',[assunto])])]);
 await writeNativeSite(root,[{route:'/a',desktop:page('Tampa para Bombona'),mobile:page('Tampa para Bombona'),status:200},{route:'/b',desktop:page('Tubete 13cm'),mobile:page('Tubete 13cm'),status:200}],rules);
 const home=await readFile(path.join(root,'src/app/(paginas)/a/page.tsx'),'utf8');
 assert.match(home,/<ProdutosRelacionados titulo="Tampa para Bombona" \/>/);assert.doesNotMatch(home,/import (Topo|Rodape|\{)/);
 const section=await readFile(path.join(root,'src/components/Secoes/ProdutosRelacionados.tsx'),'utf8');
 assert.match(section,/Outros assuntos relacionados a \{titulo\}/);assert.doesNotMatch(section,/import (Topo|Rodape|\{ settings)/);
});
