"use client";
import {createElement,useState} from "react";
import type {FormEvent} from "react";
import type {BehaviorProps} from "./context";
// Formulário sem backend migrado: mantém a aparência e bloqueia o envio com aviso.
export default function DisabledForm({as="form",message,children,...rest}:BehaviorProps){
 const [notice,setNotice]=useState("");
 return createElement(as,{...rest,onSubmit:(event:FormEvent)=>{event.preventDefault();setNotice(message);}},children,notice?<p role="alert">{notice}</p>:null);
}
