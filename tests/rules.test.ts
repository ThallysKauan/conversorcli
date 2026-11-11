import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {loadRules,writeNativePage} from '../src/targets/next/rules.ts';
import {convertSite} from '../src/targets/next/site.ts';

test('PHP produces editable native TSX routes and no PHP runtime dependency',async()=>{
 await mkdir('.work',{recursive:true});const root=await mkdtemp(path.resolve('.work/native-'));const source=path.join(root,'source');await mkdir(source);
 await writeFile(path.join(source,'index.php'),'<!doctype html><html><head><title>Example</title></head><body><header>Brand</header><?php $title="Converted"; ?><h1><?= $title ?></h1><footer>Contact</footer></body></html>');
 await writeFile(path.join(source,'sitemap.xml'),'<urlset><url><loc>https://example.com/</loc></url></urlset>');
 const report=await convertSite(source,path.join(root,'out'));
 assert.equal(report.summary.generated,1);
 const page=await readFile(path.join(root,'out/project/src/app/(paginas)/page.tsx'),'utf8');
 assert.match(page,/<h1[^>]*>Converted<\/h1>/);assert.match(page,/<Topo/);assert.match(page,/<Rodape/);assert.doesNotMatch(page,/loadDocument|<\?php|body.children/);
 assert.equal(report.rules.applied.pages,'src/app/(paginas)');
});

test('native writer honors custom page and partial mappings, including nested headers',async()=>{
 const root=await mkdtemp(path.resolve('.work/mappings-'));const rules=await loadRules();rules.mappings.pages='src/app/(custom)';rules.mappings.header='src/partials/Brand.tsx';rules.mappings.footer='src/partials/Bottom.tsx';
 const doc={tag:'html',props:{},children:[{tag:'body',props:{},children:[{tag:'div',props:{},children:[{tag:'header',props:{className:'brand'},children:['A < B {literal}']}]}]}]};
 await writeNativePage(root,'/about',doc,doc,rules);
 const page=await readFile(path.join(root,'src/app/(custom)/about/page.tsx'),'utf8');assert.match(page,/@\/partials\/Brand/);assert.match(page,/<div[^>]*>\s*<Topo/);assert.match(page,/\{"A < B \{literal\}"\}/);
 assert.match(await readFile(path.join(root,'src/partials/Bottom.tsx'),'utf8'),/<footer/);
});

test('large repeated sections become shared TSX components',async()=>{
 const root=await mkdtemp(path.resolve('.work/shared-'));const rules=await loadRules();
 const doc={tag:'html',props:{},children:[{tag:'body',props:{},children:[{tag:'section',props:{},children:['Repeated '.repeat(1500)]}]}]};
 await writeNativePage(root,'/a',doc,doc,rules);await writeNativePage(root,'/b',doc,doc,rules);
 const a=await readFile(path.join(root,'src/app/(paginas)/a/page.tsx'),'utf8'),b=await readFile(path.join(root,'src/app/(paginas)/b/page.tsx'),'utf8');assert.equal(a.replace('// Rota: /a','// Rota: /b').replace('function APage','function BPage'),b);assert.ok(a.length<2000);
 assert.match(a,/import ASecao from "@\/components\/Secoes\/ASecao"/);assert.match(await readFile(path.join(root,'src/components/Secoes/ASecao.tsx'),'utf8'),/Repeated/);assert.doesNotMatch(a,/ppnet|Block[a-f0-9]/);
});

test('seções recebem nome pela classe e variantes diferentes não colidem',async()=>{
 const root=await mkdtemp(path.resolve('.work/sections-'));const rules=await loadRules();
 const page=(text:string)=>({tag:'html',props:{},children:[{tag:'body',props:{},children:[{tag:'div',props:{className:'produtos-destaque grid'},children:[text.repeat(1500)]}]}]});
 await writeNativePage(root,'/',page('Desktop '),page('Mobile '),rules);
 const home=await readFile(path.join(root,'src/app/(paginas)/page.tsx'),'utf8');
 // Mesma estrutura, só o texto muda: um componente com o texto como prop.
 assert.match(home,/<ProdutosDestaque texto="Mobile Mobile/);assert.match(home,/<ProdutosDestaque texto="Desktop Desktop/);
 assert.match(await readFile(path.join(root,'src/components/Secoes/ProdutosDestaque.tsx'),'utf8'),/function ProdutosDestaque\(\{ texto \}: \{ texto: string \}\)[\s\S]*\{texto\}/);
});
