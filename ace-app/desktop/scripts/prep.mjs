// Copy the self-contained ACE previews into renderer/ so Electron can load them
// (and so they get bundled into the packaged app). Not committed — regenerated.
import { cp, mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, ".."); // ace-app/desktop
const rendererDir = path.resolve(root, "renderer");

const head = path.resolve(root, "../viewer3d/ace-3d.html"); // rigged 3D head
const appUi = path.resolve(root, "../preview.html"); // listen/ask/brain

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

await mkdir(rendererDir, { recursive: true });

if (await exists(head)) await cp(head, path.join(rendererDir, "3d.html"));
else console.warn("⚠ missing viewer3d/ace-3d.html");
if (await exists(appUi)) await cp(appUi, path.join(rendererDir, "app.html"));
else console.warn("⚠ missing preview.html");

const landing = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/><title>ACE</title>
<style>
  *{margin:0;box-sizing:border-box}
  html,body{height:100%}
  body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:30px;
       background:#000;color:#cfe2ff;font-family:ui-monospace,Menlo,monospace}
  h1{font-size:46px;letter-spacing:12px;color:#dbe9ff}
  .row{display:flex;gap:18px;flex-wrap:wrap;justify-content:center}
  a{padding:20px 30px;border:1px solid #2a4a7f;border-radius:16px;background:#0a1424;
    color:#cfe2ff;text-decoration:none;font-size:16px;transition:.15s}
  a:hover{border-color:#3f6fd8;background:#173a6e}
  p{color:#5b7aa8;font-size:12px;letter-spacing:2px}
</style></head><body>
  <h1>ACE</h1>
  <div class="row">
    <a href="3d.html">&#129504;&nbsp; 3D neural head</a>
    <a href="app.html">&#128172;&nbsp; ACE app</a>
  </div>
  <p>AMBIENT COGNITIVE ENGINE</p>
</body></html>`;
await writeFile(path.join(rendererDir, "index.html"), landing);

console.log("✔ renderer ready (index.html, 3d.html, app.html)");
