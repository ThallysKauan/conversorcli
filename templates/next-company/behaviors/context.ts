"use client";
import {createContext} from "react";
// Estado compartilhado pelos componentes gerados a partir de scripts da origem.
export type InteractionAction=
 {op:"class";mode:"toggle"|"add"|"remove";key:string;name:string;initial:boolean}
|{op:"style";key:string;prop:string;value:string}
|{op:"styleToggle";key:string;prop:string;when:string[];then:string;otherwise:string;initial:string}
|{op:"prop";key:string;prop:string;value?:string}
|{op:"scroll";top:number;behavior?:string};
export type InteractionState=Record<string,{classes:Record<string,boolean>;style:Record<string,string>;props?:Record<string,string>}>;
export const InteractionContext=createContext<{state:InteractionState;dispatch:(actions:InteractionAction[])=>void}>({state:{},dispatch:()=>{}});
export const TabsContext=createContext<{selected:number;select:(index:number)=>void}>({selected:0,select:()=>{}});
export const SliderContext=createContext<{index:number;go:(index:number)=>void}>({index:0,go:()=>{}});
export type BehaviorProps={[key:string]:any};
// Como jQuery.fx: requestAnimationFrame com a página visível, setTimeout quando oculta.
export const nextFrame=(step:(now:number)=>void)=>{if(document.hidden){const id=window.setTimeout(()=>step(performance.now()),13);return ()=>window.clearTimeout(id);}const id=requestAnimationFrame(step);return ()=>cancelAnimationFrame(id);};
export const joinClasses=(...names:(string|false|undefined|null)[])=>names.filter(Boolean).join(" ")||undefined;
