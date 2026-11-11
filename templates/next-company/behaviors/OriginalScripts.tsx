"use client";
import {useEffect} from "react";
type Item={src?:string;code?:string;type?:string;id?:string};
type Listener=EventListenerOrEventListenerObject;
// JavaScript da origem sem regra React (three.js, plugins, código próprio): executado como no site, na ordem do documento.
// DOMContentLoaded e load já passaram quando a página hidrata: ouvintes registrados durante a execução são chamados ao fim.
// document.write durante a execução é capturado: o HTML entra no fim do body e os <script> escritos rodam em seguida.
// Eventos inline (onclick="...") chegam como data-evento-onclick e voltam a ser atributos depois dos scripts.
export default function OriginalScripts({items}:{items:readonly Item[]}){
 useEffect(()=>{
  const root=document.documentElement;if(root.dataset.scriptsOrigem===location.pathname)return;root.dataset.scriptsOrigem=location.pathname;
  const late:{target:EventTarget;listener:Listener}[]=[];
  const patch=(target:Window|Document)=>{
   const original=target.addEventListener;
   target.addEventListener=function(this:EventTarget,type:string,listener:Listener|null,options?:boolean|AddEventListenerOptions){
    if((type==="DOMContentLoaded"||type==="load")&&listener){late.push({target:this,listener});return;}
    return original.call(this,type,listener as Listener,options);
   } as typeof original;
   return ()=>{target.addEventListener=original;};
  };
  let written:string[]=[];
  const write=document.write,writeln=document.writeln;
  document.write=(...html:string[])=>{written.push(html.join(""));};document.writeln=(...html:string[])=>{written.push(html.join("")+"\n");};
  const restore=[patch(window),patch(document),()=>{document.write=write;document.writeln=writeln;}];
  const append=(item:Item)=>new Promise<void>(resolve=>{
   const script=document.createElement("script");if(item.type)script.type=item.type;if(item.id)script.id=item.id;
   if(item.src){script.src=item.src;script.async=false;script.onload=script.onerror=()=>resolve();document.body.appendChild(script);return;}
   script.text=item.code||"";document.body.appendChild(script);resolve();
  });
  // HTML escrito por document.write: os scripts dele entram na fila logo após o atual.
  const flush=()=>{
   if(!written.length)return [] as Item[];const template=document.createElement("template");template.innerHTML=written.join("");written=[];
   const scripts=[...template.content.querySelectorAll("script")].map(script=>{script.remove();return {src:script.getAttribute("src")||undefined,code:script.getAttribute("src")?undefined:script.textContent||"",type:script.getAttribute("type")||undefined,id:script.id||undefined};});
   document.body.appendChild(template.content);return scripts;
  };
  void (async()=>{
   const queue=[...items];
   try{while(queue.length){await append(queue.shift()!);queue.unshift(...flush());}}finally{for(const undo of restore)undo();}
   for(const element of document.querySelectorAll<HTMLElement>("*"))for(const attribute of [...element.attributes]){const event=attribute.name.match(/^data-evento-(on[a-z]+)$/)?.[1];if(event)element.setAttribute(event,attribute.value);}
   for(const {target,listener} of late){const event=new Event(target===document?"DOMContentLoaded":"load");if(typeof listener==="function")listener.call(target,event);else listener.handleEvent(event);}
   const onload=window.onload;if(typeof onload==="function")onload.call(window,new Event("load"));
  })();
 },[items]);
 return null;
}
