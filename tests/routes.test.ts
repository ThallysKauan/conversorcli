import test from 'node:test';
import assert from 'node:assert/strict';
import {parse} from 'parse5';
import {pageSignature} from '../src/validation/routes.ts';
test('HTTP verification compares real title and heading, not script text',()=>{
 const reference={tag:'html',children:[{tag:'head',children:[{tag:'title',children:['About & company']}]},{tag:'body',children:[{tag:'h1',children:['Our ',{tag:'strong',children:['team']}]}]}]};
 const html=parse('<html><head><title>About &amp; company</title></head><body><h1>Our <strong>team</strong></h1><script>"<h1>wrong</h1>"</script></body></html>');
 assert.deepEqual(pageSignature(html),pageSignature(reference));assert.notDeepEqual(pageSignature(parse('<h1>Home</h1>')),pageSignature(reference));
});
