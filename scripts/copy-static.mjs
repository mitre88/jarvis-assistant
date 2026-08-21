// Copy renderer static assets (html, css) next to the compiled JS.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, "dist", "renderer");
mkdirSync(outDir, { recursive: true });
for (const file of ["index.html", "styles.css"]) {
  copyFileSync(join(root, "src", "renderer", file), join(outDir, file));
}
