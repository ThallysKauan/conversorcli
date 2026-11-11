"use client";
import {useCallback,useEffect,useMemo,useState} from "react";
import type {ReactNode} from "react";
import {InteractionContext} from "./context";
import type {InteractionAction,InteractionState} from "./context";
// Estado das classes/estilos alterados por handlers de clique da origem (classList, style.display).
export function applyActions(state:InteractionState,actions:InteractionAction[]){
 const next={...state};
 for(const action of actions){
  if(action.op==="scroll")continue;
  const current=next[action.key]||{classes:{},style:{}};const item={classes:{...current.classes},style:{...current.style},props:{...current.props}};
  if(action.op==="class"){const value=item.classes[action.name]??action.initial;item.classes[action.name]=action.mode==="toggle"?!value:action.mode==="add";}
  else if(action.op==="style")item.style[action.prop]=action.value;
  else if(action.op==="prop")item.props[action.prop]=action.value??"";
  else{const value=item.style[action.prop]??action.initial;item.style[action.prop]=action.when.includes(value)?action.then:action.otherwise;}
  next[action.key]=item;
 }
 return next;
}
export default function InteractionProvider({keys=[],children}:{keys?:{key:string;actions:InteractionAction[]}[];children?:ReactNode}){
 const [state,setState]=useState<InteractionState>({});
 const dispatch=useCallback((actions:InteractionAction[])=>{
  for(const action of actions)if(action.op==="scroll")window.scrollTo({top:action.top,behavior:(action.behavior as ScrollBehavior)||"auto"});
  setState(current=>applyActions(current,actions));
 },[]);
 // O body não é renderizado pela página: recebe as alterações diretamente.
 useEffect(()=>{const body=state.body;if(!body)return;for(const [name,on] of Object.entries(body.classes))document.body.classList.toggle(name,on);for(const [prop,value] of Object.entries(body.style))(document.body.style as any)[prop]=value;},[state.body]);
 useEffect(()=>{if(!keys.length)return;const onKey=(event:KeyboardEvent)=>{for(const item of keys)if(event.key===item.key)dispatch(item.actions);};document.addEventListener("keydown",onKey);return ()=>document.removeEventListener("keydown",onKey);},[keys,dispatch]);
 const value=useMemo(()=>({state,dispatch}),[state,dispatch]);
 return <InteractionContext.Provider value={value}>{children}</InteractionContext.Provider>;
}
