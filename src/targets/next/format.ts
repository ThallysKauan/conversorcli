import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { format, version } from "prettier";

export const formatOptions = {
  tabWidth: 2,
  useTabs: false,
  printWidth: 100,
  singleQuote: false,
  trailingComma: "all" as const,
  endOfLine: "lf" as const,
};
export async function formatSource(file: string, source: string) {
  return format(source, { ...formatOptions, filepath: file });
}

/** Format only editable generated sources; never touch copied public assets. */
export async function formatProject(project: string) {
  const files: string[] = [];
  async function visit(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && /\.(tsx?|json|scss|css)$/.test(entry.name))
        files.push(file);
    }
  }
  await visit(path.join(project, "src"));
  for (const entry of await readdir(project, { withFileTypes: true }))
    if (
      entry.isFile() &&
      /\.(tsx?|json|mjs|md)$/.test(entry.name) &&
      entry.name !== "package-lock.json"
    )
      files.push(path.join(project, entry.name));
  const pkgPath = path.join(project, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
  pkg.devDependencies = { ...pkg.devDependencies, prettier: version };
  pkg.scripts = {
    ...pkg.scripts,
    format: "prettier --write .",
    "format:check": "prettier --check .",
  };
  await writeFile(pkgPath, JSON.stringify(pkg));
  await writeFile(
    path.join(project, ".prettierrc.json"),
    JSON.stringify(formatOptions, null, 2) + "\n",
  );
  await writeFile(
    path.join(project, ".prettierignore"),
    "node_modules/\n.next/\npublic/\npackage-lock.json\n",
  );
  for (const file of files)
    await writeFile(
      file,
      await formatSource(file, await readFile(file, "utf8")),
    );
  return files.length;
}
