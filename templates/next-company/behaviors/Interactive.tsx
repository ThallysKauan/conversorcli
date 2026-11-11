"use client";
import {createElement,useContext} from "react";
import type {MouseEvent} from "react";
import {InteractionContext,joinClasses} from "./context";
import type {BehaviorProps,InteractionAction} from "./context";
type Handler={actions:InteractionAction[];preventDefault?:boolean;stopPropagation?:boolean;selfOnly?:boolean};
// Elemento alvo e/ou disparador de uma interação migrada.
export default function Interactive({as="div",stateKey,handlers=[],bindAttrs={},className,style,children,...rest}:BehaviorProps){
 const {state,dispatch}=useContext(InteractionContext);const own=state[stateKey];
 const names=new Set(String(className||"").split(/\s+/).filter(Boolean));
 for(const [name,on] of Object.entries(own?.classes||{}))if(on)names.add(name);else names.delete(name);
 const attrs:Record<string,string>={};
 for(const [name,source] of Object.entries(bindAttrs as Record<string,{key:string;className:string;initial:boolean}>))attrs[name]=String(state[source.key]?.classes[source.className]??source.initial);
 const onClick=(handlers as Handler[]).length?(event:MouseEvent)=>{
  for(const handler of handlers as Handler[]){if(handler.selfOnly&&event.target!==event.currentTarget)continue;if(handler.preventDefault)event.preventDefault();if(handler.stopPropagation)event.stopPropagation();dispatch(handler.actions);}
 }:undefined;
 const {textContent,...props}=own?.props||{};
 return createElement(as,{...rest,...props,...attrs,className:joinClasses(...names),style:own?.style&&Object.keys(own.style).length?{...style,...own.style}:style,onClick},textContent!==undefined?textContent:children);
}
