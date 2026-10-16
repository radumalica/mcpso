// Probe: does components/markdown/index.tsx's configuration (markdown-it defaults + highlight)
// let raw HTML / javascript: links through? Mirrors the component's options exactly.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const MarkdownIt = require("markdown-it");
const md = new MarkdownIt({ highlight: (str) => `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>` });
const probes = {
  raw_script: "<script>alert(1)</script>",
  raw_img_onerror: "<img src=x onerror=alert(1)>",
  js_link: "[click](javascript:alert(1))",
  data_link: "[click](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
  vbscript_link: "[x](vbscript:msgbox(1))",
  image_js: "![x](javascript:alert(1))",
  https_link: "[ok](https://example.com)",
  autolink: "<https://example.com>",
};
console.log("markdown-it version:", require("markdown-it/package.json").version, "| options.html =", md.options.html);
for (const [k, v] of Object.entries(probes)) console.log(k.padEnd(16), JSON.stringify(md.render(v).trim()));
