import {readFile} from 'node:fs/promises';
import path from 'node:path';
// Domínio público do site, em cascata: sitemap.xml, Sitemap: do robots.txt, canonical/og:url literal,
// domínio do email da empresa no arquivo de configurações. O .htaccess decide o www.
const freeMail=/^(gmail|googlemail|hotmail|outlook|live|yahoo|ymail|uol|bol|terra|ig|icloud|me|msn|protonmail|zoho)\.|(^|\.)(yaslip|mrfmidiadigital|example)\./i;
async function text(file:string){try{return await readFile(file,'utf8');}catch{return '';}}
export async function detectSiteUrl(source:string,files:string[],configFile?:string):Promise<{url:string;source:string}|undefined>{
 const origin=(value:string)=>{try{const url=new URL(value.trim());return /^https?:$/.test(url.protocol)&&!/example\.|localhost|_|site_?base|seu_?(site|dominio)|nome_?site|seudominio|dominio\.com/i.test(url.host)?url.origin:undefined;}catch{return undefined;}};
 const sitemap=(await text(path.join(source,'sitemap.xml'))).match(/<loc>\s*(https?:\/\/[^<\s]+)\s*<\/loc>/i);
 if(sitemap&&origin(sitemap[1]))return {url:origin(sitemap[1])!,source:'sitemap.xml'};
 const robots=(await text(path.join(source,'robots.txt'))).match(/^\s*sitemap:\s*(https?:\/\/\S+)/im);
 if(robots&&origin(robots[1]))return {url:origin(robots[1])!,source:'robots.txt'};
 const pages=files.filter(f=>/\.(php|html?)$/i.test(f)&&!/^(libraries|vendor|node_modules)\//i.test(f)).slice(0,400);
 const counts=new Map<string,number>();
 for(const file of pages){for(const m of (await text(path.join(source,file))).matchAll(/<link[^>]+rel=["']canonical["'][^>]*href=["'](https?:\/\/[^"'<]+)["']|property=["']og:url["'][^>]*content=["'](https?:\/\/[^"'<]+)["']/gi)){const found=origin(m[1]||m[2]);if(found)counts.set(found,(counts.get(found)||0)+1);}}
 const canonical=[...counts].sort((a,b)=>b[1]-a[1])[0];if(canonical)return {url:canonical[0],source:'canonical/og:url'};
 const config=configFile?await text(path.join(source,configFile)):'';
 const domains=new Map<string,number>();
 for(const m of config.matchAll(/[\w.+-]+@([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})/gi)){const domain=m[1].toLowerCase();if(!freeMail.test(domain))domains.set(domain,(domains.get(domain)||0)+1);}
 const domain=[...domains].sort((a,b)=>b[1]-a[1])[0]?.[0];if(!domain)return undefined;
 const htaccess=(await text(path.join(source,'.htaccess')))+(await text(path.join(source,'_.htaccess')));
 // www→sem www (RewriteCond ^www\. e destino %1): domínio sem www; padrão com www.
 const bare=/RewriteCond\s+%\{HTTP_HOST\}\s+\^www\\./i.test(htaccess)&&/https?:\/\/%1/.test(htaccess);
 return {url:'https://'+(bare||domain.startsWith('www.')?domain:'www.'+domain),source:'email do arquivo de configurações'};
}
