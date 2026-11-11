import Script from "next/script";
// Snippet oficial do Meta Pixel carregado por next/script.
export default function MetaPixel({ids=[],events=["PageView"]}:{ids?:readonly string[];events?:readonly string[]}){
 const init=ids.map(id=>`fbq('init',${JSON.stringify(id)});`).join("")+events.map(event=>`fbq('track',${JSON.stringify(event)});`).join("");
 return <Script id="meta-pixel" strategy="afterInteractive">{`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');${init}`}</Script>;
}
