"use client";
import {createElement,useContext} from "react";
import {SliderContext} from "./context";
import type {BehaviorProps} from "./context";
export default function SlideTrack({as="div",style,children,...rest}:BehaviorProps){
 const {index}=useContext(SliderContext);
 return createElement(as,{...rest,style:{...style,transform:`translateX(-${index*100}%)`}},children);
}
