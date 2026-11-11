import {NextRequest,NextResponse} from "next/server";
import nodemailer from "nodemailer";
import {FormDataSchema,attachmentLimits,fieldLabel,parseOriginalForm} from "@/schemas/form";
export const runtime="nodejs";
const escape=(value:string)=>value.replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]!));
export async function POST(req:NextRequest){
 let body:Record<string,unknown>;const attachments:{filename:string;content:Buffer}[]=[];
 try{
  // Formulário com arquivo (multipart) ou JSON.
  if((req.headers.get("content-type")||"").startsWith("multipart/form-data")){
   const form=await req.formData();body={};
   for(const [name,value] of form.entries()){
    if(typeof value==="string"){body[name]=typeof body[name]==="string"?body[name]+", "+value:value;continue;}
    if(!value.size)continue;
    if(attachments.length>=attachmentLimits.files||value.size>attachmentLimits.bytes)return NextResponse.json({error:"Arquivo muito grande ou em excesso."},{status:413});
    attachments.push({filename:value.name.replace(/[^\w.\- ]/g,"_").slice(0,120)||"anexo",content:Buffer.from(await value.arrayBuffer())});
   }
  }else{const raw=await req.text();if(raw.length>30000)return NextResponse.json({error:"Mensagem muito grande."},{status:413});body=JSON.parse(raw);}
  if(!body||typeof body!=="object"||Array.isArray(body))throw new Error();
 }catch{return NextResponse.json({error:"Dados inválidos."},{status:400});}
 // _form "original": formulário com a marcação do site; campos além dos centrais seguem no email com o nome do campo.
 let rows:[string,string][],replyTo:string|undefined;
 if(body._form==="original"){
  const parsed=parseOriginalForm(body);if(!parsed.success)return NextResponse.json({error:parsed.error.issues[0]?.message||"Revise os campos."},{status:400});
  const {extras,...data}=parsed.data;replyTo=data.email||undefined;
  rows=[...(data.nome?[["Nome",data.nome] as [string,string]]:[]),...(data.email?[["Email",data.email] as [string,string]]:[]),...(data.telefone?[["Telefone",data.telefone] as [string,string]]:[]),...extras.map(([name,value]):[string,string]=>[fieldLabel(name),value]),...(data.mensagem?[["Mensagem",data.mensagem] as [string,string]]:[])];
 }else{
  if(attachments.length)return NextResponse.json({error:"Dados inválidos."},{status:400});
  const parsed=FormDataSchema.safeParse({...body,email:body.email??body.email_form,telefone:body.telefone??body.telefone_form});
  if(!parsed.success)return NextResponse.json({error:parsed.error.issues[0]?.message||"Revise os campos."},{status:400});
  const data=parsed.data;replyTo=data.email;rows=[["Nome",data.nome],["Empresa",data.empresa],["Email",data.email],["Telefone",data.telefone],["Como nos conheceu",data.como_nos_conheceu],["Mensagem",data.mensagem]];
 }
 const env=process.env;const port=Number(env.SMTP_PORT||587);
 if(!env.SMTP_HOST||!env.SMTP_USER||!env.SMTP_PASSWORD||!env.EMAIL_REMETENTE||!env.EMAIL_CONTATO||!Number.isInteger(port)||port<1||port>65535)return NextResponse.json({error:"Envio ainda não configurado. Utilize os outros canais de contato."},{status:503});
 if(env.RECAPTCHA_ENABLED!=="false"){
  if(!env.RECAPTCHA_SECRET)return NextResponse.json({error:"Verificação ainda não configurada."},{status:503});
  const token=body.recaptchaToken??body.recaptcha_response;if(typeof token!=="string"||!token)return NextResponse.json({error:"Conclua a verificação reCAPTCHA."},{status:400});
  try{const response=await fetch("https://www.google.com/recaptcha/api/siteverify",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({secret:env.RECAPTCHA_SECRET,response:token}),signal:AbortSignal.timeout(10000)});const result=await response.json();if(!response.ok||!result.success||result.score<0.5||typeof result.score!=="number"||result.action!=="submit")return NextResponse.json({error:"Falha na verificação reCAPTCHA."},{status:403});}catch{return NextResponse.json({error:"Verificação indisponível. Tente novamente."},{status:503});}
 }
 try{
  const transporter=nodemailer.createTransport({host:env.SMTP_HOST,port,secure:port===465,requireTLS:port!==465,auth:{user:env.SMTP_USER,pass:env.SMTP_PASSWORD},connectionTimeout:10000,socketTimeout:20000});
  await transporter.sendMail({from:env.EMAIL_REMETENTE,to:env.EMAIL_CONTATO,...(env.EMAIL_BCC?{bcc:env.EMAIL_BCC}:{}),...(replyTo?{replyTo}:{}),subject:"Contato via Site - "+(env.SITE_NAME||"Site"),text:rows.map(([label,value])=>label+": "+value).join("\n"),html:"<h2>Contato via site</h2>"+rows.map(([label,value])=>"<p><strong>"+escape(label)+":</strong> "+escape(value)+"</p>").join(""),...(attachments.length?{attachments}:{})});
  return NextResponse.json({message:"Mensagem enviada com sucesso. Aguarde nosso retorno!"});
 }catch{return NextResponse.json({error:"Não foi possível enviar agora. Tente novamente."},{status:502});}
}
