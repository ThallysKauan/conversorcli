import Script from "next/script";
// Snippet oficial do Google Tag Manager carregado por next/script.
export default function GoogleTagManager({ids=[]}:{ids?:readonly string[]}){
 return <>{ids.map(id=><Script key={id} id={"gtm-"+id} strategy="afterInteractive">{`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer',${JSON.stringify(id)});`}</Script>)}</>;
}
