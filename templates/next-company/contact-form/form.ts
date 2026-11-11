import {z} from "zod";
const core={
 nome:z.string().trim().min(1,"O nome é obrigatório.").max(200),
 email:z.string().trim().email("Email inválido.").max(254),
 telefone:z.string().trim().min(1,"O telefone é obrigatório.").max(40),
 mensagem:z.string().trim().min(1,"A mensagem é obrigatória.").max(10000)
};
export const FormDataSchema=z.object({
 nome:core.nome,
 email:core.email,
 empresa:z.string().trim().min(1,"A empresa é obrigatória.").max(200),
 telefone:core.telefone,
 como_nos_conheceu:z.string().trim().min(1,"Selecione como nos conheceu.").max(200),
 mensagem:core.mensagem
});
// Formulário com a marcação original do site (contato, orçamento, depoimento, trabalhe conosco): ao menos um campo preenchido;
// os demais campos seguem como texto no email.
export const OriginalFormSchema=z.object({
 nome:z.string().trim().max(200),
 email:z.union([z.literal(""),z.string().trim().email("Email inválido.").max(254)]),
 telefone:z.string().trim().max(40),
 mensagem:z.string().trim().max(10000),
 extras:z.array(z.tuple([z.string().regex(/^[\w -]{1,60}$/),z.string().trim().max(2000)])).max(30,"Campos demais.")
}).refine(data=>data.email!==""||data.telefone!==""||data.nome!==""||data.mensagem!==""||data.extras.length>0,{message:"Preencha o formulário antes de enviar."});
const emailFields=["email","email_form","e-mail"],phoneFields=["telefone","telefone_form","fone","phone","tel","celular","whatsapp"];
const reserved=new Set(["nome","name","mensagem","message",...emailFields,...phoneFields,"recaptchaToken","recaptcha_response","g-recaptcha-response","submit","_form"]);
export function parseOriginalForm(body:Record<string,unknown>){
 const pick=(names:string[])=>{for(const name of names){const value=body[name];if(typeof value==="string"&&value.trim())return value;}return "";};
 // Nomes como servicos[] (checkbox múltiplo) viram rótulo simples.
 const extras=Object.entries(body).filter((entry):entry is [string,string]=>!reserved.has(entry[0])&&typeof entry[1]==="string"&&entry[1].trim()!=="").map(([name,value]):[string,string]=>[name.replace(/\[\]$/,"").replace(/[^\w -]/g," ").trim().slice(0,60)||"campo",value]);
 return OriginalFormSchema.safeParse({nome:pick(["nome","name"]),email:pick(emailFields),telefone:pick(phoneFields),mensagem:pick(["mensagem","message"]),extras});
}
export const fieldLabel=(name:string)=>{const text=name.replace(/_form$/,"").replace(/[_-]+/g," ").trim();return text.charAt(0).toUpperCase()+text.slice(1);};
// Anexos (ex.: currículo): até 3 arquivos de 5 MB.
export const attachmentLimits={files:3,bytes:5*1024*1024};
