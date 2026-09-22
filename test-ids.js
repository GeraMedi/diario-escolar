// Verifica que todos los IDs usados en app.js existan en index.html
const fs = require("fs");
const path = require("path");
const dir = __dirname;
const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
const js = fs.readFileSync(path.join(dir, "app.js"), "utf8");

const ids = [...new Set([...js.matchAll(/\$\("([A-Za-z0-9_]+)"\)/g)].map((m) => m[1]))];
const faltan = ids.filter((id) => !html.includes(`id="${id}"`));

// IDs declarados en HTML que nunca se usan (informativo)
const htmlIds = [...html.matchAll(/id="([A-Za-z0-9_]+)"/g)].map((m) => m[1]);
const sinUsar = htmlIds.filter((id) => !ids.includes(id));

console.log("IDs usados en app.js:", ids.length);
console.log(faltan.length ? "FALTAN en HTML: " + faltan.join(", ") : "Todos los IDs existen OK");
if (sinUsar.length) console.log("IDs en HTML sin uso (ok si son de otros fines):", sinUsar.join(", "));

process.exit(faltan.length ? 1 : 0);
