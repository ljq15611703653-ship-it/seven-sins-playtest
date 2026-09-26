// 把网页 demo 打包成纯静态文件，输出到仓库根目录的 sin-squad-v3/（不进 git；GitHub Actions 在 main 上打包后发布到 Pages）。
import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const web = join(root, "web");
const out = join(root, "..", "sin-squad-v3");
await mkdir(out, { recursive: true });

// 人物立绘：web/art/<人物编号>.webp，打包时把有立绘的编号告诉页面
const artDir = join(web, "art");
const artFiles = (await readdir(artDir).catch(() => [])).filter((f) => f.endsWith(".webp"));
const artIds = artFiles.map((f) => f.replace(/\.webp$/, ""));

const result = await build({
  entryPoints: [join(web, "main.ts")],
  bundle: true,
  format: "esm",
  target: "es2020",
  minify: true,
  charset: "utf8",
  legalComments: "none",
  write: false,
  define: { __ART_IDS__: JSON.stringify(artIds) },
});
const js = result.outputFiles[0].contents;
const css = await readFile(join(web, "style.css"));
const version = createHash("sha256").update(js).update(css).digest("hex").slice(0, 10);
const html = (await readFile(join(web, "index.html"), "utf8")).replaceAll("__VERSION__", version);

await writeFile(join(out, "app.js"), js);
await writeFile(join(out, "style.css"), css);
await writeFile(join(out, "index.html"), html);
await mkdir(join(out, "art"), { recursive: true });
for (const f of artFiles) await copyFile(join(artDir, f), join(out, "art", f));

// 背景音乐：web/audio/<曲名>.mp3（曲名见 web/music.ts）
const audioDir = join(web, "audio");
const audioFiles = (await readdir(audioDir).catch(() => [])).filter((f) => f.endsWith(".mp3"));
await mkdir(join(out, "audio"), { recursive: true });
for (const f of audioFiles) await copyFile(join(audioDir, f), join(out, "audio", f));
console.log(`已输出到 ${out}（版本 ${version}，app.js ${(js.length / 1024).toFixed(1)} KB，立绘 ${artIds.length} 张，音乐 ${audioFiles.length} 首）`);
