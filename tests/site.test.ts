import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile,access} from 'node:fs/promises';
import path from 'node:path';
import {discover} from '../src/analysis/discovery.ts';
import {convertSite} from '../src/targets/next/site.ts';
test('site: converte páginas independentes, preserva rotas e continua após falha',async()=>{
 await mkdir('.work',{recursive:true});const dir=await mkdtemp(path.resolve('.work/site-test-'));const source=path.join(dir,'source');await mkdir(source);
 await writeFile(path.join(source,'index.php'),'<!doctype html><html><head><title>Home</title></head><body><h1>Home</h1></body></html>');
 await writeFile(path.join(source,'sobre.php'),'<?php $title="Sobre"; ?><!doctype html><html><head><title><?= $title ?></title></head><body><h1><?= $title ?></h1></body></html>');
 await writeFile(path.join(source,'contato.php'),'<?php unknown_function(); ?>');
 await writeFile(path.join(source,'fragment.php'),'<footer>Rodapé</footer>');
 const output=path.join(dir,'result');const report=await convertSite(source,output);
 assert.deepEqual(report.summary,{converted:0,partial:2,generated:2,unfinished:1,fragments:1});assert.equal(report.status,'incomplete');
 assert.deepEqual(report.parts.filter(p=>p.status==='converted'||p.status==='partial').map(p=>p.route),['/','/sobre']);
 await access(path.join(output,'inacabados/contato.php(inacabado).txt'));
 // Projeto só em Next: sem JSON renderizado, middleware, rota genérica ou referência a .php.
 for(const file of ['src/data/pages','src/lib/siteDocument.ts','src/lib/render.ts','src/middleware.ts','src/app/(paginas)/[...slug]/page.tsx'])await assert.rejects(access(path.join(output,'project',file)));
 const sobre=await readFile(path.join(output,'project/src/app/(paginas)/sobre/page.tsx'),'utf8');assert.match(sobre,/export const metadata:\s*Metadata\s*=\s*\{\s*title:\s*"Sobre"\s*\}/);
 assert.doesNotMatch(await readFile(path.join(output,'project/next.config.ts'),'utf8'),/php/);
 await access(path.join(output,'reference/page-0001.desktop.json'));await access(path.join(output,'reference/page-0004.desktop.json'));
 assert.equal(await readFile(path.join(source,'contato.php'),'utf8'),'<?php unknown_function(); ?>');
 await assert.rejects(convertSite(source,output),/já existe/);
 await assert.rejects(convertSite(source,path.join(source,'result')),/fora da pasta/);
});

test('descoberta separa auxiliares e encontra includes ausentes mesmo depois de session_start',async()=>{
 await mkdir('.work',{recursive:true});const source=await mkdtemp(path.resolve('.work/discovery-'));
 await mkdir(path.join(source,'inc-midia'));await mkdir(path.join(source,'libraries'));
 await writeFile(path.join(source,'index.php'),'<?php session_start(); include "inc-midia/contact.php";');
 await writeFile(path.join(source,'inc-midia/contact.php'),'<?php require __DIR__ . "/missing.php";');
 await writeFile(path.join(source,'libraries/example.php'),'<?php class Test {}');
 const result=await discover(source,['index.php','inc-midia/contact.php','libraries/example.php']);
 assert.deepEqual(result.entries,['index.php']);assert.equal(result.auxiliary.length,2);
 assert.equal(result.dependencyIssues.length,1);assert.deepEqual(result.dependencyIssues[0].affectedPages,['index.php']);
 assert.match(result.dependencyIssues[0].reason,/missing.php/);
});
test('contact form keeps original markup and uses template backend',async()=>{
 await mkdir('.work',{recursive:true});const root=await mkdtemp(path.resolve('.work/omit-'));const source=path.join(root,'source');await mkdir(source);await mkdir(path.join(source,'inc-midia'));
 await writeFile(path.join(source,'index.php'),'<!doctype html><html><body><h1>Home</h1><form><?php include "inc-midia/contato-envio.php"; ?><input name="email_form" /><input name="nome" /><input name="telefone_form" /><textarea name="mensagem"></textarea></form></body></html>');
 await writeFile(path.join(source,'inc-midia/contato-envio.php'),'<?php require "missing-form.php";');
 const report=await convertSite(source,path.join(root,'out'));assert.equal(report.summary.generated,1);assert.equal(report.dependencyIssues.length,0);
 await assert.rejects(access(path.join(root,'out/project/src/middleware.ts')));
 const page=await readFile(path.join(root,'out/project/src/app/(paginas)/page.tsx'),'utf8');assert.match(page,/<ContactForm[^>]*>[\s\S]*name="email_form"[\s\S]*<\/ContactForm>/);assert.doesNotMatch(page,/<form|action=|data-ppnet/);await access(path.join(root,'out/project/src/app/api/send-email/route.ts'));await access(path.join(root,'out/project/.env.example'));
 assert.deepEqual((report as any).legacyRedirects,[]);
});
test('configuration viewer separated from public pages',async()=>{
 await mkdir('.work',{recursive:true});const source=await mkdtemp(path.resolve('.work/classification-'));
 await writeFile(path.join(source,'viewer.php'),'<?php echo file_get_contents(".htaccess");');
 await writeFile(path.join(source,'index.php'),'<html><body>Public</body></html>');
 const result=await discover(source,['viewer.php','index.php']);assert.deepEqual(result.entries,['index.php']);assert.equal(result.excludedSources.length,1);
});

test('dataString excludes only listed keyword pages and their paginas copies',async()=>{
 await mkdir('.work',{recursive:true});const source=await mkdtemp(path.resolve('.work/keywords-'));await mkdir(path.join(source,'inc-midia'));await mkdir(path.join(source,'paginas'));
 await writeFile(path.join(source,'inc-midia/configuracoes-gerais.php'),`<?php $dataString='{"keyword.php":"Keyword"}';`);
 for(const file of ['index.php','contato.php','keyword.php','paginas/keyword.php','paginas/other.php'])await writeFile(path.join(source,file),'<html><body>Page</body></html>');
 const result=await discover(source,['inc-midia/configuracoes-gerais.php','index.php','contato.php','keyword.php','paginas/keyword.php','paginas/other.php'],[],'inc-midia/configuracoes-gerais.php');
 assert.deepEqual(result.entries,['index.php','contato.php','paginas/other.php']);assert.equal(result.excludedSources.length,2);
});

test('links .php viram rotas Next, 404 vai para not-found e head vira metadata/layout',async()=>{
 await mkdir('.work',{recursive:true});const root=await mkdtemp(path.resolve('.work/links-'));const source=path.join(root,'source');await mkdir(source);
 await writeFile(path.join(source,'sitemap.xml'),'<urlset><url><loc>https://www.exemplo.com.br/</loc></url></urlset>');
 const head=(title:string,canonical:string)=>`<head><meta charset="UTF-8"><title>${title}</title><meta name="description" content="Desc ${title}"><meta property="og:url" content="${canonical}"><link rel="canonical" href="${canonical}"><link rel="stylesheet" href="/css/site.css"><script type="application/ld+json">{"url":"${canonical}"}</script></head>`;
 await writeFile(path.join(source,'index.php'),'<!doctype html><html lang="pt-BR">'+head('Home','https://www.exemplo.com.br/index.php')+'<body><a href="sobre.php#time">Sobre</a><a href="https://exemplo.com.br/sobre.php?x=1">Abs</a><a href="https://outro.com/a.php">Fora</a><a href="nao-existe.php">Quebrado</a><a href="http://validator.w3.org/check?uri=https://www.exemplo.com.br/sobre.php">W3C</a></body></html>');
 await writeFile(path.join(source,'sobre.php'),'<!doctype html><html lang="pt-BR">'+head('Sobre','https://www.exemplo.com.br/sobre.php')+'<body><a href="/index.php">Início</a></body></html>');
 await writeFile(path.join(source,'erro-404.php'),'<?php http_response_code(404); ?><!doctype html><html lang="pt-BR">'+head('Não encontrada','https://www.exemplo.com.br/erro-404.php')+'<body><h1>404</h1></body></html>');
 await writeFile(path.join(source,'backend.php'),'<!doctype html><html lang="pt-BR">'+head('B','https://www.exemplo.com.br/backend.php')+'<body><a href="inc-midia/enviar.php">x</a><a href="nao-existe.php">y</a></body></html>');
 await mkdir(path.join(source,'inc-midia'));await writeFile(path.join(source,'inc-midia/enviar.php'),'<?php mail("a","b","c");');
 const report=await convertSite(source,path.join(root,'out'));const project=path.join(root,'out/project');
 const home=await readFile(path.join(project,'src/app/(paginas)/page.tsx'),'utf8');
 assert.match(home,/href="\/sobre#time"/);assert.match(home,/href="\/nao-existe"/);assert.match(home,/href="\/sobre\?x=1"/);assert.match(home,/href="https:\/\/outro\.com\/a\.php"/);
 assert.match(home,/canonical:\s*"https:\/\/www\.exemplo\.com\.br\/"/);assert.doesNotMatch(home.replace('https://outro.com/a.php',''),/\.php/);
 const layout=await readFile(path.join(project,'src/app/layout.tsx'),'utf8');assert.match(layout,/rel="stylesheet"\s+href="\/css\/site.css"/);assert.match(layout,/metadataBase/);
 assert.match(await readFile(path.join(project,'src/app/(paginas)/erro-404/page.tsx'),'utf8'),/title:\s*"Não encontrada"/);assert.match(await readFile(path.join(project,'src/app/not-found.tsx'),'utf8'),/from "\.\/\(paginas\)\/erro-404\/page"/);assert.match(await readFile(path.join(project,'src/middleware.ts'),'utf8'),/status:\s*404[\s\S]*\["\/erro-404"\]/);
 const backend=report.parts.find(p=>p.source==='backend.php')!;assert.equal(backend.status,'unfinished');assert.match(backend.reason!,/enviar\.php/);
 assert.equal(report.parts.find(p=>p.source==='erro-404.php')!.httpStatus,404);
});
test('variáveis PHP sem valor não deixam a página parcial e ficam em settings.variaveis',async()=>{
 await mkdir('.work',{recursive:true});const root=await mkdtemp(path.resolve('.work/variables-'));const source=path.join(root,'source');await mkdir(path.join(source,'inc-midia'),{recursive:true});
 await writeFile(path.join(source,'inc-midia/configuracoes-gerais.php'),`<?php $nomeSite='Loja Teste'; $ddd='11'; $telefoneFestas='4142-4488'; $smtpSenha='x'; $nomePagina=basename($_SERVER['PHP_SELF']);`);
 for(const [file,title] of [['index.php','Home'],['sobre.php','Sobre']])await writeFile(path.join(source,file),`<?php include 'inc-midia/configuracoes-gerais.php'; ?><!doctype html><html><head><title>${title}</title></head><body><header class="<?php if ($navativa == false): ?>rolado<?php endif; ?>"></header><h1>${title}</h1><a href="tel:<?= $ddd . $telefone ?>">(<?= $ddd ?>) <?= $telefone ?></a><p><?= $telefoneFestas ?></p></body></html>`);
 const report:any=await convertSite(source,path.join(root,'out'));
 assert.equal(report.summary.generated,2);for(const part of report.parts)assert.doesNotMatch(JSON.stringify(part.notices||[]),/Variável sem valor/);
 assert.deepEqual(report.phpVariables.placeholder,['telefone']);
 const settings=await readFile(path.join(root,'out/project/src/settings/settings.ts'),'utf8');
 assert.match(settings,/const preencher = "ppnet";/);assert.match(settings,/telefone: preencher/);assert.match(settings,/telefoneFestas: "4142-4488"/);
 assert.doesNotMatch(settings,/smtpSenha|nomePagina/);
 const page=await readFile(path.join(root,'out/project/src/app/(paginas)/page.tsx'),'utf8');
 assert.match(page,/settings\.variaveis\["telefone"\]/);assert.match(page,/settings\.variaveis\["telefoneFestas"\]/);assert.match(page,/"rolado"/);assert.doesNotMatch(page,/ppnet|\uE000/);
 const reference=await readFile(path.join(root,'out/reference/page-0001.desktop.json'),'utf8');assert.match(reference,/"href":"tel:11"/);assert.match(reference,/\(11\) ppnet/);
});
test('JS sem regra roda como na origem; date() na requisição; JSON-LD reparado; avisos fiéis viram decisões',async()=>{
 await mkdir('.work',{recursive:true});const root=await mkdtemp(path.resolve('.work/original-'));const source=path.join(root,'source');await mkdir(path.join(source,'js'),{recursive:true});
 await writeFile(path.join(source,'js/cena.js'),"window.irPara=function(){location.href='contato.php';};");
 await writeFile(path.join(source,'contato.php'),'<!doctype html><html><head><title>Contato</title></head><body><h1>Contato</h1></body></html>');
 await writeFile(path.join(source,'index.php'),`<!doctype html><html><head><title>Home</title><script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js"}}</script></head><body><h1>Home</h1><canvas id="c"></canvas><button onclick="girar(this)">Girar</button><a href="javascript:abrir('x')">Abrir</a>
<script type="module">import * as THREE from 'three'; const r=new THREE.WebGLRenderer({canvas:document.getElementById('c')}); window.girar=()=>r.render(new THREE.Scene(),new THREE.PerspectiveCamera());</script>
<script src="js/cena.js"></script><script>document.addEventListener('DOMContentLoaded',()=>{document.body.classList.add('pronto')});function abrir(x){console.log(x)}</script>
<script type="application/ld+json">{"name":"Linha 1
linha 2","url":"https://x.com",}</script><footer>© <?= date('Y') ?> <?php echo file_get_contents('css/nao-existe.css'); ?></footer></body></html>`);
 await writeFile(path.join(source,'malicioso.php'),'<!doctype html><html><head><title>M</title></head><body><h1>M</h1><script>eval(atob("YWxlcnQoMSk="))</script></body></html>');
 await writeFile(path.join(source,'velho.php'),`<!doctype html><html><head><title>Velho</title></head><body><h1>Velho</h1><script>document.write('<p>x</p>')</script></body></html>`);
 const report:any=await convertSite(source,path.join(root,'out'));
 const home=report.parts.find((p:any)=>p.source==='index.php');assert.deepEqual(home.notices.map((n:any)=>n.message),['Domínio não identificado (sem sitemap, canonical ou email da empresa): informe com --url https://www.dominio.com.br ou ajuste NEXT_PUBLIC_SITE_URL no .env.']);
 assert.match(home.behaviors.decisions.join('\n'),/executado como na origem/);assert.match(home.behaviors.decisions.join('\n'),/Include ausente/);
 assert.notEqual(report.parts.find((p:any)=>p.source==='velho.php').status,'unfinished');assert.equal(report.parts.find((p:any)=>p.source==='malicioso.php').status,'unfinished');
 const page=await readFile(path.join(root,'out/project/src/app/(paginas)/page.tsx'),'utf8');
 assert.match(page,/<OriginalScripts/);assert.match(page,/type: "importmap"/);assert.match(page,/type: "module"/);assert.match(page,/data-evento-onclick="girar\(this\)"/);
 assert.match(page,/data-evento-onclick="abrir\('x'\);return false"/);assert.doesNotMatch(page,/javascript:|<script(?![^>]*ld\+json)/);
 assert.match(page,/String\(phpDate\("Y"\)\)/);assert.match(page,/import \{ phpDate \} from "@\/settings\/date"/);assert.match(page,/Linha 1\\nlinha 2/);
 const published=page.match(/src: "(\/scripts\/[^"]+)"/)![1];assert.match(await readFile(path.join(root,'out/project/public',published),'utf8'),/location\.href='\/contato'/);
 assert.match(await readFile(path.join(root,'out/project/src/app/layout.tsx'),'utf8'),/revalidate/);
 await access(path.join(root,'out/project/src/settings/date.ts'));
});
test('domínio pelo email da configuração, exclusão de cópias/páginas salvas e formulário POST genérico',async()=>{
 await mkdir('.work',{recursive:true});const root=await mkdtemp(path.resolve('.work/generic-'));const source=path.join(root,'source');await mkdir(path.join(source,'inc-midia'),{recursive:true});await mkdir(path.join(source,'assets/pagina_files'),{recursive:true});
 await writeFile(path.join(source,'inc-midia/configuracoes-gerais.php'),`<?php $email='contato@empresa-teste.com.br'; $email2='fulano@gmail.com';`);
 await writeFile(path.join(source,'.htaccess'),'RewriteCond %{HTTP_HOST} !^www\. [NC]\nRewriteRule ^(.*)$ https://www.%{HTTP_HOST}%{REQUEST_URI} [R=301,L]');
 await writeFile(path.join(source,'index.php'),`<?php include 'inc-midia/configuracoes-gerais.php'; ?><!doctype html><html><head><title>Home</title></head><body><h1>Home</h1><form method="post" class="depo"><input name="nome"><textarea name="depoimento"></textarea><input type="file" name="foto"><button name="submit">Enviar</button></form><form action="https://api.whatsapp.com/send"><input name="text"></form><form method="post"><input name="usuario"><input type="password" name="senha"></form></body></html>`);
 await writeFile(path.join(source,'index copy.php'),'<html><body>copia</body></html>');
 await writeFile(path.join(source,'assets/pagina_files/salva.html'),'<html><body>salva</body></html>');
 await writeFile(path.join(source,'antigo.php'),`<?php header('Location: index.php'); exit;`);
 const report:any=await convertSite(source,path.join(root,'out'));
 assert.equal(report.siteUrlSource,'email do arquivo de configurações');
 assert.match(await readFile(path.join(root,'out/project/src/settings/settings.ts'),'utf8'),/https:\/\/www\.empresa-teste\.com\.br/);
 assert.deepEqual(report.parts.filter((p:any)=>p.status!=='fragment').map((p:any)=>p.source),['index.php']);
 assert.ok(report.excludedSources.some((e:any)=>e.source==='index copy.php'));assert.ok(report.excludedSources.some((e:any)=>e.source==='assets/pagina_files/salva.html'));
 assert.match(await readFile(path.join(root,'out/project/next.config.ts'),'utf8'),/source:\s*"\/antigo",\s*destination:\s*"\/"/);
 const page=await readFile(path.join(root,'out/project/src/app/(paginas)/page.tsx'),'utf8');
 assert.match(page,/<ContactForm[^>]*className="depo"/);assert.match(page,/action="https:\/\/api\.whatsapp\.com\/send"/);assert.match(page,/<DisabledForm/);
});
test('WordPress em subpasta fica fora; links vão ao domínio original; index é processada primeiro',async()=>{
 await mkdir('.work',{recursive:true});const root=await mkdtemp(path.resolve('.work/embedded-'));const source=path.join(root,'source');await mkdir(path.join(source,'blog/wp-includes'),{recursive:true});await mkdir(path.join(source,'aaa'),{recursive:true});
 await writeFile(path.join(source,'sitemap.xml'),'<urlset><url><loc>https://www.loja.com.br/</loc></url></urlset>');
 await writeFile(path.join(source,'blog/wp-settings.php'),'<?php eval("x");');await writeFile(path.join(source,'blog/index.php'),'<?php require "wp-settings.php";');await writeFile(path.join(source,'blog/wp-includes/a.php'),'<?php echo 1;');
 await writeFile(path.join(source,'aaa/pagina.php'),'<!doctype html><html><head><title>A</title></head><body><h1>A</h1></body></html>');
 await writeFile(path.join(source,'index.php'),'<!doctype html><html><head><title>Home</title></head><body><h1>Home</h1><a href="blog/">Blog</a><a href="/blog/post/?p=1">Post</a><img src="/blog/wp-content/uploads/x.jpg" alt="x"></body></html>');
 const report:any=await convertSite(source,path.join(root,'out'));
 assert.equal(report.parts[0].source,'index.php');assert.deepEqual(report.parts.map((p:any)=>p.source),['index.php','aaa/pagina.php']);
 assert.ok(report.excludedSources.some((e:any)=>e.source==='blog/'&&/WordPress/.test(e.reason)));
 const page=await readFile(path.join(root,'out/project/src/app/(paginas)/page.tsx'),'utf8');
 assert.match(page,/href="https:\/\/www\.loja\.com\.br\/blog\/"/);assert.match(page,/href="https:\/\/www\.loja\.com\.br\/blog\/post\/\?p=1"/);assert.match(page,/src="https:\/\/www\.loja\.com\.br\/blog\/wp-content\/uploads\/x\.jpg"/);
});
