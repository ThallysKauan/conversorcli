"use client";
import {useEffect} from "react";
type Vars=Record<string,unknown>;
type Tween={method:"to"|"from"|"set"|"fromTo";selector:string;vars:Vars;fromVars?:Vars};
// gsap.to/from/set/fromTo da origem com o pacote npm gsap e o plugin ScrollTrigger; desfeitos ao sair da página.
export default function ScrollTween({tweens}:{tweens:readonly Tween[]}){
 useEffect(()=>{
  let cancelled=false;let context:{revert:()=>void}|undefined;
  void Promise.all([import("gsap"),import("gsap/ScrollTrigger")]).then(([{gsap},{ScrollTrigger}])=>{
   if(cancelled)return;gsap.registerPlugin(ScrollTrigger);
   context=gsap.context(()=>{for(const tween of tweens){if(tween.method==="fromTo")gsap.fromTo(tween.selector,tween.fromVars||{},tween.vars);else gsap[tween.method](tween.selector,tween.vars);}});
  });
  return ()=>{cancelled=true;context?.revert();};
 },[tweens]);
 return null;
}
