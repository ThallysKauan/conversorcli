"use client";
import {useMemo,useState} from "react";
import type {ReactNode} from "react";
import {TabsContext} from "./context";
export default function TabsProvider({children}:{children?:ReactNode}){
 const [selected,select]=useState(0);
 const value=useMemo(()=>({selected,select}),[selected]);
 return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>;
}
