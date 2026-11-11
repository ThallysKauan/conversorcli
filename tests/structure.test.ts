import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile, readFile, access } from "node:fs/promises";
import path from "node:path";
import { convertSite } from "../src/targets/next/site.ts";

test("sitebase: settings consumido, catálogo de páginas publicadas, SEO e env sem segredos", async () => {
  await mkdir(".work", { recursive: true });
  const root = await mkdtemp(path.resolve(".work/structure-"));
  const source = path.join(root, "source");
  await mkdir(source);
  await writeFile(
    path.join(source, "sitemap.xml"),
    "<urlset><url><loc>https://example.com/</loc></url></urlset>",
  );
  await writeFile(
    path.join(source, "index.php"),
    `<?php $nomeSite='Empresa Teste';$email='contato@example.com';$ddd='11';$telefone='5555-1234';$senha='DO_NOT_EXPORT_TEST_SECRET'; ?><!doctype html><html><head><title>Home</title></head><body><h1><?= $nomeSite ?></h1><a href="mailto:<?= $email ?>"><?= $email ?></a></body></html>`,
  );
  await writeFile(
    path.join(source, "privada.php"),
    '<html><head><title>Privada</title><meta name="robots" content="noindex, follow"></head><body>Privada</body></html>',
  );
  await writeFile(
    path.join(source, "erro.php"),
    "<?php http_response_code(404); ?><html><body>404</body></html>",
  );
  await writeFile(
    path.join(source, "falha.php"),
    "<?php unknown_function(); ?>",
  );
  const out = path.join(root, "out");
  const report = await convertSite(source, out);
  const project = path.join(out, "project");
  const settings = await readFile(
    path.join(project, "src/settings/settings.ts"),
    "utf8",
  );
  assert.match(settings, /siteName: "Empresa Teste"/);
  assert.match(settings, /email: "contato@example.com"/);
  assert.doesNotMatch(settings, /DO_NOT_EXPORT|senha/);
  const home = await readFile(
    path.join(project, "src/app/(paginas)/page.tsx"),
    "utf8",
  );
  assert.match(home, /settings\.email/);
  assert.match(home, /settings\.siteName/);
  const data = await readFile(
    path.join(project, "src/data/pagesData.ts"),
    "utf8",
  );
  assert.match(data, /contratada:/);
  assert.match(data, /indexable: false/);
  assert.doesNotMatch(data, /route: "\/(erro|falha)"/);
  assert.deepEqual(report.siteStructure.indexableRoutes, ["/", "/mapa-site"]);
  for (const file of [
    "src/app/(paginas)/mapa-site/page.tsx",
    "src/app/sitemap.xml/route.ts",
    "src/app/robots.ts",
    ".env",
    ".env.example",
  ])
    await access(path.join(project, file));
  const env = await readFile(path.join(project, ".env"), "utf8");
  assert.match(env, /NEXT_PUBLIC_SITE_URL=/);
  assert.match(env, /SMTP_PASSWORD=\r?\n/);
  assert.doesNotMatch(env, /DO_NOT_EXPORT/);
  assert.match(
    await readFile(path.join(project, ".gitignore"), "utf8"),
    /\.env\*/,
  );
});
