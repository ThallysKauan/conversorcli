"use client";
import {createElement,useContext,useEffect,useRef,useState} from "react";
import {TabsContext,nextFrame} from "./context";
import type {BehaviorProps} from "./context";
const swing=(p:number)=>0.5-Math.cos(p*Math.PI)/2;
// Equivalente a slideDown/slideUp do jQuery: anima a altura e oculta com display:none.
export default function TabPanel({as="div",index=0,duration=400,style,children,...rest}:BehaviorProps){
 const {selected}=useContext(TabsContext);const open=selected===index;
 const ref=useRef<HTMLElement>(null);const [hidden,setHidden]=useState(!open);const first=useRef(true);
 useEffect(()=>{
  if(first.current){first.current=false;return;}
  const element=ref.current;if(!element)return;let cancel=()=>{};
  setHidden(false);element.style.display=open?"":element.style.display;
  const from=open?0:element.scrollHeight;element.style.overflow="hidden";element.style.height=from+"px";
  const start=performance.now();
  const step=(now:number)=>{const to=open?element.scrollHeight:0,p=Math.min(1,(now-start)/duration);element.style.height=from+(to-from)*swing(p)+"px";if(p<1)cancel=nextFrame(step);else{element.style.height="";element.style.overflow="";if(!open)setHidden(true);}};
  cancel=nextFrame(step);
  return ()=>cancel();
 },[open,duration]);
 return createElement(as,{...rest,ref,style:hidden?{...style,display:"none"}:style},children);
}
