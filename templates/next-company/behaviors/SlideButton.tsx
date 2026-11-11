"use client";
import {createElement,useContext} from "react";
import {SliderContext} from "./context";
import type {BehaviorProps} from "./context";
export default function SlideButton({as="button",delta=1,children,...rest}:BehaviorProps){
 const {index,go}=useContext(SliderContext);
 return createElement(as,{...rest,onClick:()=>go(index+delta)},children);
}
