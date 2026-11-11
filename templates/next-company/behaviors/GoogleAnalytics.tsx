import Script from "next/script";
// gtag.js com as configurações encontradas na origem.
export default function GoogleAnalytics({id,configs=[id]}:{id:string;configs?:readonly string[]}){
 return <>
  <Script src={"https://www.googletagmanager.com/gtag/js?id="+encodeURIComponent(id)} strategy="afterInteractive" />
  <Script id={"gtag-"+id} strategy="afterInteractive">{`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());${configs.map(config=>`gtag('config',${JSON.stringify(config)});`).join("")}`}</Script>
 </>;
}
