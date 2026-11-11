"use client";
import {useEffect} from "react";
type Props={slides:string;prev:string;next:string;container:string;track:string;classes:{active:string;prev:string;next:string};gap:number;iframeQuery?:string};
// Carrossel com classes ativo/anterior/próximo e trilho centralizado por translateX; o iframe do slide ativo
// recebe data-src + iframeQuery e os demais ficam sem src (vídeo pausado), como no script original.
export default function CenteredCarousel({slides,prev,next,container,track,classes,gap,iframeQuery}:Props){
 const {active,prev:before,next:after}=classes;
 useEffect(()=>{
  const items=[...document.querySelectorAll<HTMLElement>(slides)];const back=document.querySelector(prev),forward=document.querySelector(next);
  if(!items.length||!back||!forward)return;
  const total=items.length;let index=0;
  const update=()=>{
   items.forEach((slide,i)=>{
    slide.classList.remove(active,before,after);const iframe=iframeQuery===undefined?null:slide.querySelector("iframe");if(iframe)iframe.src="";
    if(i===index){slide.classList.add(active);if(iframe)iframe.src=String(iframe.getAttribute("data-src"))+iframeQuery;}
    else if(i===(index-1+total)%total)slide.classList.add(before);
    else if(i===(index+1)%total)slide.classList.add(after);
   });
   const width=items[0].offsetWidth+gap;const box=document.querySelector<HTMLElement>(container),list=document.querySelector<HTMLElement>(track);if(!box||!list)return;
   list.style.transform="translateX("+(-index*width+(box.offsetWidth-width)/2)+"px)";
  };
  const previous=()=>{index=(index-1+total)%total;update();},following=()=>{index=(index+1)%total;update();};
  back.addEventListener("click",previous);forward.addEventListener("click",following);window.addEventListener("resize",update);update();
  return ()=>{back.removeEventListener("click",previous);forward.removeEventListener("click",following);window.removeEventListener("resize",update);};
 },[slides,prev,next,container,track,active,before,after,gap,iframeQuery]);
 return null;
}
