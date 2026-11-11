"use client";
import {createElement,useState} from "react";
import type {BehaviorProps} from "./context";
type Style=Record<string,string>;
// onmouseover/onmouseout com this.style.x = "valor": os valores ficam no estilo inline; "" remove a propriedade, como no DOM.
export default function HoverStyle({as="div",hoverStyle,leaveStyle,style,children,...rest}:BehaviorProps){
 const [current,setCurrent]=useState<Style>({});
 const apply=(changes?:Style)=>{if(changes)setCurrent(previous=>({...previous,...changes}));};
 const merged:Style={...style,...current};for(const key of Object.keys(merged))if(merged[key]==="")delete merged[key];
 return createElement(as,{...rest,style:merged,onMouseOver:()=>apply(hoverStyle),onMouseOut:()=>apply(leaveStyle)},children);
}
