import Script from "next/script";
// Script de terceiro (widget, rastreador) mantido como dependência externa via next/script.
export default function ExternalScript({src,id}:{src:string;id?:string}){
 return <Script src={src} id={id} strategy="afterInteractive" />;
}
