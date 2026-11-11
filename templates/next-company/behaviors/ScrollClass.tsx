"use client";
import {createElement,useEffect,useState} from "react";
import {joinClasses} from "./context";
import type {BehaviorProps} from "./context";
type Rule={className:string;afterSelector?:string;addAt?:number;removeAt?:number;minWidth?:number};
// Classe aplicada após rolar além de um limite (topo fixo): altura de outro elemento ou pixels, com histerese opcional.
export default function ScrollClass({as="header",scrollClass,className,children,...rest}:BehaviorProps){
 const rule=scrollClass as Rule;const [active,setActive]=useState(false);
 useEffect(()=>{
  const minWidth=rule.minWidth??0;
  const update=()=>{
   const y=window.scrollY,width=document.documentElement.clientWidth;
   const limit=rule.afterSelector!==undefined?document.querySelector<HTMLElement>(rule.afterSelector)?.offsetHeight:rule.addAt;
   const add=limit!==undefined&&y>limit&&width>minWidth;
   setActive(current=>rule.removeAt===undefined?add:!current&&add?true:current&&(y<rule.removeAt||width<=minWidth)?false:current);
  };
  update();window.addEventListener("scroll",update,{passive:true});window.addEventListener("resize",update);
  return ()=>{window.removeEventListener("scroll",update);window.removeEventListener("resize",update);};
 },[rule.afterSelector,rule.addAt,rule.removeAt,rule.minWidth]);
 return createElement(as,{...rest,className:joinClasses(className,active&&rule.className)},children);
}
