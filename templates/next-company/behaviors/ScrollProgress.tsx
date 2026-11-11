"use client";
import {createElement,useEffect,useRef} from "react";
import type {BehaviorProps} from "./context";
// Indicadores ligados à porcentagem rolada: traço do círculo, anel por offset, texto, largura ou classes.
export default function ScrollProgress({as="circle",mode="dasharray",radius=20,above=5,on="visible",off="hidden",children,...rest}:BehaviorProps){
 const ref=useRef<HTMLElement&SVGElement>(null);
 useEffect(()=>{
  const element=ref.current;if(!element)return;const circumference=2*Math.PI*radius;
  if(mode==="dashoffset")element.style.strokeDasharray=String(circumference);
  const update=()=>{
   const root=document.documentElement;const total=root.scrollHeight-root.clientHeight;
   if(mode==="dasharray"){element.style.strokeDasharray=`${circumference*((root.scrollTop+document.body.scrollTop)/total)} ${circumference}`;return;}
   if(mode==="width"){element.style.width=((root.scrollTop||document.body.scrollTop)/total)*100+"%";return;}
   if(total<=0)return;const percent=Math.round((window.scrollY/total)*100);
   if(mode==="dashoffset")element.style.strokeDashoffset=String(circumference-(percent/100)*circumference);
   else if(mode==="text")element.innerText=`${percent}%`;
   else{element.classList.toggle(on,percent>above);element.classList.toggle(off,percent<=above);}
  };
  update();window.addEventListener("scroll",update,{passive:true});window.addEventListener("resize",update);
  return ()=>{window.removeEventListener("scroll",update);window.removeEventListener("resize",update);};
 },[mode,radius,above,on,off]);
 return createElement(as,{...rest,ref},children);
}
