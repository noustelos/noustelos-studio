#!/usr/bin/env node
/* Conservative, string-aware CSS minifier for this static site.
   Safe by design: never collapses whitespace inside quoted strings,
   keeps single spaces around calc() operators, preserves !important.
   Usage: node tools/minify-css.js input.css output.css */
const fs = require("fs");

function minify(css) {
  let out = "";
  let i = 0;
  const n = css.length;
  let prevSig = ""; // last significant (non-space) char written
  let pendingSpace = false;

  const isWS = (c) => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f";

  while (i < n) {
    const c = css[i];

    // strings — copy verbatim
    if (c === '"' || c === "'") {
      const quote = c;
      out += c; i++;
      while (i < n) {
        const d = css[i];
        out += d; i++;
        if (d === "\\") { if (i < n) { out += css[i]; i++; } continue; }
        if (d === quote) break;
      }
      prevSig = quote; pendingSpace = false;
      continue;
    }

    // comments — drop
    if (c === "/" && css[i + 1] === "*") {
      i += 2;
      while (i < n && !(css[i] === "*" && css[i + 1] === "/")) i++;
      i += 2;
      continue;
    }

    if (isWS(c)) { pendingSpace = true; i++; continue; }

    // a significant char is about to be written
    const punct = "{}:;,>~+()";
    if (pendingSpace) {
      // keep a space only when it is meaningful (between tokens),
      // i.e. not adjacent to structural punctuation — EXCEPT keep
      // spaces around + ~ > ( ) which can be combinators OR calc ops.
      const keep =
        prevSig !== "" &&
        !"{};,:".includes(prevSig) &&
        !"{};,:".includes(c);
      if (keep) out += " ";
      pendingSpace = false;
    }

    out += c;
    prevSig = c;
    i++;
  }

  // remove last ; before }
  out = out.replace(/;}/g, "}");
  return out.trim();
}

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) { console.error("usage: minify-css.js in out"); process.exit(1); }
const src = fs.readFileSync(inPath, "utf8");
fs.writeFileSync(outPath, minify(src));
console.log(`minified ${inPath} -> ${outPath} (${src.length} -> ${fs.statSync(outPath).size} bytes)`);
