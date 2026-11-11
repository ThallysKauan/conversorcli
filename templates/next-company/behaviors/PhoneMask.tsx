"use client";
import {createElement} from "react";
import type {FormEvent} from "react";
import type {BehaviorProps} from "./context";
// Mesma máscara de mtel() da origem: (11) 91234-5678.
const mask=(value:string)=>value.replace(/\D/g,"").replace(/^(\d{2})(\d)/,"($1) $2").replace(/(\d)(\d{4})$/,"$1-$2");
export default function PhoneMask({as="input",children,...rest}:BehaviorProps){
 return createElement(as,{...rest,onInput:(event:FormEvent<HTMLInputElement>)=>{const input=event.currentTarget;input.value=mask(input.value);}},children);
}
