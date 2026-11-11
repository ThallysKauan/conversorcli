"use client";
import {createElement,useContext} from "react";
import {TabsContext,joinClasses} from "./context";
import type {BehaviorProps} from "./context";
export default function TabTrigger({as="span",index=0,selectedClass,className,children,...rest}:BehaviorProps){
 const {selected,select}=useContext(TabsContext);
 return createElement(as,{...rest,className:joinClasses(className,selected===index&&selectedClass),onClick:()=>select(index)},children);
}
