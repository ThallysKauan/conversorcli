"use client";
import {useEffect,useMemo,useState} from "react";
import type {ReactNode} from "react";
import {SliderContext} from "./context";
// Índice do slider por translateX da origem, com volta ao início/fim e autoplay opcional.
export default function SliderProvider({total=0,interval=0,children}:{total?:number;interval?:number;children?:ReactNode}){
 const [index,setIndex]=useState(0);
 const go=useMemo(()=>(next:number)=>setIndex(next<0?total-1:next>=total?0:next),[total]);
 useEffect(()=>{if(!interval||total<1)return;const timer=window.setInterval(()=>setIndex(current=>current+1>=total?0:current+1),interval);return ()=>window.clearInterval(timer);},[interval,total]);
 const value=useMemo(()=>({index,go}),[index,go]);
 return <SliderContext.Provider value={value}>{children}</SliderContext.Provider>;
}
