"use client";
import {useEffect} from "react";
// setInterval que tira a classe do item atual e põe no próximo (ex.: banner .slide.active), começando pelo primeiro.
export default function ClassRotator({selector,className,interval}:{selector:string;className:string;interval:number}){
 useEffect(()=>{
  const items=document.querySelectorAll(selector);if(!items.length)return;let current=0;
  const id=window.setInterval(()=>{items[current].classList.remove(className);current=(current+1)%items.length;items[current].classList.add(className);},interval);
  return ()=>window.clearInterval(id);
 },[selector,className,interval]);
 return null;
}
