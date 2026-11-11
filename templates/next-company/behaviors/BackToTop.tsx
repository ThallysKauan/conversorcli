"use client";
import {createElement,useEffect,useRef} from "react";
import type {MouseEvent} from "react";
import {nextFrame} from "./context";
import type {BehaviorProps} from "./context";
const swing=(p:number)=>0.5-Math.cos(p*Math.PI)/2;
// Mesmo critério do jQuery para o display exibido por fadeIn.
function defaultDisplay(tag:string){const probe=document.createElement(tag);document.body.appendChild(probe);const value=getComputedStyle(probe).display;probe.remove();return value==="none"?"block":value;}
function fade(element:HTMLElement&{fadeToken?:symbol},show:boolean,duration:number,display:string){
 const hidden=getComputedStyle(element).display==="none";
 if(show&&!hidden&&!element.fadeToken)return;if(!show&&hidden)return;
 const token=Symbol(),start=performance.now(),from=hidden?0:Number(getComputedStyle(element).opacity||1);element.fadeToken=token;
 if(show)element.style.display=display;
 const step=(now:number)=>{
  if(element.fadeToken!==token)return;const p=duration?Math.min(1,(now-start)/duration):1;
  element.style.opacity=String(show?from+(1-from)*swing(p):from*(1-swing(p)));
  if(p<1){nextFrame(step);return;}
  element.style.opacity="";element.fadeToken=undefined;if(!show)element.style.display="none";
 };
 nextFrame(step);
}
// Botão exibido após rolagem (fadeIn/fadeOut) que anima a volta ao topo.
export default function BackToTop({as="button",showAfter,fadeIn=400,fadeOut=400,scrollDuration,children,...rest}:BehaviorProps){
 const ref=useRef<HTMLElement>(null);
 useEffect(()=>{
  const element=ref.current;if(!element||showAfter===undefined)return;const display=defaultDisplay(element.tagName);
  const update=()=>{const show=window.scrollY>showAfter;fade(element,show,show?fadeIn:fadeOut,display);};
  window.addEventListener("scroll",update,{passive:true});return ()=>window.removeEventListener("scroll",update);
 },[showAfter,fadeIn,fadeOut]);
 const onClick=scrollDuration===undefined?undefined:(event:MouseEvent)=>{
  event.preventDefault();const start=performance.now(),from=window.scrollY;
  const step=(now:number)=>{const p=Math.min(1,(now-start)/scrollDuration);window.scrollTo(0,from*(1-swing(p)));if(p<1)nextFrame(step);};
  nextFrame(step);
 };
 return createElement(as,{...rest,ref,onClick},children);
}
