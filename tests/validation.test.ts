import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {validateConversion,projectFiles} from '../src/validation/project.ts';
async function fixture(){
 await mkdir('.work',{recursive:true});const root=await mkdtemp(path.resolve('.work/validation-'));
 await mkdir(path.join(root,'project/src/app/(paginas)/about'),{recursive:true});
 await writeFile(path.join(root,'project/src/app/(paginas)/about/page.tsx'),'export default function Page(){return null;}');
 await writeFile(path.join(root,'report.json'),JSON.stringify({status:'incomplete',parts:[{route:'/about',status:'partial'}],checks:{build:'not-run',visual:'not-run',behavior:'not-run'}}));return root;
}
test('validation installs and builds inside project, retaining functional pending state',async()=>{
 const root=await fixture(),calls:string[]=[];
 const report=await validateConversion(root,()=>{},async(cwd,command,args)=>{assert.equal(cwd,path.join(root,'project'));calls.push(command+' '+args.join(' '));return {code:0,output:'ok'};});
 assert.deepEqual(calls,['npm install --no-audit --no-fund','npm run build']);assert.equal(report.checks.build,'passed');assert.equal(report.checks.routes,'passed');assert.equal(report.status,'incomplete');assert.equal(report.checks.behavior,'not-run');
});
test('build failure persists diagnostics and never reports passed',async()=>{
 const root=await fixture();let call=0;
 const report=await validateConversion(root,()=>{},async()=>({code:call++?1:0,output:'type error'}));
 assert.equal(report.checks.build,'failed');assert.equal(await readFile(path.join(root,'validation-build.log'),'utf8'),'type error');
});
test('missing routes stop before running install or build',async()=>{
 const root=await fixture();await writeFile(path.join(root,'report.json'),JSON.stringify({parts:[{route:'/missing',status:'partial'}]}));
 const report=await validateConversion(root,()=>{},async()=>{throw new Error('must not execute');});assert.equal(report.checks.routes,'failed');assert.deepEqual(report.validation.missing,['/missing']);
});


test('validation prunes dependencies and build output before inspecting project files',async()=>{
 const root=await fixture();const project=path.join(root,'project');
 for(const name of ['node_modules/pkg','.next/server','.git/objects','src/components'])await mkdir(path.join(project,name),{recursive:true});
 for(const name of ['node_modules/pkg/legacy.php','.next/server/legacy.php','.git/objects/legacy.php','src/components/Native.tsx'])await writeFile(path.join(project,name),'ok');
 const files=await projectFiles(project);
 assert.ok(files.some(file=>file.endsWith('Native.tsx')));
 assert.ok(!files.some(file=>/node_modules|\.next|\.git/.test(file)));
});
