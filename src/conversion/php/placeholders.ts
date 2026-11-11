// Variáveis PHP sem valor na origem usadas como texto. A renderização grava um marcador (caracteres de uso privado,
// preservados pelo parser HTML); o código gerado troca o marcador por settings.variaveis.<nome>, que recebe o valor
// do arquivo de configurações ou o placeholder abaixo para ser preenchido.
export const placeholderValue='ppnet';
const ids=new Map<string,number>(),names:string[]=[];
export function placeholderToken(name:string){let id=ids.get(name);if(id===undefined){id=names.length;names.push(name);ids.set(name,id);}return '\uE000'+id+'\uE001';}
const pattern=()=>/\uE000(\d+)\uE001/g;
// Expressões calculadas na requisição (date() impresso): marcador próprio, trocado pelo código no arquivo gerado.
const expressions:{code:string;value:()=>string}[]=[],expressionIds=new Map<string,number>();
const expressionPattern=()=>/\uE002(\d+)\uE003/g;
export function expressionToken(code:string,value:()=>string){let id=expressionIds.get(code);if(id===undefined){id=expressions.length;expressions.push({code,value});expressionIds.set(code,id);}return '\uE002'+id+'\uE003';}
export function placeholderNames(text:string){return [...new Set([...text.matchAll(pattern())].map(m=>names[Number(m[1])]))];}
// Texto final (referência para validação HTTP): o marcador vira o valor que a página exibirá.
export function fillPlaceholders(text:string,values:Record<string,unknown>={}){return text.replace(pattern(),(_,id)=>{const value=values[names[Number(id)]];return value===undefined?placeholderValue:String(value);}).replace(expressionPattern(),(_,id)=>expressions[Number(id)].value());}
// Código gerado: o marcador só aparece dentro de literais de string JSON ("..."), então vira concatenação.
export function placeholderCode(code:string){return code.replace(expressionPattern(),(_,id)=>'"+String('+expressions[Number(id)].code+')+"').replace(/([^\\])""\+String\(/g,'$1String(').replace(/(String\(phpDate\([^)]*\)\))\+""(?!")/g,'$1').replace(pattern(),(_,id)=>'"+settings.variaveis['+JSON.stringify(names[Number(id)])+']+"').replace(/([^\\])""\+settings\.variaveis/g,'$1settings.variaveis').replace(/(settings\.variaveis\["[\w$]+"\])\+""(?!")/g,'$1');}
export const hasPlaceholder=(text:string)=>pattern().test(text)||expressionPattern().test(text);
