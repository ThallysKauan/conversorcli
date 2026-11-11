"use client";
import {useId,useState} from "react";
import type {ComponentProps,FormEvent} from "react";
import {FormDataSchema,parseOriginalForm} from "@/schemas/form";
import type {z} from "zod";
import styles from "./ContactForm.module.scss";
type Values=z.infer<typeof FormDataSchema>;
const empty:Values={nome:"",email:"",empresa:"",telefone:"",como_nos_conheceu:"",mensagem:""};
const siteKey=process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY||"";
type Captcha={ready:(fn:()=>void)=>void;execute:(key:string,options:{action:string})=>Promise<string>};
let captchaLoading:Promise<void>|undefined;
function loadCaptcha(){
 if(!siteKey)return Promise.resolve();
 if(!captchaLoading)captchaLoading=new Promise<void>((resolve,reject)=>{const script=document.createElement("script");script.src="https://www.google.com/recaptcha/api.js?render="+encodeURIComponent(siteKey);script.async=true;script.onload=()=>resolve();script.onerror=()=>{captchaLoading=undefined;reject(new Error("Não foi possível carregar a verificação."));};document.head.appendChild(script);});
 return captchaLoading;
}
type Props=Omit<ComponentProps<"form">,"onSubmit">&{variation?:"contatoForm"|"contatoFormIncluded"};
async function captchaToken(){
 if(!siteKey)return "";
 await loadCaptcha();const captcha=(window as unknown as {grecaptcha?:Captcha}).grecaptcha;if(!captcha)throw new Error("Verificação indisponível.");
 await new Promise<void>(resolve=>captcha.ready(resolve));return captcha.execute(siteKey,{action:"submit"});
}
// Com children, mantém a marcação original do site e só assume o envio; sem children, usa o formulário do template.
export default function ContactForm({variation="contatoForm",children,...form}:Props){
 const id=useId();const [formData,setFormData]=useState<Values>({...empty});const [message,setMessage]=useState("");const [loading,setLoading]=useState(false);
 const loadRecaptcha=()=>{void loadCaptcha().catch(()=>{});};
 async function handleSubmit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(loading)return;setLoading(true);setMessage("");
  try{
   const parsed=FormDataSchema.safeParse(formData);if(!parsed.success){setMessage(parsed.error.issues[0]?.message||"Revise os campos.");return;}
   const recaptchaToken=await captchaToken();
   const response=await fetch("/api/send-email",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...parsed.data,recaptchaToken})});
   const data=await response.json();if(!response.ok)throw new Error(data.error||"Não foi possível enviar.");setMessage(data.message||"Mensagem enviada com sucesso.");setFormData({...empty});
  }catch(error){setMessage(error instanceof Error?error.message:"Não foi possível enviar. Tente novamente.");}finally{setLoading(false);}
 }
 async function handleOriginalSubmit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(loading)return;const target=e.currentTarget;setLoading(true);setMessage("");
  try{
   const fields:Record<string,string>={};const form=new FormData(target);let files=false;
   form.forEach((value,name)=>{if(typeof value==="string")fields[name]=fields[name]?fields[name]+", "+value:value;else if(value.size)files=true;});
   const parsed=parseOriginalForm(fields);if(!parsed.success){setMessage(parsed.error.issues[0]?.message||"Revise os campos.");return;}
   const recaptchaToken=await captchaToken();
   // Com arquivo (ex.: currículo) o envio é multipart; sem arquivo, JSON.
   if(files){form.set("_form","original");form.set("recaptchaToken",recaptchaToken);}
   const response=await fetch("/api/send-email",files?{method:"POST",body:form}:{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...fields,_form:"original",recaptchaToken})});
   const data=await response.json();if(!response.ok)throw new Error(data.error||"Não foi possível enviar.");setMessage(data.message||"Mensagem enviada com sucesso.");target.reset();
  }catch(error){setMessage(error instanceof Error?error.message:"Não foi possível enviar. Tente novamente.");}finally{setLoading(false);}
 }
 if(children!==undefined)return (
    <form {...form} data-contact-form="true" onSubmit={handleOriginalSubmit} onFocusCapture={loadRecaptcha} aria-busy={loading}>
      {children}
      {message && <p role="status" aria-live="polite" className={styles.formSuccess}>{message}</p>}
    </form>
  );
  return (
    <form data-contact-form="true" onSubmit={handleSubmit} className={styles[variation]}>
      {message && <p role="status" aria-live="polite" className={styles.formSuccess}>{message}</p>}
      <div className={styles.boxInput}>
        <div className={styles.inputForm}>
          <label htmlFor={id+"-nome"}>Nome <span style={{ color: "red" }}>*</span></label>
          <input
            type="text"
            name="nome"
            id={id+"-nome"}
            placeholder="Nome"
            value={formData.nome}
            onClick={loadRecaptcha}
            onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
            required
          />
        </div>
        <div className={styles.inputForm}>
          <label htmlFor={id+"-email"}>Email <span style={{ color: "red" }}>*</span></label>
          <input
            type="email"
            name="email"
            id={id+"-email"}
            placeholder="Email"
            value={formData.email}
            onClick={loadRecaptcha}
            onChange={(e) =>
              setFormData({ ...formData, email: e.target.value })
            }
            required
          />
        </div>
      </div>
      <div className={styles.boxInput}>
        <div className={styles.inputForm}>
          <label htmlFor={id+"-telefone"}>Telefone <span style={{ color: "red" }}>*</span></label>
          <input
            type="text"
            maxLength={15}
            name="telefone"
            id={id+"-telefone"}
            placeholder="Telefone"
            value={formData.telefone}
            onClick={loadRecaptcha}
            onChange={(e) =>
              setFormData({ ...formData, telefone: e.target.value })
            }
            required
          />
        </div>
        <div className={styles.inputForm}>
          <label htmlFor={id+"-empresa"}>Empresa <span style={{ color: "red" }}>*</span></label>
          <input
            type="text"
            maxLength={200}
            name="empresa"
            id={id+"-empresa"}
            placeholder="Empresa"
            value={formData.empresa}
            onClick={loadRecaptcha}
            onChange={(e) =>
              setFormData({ ...formData, empresa: e.target.value })
            }
            required
          />
        </div>
      </div>
      <div className={styles.inputForm}>
        <label htmlFor={id+"-como_nos_conheceu"}>Como nos conheceu? <span style={{ color: "red" }}>*</span></label>
        <select
          value={formData.como_nos_conheceu}
          onClick={loadRecaptcha}
          name="como_nos_conheceu"
          id={id+"-como_nos_conheceu"}
          onChange={(e) =>
            setFormData({ ...formData, como_nos_conheceu: e.target.value })
          }
          required
        >
          <option value="" disabled>
            Selecione uma opção
          </option>
          <option value="Busca do Google">Busca do Google</option>
          <option value="Outros Buscadores">Outros Buscadores</option>
          <option value="Links Patrocinados">Links patrocinados</option>
          <option value="Facebook">Facebook</option>
          <option value="Twitter">Twitter</option>
          <option value="Indicação de um amigo">Indicação de um amigo</option>
          <option value="Outros">Outros</option>
        </select>
      </div>
      <div className={styles.inputForm}>
        <label htmlFor={id+"-mensagem"}>Mensagem <span style={{ color: "red" }}>*</span></label>
        <textarea
          placeholder="Mensagem"
          id={id+"-mensagem"}
          value={formData.mensagem}
          name="mensagem"
          onClick={loadRecaptcha}
          onChange={(e) =>
            setFormData({ ...formData, mensagem: e.target.value })
          }
          required
        />
      </div>
      <button className={styles.btnSubmit} type="submit" disabled={loading}>
        {loading ? "Enviando..." : "Enviar"}
      </button>
    </form>
  );
}
