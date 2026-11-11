import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {Rules} from './rules.ts';
export async function writeContactTemplate(project:string,rules:Rules){
 const base=new URL('../../../templates/next-company/contact-form/',import.meta.url);
 const alias=(file:string)=>'@/'+file.replace(/^src\//,'').replace(/\.[^.]+$/,'');
 const files:Record<string,string>={'ContactForm.tsx':rules.mappings.contactForm,'ContactForm.module.scss':path.posix.join(path.posix.dirname(rules.mappings.contactForm),'ContactForm.module.scss'),'form.ts':rules.mappings.contactValidation,'route.ts':rules.mappings.emailHandler,'.env.example':'.env.example'};
 for(const [name,target] of Object.entries(files)){let content=await readFile(new URL(name,base),'utf8');content=content.replaceAll('@/schemas/form',alias(rules.mappings.contactValidation));await mkdir(path.dirname(path.join(project,target)),{recursive:true});await writeFile(path.join(project,target),content);}
 const packagePath=path.join(project,'package.json'),pkg=JSON.parse(await readFile(packagePath,'utf8'));Object.assign(pkg.dependencies,{nodemailer:'^7.0.9',zod:'^4.1.12'});Object.assign(pkg.devDependencies,{'@types/nodemailer':'^7.0.2'});await writeFile(packagePath,JSON.stringify(pkg,null,2));
 await writeFile(path.join(project,'.gitignore'),'node_modules/\n.next/\n.env*\n!.env.example\n');
}
