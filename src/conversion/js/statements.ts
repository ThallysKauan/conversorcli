// Divisor léxico de JavaScript: não executa código, apenas separa instruções de nível superior.
// Reconhece strings, template literals, comentários, expressões regulares e ASI por quebra de linha.
const regexPrefix=new Set(['(',',','=',':','[','!','&','|','?','{','}',';','+','-','*','%','<','>','~','^']);
const regexKeywords=new Set(['return','typeof','case','do','else','in','of','new','delete','void','throw','instanceof','yield','await']);
const continuation=/^(?:else|catch|finally)\b/;

/** Remove comentários preservando strings, templates e expressões regulares. */
export function stripComments(code:string){
 let out='',i=0,prev='';const templates:number[]=[];let depth=0;
 const word=()=>{const m=out.match(/([A-Za-z_$][\w$]*)\s*$/);return m?m[1]:'';};
 while(i<code.length){
  const c=code[i],n=code[i+1];
  if(c==='/'&&n==='/'){while(i<code.length&&code[i]!=='\n')i++;continue;}
  if(c==='/'&&n==='*'){const end=code.indexOf('*/',i+2);i=end<0?code.length:end+2;out+=' ';continue;}
  if(c==='"'||c==="'"){let j=i+1;while(j<code.length&&code[j]!==c&&code[j]!=='\n'){if(code[j]==='\\')j++;j++;}out+=code.slice(i,j+1);i=j+1;prev=c;continue;}
  if(c==='`'||(c==='}'&&templates.length&&templates[templates.length-1]===depth)){
   if(c==='}')templates.pop();let j=i+1;
   while(j<code.length&&code[j]!=='`'){if(code[j]==='\\'){j+=2;continue;}if(code[j]==='$'&&code[j+1]==='{'){templates.push(depth);j+=2;break;}j++;}
   const closed=code[j-1]==='{'&&code[j-2]==='$';out+=code.slice(i,closed?j:j+1);i=closed?j:j+1;prev=closed?'{':'`';continue;
  }
  if(c==='/'){const p=prev;if(!p||regexPrefix.has(p)||regexKeywords.has(word())){let j=i+1,klass=false;while(j<code.length&&code[j]!=='\n'){if(code[j]==='\\'){j+=2;continue;}if(code[j]==='[')klass=true;else if(code[j]===']')klass=false;else if(code[j]==='/'&&!klass)break;j++;}j++;while(/[a-z]/i.test(code[j]||''))j++;out+=code.slice(i,j);i=j;prev='/r';continue;}}
  if(c==='{'||c==='('||c==='[')depth++;if(c==='}'||c===')'||c===']')depth--;
  out+=c;if(!/\s/.test(c))prev=c;i++;
 }
 return out;
}

/** Separa instruções de nível superior de um código já sem comentários. */
export function splitStatements(input:string){
 const code=stripComments(input),statements:string[]=[];let start=0,depth=0,i=0,prev='';const templates:number[]=[];
 const push=(end:number)=>{const text=code.slice(start,end).trim().replace(/;$/,'').trim();if(text)statements.push(text);start=end;};
 const nextToken=(from:number)=>code.slice(from).match(/^\s*([\s\S]{0,12})/)![1];
 while(i<code.length){
  const c=code[i];
  if(c==='"'||c==="'"){let j=i+1;while(j<code.length&&code[j]!==c&&code[j]!=='\n'){if(code[j]==='\\')j++;j++;}i=j+1;prev='a';continue;}
  if(c==='`'||(c==='}'&&templates.length&&templates[templates.length-1]===depth)){
   if(c==='}')templates.pop();let j=i+1,opened=false;
   while(j<code.length&&code[j]!=='`'){if(code[j]==='\\'){j+=2;continue;}if(code[j]==='$'&&code[j+1]==='{'){templates.push(depth);j+=2;opened=true;break;}j++;}
   i=opened?j:j+1;prev=opened?'{':'a';continue;
  }
  if(c==='/'&&(!prev||regexPrefix.has(prev))){let j=i+1,klass=false;while(j<code.length&&code[j]!=='\n'){if(code[j]==='\\'){j+=2;continue;}if(code[j]==='[')klass=true;else if(code[j]===']')klass=false;else if(code[j]==='/'&&!klass)break;j++;}j++;while(/[a-z]/i.test(code[j]||''))j++;i=j;prev='a';continue;}
  if(c==='{'||c==='('||c==='[')depth++;
  else if(c==='}'||c===')'||c===']'){depth--;if(depth===0&&c==='}'){const next=nextToken(i+1);if(!/^[.(,)\]?:+\-*/&|=]/.test(next)&&!continuation.test(next)&&!/^\s*;/.test(code.slice(i+1))&&/^[\w$'"`]|^$/.test(next)){i++;push(i);prev='';continue;}}}
  else if(c===';'&&depth===0){i++;push(i);prev='';continue;}
  else if(c==='\n'&&depth===0&&prev&&/[\w$)\]'"`a]/.test(prev)){const next=nextToken(i+1);if(next&&/^[A-Za-z_$'"]/.test(next)&&!continuation.test(next)&&!/^(?:instanceof|in|of)\b/.test(next)){push(i);prev='';i++;continue;}}
  if(!/\s/.test(c))prev=c==='}'?'}':/[\w$]/.test(c)?'a':c;i++;
 }
 push(code.length);return statements;
}

/** Retorna o corpo de wrappers de inicialização (DOMContentLoaded, $(fn), ready). */
export function readyBody(statement:string){
 const patterns=[/^(?:\$|jQuery)\(\s*(?:function\s*\(\s*\$?\s*\)|\(\s*\$?\s*\)\s*=>)\s*\{([\s\S]*)\}\s*\)$/,/^(?:\$|jQuery)\(\s*document\s*\)\.ready\(\s*(?:function\s*\(\s*\$?\s*\)|\(\s*\)\s*=>)\s*\{([\s\S]*)\}\s*\)$/,/^(?:document|window)\.addEventListener\(\s*["'](?:DOMContentLoaded|load)["']\s*,\s*(?:function\s*\(\s*\)|\(\s*\)\s*=>)\s*\{([\s\S]*)\}\s*\)$/,/^window\.onload\s*=\s*(?:function\s*\(\s*\)|\(\s*\)\s*=>)\s*\{([\s\S]*)\}$/,/^\(\s*(?:function\s*\(\s*\)|\(\s*\)\s*=>)\s*\{([\s\S]*)\}\s*\)\s*\(\s*\)$/];
 for(const pattern of patterns){const match=statement.match(pattern);if(match)return match[1];}
 return undefined;
}

/** Converte um literal de objeto JavaScript simples em valor JSON. */
export function objectLiteral(text:string):any{
 let json='';let i=0;
 while(i<text.length){const c=text[i];if(c==="'"||c==='"'){let j=i+1,value='';while(j<text.length&&text[j]!==c){if(text[j]==='\\'){value+=text[j+1];j+=2;continue;}value+=text[j];j++;}json+=JSON.stringify(value);i=j+1;continue;}json+=c;i++;}
 json=json.replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g,'$1"$2":').replace(/,(\s*[}\]])/g,'$1');
 return JSON.parse(json);
}
