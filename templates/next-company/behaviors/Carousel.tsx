"use client";
import {Children,cloneElement,createElement,isValidElement,useCallback,useEffect,useRef,useState} from "react";
import type {CSSProperties,PointerEvent,ReactElement,ReactNode} from "react";
import {joinClasses} from "./context";
import type {BehaviorProps} from "./context";
// Carrossel com a mesma marcação e classes do slick 1.8, para reaproveitar o CSS da origem.
type Settings={slidesToShow:number;slidesToScroll:number;infinite:boolean;arrows:boolean;dots:boolean;speed:number;autoplay:boolean;autoplaySpeed:number;fade:boolean;pauseOnHover:boolean;draggable:boolean;swipe:boolean;cssEase:string};
const defaults:Settings={slidesToShow:1,slidesToScroll:1,infinite:true,arrows:true,dots:false,speed:500,autoplay:false,autoplaySpeed:3000,fade:false,pauseOnHover:true,draggable:true,swipe:true,cssEase:"ease"};
// Mesma escolha do slick (mobileFirst=false): menor breakpoint maior que a largura da janela.
function resolve(options:BehaviorProps,width?:number):Settings{
 const {responsive=[],...base}=options||{};let settings={...defaults,...base} as Settings;
 if(width!==undefined){const target=(responsive as {breakpoint:number;settings:Partial<Settings>}[]).filter(item=>width<item.breakpoint).sort((a,b)=>a.breakpoint-b.breakpoint)[0];if(target&&typeof target.settings==="object")settings={...settings,...target.settings};}
 if(settings.fade)settings.slidesToShow=1;
 return settings;
}
function slide(child:ReactNode,key:string,clone:boolean):ReactNode{
 const element=child as ReactElement<{style?:CSSProperties;id?:string}>;
 const style:CSSProperties={width:"100%",display:"inline-block"};
 if(isValidElement(element)&&typeof element.type==="string")return cloneElement(element,{key,style:{...style,...element.props.style},...(clone?{id:undefined}:{})});
 return <div key={key} style={style}>{child}</div>;
}
export default function Carousel({as="div",options={},className,children,...rest}:BehaviorProps){
 const items=Children.toArray(children).filter(isValidElement);const count=items.length;
 const [width,setWidth]=useState<number>();const [current,setCurrent]=useState(0);const [animate,setAnimate]=useState(false);const [paused,setPaused]=useState(false);
 const settings=resolve(options,width);const {slidesToShow:show,slidesToScroll:scroll,infinite,speed,fade}=settings;
 const active=count>show;const clones=infinite&&!fade&&active?show:0;const total=count+clones*2;
 const busy=useRef(false);const drag=useRef<number|undefined>(undefined);
 useEffect(()=>{const update=()=>setWidth(document.documentElement.clientWidth);update();window.addEventListener("resize",update);return ()=>window.removeEventListener("resize",update);},[]);
 useEffect(()=>{if(!infinite&&current>Math.max(0,count-show))setCurrent(Math.max(0,count-show));},[infinite,current,count,show]);
 const go=useCallback((target:number)=>{
  if(busy.current||!active)return;
  if(!infinite)target=Math.max(0,Math.min(target,count-show));
  if(fade){setCurrent(((target%count)+count)%count);return;}
  busy.current=true;setAnimate(true);setCurrent(target);
  window.setTimeout(()=>{busy.current=false;setAnimate(false);setCurrent(value=>((value%count)+count)%count);},speed);
 },[active,infinite,count,show,fade,speed]);
 useEffect(()=>{if(!settings.autoplay||paused||!active)return;const timer=window.setInterval(()=>go(current+scroll),settings.autoplaySpeed);return ()=>window.clearInterval(timer);},[settings.autoplay,settings.autoplaySpeed,paused,active,go,current,scroll]);
 const prevDisabled=!infinite&&current<=0,nextDisabled=!infinite&&current>=count-show;
 const dotCount=!active?0:infinite?Math.ceil(count/scroll):Math.ceil((count-show)/scroll)+1;
 const normalized=((current%count)+count)%count;
 const slides:ReactNode[]=[];
 const pushSlide=(child:ReactNode,index:number,key:string,clone:boolean)=>{
  const isActive=!clone&&index>=current&&index<current+show;
  const style:CSSProperties=fade?{width:100/count+"%",position:"relative",left:-(index*100/count)+"%",top:0,zIndex:index===normalized?999:998,opacity:index===normalized?1:0,transition:`opacity ${speed}ms ${settings.cssEase}`}:{width:100/total+"%"};
  slides.push(<div key={key} className={joinClasses("slick-slide",clone&&"slick-cloned",(fade?index===normalized:isActive)&&"slick-active",index===normalized&&!clone&&"slick-current")} data-slick-index={index} aria-hidden={!(fade?index===normalized:isActive)} tabIndex={-1} style={style}><div>{slide(child,key+"-item",clone)}</div></div>);
 };
 for(let i=clones;i>0;i--)pushSlide(items[count-i],-i,"clone-start-"+i,true);
 items.forEach((child,index)=>pushSlide(child,index,"slide-"+index,false));
 for(let i=0;i<clones;i++)pushSlide(items[i],count+i,"clone-end-"+i,true);
 const trackStyle:CSSProperties=fade?{opacity:1,width:count*100+"%"}:{opacity:1,width:total*100/show+"%",transform:`translate3d(${-(current+clones)*100/total}%, 0px, 0px)`,transition:animate?`transform ${speed}ms ${settings.cssEase}`:undefined};
 const start=(event:PointerEvent)=>{if(!settings.swipe||(event.pointerType==="mouse"&&!settings.draggable))return;drag.current=event.clientX;};
 const end=(event:PointerEvent)=>{if(drag.current===undefined)return;const delta=event.clientX-drag.current,limit=(event.currentTarget as HTMLElement).offsetWidth/5;drag.current=undefined;if(Math.abs(delta)>limit)go(current+(delta<0?scroll:-scroll));};
 return createElement(as,{...rest,className:joinClasses(className,"slick-initialized","slick-slider",settings.dots&&dotCount>0&&"slick-dotted"),onMouseEnter:settings.pauseOnHover?()=>setPaused(true):undefined,onMouseLeave:settings.pauseOnHover?()=>setPaused(false):undefined},
  settings.arrows&&active?<button key="prev" className={joinClasses("slick-prev","slick-arrow",prevDisabled&&"slick-disabled")} aria-label="Previous" type="button" aria-disabled={prevDisabled} onClick={()=>go(current-scroll)}>Previous</button>:null,
  <div key="list" className={joinClasses("slick-list",settings.draggable&&"draggable")} onPointerDown={start} onPointerUp={end} onPointerCancel={()=>{drag.current=undefined;}}><div className="slick-track" style={trackStyle}>{slides}</div></div>,
  settings.arrows&&active?<button key="next" className={joinClasses("slick-next","slick-arrow",nextDisabled&&"slick-disabled")} aria-label="Next" type="button" aria-disabled={nextDisabled} onClick={()=>go(current+scroll)}>Next</button>:null,
  settings.dots&&dotCount>0?<ul key="dots" className="slick-dots" role="tablist">{Array.from({length:dotCount},(_,index)=><li key={index} className={Math.floor(normalized/scroll)===index?"slick-active":undefined} role="presentation"><button type="button" role="tab" aria-label={`${index+1} of ${dotCount}`} onClick={()=>go(index*scroll)}>{index+1}</button></li>)}</ul>:null
 );
}
