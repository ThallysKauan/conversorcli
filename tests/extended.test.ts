import test from 'node:test';import assert from 'node:assert/strict';import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';import path from 'node:path';import {renderExtended} from '../src/conversion/php/extended.ts';
test('condições, arrays, funções, globals e interpolação geram conteúdo',async()=>{await mkdir('.work',{recursive:true});const root=await mkdtemp(path.resolve('.work/extended-'));await writeFile(path.join(root,'index.php'),'<?php $name="Catálogo"; $items=array("a"=>"Um","b"=>"Dois"); function menu(){global $name;echo "<h1>$name</h1>";foreach($GLOBALS["items"] as $key=>$value){if(isset($value)){echo "<p>$key: $value</p>";}}} menu();');const r=await renderExtended(root,'index.php');assert.equal(r.html,'<h1>Catálogo</h1><p>a: Um</p><p>b: Dois</p>');assert.deepEqual(r.notices,[]);});
test('falha em include é registrada sem apagar HTML independente',async()=>{await mkdir('.work',{recursive:true});const root=await mkdtemp(path.resolve('.work/extended-'));await writeFile(path.join(root,'index.php'),'<!doctype html><html><body><?php require "missing.php"; ?><h1>Preservado</h1></body></html>');const r=await renderExtended(root,'index.php');assert.match(r.html,/<h1>Preservado/);assert.match(r.notices[0].message,/Include ausente/);});
test('execução dinâmica permanece bloqueada',async()=>{await mkdir('.work',{recursive:true});const root=await mkdtemp(path.resolve('.work/extended-'));await writeFile(path.join(root,'index.php'),'<?php eval("echo 1;");');await assert.rejects(renderExtended(root,'index.php'),/bloqueada/);});
test('arrays, trim, loops, switch and exceptions',async()=>{
 await mkdir('.work',{recursive:true});const root=await mkdtemp(path.resolve('.work/extended-'));
 await writeFile(path.join(root,'index.php'),`<?php
 $a=array('first','last'); echo array_pop($a); array_push($a,'next'); echo count($a); echo trim('/folder/','/');
 $i=0; while($i<2){echo $i; $i++;} do {echo 'd';} while(false);
 switch(2){case 1:echo 'bad';break;case 2:echo 'ok';break;default:echo 'bad';}
 try {throw new Exception('caught');} catch(Exception $e){echo $e->getMessage();} finally {echo 'finally';}
 echo $undefined ?? 'fallback';`);
 const r=await renderExtended(root,'index.php');assert.equal(r.html,'last2folder01dokcaughtfinallyfallback');assert.deepEqual(r.notices,[]);
});
test('unused session startup versus actual session state',async()=>{
 await mkdir('.work',{recursive:true});const root=await mkdtemp(path.resolve('.work/extended-'));
 await writeFile(path.join(root,'index.php'),`<?php session_start(); ini_set('display_errors',0); error_reporting(E_ALL); echo 'page';`);
 assert.deepEqual((await renderExtended(root,'index.php')).notices,[]);
 await writeFile(path.join(root,'state.php'),`<?php session_start(); $_SESSION['name']='test';`);
 assert.match((await renderExtended(root,'state.php')).notices[0].message,/Sessão PHP/);
});
test('HTTP status preserved alongside content',async()=>{
 await mkdir('.work',{recursive:true});const root=await mkdtemp(path.resolve('.work/extended-'));
 await writeFile(path.join(root,'index.php'),`<?php header('HTTP/1.1 404 Not Found'); http_response_code(404); ?><html><body>Missing</body></html>`);
 const r=await renderExtended(root,'index.php');assert.equal(r.responseStatus,404);assert.deepEqual(r.notices,[]);assert.match(r.html,/Missing/);
});
test('variáveis sem valor: null em condições, marcador quando impressas; config e funções de URL',async()=>{
 await mkdir('.work',{recursive:true});const root=await mkdtemp(path.resolve('.work/extended-'));await mkdir(path.join(root,'inc'));await mkdir(path.join(root,'assets'));
 for(const file of ['prod-02.webp','prod-01.webp','outro-01.webp'])await writeFile(path.join(root,'assets',file),'');
 await writeFile(path.join(root,'inc/config.php'),`<?php $telefoneFestas='4142-4488'; $ddd='11'; $senhaSmtp='segredo'; $msgPadrao = urlencode("Olá, vim do site!");`);
 await writeFile(path.join(root,'index.php'),`<?php include 'inc/config.php'; ?><header class="<?php if ($navativa == false): ?>rolado<?php endif; ?>"></header><?php if ($home == true) echo 'home'; ?><a href="tel:<?= $ddd . $telefone ?>"><?= $telefone ?></a><p><?= "$ddd/{$telefone}" ?></p><?php foreach (glob('assets/prod-*.webp') as $f) echo $f, ';'; ?><i><?= $msgPadrao ?></i><b><?= rawurlencode('a b~') ?></b>`);
 const r=await renderExtended(root,'index.php',{configFile:'inc/config.php'});
 assert.deepEqual(r.notices,[]);assert.deepEqual(r.undefinedVariables,['home','navativa','telefone']);
 const token=r.html.match(/\uE000\d+\uE001/)![0];
 assert.equal(r.html,`<header class="rolado"></header><a href="tel:11${token}">${token}</a><p>11/${token}</p>assets/prod-01.webp;assets/prod-02.webp;<i>Ol%C3%A1%2C+vim+do+site%21</i><b>a%20b~</b>`);
 assert.deepEqual(r.variables,{telefoneFestas:'4142-4488',ddd:'11',msgPadrao:'Ol%C3%A1%2C+vim+do+site%21'});
});
test('builtins, closures, short tags, return em include, constantes e Location',async()=>{
 await mkdir('.work',{recursive:true});const root=await mkdtemp(path.resolve('.work/extended-'));await mkdir(path.join(root,'inc'));
 await writeFile(path.join(root,'inc/cfg.php'),`<?php define('MARCA','Loja'); const ANO=2020; if(true) return 'ok'; echo 'nunca';`);
 await writeFile(path.join(root,'index.php'),`<?php $r=include 'inc/cfg.php'; ?><? if(substr_count('a,b,c',',')===2): ?>sc<? endif; ?>|<?= $r ?>|<?= MARCA.ANO ?>|<?= implode(',',array_map(fn($x)=>$x*2,array_slice([1,2,3,4],1,2))) ?>|<?php $n=[3,1,2]; usort($n,function($a,$b){return $a<=>$b;}); echo implode('',$n); ?>|<?= sprintf('%05.1f-%s',3.14159,'x') ?>|<?php if(preg_match('/(\\d+)-(\\d+)/','10-20',$m)) echo $m[2]; ?>|<?= function_exists('ajuda')?'f':'n' ?>|<?= ajuda() ?>|<?= nowdoc() ?><?php function ajuda(){return 'h';} function nowdoc(){return <<<'TXT'
nd
TXT;
} ?>|<?php list($a,$b)=['x','y']; echo $b.$a; ?>|<?= ucwords('ola mundo') ?>|<?= number_format(1234.5,2,',','.') ?>|<?= str_pad('7',3,'0',STR_PAD_LEFT) ?><?php naoExiste(); ?>`);
 const r=await renderExtended(root,'index.php');
 assert.equal(r.html,'sc|ok|Loja2020|4,6|123|003.1-x|20|f|h|nd|yx|Ola Mundo|1.234,50|007');
 assert.deepEqual(r.notices.map(n=>n.message),['Função inexistente na origem (erro fatal no ar): naoexiste(); chamada ignorada.']);
 await writeFile(path.join(root,'antigo.php'),`<?php header('Location: novo.php', true, 301); exit;`);
 const redirect=await renderExtended(root,'antigo.php');assert.equal(redirect.redirect,'novo.php');assert.equal(redirect.responseStatus,301);
});
