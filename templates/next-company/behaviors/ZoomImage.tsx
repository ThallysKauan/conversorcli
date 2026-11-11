"use client";
import {createElement,useState} from "react";
import {createPortal} from "react-dom";
import type {BehaviorProps} from "./context";
// Equivalente a openModal(this)/closeModal(): amplia a imagem em #myModal.
export default function ZoomImage({as="img",children,...rest}:BehaviorProps){
 const [open,setOpen]=useState(false);
 return <>
  {createElement(as,{...rest,onClick:()=>setOpen(true)},children)}
  {open&&createPortal(<div id="myModal" className="modal" style={{display:"flex"}} onClick={()=>setOpen(false)}><span className="close">&times;</span><img className="modal-content" id="img01" src={rest.src} alt="" /></div>,document.body)}
 </>;
}
