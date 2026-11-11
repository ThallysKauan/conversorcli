import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renderPhp } from '../src/conversion/php/index.ts';
import { documentData } from '../src/validation/html.ts';
test('variáveis e include_once preservam conteúdo sem executar PHP', async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'ppnet-'));
 await writeFile(path.join(root,'head.php'),'<?= $title ?>');
 await writeFile(path.join(root,'index.php'),'<?php $title="Olá"; require_once __DIR__ . "/head.php"; require_once __DIR__ . "/head.php"; ?>!');
 assert.equal((await renderPhp(root,'index.php')).html,'Olá!');
});
test('código executável desconhecido e includes externos são recusados',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'ppnet-'));
 await mkdir(path.join(root,'site')); await writeFile(path.join(root,'outside.php'),'segredo');
 await writeFile(path.join(root,'site/index.php'),'<?php include "../outside.php";');
 await assert.rejects(renderPhp(path.join(root,'site'),'index.php'),/fora da origem/);
 await writeFile(path.join(root,'site/index.php'),'<?php eval("echo 1;");');
 await assert.rejects(renderPhp(path.join(root,'site'),'index.php'),/não suportada/);
});
test('HTML preserva texto e classes e rejeita interatividade não convertida',()=>{
 const doc=documentData('<!doctype html><html lang="pt-BR"><head><title>T</title></head><body><h1 class="hero">A &amp; B</h1></body></html>');
 assert.match(JSON.stringify(doc),/A & B/); assert.match(JSON.stringify(doc),/className/);
 assert.throws(()=>documentData('<form></form>'),/regra específica/);
 assert.throws(()=>documentData('<p onclick="go()">x</p>'),/Atributo/);
});

test('ciclo de includes falha sem bloquear a execução',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'ppnet-'));
 await writeFile(path.join(root,'index.php'),'<?php include "index.php";');
 await assert.rejects(renderPhp(root,'index.php'),/Ciclo/);
});

test('includes aninhados usam raiz de execução e mantêm __DIR__ explícito',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'ppnet-'));await mkdir(path.join(root,'inc'));
 await writeFile(path.join(root,'index.php'),'<?php include "inc/head.php";');
 await writeFile(path.join(root,'inc/head.php'),'<?php include "inc/config.php"; include __DIR__ . "/tail.php";');
 await writeFile(path.join(root,'inc/config.php'),'OK');await writeFile(path.join(root,'inc/tail.php'),'!');
 assert.equal((await renderPhp(root,'index.php')).html,'OK!');
});
