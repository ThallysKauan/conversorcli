import test from 'node:test';
import assert from 'node:assert/strict';
import {legacyDocument} from '../src/validation/legacy.ts';
import {migrateBehaviors} from '../src/targets/next/behaviors.ts';
import {splitStatements,readyBody} from '../src/conversion/js/statements.ts';

const context=(files:Record<string,string>={})=>({entry:'index.php',files:new Set(Object.keys(files)),libraries:[],thirdPartyHosts:['googletagmanager.com'],readSource:async(file:string)=>files[file]});
const find=(node:any,test:(n:any)=>boolean):any=>{if(typeof node==='string')return;if(test(node))return node;for(const child of node.children){const found=find(child,test);if(found)return found;}};
const all=(node:any,test:(n:any)=>boolean,found:any[]=[]):any[]=>{if(typeof node==='string')return found;if(test(node))found.push(node);for(const child of node.children)all(child,test,found);return found;};

test('divisor separa instruções sem ponto e vírgula e desembrulha DOMContentLoaded',()=>{
 const statements=splitStatements("const a = document.querySelector('.a')\nvar b = document.body\nfunction f() {\n a.classList.toggle('x')\n}\n$(function(){ $('.c').slick({ dots: true, }); })");
 assert.equal(statements.length,4);assert.match(readyBody(statements[3])!,/slick/);
 assert.deepEqual(splitStatements('x.replace(/\\D/g, "") // comentário\n.trim(); y()'),['x.replace(/\\D/g, "") \n.trim()','y()']);
});

test('menu com classList.toggle vira estado React e respeita a interrupção do original',async()=>{
 const html=`<html><body><button id="menuControl" onclick="abrirMenu()">m</button><div class="mobileMenu"><a href="/" onclick="abrirMenu()">Home</a></div><script>
 const mobileMenu = document.querySelector('.mobileMenu')
 const menuControl = document.getElementById('menuControl')
 const missing = document.getElementById('nao-existe')
 var body = document.body;
 function abrirMenu() {
  mobileMenu.classList.toggle('activeMobile')
  menuControl.classList.toggle('activeMenubtn')
  missing.classList.toggle('activeMenubtn')
  body.classList.toggle('scrollBlock');
 };</script></body></html>`;
 const {document}=legacyDocument(html,'index.php',new Set(),'https://example.com');const result=await migrateBehaviors(document,context());
 assert.deepEqual(result.pending,[]);
 const button=find(document,n=>n.props.id==='menuControl');assert.equal(button.tag,'react:Interactive');
 const menu=find(document,n=>n.props.className==='mobileMenu');assert.equal(menu.tag,'react:Interactive');
 // A ação no elemento ausente interrompe a função: o body não recebe scrollBlock.
 assert.deepEqual(button.props.handlers[0].actions,[{op:'class',mode:'toggle',key:menu.props.stateKey,name:'activeMobile',initial:false},{op:'class',mode:'toggle',key:button.props.stateKey,name:'activeMenubtn',initial:false}]);
 assert.equal(find(document,n=>n.props.as==='a').props.handlers.length,1);assert.ok(find(document,n=>n.tag==='react:InteractionProvider'));
 assert.equal(all(document,n=>n.tag==='script').length,0);assert.doesNotMatch(JSON.stringify(document),/data-ppnet-events|onclick/);
});

test('openMenu com bindings locais, listeners, forEach, aria e submenu por style.display',async()=>{
 const html=`<html><body><div class="hamburger-lines" onclick="openMenu()"></div><button class="menu-toggle">b</button><nav id="menuMobile"><a href="/">a</a><a href="/b">b</a></nav>
 <a class="phone_click" href="#">fones</a><ul class="fones"><li>1</li></ul><div class="overlay"><div class="box">x</div></div><script>
 document.addEventListener("DOMContentLoaded", function () {
  window.openMenu = function () {
   const menuMobile = document.getElementById("menuMobile");
   const hamburgerLines = document.querySelector(".hamburger-lines");
   hamburgerLines.classList.toggle("active");
   menuMobile.classList.toggle("activeMenu");
   hamburgerLines.setAttribute("aria-expanded", String(menuMobile.classList.contains("activeMenu")));
  };
  const menuButton = document.querySelector(".menu-toggle");
  menuButton.addEventListener("click", function () { this.classList.toggle("opened"); openMenu(); });
  const navLinks = document.getElementById("menuMobile").querySelectorAll("a");
  navLinks.forEach(link => { link.addEventListener("click", () => { document.getElementById("menuMobile").classList.remove("activeMenu"); }); });
 });
 const toggle = document.querySelector('.phone_click')
 const submenu = document.querySelector('.fones')
 toggle.addEventListener('click', (e) => { e.preventDefault(); if (submenu.style.display == 'none') { submenu.style.display = 'block'; } else { submenu.style.display = 'none'; } });
 const overlay = document.querySelector('.overlay')
 overlay.addEventListener('click', function(e) { if (e.target === overlay) { overlay.style.display = 'none'; } });
 </script></body></html>`;
 const {document}=legacyDocument(html,'index.php',new Set(),'https://example.com');const result=await migrateBehaviors(document,context());
 assert.deepEqual(result.pending,[]);
 const lines=find(document,n=>n.props.className==='hamburger-lines'),nav=find(document,n=>n.props.id==='menuMobile'),button=find(document,n=>n.props.className==='menu-toggle');
 assert.deepEqual(lines.props.handlers[0].actions.map((a:any)=>a.name),['active','activeMenu']);assert.deepEqual(lines.props.bindAttrs['aria-expanded'],{key:nav.props.stateKey,className:'activeMenu',initial:false});
 assert.deepEqual(button.props.handlers[0].actions.map((a:any)=>a.name),['opened','active','activeMenu']);
 assert.equal(all(document,n=>n.tag==='react:Interactive'&&n.props.as==='a'&&n.props.handlers?.[0].actions[0].mode==='remove').length,2);
 const phone=find(document,n=>n.props.className==='phone_click');assert.equal(phone.props.handlers[0].preventDefault,true);assert.deepEqual(phone.props.handlers[0].actions[0],{op:'styleToggle',key:find(document,n=>n.props.className==='fones').props.stateKey,prop:'display',when:['none'],then:'block',otherwise:'none',initial:''});
 assert.equal(find(document,n=>n.props.className==='overlay').props.handlers[0].selfOnly,true);
});

test('scrollToTop, abrirModal(this), Escape e classList.toggle forçado por rolagem; script duplicado não se mantém vivo',async()=>{
 const code=`function scrollToTop() { window.scrollTo({ top: 0, behavior: "smooth" }); }
 function abrirModal(img) { document.getElementById("modal").style.display = "block"; document.getElementById("imgModal").src = img.src; }
 const menuMobile = document.getElementById("menuMobile")
 window.closeMenu = function () { if (!menuMobile) return; menuMobile.classList.remove("activeMenu"); document.body.style.overflow = ""; }
 document.addEventListener("keydown", function (event) { if (event.key === "Escape") { window.closeMenu(); } })
 const header = document.getElementById("header")
 function verificarScroll() { if (!header) return; header.classList.toggle("topo-scroll", window.scrollY > 20); }
 window.addEventListener("scroll", verificarScroll)
 verificarScroll()
 function nuncaChamada() { alert(1); }`;
 const html=`<html><head><script>${code}</script></head><body><div id="header">h</div><nav id="menuMobile"></nav><button onclick="scrollToTop()">^</button><img src="/a.webp" onclick="abrirModal(this)"><div id="modal"><img id="imgModal"></div><script>${code}</script></body></html>`;
 const {document}=legacyDocument(html,'index.php',new Set(),'https://example.com');const result=await migrateBehaviors(document,context());
 assert.deepEqual(result.pending,[]);
 assert.deepEqual(find(document,n=>n.props.as==='button').props.handlers[0].actions,[{op:'scroll',top:0,behavior:'smooth'}]);
 const thumb=find(document,n=>n.props.src==='/a.webp');assert.deepEqual(thumb.props.handlers[0].actions.map((a:any)=>a.op+':'+(a.value??a.prop)),['style:block','prop:/a.webp']);
 const provider=find(document,n=>n.tag==='react:InteractionProvider');assert.equal(provider.props.keys[0].key,'Escape');assert.deepEqual(provider.props.keys[0].actions.map((a:any)=>a.op),['class','style']);
 assert.deepEqual(find(document,n=>n.props.id==='header').props.scrollClass,{className:'topo-scroll',addAt:20});
});

test('slider por translateX com botões e autoplay',async()=>{
 const html=`<html><body><div class="hero"><div class="slides-container"><div class="slide">1</div><div class="slide">2</div><div class="slide">3</div></div><button id="prevBtn">&lt;</button><button id="nextBtn">&gt;</button></div><script>
 const slidesContainer = document.querySelector('.slides-container')
 const slides = document.querySelectorAll('.slide')
 const prevBtn = document.getElementById('prevBtn')
 const nextBtn = document.getElementById('nextBtn')
 let currentSlide = 0
 const totalSlides = slides.length
 function goToSlide(index) { if (index < 0) index = totalSlides - 1; else if (index >= totalSlides) index = 0; slidesContainer.style.transform = \`translateX(-\${index * 100}%)\`; currentSlide = index; }
 prevBtn.addEventListener('click', () => goToSlide(currentSlide - 1))
 nextBtn.addEventListener('click', () => goToSlide(currentSlide + 1))
 setInterval(() => goToSlide(currentSlide + 1), 5000)
 </script></body></html>`;
 const {document}=legacyDocument(html,'index.php',new Set(),'https://example.com');const result=await migrateBehaviors(document,context());
 assert.deepEqual(result.pending,[]);
 const provider=find(document,n=>n.tag==='react:SliderProvider');assert.deepEqual(provider.props,{total:3,interval:5000});assert.equal(provider.children[0].props.className,'hero');
 assert.equal(find(document,n=>n.props.id==='nextBtn').props.delta,1);assert.equal(find(document,n=>n.props.id==='prevBtn').props.delta,-1);assert.equal(find(document,n=>n.props.className==='slides-container').tag,'react:SlideTrack');
});

test('IntersectionObserver, AOS, topo por rolagem e setupScrollProgress',async()=>{
 const html=`<html><head><script src="https://unpkg.com/aos@2.3.1/dist/aos.js"></script></head><body><header>t</header><div class="hidden1">a</div><div class="hidden1">b</div>
 <svg><circle id="progressBar"></circle></svg><span id="progressText"></span><button id="scrollButton">^</button><script>
 const observer = new IntersectionObserver((entries) => { Array.from(entries).forEach((entry) => { entry.target.classList.remove("show1"); if (entry.intersectionRatio >= 0.1) { entry.target.classList.add("show1"); } }); }, { threshold: [0, 0.5, 1] });
 Array.from(document.querySelectorAll(".hidden1")).forEach((element) => { observer.observe(element); });
 window.onload = () => { AOS.init({ duration: 1400, offset: 100, }); }
 const header = document.querySelector("header")
 window.addEventListener("scroll", () => { if (window.scrollY > 50) { header.classList.add("scrolled"); } else { header.classList.remove("scrolled"); } })
 function setupScrollProgress({ buttonId, barId, textId, showOnScroll = false }) { const bar = document.getElementById(barId); const text = document.getElementById(textId); function update() { bar.style.strokeDashoffset = 1; text.innerText = '1%'; } }
 setupScrollProgress({ buttonId: "scrollButton", barId: "progressBar", textId: "progressText", showOnScroll: true })
 </script></body></html>`;
 const {document}=legacyDocument(html,'index.php',new Set(),'https://example.com');const result=await migrateBehaviors(document,context());
 assert.deepEqual(result.pending,[]);
 const reveals=all(document,n=>n.tag==='react:Reveal');assert.equal(reveals.length,2);assert.deepEqual({...reveals[0].props,as:undefined,className:undefined},{as:undefined,className:undefined,revealClass:'show1',ratio:0.1,removeOnExit:true,once:false,options:{threshold:[0,0.5,1]}});
 assert.deepEqual(find(document,n=>n.tag==='react:AnimateOnScroll').props.options,{duration:1400,offset:100});assert.equal(result.dependencies.aos,'2.3.1');
 assert.deepEqual(find(document,n=>n.tag==='header').props.scrollClass,{className:'scrolled',addAt:50});
 assert.equal(find(document,n=>n.props.id==='progressBar').props.mode,'dashoffset');assert.equal(find(document,n=>n.props.id==='progressText').props.mode,'text');assert.equal(find(document,n=>n.props.id==='scrollButton').props.mode,'classes');
});

test('topo fixo usa somente o seletor do elemento de referência',async()=>{
 const html=`<html><body><header>T</header><div class="banner">B</div><script>$(document).ready(function () { if ($("header").length) { var topo = $("header"); var janela = $(window);
  function scroll() { topoAltura = $(".banner").outerHeight(); scrollTopAtual = janela.scrollTop(); janelaLargura = janela.width();
   if (scrollTopAtual > topoAltura && janelaLargura > 460) { topo.addClass("topo-scroll"); } else { topo.removeClass("topo-scroll"); } }
  janela.scroll(function () { scroll(); }); } });</script></body></html>`;
 const {document}=legacyDocument(html,'index.php',new Set(),'https://example.com');const result=await migrateBehaviors(document,context());
 assert.deepEqual(result.pending,[]);assert.deepEqual(find(document,n=>n.tag==='header').props.scrollClass,{className:'topo-scroll',afterSelector:'.banner',minWidth:460});
});

test('jQuery, slick, abas, voltar ao topo e analytics viram componentes; o restante é sinalizado',async()=>{
 const html=`<html><head><script async src="https://www.googletagmanager.com/gtag/js?id=G-1"></script><script>window.dataLayer = window.dataLayer || [];function gtag(){dataLayer.push(arguments);}gtag('js', new Date());gtag('config', 'G-1');</script></head><body>
 <div class="wrap"><div class="abas"><span>A</span><span>B</span></div><div class="conteudo"><ul><li>1</li></ul><ul><li>2</li></ul></div></div>
 <div class="cards"><a>1</a><a>2</a></div><button id="topo">^</button><img src="/a.png"><button onclick="desconhecida()">x</button>
 <script src="/libraries/jquery.min.js"></script><script>$(function () {
  if ($(".abas").length && $(".conteudo").length) { var botao = $(".abas span"); var conteudo = $(".conteudo ul"); var i = 0; var anterior = 0; var tempo = 500;
   $(".conteudo ul:gt(0)").hide(); botao.eq(i).addClass("sel");
   botao.click(function () { i = $(this).index(); if (i != anterior) { conteudo.eq(anterior).stop(true, true).slideUp(tempo); conteudo.eq(i).stop(true, true).slideDown(tempo); botao.eq(anterior).removeClass("sel"); botao.eq(i).addClass("sel"); } anterior = i; }); }
  $(window).scroll(function () { if ($(this).scrollTop() > 200) { $("#topo").fadeIn(200); } else { $("#topo").fadeOut(200); } });
  $("#topo").click(function (event) { event.preventDefault(); $("html, body").animate({ scrollTop: 0 }, 300); });
  $(".cards").slick({ arrows: true, slidesToShow: 4, responsive: [ { breakpoint: 401, settings: { slidesToShow: 1, arrows: false, }, }, ], });
  function nunca() { alert(1); }
  document.title = "efeito sem regra";
 });</script></body></html>`;
 const {document}=legacyDocument(html,'index.php',new Set(['libraries/jquery.min.js']),'https://example.com');const result=await migrateBehaviors(document,context());
 assert.equal(find(document,n=>n.props.className==='cards').tag,'react:Carousel');assert.equal(find(document,n=>n.props.className==='cards').props.options.responsive[0].settings.slidesToShow,1);
 assert.deepEqual(find(document,n=>n.props.id==='topo').props,{as:'button',id:'topo',showAfter:200,fadeIn:200,fadeOut:200,scrollDuration:300});
 assert.equal(all(document,n=>n.tag==='react:TabTrigger').length,2);assert.equal(all(document,n=>n.tag==='react:TabPanel')[1].props.index,1);assert.equal(find(document,n=>n.tag==='react:TabsProvider').children[0].props.className,'wrap');
 assert.deepEqual(find(document,n=>n.tag==='react:GoogleAnalytics').props,{id:'G-1',configs:['G-1']});
 assert.equal(all(document,n=>n.tag==='script').length,0);
 const messages=result.pending.map(n=>n.message).join('\n');
 assert.match(messages,/document\.title/);assert.match(messages,/onclick="desconhecida\(\)"/);assert.doesNotMatch(messages,/nunca|slick|scrollTop/);
 assert.ok(result.decisions.some(d=>d.includes('nunca')));
});


test('clique interno preserva stopPropagation e toggle com booleano preserva add/remove',async()=>{
 const html=`<html><body><div id="overlay"><button id="close">Fechar</button></div><script>
 const overlay=document.getElementById('overlay');
 const close=document.getElementById('close');
 overlay.addEventListener('click', function(e){overlay.classList.toggle('opened');});
 close.addEventListener('click', function(e){e.preventDefault();e.stopPropagation();overlay.classList.toggle('opened', false);close.classList.toggle('selected', true);});
 </script></body></html>`;
 const {document}=legacyDocument(html,'index.php',new Set(),'https://example.com');const result=await migrateBehaviors(document,context());
 assert.deepEqual(result.pending,[]);
 const handler=find(document,n=>n.props.id==='close').props.handlers[0];
 assert.equal(handler.preventDefault,true);assert.equal(handler.stopPropagation,true);
 assert.deepEqual(handler.actions.map((a:any)=>({mode:a.mode,name:a.name})),[{mode:'remove',name:'opened'},{mode:'add',name:'selected'}]);
 assert.equal(find(document,n=>n.props.id==='overlay').props.handlers[0].stopPropagation,undefined);
});

test('GSAP com ScrollTrigger do cdnjs vira ScrollTween com o pacote gsap na mesma versão',async()=>{
 const html=`<html><body><div class="headline_produto"><div class="bloco-banner"></div></div><script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js"></script><script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/ScrollTrigger.min.js"></script><script>
 gsap.registerPlugin(ScrollTrigger);
 // Banner encolhe e sobe
 gsap.to(".bloco-banner", {
  scale: 0.6, y: 650, opacity: 1, ease: "power1.out",
  scrollTrigger: { trigger: ".headline_produto", start: "top top", end: "50% top", // <- antes do fim
   scrub: true, pin: true }
 });
 gsap.fromTo('.bloco-banner', {opacity: 0}, {opacity: 1});
 </script></body></html>`;
 const {document}=legacyDocument(html,'index.php',new Set(),'https://example.com');const result=await migrateBehaviors(document,context());
 assert.deepEqual(result.pending,[]);assert.equal(result.dependencies.gsap,'3.12.2');
 const tween=find(document,n=>n.tag==='react:ScrollTween');
 assert.deepEqual(tween.props.tweens,[{method:'to',selector:'.bloco-banner',vars:{scale:0.6,y:650,opacity:1,ease:'power1.out',scrollTrigger:{trigger:'.headline_produto',start:'top top',end:'50% top',scrub:true,pin:true}}},{method:'fromTo',selector:'.bloco-banner',fromVars:{opacity:0},vars:{opacity:1}}]);
 assert.equal(all(document,n=>n.tag==='script'||n.tag==='react:ExternalScript').length,0);
});

test('rotação de classe por setInterval vira ClassRotator; sem elementos, é descartada',async()=>{
 const script=`<script>
 const slides = document.querySelectorAll('.slide');
 let current = 0;
 function nextSlide() {
  slides[current].classList.remove('active');
  current = (current + 1) % slides.length;
  slides[current].classList.add('active');
 }
 setInterval(nextSlide, 5000);
 </script>`;
 let {document}=legacyDocument('<html><body><div class="slide active">1</div><div class="slide">2</div>'+script+'</body></html>','index.php',new Set(),'https://example.com');let result=await migrateBehaviors(document,context());
 assert.deepEqual(result.pending,[]);assert.deepEqual(find(document,n=>n.tag==='react:ClassRotator').props,{selector:'.slide',className:'active',interval:5000});
 ({document}=legacyDocument('<html><body>'+script+'</body></html>','index.php',new Set(),'https://example.com'));result=await migrateBehaviors(document,context());
 assert.deepEqual(result.pending,[]);assert.equal(find(document,n=>n.tag==='react:ClassRotator'),undefined);assert.match(result.decisions.join('\n'),/Rotação de classe em \.slide sem elementos/);
});

test('carrossel centralizado com iframe vira CenteredCarousel; marcação comentada é descartada',async()=>{
 const script=`<script>
 (() => {
  const slides = document.querySelectorAll('.xqvsl_slide_item');
  const btnPrev = document.querySelector('.xqvsl_btn_prev');
  const btnNext = document.querySelector('.xqvsl_btn_next');
  let currentIndex = 0;
  const total = slides.length;
  function updateSlides() {
   slides.forEach((slide, i) => {
    slide.classList.remove('xqvsl_active', 'xqvsl_prev', 'xqvsl_next');
    const iframe = slide.querySelector('iframe');
    // Limpa o src
    if (iframe) {
     iframe.src = '';
    }
    if (i === currentIndex) {
     slide.classList.add('xqvsl_active');
     if (iframe) {
      const baseSrc = iframe.getAttribute('data-src');
      iframe.src = \`\${baseSrc}?autoplay=1&mute=1\`;
     }
    } else if (i === (currentIndex - 1 + total) % total) {
     slide.classList.add('xqvsl_prev');
    } else if (i === (currentIndex + 1) % total) {
     slide.classList.add('xqvsl_next');
    }
   });
   const slideWidth = slides[0].offsetWidth + 20;
   const container = document.querySelector('.xqvsl_slider_container');
   const containerWidth = container.offsetWidth;
   let offset = (containerWidth - slideWidth) / 2;
   const ul = document.querySelector('.xqvsl_slides_list');
   ul.style.transform = \`translateX(\${-currentIndex * slideWidth + offset}px)\`;
  }
  btnPrev.addEventListener('click', () => {
   currentIndex = (currentIndex - 1 + total) % total;
   updateSlides();
  });
  btnNext.addEventListener('click', () => {
   currentIndex = (currentIndex + 1) % total;
   updateSlides();
  });
  window.addEventListener('resize', updateSlides);
  updateSlides();
 })();
 </script>`;
 const markup='<div class="xqvsl_slider_container"><ul class="xqvsl_slides_list"><li class="xqvsl_slide_item"><iframe data-src="https://www.youtube.com/embed/a"></iframe></li><li class="xqvsl_slide_item"></li></ul><button class="xqvsl_btn_prev">&lt;</button><button class="xqvsl_btn_next">&gt;</button></div>';
 let {document}=legacyDocument('<html><body>'+markup+script+'</body></html>','index.php',new Set(),'https://example.com');let result=await migrateBehaviors(document,context());
 assert.deepEqual(result.pending,[]);
 assert.deepEqual(find(document,n=>n.tag==='react:CenteredCarousel').props,{slides:'.xqvsl_slide_item',prev:'.xqvsl_btn_prev',next:'.xqvsl_btn_next',container:'.xqvsl_slider_container',track:'.xqvsl_slides_list',classes:{active:'xqvsl_active',prev:'xqvsl_prev',next:'xqvsl_next'},gap:20,iframeQuery:'?autoplay=1&mute=1'});
 assert.equal(all(document,n=>n.tag==='react:Interactive').length,0);
 ({document}=legacyDocument('<html><body><!-- '+markup+' -->'+script+'</body></html>','index.php',new Set(),'https://example.com'));result=await migrateBehaviors(document,context());
 assert.deepEqual(result.pending,[]);assert.equal(find(document,n=>n.tag==='react:CenteredCarousel'),undefined);assert.match(result.decisions.join('\n'),/original falhava/);
});

test('onmouseover/onmouseout com this.style viram HoverStyle',async()=>{
 const html=`<html><body><a href="/x" style="border:1px solid #fb952f33; transition:transform 0.3s" onmouseover="this.style.transform='translateY(-5px)';this.style.borderColor='#fb952f'" onmouseout="this.style.transform='';this.style.borderColor='#fb952f33'">x</a><a href="/y" onmouseover="abrir(this)">y</a></body></html>`;
 const {document}=legacyDocument(html,'index.php',new Set(),'https://example.com');const result=await migrateBehaviors(document,context());
 const link=find(document,n=>n.props.href==='/x');assert.equal(link.tag,'react:HoverStyle');assert.equal(link.props.as,'a');
 assert.deepEqual(link.props.hoverStyle,{transform:'translateY(-5px)',borderColor:'#fb952f'});assert.deepEqual(link.props.leaveStyle,{transform:'',borderColor:'#fb952f33'});
 assert.equal(result.pending.length,1);assert.match(result.pending[0].message,/abrir\(this\)/);
});
