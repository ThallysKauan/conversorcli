import test from 'node:test';
import assert from 'node:assert/strict';
import {legacyDocument} from '../src/validation/legacy.ts';
test('React boolean and numeric attributes preserve browser semantics',()=>{
 const {document}=legacyDocument('<!doctype html><html><body><script async defer src="/a.js"></script><textarea rows="4" maxlength="10"></textarea><button tabindex="0">x</button></body></html>','index.php',new Set(),'https://example.com');
 const body:any=document.children.find((n:any)=>n.tag==='body');assert.equal(body.children[0].props.async,true);assert.equal(body.children[0].props.defer,true);assert.equal(body.children[1].props.rows,4);assert.equal(body.children[1].props.maxLength,10);assert.equal(body.children[2].props.tabIndex,0);
});

test('excluded keywords retain original URLs while normal pages stay local',()=>{
 const {document}=legacyDocument('<html><body><a href="keyword.php?q=1#item">Keyword</a><a href="contato.php">Contact</a></body></html>','index.php',new Set(['keyword.php','contato.php']),'https://example.com',{excludedPages:new Set(['keyword.php'])});
 const body:any=document.children.find((n:any)=>n.tag==='body');assert.equal(body.children[0].props.href,'https://example.com/keyword.php?q=1#item');assert.equal(body.children[1].props.href,'/contato.php');
});

test('recognized contact form keeps original markup unless formMarkup is template',()=>{
 const html='<html><body><form class="contato" method="POST" action="envio.php" onsubmit="return validar()"><div class="radio-group"><input type="radio" name="produtos_form" value="A" checked></div><input name="nome" required><input name="endereco"><input type="tel" name="telefone"><input type="email" name="email"><select name="como"><option value="" selected disabled>Como nos conheceu?</option><option value="google">Google</option></select><textarea name="mensagem"></textarea><button type="submit">Enviar</button></form></body></html>';
 const body=(doc:any)=>doc.children.find((n:any)=>n.tag==='body');
 const original:any=body(legacyDocument(html,'index.php',new Set(),'https://example.com',{forms:'template'}).document).children[0];
 assert.equal(original.tag,'contact-form');assert.equal(original.props.className,'contato');
 for(const key of ['action','method','data-ppnet-events','data-ppnet-unfinished-form'])assert.equal(key in original.props,false);
 const select=original.children.find((n:any)=>n.tag==='select');assert.equal(select.props.defaultValue,'');assert.equal('selected' in select.children[0].props,false);
 assert.equal(original.children[0].children[0].props.defaultChecked,true);assert.ok(original.children.some((n:any)=>n.props?.name==='endereco'));
 const template:any=body(legacyDocument(html,'index.php',new Set(),'https://example.com',{forms:'template',formMarkup:'template'}).document).children[0];
 assert.deepEqual(template,{tag:'contact-form',props:{variation:'contatoFormIncluded'},children:[]});
});

test('meta e link no body vão para o início do pai e os textos vizinhos se unem (hidratação do React 19)',()=>{
 const {document}=legacyDocument('<html><body><div>a<meta name="x" content="1">\n\t<meta itemprop="y" content="2"><link rel="canonical" href="/z">b<link rel="stylesheet" href="/s.css"></div></body></html>','index.php',new Set(),'https://example.com');
 const div:any=(document.children.find((n:any)=>n.tag==='body') as any).children[0];
 assert.deepEqual(div.children.map((c:any)=>typeof c==='string'?c:c.tag+(c.props.itemProp?':itemprop':'')),['meta','link','a\n\t','meta:itemprop','b','link']);
});
