import {parse} from 'parse5';
import postcss from 'postcss';
import path from 'node:path';
export interface LegacyNode {tag:string;props:Record<string,any>;children:(LegacyNode|string)[]}
const aliases:Record<string,string>={class:'className',for:'htmlFor',charset:'charSet','http-equiv':'httpEquiv',tabindex:'tabIndex',colspan:'colSpan',rowspan:'rowSpan',crossorigin:'crossOrigin',srcset:'srcSet',allowfullscreen:'allowFullScreen',frameborder:'frameBorder',referrerpolicy:'referrerPolicy',acceptcharset:'acceptCharset',readonly:'readOnly',maxlength:'maxLength',minlength:'minLength',cellpadding:'cellPadding',cellspacing:'cellSpacing',autocomplete:'autoComplete',autofocus:'autoFocus',playsinline:'playsInline',nomodule:'noModule',novalidate:'noValidate',formnovalidate:'formNoValidate',itemscope:'itemScope',autoplay:'autoPlay',contenteditable:'contentEditable',spellcheck:'spellCheck',accesskey:'accessKey',enctype:'encType',formaction:'formAction',formmethod:'formMethod',formtarget:'formTarget',formenctype:'formEncType',datetime:'dateTime',usemap:'useMap',hreflang:'hrefLang',inputmode:'inputMode',enterkeyhint:'enterKeyHint',srclang:'srcLang',marginwidth:'marginWidth',marginheight:'marginHeight',allowtransparency:'allowTransparency',bgcolor:'bgColor',valign:'vAlign',nowrap:'noWrap',fetchpriority:'fetchPriority',itemprop:'itemProp',itemtype:'itemType',itemid:'itemID',itemref:'itemRef',popovertarget:'popoverTarget',popovertargetaction:'popoverTargetAction',controlslist:'controlsList',disablepictureinpicture:'disablePictureInPicture',disableremoteplayback:'disableRemotePlayback',classid:'classID',dirname:'dirName',imagesizes:'imageSizes',imagesrcset:'imageSrcSet',sizes:'sizes',radiogroup:'radioGroup',keyparams:'keyParams',keytype:'keyType',mediagroup:'mediaGroup',accept:'accept','accept-charset':'acceptCharset'};
const bools=new Set(['async','defer','nomodule','open','reversed','novalidate','formnovalidate','itemscope','inert','hidden','disabled','checked','multiple','required','autofocus','selected','autoplay','controls','loop','muted','readonly','allowfullscreen','playsinline']);
const voids=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
// Repara JSON-LD comum em PHP: caracteres de controle dentro de strings e vírgula antes de } ou ].
export function repairJson(raw:string):string|undefined{
 try{JSON.parse(raw);return raw;}catch{}
 let out='',inString=false;
 for(let i=0;i<raw.length;i++){const c=raw[i];if(inString){if(c==='\\'){out+=c+(raw[i+1]??'');i++;continue;}if(c==='"')inString=false;else if(c<' '){out+=c==='\n'?'\\n':c==='\r'?'\\r':c==='\t'?'\\t':'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0');continue;}}else if(c==='"')inString=true;out+=c;}
 out=out.replace(/,(\s*[}\]])/g,'$1');
 try{JSON.parse(out);return out;}catch{return undefined;}
}
export function legacyDocument(html:string,entry:string,files:Set<string>,siteUrl:string,options:{forms?:'omit'|'disabled'|'template';formMarkup?:'original'|'template';excludedPages?:Set<string>}={}) {
 const warnings:string[]=[];const tree:any=parse(html,{onParseError:e=>{if(e.code!=='missing-doctype')warnings.push('HTML da origem reparado pelo parser: '+e.code);}});
 const doc=tree.childNodes.find((n:any)=>n.tagName==='html');const domain=new URL(siteUrl).host;
 function url(value:string,tag:string,key:string){
  if(tag==='a'&&options.excludedPages?.size){try{const absolute=new URL(value,new URL(entry,siteUrl+'/'));const site=new URL(siteUrl);if(absolute.host.replace(/^www\./,'')===site.host.replace(/^www\./,'')&&options.excludedPages.has(absolute.pathname.replace(/\/{2,}/g,'/').slice(1)))return new URL(absolute.pathname+absolute.search+absolute.hash,site.origin).href;}catch{}}
  if(/^(mailto:|tel:|data:|#|javascript:)/i.test(value))return value;
  try{const abs=new URL(value);if(tag==='a'&&abs.host===domain)return abs.pathname+abs.search+abs.hash;return value;}catch{}
  if(value.startsWith('//')||value.startsWith('/'))return value;
  const clean=value.split(/[?#]/)[0],suffix=value.slice(clean.length);const local=path.posix.normalize(path.posix.join(path.posix.dirname(entry),clean));
  if(files.has(local))return '/'+local+suffix;if(files.has(clean))return '/'+clean+suffix;return value;
 }
 function convert(n:any):any{
  let contact=false;
  if(n.nodeName==='#text')return n.value;if(n.tagName==='form'&&options.forms==='omit')return null;if(!n.tagName)return null;
  // Formulário que funciona sem backend (sem campos, GET ou action em outro domínio, ex.: WhatsApp): segue como na origem.
  let passive=false;
  if(n.tagName==='form'){
   const names=new Set<string>();const collect=(item:any)=>{for(const attr of item.attrs||[])if(attr.name==='name')names.add(attr.value);for(const child of item.childNodes||[])collect(child);};collect(n);
   for(const name of ['submit','recaptcha_response','g-recaptcha-response'])names.delete(name);
   const attr=(name:string)=>(n.attrs||[]).find((a:any)=>a.name===name)?.value as string|undefined;
   const action=attr('action')||'',method=(attr('method')||'get').toLowerCase();
   let external=false;try{external=/^(https?:)?\/\//i.test(action)&&new URL(action,siteUrl).host!==domain;}catch{}
   const contactLike=[...names].some(name=>/^(e-?mail|email_form|telefone|telefone_form|fone|phone|tel|celular|whatsapp)$/i.test(name));
   passive=!names.size||external||(method==='get'&&!contactLike);
   if(!passive&&options.forms==='template'){
    const standard=names.has('nome')&&names.has('mensagem')&&(names.has('email')||names.has('email_form'))&&(names.has('telefone')||names.has('telefone_form'));
    if(standard&&options.formMarkup==='template')return {tag:'contact-form',props:{variation:/^contato\.(php|html?)$/i.test(path.posix.basename(entry))?'contatoForm':'contatoFormIncluded'},children:[]};
    // Formulário com campos (contato, orçamento, depoimento, trabalhe conosco) envia por email pela API com a marcação original.
    // Login/cadastro (campo password) depende de servidor com sessão: fica sem envio.
    let password=false;const scan=(item:any)=>{if(item.tagName==='input'&&(item.attrs||[]).some((a:any)=>a.name==='type'&&a.value.toLowerCase()==='password'))password=true;for(const child of item.childNodes||[])scan(child);};scan(n);
    if(!password)contact=true;
    else warnings.push('Formulário de login/senha: preservado sem envio; requer backend com sessão.');
   }
  }
  if(n.tagName==='base'){warnings.push('Tag base omitida para manter navegação local; revisar URLs.');return null;}
  const props:Record<string,any>={},events:Record<string,string>={};
  for(const a of n.attrs||[]){let key=a.name,value=a.value;if(/^on/i.test(key)){events[key]=value;continue;}
   if(key==='style'){const style:Record<string,string>={};try{postcss.parse('x{'+value+'}').walkDecls(d=>{const name=d.prop.startsWith('--')?d.prop:d.prop.replace(/^-ms-/,'ms-').replace(/-([a-z])/g,(_,s)=>s.toUpperCase());style[name]=d.value;});props.style=style;}catch{warnings.push('Estilo inline inválido na origem.');}continue;}
   // Atributos com namespace (SVG): xmlns:xlink → xmlnsXlink, xlink:href → xlinkHref, xml:space → xmlSpace; outros xmlns:* não são necessários em SVG inline.
   if(a.prefix==='xmlns'||/^xmlns:/.test(a.name)){if(a.name==='xlink'||a.name==='xmlns:xlink')props.xmlnsXlink=value;continue;}
   if(!a.prefix&&a.name.includes(':')&&!/^xlink:|^xml:/.test(a.name))continue;
   if(a.prefix==='xlink'||a.prefix==='xml'){props[a.prefix+a.name.charAt(0).toUpperCase()+a.name.slice(1)]=value;continue;}
   // Em URLs, variável PHP sem valor vale vazio como no PHP (href="<?=$url?>x.php" → "x.php"), não o placeholder.
   if(['src','href','data','poster','action','srcset'].includes(key)&&/\uE000\d+\uE001/.test(value)){value=value.replace(/\uE000\d+\uE001/g,'');warnings.push('Variável PHP sem valor em URL tratada como vazia, como no PHP.');}
   if(['src','href','data','poster'].includes(key))value=url(value,n.tagName,key);
   key=aliases[key]||((n.namespaceURI||'').includes('svg')&&!/^(data|aria)-/.test(key)?key.replace(/[-:]([a-z])/g,(_:string,s:string)=>s.toUpperCase()):key);
   if(['tabindex','colspan','rowspan','maxlength','minlength','rows','cols','size','span','start'].includes(a.name)){if(/^-?\d+$/.test(value))props[key]=Number(value);else warnings.push('Atributo numérico inválido omitido: '+a.name);}else props[key]=bools.has(a.name)?true:value;
  }
  // Formulário reconhecido com a marcação original: mantém classes e campos; o envio fica com o ContactForm.
  if(contact){for(const key of ['action','method','target','enctype'])delete props[key];return {tag:'contact-form',props,children:n.childNodes.map(convert).filter((v:any)=>v!==null)};}
  if(Object.keys(events).length)props['data-ppnet-events']=JSON.stringify(events);
  if(n.tagName==='form'&&!passive){props['data-ppnet-unfinished-form']='true';props.action='/api/ppnet-unfinished-form';props.method='post';warnings.push('Formulário preservado visualmente; envio desativado até implementar e validar backend.');}
  if(n.tagName==='input'&&Object.hasOwn(props,'value')){props.defaultValue=props.value;delete props.value;}
  if(Object.hasOwn(props,'checked')){props.defaultChecked=props.checked;delete props.checked;}
  // Scripts JavaScript seguem para as regras de comportamento (targets/next/behaviors.ts); nenhum é executado como está.
  // JSON-LD: quebras de linha cruas em strings e vírgulas finais são reparadas; o que não tem reparo seguro segue como na origem.
  if(n.tagName==='script'&&String(props.type||'').toLowerCase()==='application/ld+json'){const raw=(n.childNodes||[]).map((c:any)=>c.value||'').join('');const fixed=repairJson(raw);if(fixed!==undefined)return {tag:'script',props,children:[fixed]};warnings.push('JSON-LD inválido na origem mantido como está (decisão).');return {tag:'script',props,children:[raw]};}
  if(n.tagName==='noscript')return null;
  // Nome de tag inválido na origem (ex.: resto de localizar/substituir): o navegador o trata como elemento inline desconhecido.
  if(!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/i.test(n.tagName)){warnings.push('Tag inválida na origem <'+n.tagName.slice(0,40)+'> renderizada como span, como no navegador.');return {tag:'span',props,children:(n.childNodes||[]).map(convert).filter((v:any)=>v!==null)};}
  let children=voids.has(n.tagName)?[]:(n.childNodes||[]).map(convert).filter((v:any)=>v!==null);
  // O React 19 move meta, title e link (exceto stylesheet) para o head: os textos vizinhos se juntariam só no servidor e quebrariam
  // a hidratação (a página inteira seria recriada no cliente). Esses elementos vão para o início do pai e os textos são unidos.
  if(n.tagName!=='head'&&!(n.namespaceURI||'').includes('svg')){
   const hoisted=(c:any)=>typeof c!=='string'&&((c.tag==='meta'&&!('itemProp' in c.props))||c.tag==='title'||(c.tag==='link'&&String(c.props.rel||'').toLowerCase()!=='stylesheet'));
   if(children.some(hoisted)){
    const rest:any[]=[];for(const c of children.filter((c:any)=>!hoisted(c))){if(typeof c==='string'&&typeof rest.at(-1)==='string')rest[rest.length-1]+=c;else rest.push(c);}
    children=[...children.filter(hoisted),...rest];
   }
  }
  // React ignora selected em option: a opção marcada vira defaultValue do select.
  if(n.tagName==='select'){const option=children.find((c:any)=>c?.tag==='option'&&c.props.selected);for(const c of children)if(c?.tag==='option')delete c.props.selected;if(option&&!('defaultValue' in props))props.defaultValue=option.props.value??option.children.filter((c:any)=>typeof c==='string').join('').trim();}
  return {tag:n.tagName,props,children};
 }
 return {document:convert(doc) as LegacyNode,warnings:[...new Set(warnings)]};
}
