"use client";
import {createElement,useEffect,useRef,useState} from "react";
import {joinClasses} from "./context";
import type {BehaviorProps} from "./context";
// Adiciona revealClass quando o elemento entra na tela (IntersectionObserver da origem).
export default function Reveal({as="div",revealClass,ratio=0,removeOnExit=false,once=false,options={},className,children,...rest}:BehaviorProps){
 const ref=useRef<HTMLElement>(null);const [visible,setVisible]=useState(false);
 useEffect(()=>{
  const element=ref.current;if(!element||typeof IntersectionObserver==="undefined")return;
  const observer=new IntersectionObserver(entries=>{for(const entry of entries){const on=ratio>0?entry.intersectionRatio>=ratio:entry.isIntersecting;if(on){setVisible(true);if(once)observer.unobserve(entry.target);}else if(removeOnExit)setVisible(false);}},options);
  observer.observe(element);return ()=>observer.disconnect();
 },[ratio,removeOnExit,once,options]);
 return createElement(as,{...rest,ref,className:joinClasses(className,visible&&revealClass)},children);
}
