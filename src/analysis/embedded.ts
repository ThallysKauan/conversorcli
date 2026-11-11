// Aplicações com banco de dados instaladas numa subpasta (blog em WordPress, loja...) não têm como virar páginas estáticas:
// ficam fora da conversão e os links para elas seguem para o domínio original.
const markers:[RegExp,string][]=[
 [/^(.*\/)?wp-settings\.php$/i,'WordPress'],
 [/^(.*\/)?administrator\/manifests\/files\/joomla\.xml$/i,'Joomla'],
 [/^(.*\/)?core\/lib\/Drupal\.php$/i,'Drupal'],
 [/^(.*\/)?app\/Mage\.php$/i,'Magento'],
 [/^(.*\/)?system\/engine\/controller\.php$/i,'OpenCart'],
];
export function embeddedApps(files:string[]){
 const found=new Map<string,string>();
 for(const file of files)for(const [pattern,name] of markers){const match=file.match(pattern);if(match)found.set((match[1]||'').replace(/\/$/,''),name);}
 // A raiz inteira como CMS não é "embutido": o conversor avisa pelas páginas inacabadas. Pastas aninhadas contam pela mais externa.
 const roots=[...found.keys()].filter(Boolean).sort((a,b)=>a.length-b.length);const kept:string[]=[];
 for(const root of roots)if(!kept.some(parent=>root.startsWith(parent+'/')))kept.push(root);
 return kept.map(root=>({root,name:found.get(root)!}));
}
