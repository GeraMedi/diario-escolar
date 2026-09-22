// Test de exporters.js — valida PDF y DOCX sin librerías externas
const path = require("path");
const fs = require("fs");
const E = require(path.join(__dirname, "exporters.js"));

const registros = [
  {
    fecha: "2026-09-21", hora: "08:15", grupo: "3° A", titulo: "Participación de Lucía y Mateo",
    texto: "Hoy Lucía y Mateo participaron mucho en matemática. Falta Lucas por lluvia. " +
      "Hubo un conflicto menor en el recreo pero se resolvió. Pendiente: revisar las carpetas de " +
      "todos los alumnos antes del viernes. ".repeat(6),
    notas: [{ tipo: "alumno", label: "👤 Alumno", texto: "Lucía" }],
  },
  { fecha: "2026-09-21", hora: "09:05", grupo: "3° B", titulo: "Indisciplina en el aula",
    texto: "Dos alumnos no trajeron la tarea y hubo pelea durante el trabajo grupal.", notas: [] },
];

let failures = 0;
const check = (name, cond, extra) => {
  console.log((cond ? "PASS " : "FAIL ") + name + (cond ? "" : "  <-- " + (extra || "")));
  if (!cond) failures++;
};

/* ---------- PDF ---------- */
const pdf = E.construirPDF(registros, "2026-09-21", { generado: "21/09/2026 a las 12:00" });
const pdfStr = Buffer.from(pdf).toString("latin1");

check("PDF: cabecera %PDF-1.4", pdfStr.startsWith("%PDF-1.4"));
check("PDF: termina con %%EOF", pdfStr.trimEnd().endsWith("%%EOF"));
check("PDF: tiene xref", pdfStr.includes("\nxref\n"));
check("PDF: tiene trailer", pdfStr.includes("/Root 1 0 R"));

// validar offsets del xref
const xrefIdx = pdfStr.lastIndexOf("\nxref\n");
const xrefBody = pdfStr.slice(xrefIdx + 1);
const lines = xrefBody.split("\n");
const total = parseInt(lines[1].split(" ")[1], 10);
let offsetsOK = true;
for (let i = 0; i < total - 1; i++) {
  // línea 2+i es la entrada libre; los objetos arrancan en línea 3+i
  const off = parseInt(lines[3 + i].slice(0, 10), 10);
  const expected = `${i + 1} 0 obj`;
  if (pdfStr.slice(off, off + expected.length) !== expected) {
    offsetsOK = false;
    console.log(`   offset obj ${i + 1} incorrecto: esperaba "${expected}" en ${off}, hay "${pdfStr.slice(off, off + 12)}"`);
    break;
  }
}
check("PDF: todos los offsets del xref apuntan a su objeto", offsetsOK);

check("PDF: cuenta de /Count coincide con páginas reales",
  (() => {
    const m = pdfStr.match(/\/Count (\d+)/);
    const real = (pdfStr.match(/\/Type \/Page /g) || []).length;
    return m && parseInt(m[1], 10) === real;
  })());

check("PDF: renglones de cuaderno presentes", pdfStr.includes("0.81 0.89 0.97 RG"));
check("PDF: margen rojo presente", pdfStr.includes("1 0.79 0.83 RG"));
check("PDF: incluye título del día", pdfStr.includes("Participaci"));
check("PDF: sin bytes inválidos (>255)", [...pdf].every((b) => b <= 255));

fs.writeFileSync(path.join(__dirname, "_test_salida.pdf"), Buffer.from(pdf));

/* ---------- DOCX ---------- */
(async () => {
  const docx = E.construirDOCX(registros, "2026-09-21", { generado: "21/09/2026 a las 12:00" });
  const buf = Buffer.from(await docx.arrayBuffer());
  fs.writeFileSync(path.join(__dirname, "_test_salida.docx"), buf);

  check("DOCX: firma ZIP (PK\\x03\\x04)", buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 3 && buf[3] === 4);
  check("DOCX: firma fin de zip (PK\\x05\\x06)", buf.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06])));

  // leer entradas del zip manualmente
  const enc = new TextDecoder("utf-8");
  let pos = 0;
  const entradas = [];
  while (pos + 4 <= buf.length && buf.readUInt32LE(pos) === 0x04034b50) {
    const crc = buf.readUInt32LE(pos + 14);
    const size = buf.readUInt32LE(pos + 18);
    const nameLen = buf.readUInt16LE(pos + 26);
    const extraLen = buf.readUInt16LE(pos + 28);
    const name = enc.decode(buf.subarray(pos + 30, pos + 30 + nameLen));
    const data = buf.subarray(pos + 30 + nameLen + extraLen, pos + 30 + nameLen + extraLen + size);
    entradas.push({ name, crc, data });
    pos += 30 + nameLen + extraLen + size;
  }
  check("DOCX: tiene 3 archivos", entradas.length === 3, `encontradas: ${entradas.map(e => e.name).join(", ")}`);
  check("DOCX: nombres correctos",
    entradas.some(e => e.name === "[Content_Types].xml") &&
    entradas.some(e => e.name === "_rels/.rels") &&
    entradas.some(e => e.name === "word/document.xml"));

  check("DOCX: CRC32 de cada entrada es válido",
    entradas.every((e) => E.crc32(e.data) === e.crc));

  const docXml = enc.decode(entradas.find(e => e.name === "word/document.xml").data);
  check("DOCX: es XML válido de Word (w:document)", docXml.startsWith("<?xml") && docXml.includes("<w:document") && docXml.includes("</w:document>"));
  check("DOCX: contiene el texto de la nota", docXml.includes("participaron mucho"));
  check("DOCX: escape de XML correcto (sin & crudos)", !/&(?!(amp|lt|gt|quot|apos);)/.test(docXml.replace(/<\?xml[^?]*\?>/, "")));

  // paginación larga
  const largo = Array.from({ length: 40 }, (_, i) => ({
    fecha: "2026-09-21", hora: `0${i % 9}:00`, grupo: "5° A",
    titulo: `Nota numero ${i}`, texto: ("Texto largo de prueba con acentos áéíóúñ y ñ. ").repeat(30),
    notas: [{ tipo: "destacado", label: "Destacado", texto: "bien" }],
  }));
  const pdfLargo = E.construirPDF(largo, "2026-09-21", {});
  const pdfLargoStr = Buffer.from(pdfLargo).toString("latin1");
  const paginas = (pdfLargoStr.match(/\/Type \/Page /g) || []).length;
  check("PDF largo: multipágina (>1)", paginas > 1, `páginas: ${paginas}`);
  const countM = pdfLargoStr.match(/\/Count (\d+)/);
  check("PDF largo: /Count correcto", countM && parseInt(countM[1], 10) === paginas);

  // wrap
  const wrapped = E.wrapTexto("palabra ".repeat(60), 11.5, 495);
  check("wrap: ninguna línea excede el ancho", wrapped.every(l => l.length <= Math.floor(495 / (11.5 * 0.5)) + 30));

  // agrupación por fechas (compartir todo el diario)
  const multi = [
    { fecha: "2026-09-20", hora: "08:00", grupo: "3° A", titulo: "Día 1", texto: "Primera nota del lunes.", notas: [] },
    { fecha: "2026-09-21", hora: "09:00", grupo: "3° A", titulo: "Día 2", texto: "Nota del martes.", notas: [] },
    { fecha: "2026-09-21", hora: "10:00", grupo: "3° B", titulo: "Día 2 b", texto: "Segunda nota del martes.", notas: [] },
  ];
  const pdfMulti = Buffer.from(E.construirPDF(multi, "2026-09-20", { agruparPorFecha: true })).toString("latin1");
  check("PDF multi: muestra encabezado de rango de fechas",
    pdfMulti.includes("Del 20/09/2026 al 21/09/2026"));
  check("PDF multi: incluye título de cada día",
    pdfMulti.includes("lunes") && pdfMulti.includes("martes"));

  const docxMulti = Buffer.from(await E.construirDOCX(multi, "2026-09-20", { agruparPorFecha: true }).arrayBuffer());
  const dx = new TextDecoder("utf-8");
  let p2 = 0, docXml2 = "";
  while (p2 + 4 <= docxMulti.length && docxMulti.readUInt32LE(p2) === 0x04034b50) {
    const size = docxMulti.readUInt32LE(p2 + 18);
    const nameLen = docxMulti.readUInt16LE(p2 + 26);
    const extraLen = docxMulti.readUInt16LE(p2 + 28);
    const name = dx.decode(docxMulti.subarray(p2 + 30, p2 + 30 + nameLen));
    const data = docxMulti.subarray(p2 + 30 + nameLen + extraLen, p2 + 30 + nameLen + extraLen + size);
    if (name === "word/document.xml") docXml2 = dx.decode(data);
    p2 += 30 + nameLen + extraLen + size;
  }
  check("DOCX multi: incluye títulos de cada día", docXml2.includes("lunes") && docXml2.includes("martes"));

  console.log(failures === 0 ? "\nTODO OK ✅" : `\n${failures} fallas ❌`);
  process.exit(failures ? 1 : 0);
})();
