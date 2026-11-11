"use client";
import {useEffect} from "react";
// AOS.init da origem com o pacote npm; o CSS continua vindo do <link> original.
export default function AnimateOnScroll({options}:{options?:Record<string,unknown>}){
 useEffect(()=>{let cancelled=false;void import("aos").then(module=>{if(!cancelled)(module.default as {init:(o?:object)=>void}).init(options||{});});return ()=>{cancelled=true;};},[options]);
 return null;
}
