import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { NativePage, Rules } from "./rules.ts";
import { metadataFrom } from "./rules.ts";
import type { LegacyNode } from "../../validation/legacy.ts";
import {
  hasPlaceholder,
  placeholderCode,
  placeholderValue,
} from "../../conversion/php/placeholders.ts";

export interface SiteVariables {
  values: Record<string, string | number | boolean>;
  missing: string[];
}

export function publicSettings(raw: Record<string, string>, siteUrl: string) {
  const value = (...names: string[]) =>
    names.map((n) => raw[n]).find((v) => typeof v === "string" && v.trim()) ||
    "";
  return {
    title: value("h1", "nomeSite"),
    description: value("description"),
    keywords: value("key"),
    siteName: value("nomeSite"),
    canonical: siteUrl + "/",
    ddd: value("ddd"),
    selosDark: true,
    numeroTelefone: value("telefone"),
    numeroWhatsapp: value("whatsapp"),
    whatsappApi: value("linkWhatsapp"),
    email: value("email"),
    emailDestinatario: value("email"),
    endereco: {
      rua: value("rua", "endereco"),
      numero: value("numero"),
      cidade: value("cidade"),
      estado: value("estado"),
      cep: value("cep"),
      urlMaps: value("urlMaps", "linkMaps"),
      mapaEmbed: value("mapaEmbed", "mapa"),
    },
    robots: value("indexRobots") || "index, follow",
  };
}
export function settingReferences(
  settings: ReturnType<typeof publicSettings>,
  variables: SiteVariables["values"] = {},
) {
  const refs: Record<string, string> = {};
  for (const name of [
    "siteName",
    "numeroTelefone",
    "numeroWhatsapp",
    "whatsappApi",
    "email",
  ] as const) {
    const value = settings[name];
    if (value.length > 3 && !refs[value]) refs[value] = "settings." + name;
  }
  if (settings.email)
    refs["mailto:" + settings.email] = '"mailto:" + settings.email';
  // Textos idênticos a variáveis do arquivo de configurações passam a ler settings.variaveis.
  for (const [name, value] of Object.entries(variables))
    if (typeof value === "string" && value.trim().length > 3 && !refs[value])
      refs[value] = "settings.variaveis[" + JSON.stringify(name) + "]";
  return refs;
}
// Preserve the page shell and headings; replace the source's sitemap lists only.
export function prepareSiteMap(doc: LegacyNode) {
  let replaced = false;
  function walk(node: LegacyNode) {
    node.children = node.children.filter(
      (c) =>
        typeof c === "string" ||
        !String(c.props.className || "")
          .split(/\s+/)
          .includes("menuList"),
    );
    for (const child of node.children) {
      if (typeof child === "string") continue;
      if (
        String(child.props.className || "")
          .split(/\s+/)
          .includes("sitemapList")
      ) {
        child.tag = "react:SiteMapLinks";
        child.children = [];
        replaced = true;
      } else walk(child);
    }
  }
  walk(find(doc, "main") || find(doc, "body") || doc);
  if (!replaced) {
    const main = find(doc, "main") || find(doc, "body");
    main?.children.push({ tag: "react:SiteMapLinks", props: {}, children: [] });
  }
}
function find(node: LegacyNode, tag: string): LegacyNode | undefined {
  if (node.tag === tag) return node;
  for (const child of node.children)
    if (typeof child !== "string") {
      const result = find(child, tag);
      if (result) return result;
    }
}
export function pageCatalog(pages: NativePage[]) {
  return pages
    .filter((p) => p.status === 200)
    .map((p) => {
      const head = find(p.desktop, "head");
      const meta = metadataFrom(
        (head?.children || []).filter(
          (n): n is LegacyNode => typeof n !== "string",
        ),
      );
      const heading = find(p.desktop, "h1");
      const title = String(meta.title || p.route);
      return {
        route: p.route,
        contratada: p.route.slice(1),
        title,
        palavra: heading
          ? heading.children
              .filter((c) => typeof c === "string")
              .join("")
              .trim() || title
          : title,
        description: String(meta.description || ""),
        keywords: String(meta.keywords || ""),
        indexable: !/(?:^|[\s,])(noindex|none)(?:$|[\s,])/i.test(
          String(meta.robots || ""),
        ),
      };
    });
}

export async function writeSiteStructure(
  project: string,
  pages: NativePage[],
  rules: Rules,
  settings: ReturnType<typeof publicSettings>,
  variables: SiteVariables = { values: {}, missing: [] },
) {
  const put = async (file: string, code: string) => {
    await mkdir(path.dirname(path.join(project, file)), { recursive: true });
    await writeFile(path.join(project, file), code);
  };
  const alias = (file: string) =>
    "@/" + file.replace(/^src\//, "").replace(/\.tsx?$/, "");
  const settingsImport = JSON.stringify(alias(rules.mappings.siteSettings));
  const dataImport = JSON.stringify(alias(rules.mappings.catalogData));
  await put(
    rules.mappings.siteSettings,
    `// Configurações públicas compartilhadas. Credenciais ficam somente no .env.
export const url=(process.env.NEXT_PUBLIC_SITE_URL || ${JSON.stringify(settings.canonical)}).replace(/\\/+$/, '')+'/';
// Variáveis PHP sem valor na origem que aparecem como texto: trocar o placeholder pelo valor real.
const preencher=${JSON.stringify(placeholderValue)};
// Variáveis do arquivo de configurações da origem, com os valores do site no ar.
const variaveis={${[...Object.entries(variables.values).map(([name, value]) => JSON.stringify(name) + ":" + JSON.stringify(value)), ...variables.missing.map((name) => JSON.stringify(name) + ":preencher")].join(",")}};
export const settings={...${JSON.stringify(settings)},variaveis,canonical:url,openGraph:{url,siteName:${JSON.stringify(settings.siteName)},locale:'pt_BR'}};
`,
  );
  // date() impresso nas páginas é calculado na requisição por este utilitário.
  await put(
    path.posix.join(path.posix.dirname(rules.mappings.siteSettings), "date.ts"),
    await readFile(new URL("../../conversion/php/date.ts", import.meta.url), "utf8"),
  );
  const catalog = pageCatalog(pages);
  const hasMap = pages.some((p) => p.route === "/mapa-site");
  if (!hasMap)
    catalog.push({
      route: "/mapa-site",
      contratada: "mapa-site",
      title: "Mapa do Site",
      palavra: "Mapa do Site",
      description: "Páginas disponíveis neste site.",
      keywords: "",
      indexable: true,
    });
  const catalogCode = JSON.stringify(catalog);
  await put(
    rules.mappings.catalogData,
    (hasPlaceholder(catalogCode) ? "import {settings} from " + settingsImport + ";\n" : "") +
      `export interface SitePage {route:string;contratada:string;title:string;palavra:string;description:string;keywords:string;indexable:boolean}
// Somente páginas geradas; erros 404 e exclusões não entram nesta lista.
export const pagesData:SitePage[]=${placeholderCode(catalogCode)};
export default pagesData;
`,
  );
  await put(
    "src/components/behaviors/SiteMapLinks.tsx",
    `import Link from 'next/link';
import pagesData from ${dataImport};
export default function SiteMapLinks({className='sitemapList'}:{className?:string}){return <ul className={className}>{pagesData.map(page=><li key={page.route}><Link href={page.route}>{page.palavra}</Link></li>)}</ul>;}
`,
  );
  if (!hasMap)
    await put(
      path.posix.join(rules.mappings.pages, "mapa-site/page.tsx"),
      `import SiteMapLinks from '@/components/behaviors/SiteMapLinks';
export const metadata={title:'Mapa do Site'};
export default function MapaSitePage(){return <main><h1>Mapa do Site</h1><SiteMapLinks /></main>;}
`,
    );
  await put(
    "src/app/sitemap.xml/route.ts",
    `import pagesData from ${dataImport};
import {url} from ${settingsImport};
const escapeXml=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
export function GET(){const locations=pagesData.filter(page=>page.indexable).map(page=>'<url><loc>'+escapeXml(new URL(page.route,url).href)+'</loc></url>').join('\\n');return new Response('<?xml version="1.0" encoding="UTF-8"?>\\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\\n'+locations+'\\n</urlset>',{headers:{'Content-Type':'application/xml; charset=utf-8'}});}
`,
  );
  await put(
    "src/app/robots.ts",
    `import type {MetadataRoute} from 'next';
import {url} from ${settingsImport};
export default function robots():MetadataRoute.Robots{return {rules:{userAgent:'*',allow:'/',disallow:['/api/']},sitemap:new URL('sitemap.xml',url).href};}
`,
  );
  let env = "";
  try {
    env = await readFile(path.join(project, ".env.example"), "utf8");
  } catch {}
  env =
    "NEXT_PUBLIC_SITE_URL=" + JSON.stringify(settings.canonical) + "\n" + env;
  await put(".env.example", env);
  await put(".env", env);
  let ignore = "";
  try {
    ignore = await readFile(path.join(project, ".gitignore"), "utf8");
  } catch {}
  if (!ignore.includes(".env*"))
    await put(".gitignore", ignore + "\n.env*\n!.env.example\n");
  return { catalog, generatedMap: !hasMap };
}
