"use client";
import {useEffect} from "react";
// Barra de rolagem personalizada do body, antes iniciada por scroll.js com OverlayScrollbarsGlobal.
// O CSS da biblioteca continua vindo das folhas de estilo da origem.
export default function CustomScrollbars({options}:{options?:Record<string,unknown>}){
 useEffect(()=>{
  let instance:{destroy:()=>void}|undefined,cancelled=false;
  void import("overlayscrollbars").then(({OverlayScrollbars})=>{if(!cancelled)instance=OverlayScrollbars(document.body,(options||{}) as never);});
  return ()=>{cancelled=true;instance?.destroy();};
 },[options]);
 return null;
}
