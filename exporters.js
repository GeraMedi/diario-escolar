/* =========================================================
   exporters.js — exportación sin librerías
   - construirPDF(registros, fecha)  → Uint8Array (diseño hoja de cuaderno)
   - construirDOCX(registros, fecha) → Blob (.docx real, zip store)
   ========================================================= */
(function (global) {
  "use strict";

  /* ---------------- helpers comunes ---------------- */
  const pad = (n) => String(n).padStart(2, "0");
  const parseISO = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  const diaSemanaDe = (iso) =>
    parseISO(iso).toLocaleDateString("es-AR", { weekday: "long" });
  const fechaLargaDe = (iso) =>
    parseISO(iso).toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" });
  const fechaCortaDe = (iso) => {
    const d = parseISO(iso);
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  };
  const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");

  /* =========================================================
     PDF
     ========================================================= */
  const pdfSan = (s) =>
    String(s ?? "")
      .split("")
      .map((c) => (c.codePointAt(0) > 255 ? "" : c))
      .join("");

  function pdfEsc(s) {
    return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  }

  function wrapTexto(texto, size, anchoDisp) {
    const maxChars = Math.max(20, Math.floor(anchoDisp / (size * 0.5)));
    const out = [];
    String(texto)
      .split(/\n/)
      .forEach((par) => {
        const palabras = par.split(/\s+/).filter(Boolean);
        if (!palabras.length) {
          out.push("");
          return;
        }
        let linea = "";
        palabras.forEach((p) => {
          while (p.length > maxChars) {
            out.push((linea + " " + p.slice(0, maxChars)).trim());
            linea = "";
            p = p.slice(maxChars);
          }
          if ((linea + " " + p).length > maxChars) {
            out.push(linea);
            linea = p;
          } else {
            linea = linea ? linea + " " + p : p;
          }
        });
        if (linea) out.push(linea);
      });
    return out;
  }

  function construirPDF(registros, fecha, extras) {
    extras = extras || {};
    const W = 595, H = 842;
    const X = 58;       // margen de texto
    const XDER = 42;    // margen derecho
    const TOP = 780, BOT = 70;

    const pages = [];
    let ops = null,
      y = 0;

    const nuevaPagina = () => {
      ops = [];
      pages.push(ops);
      y = TOP;
    };
    const poner = (texto, font, size, lh, gap = 0) => {
      if (!ops) nuevaPagina();
      y -= gap;
      if (y - lh < BOT) {
        nuevaPagina();
        y = TOP;
        y -= gap;
      }
      ops.push(
        `BT /${font} ${size} Tf 0.29 0.27 0.35 rg ${X} ${y.toFixed(1)} Td (${pdfEsc(
          pdfSan(texto)
        )}) Tj ET`
      );
      y -= lh;
    };
    const ponerWrapped = (texto, font, size, lh) => {
      wrapTexto(texto, size, W - X - XDER).forEach((l) => poner(l || " ", font, size, lh));
    };
    const separador = (gap) => {
      if (!ops) return;
      y -= gap;
      if (y < BOT) {
        nuevaPagina();
        y = TOP;
      }
      ops.push(
        `[3 3] 0 d 0.78 0.76 0.86 RG ${X} ${y.toFixed(1)} m ${W - XDER} ${y.toFixed(1)} l S [] 0 d`
      );
      y -= 10;
    };

    // --- encabezado (primera página) ---
    nuevaPagina();
    poner("Diario Escolar de Voz", "F2", 20, 26);
    if (extras.agruparPorFecha) {
      const fechas = [...new Set(registros.map((r) => r.fecha))].sort();
      const rango =
        fechas.length === 1
          ? `${capitalize(diaSemanaDe(fechas[0]))}, ${fechaLargaDe(fechas[0])}`
          : `Del ${fechaCortaDe(fechas[0])} al ${fechaCortaDe(fechas[fechas.length - 1])} · ${
              registros.length
            } notas`;
      poner(rango, "F1", 12, 18, 4);
    } else {
      poner(`${capitalize(diaSemanaDe(fecha))}, ${fechaLargaDe(fecha)}`, "F1", 12, 18, 4);
    }
    const grupos = [...new Set(registros.map((r) => r.grupo).filter(Boolean))].join(" · ");
    if (grupos) poner(`Grupos: ${grupos}`, "F3", 11, 16, 2);
    separador(12);

    if (!registros.length) poner("(Sin notas para este día)", "F3", 12, 18, 8);

    let fechaAnterior = null;
    registros.forEach((r, i) => {
      if (extras.agruparPorFecha && r.fecha !== fechaAnterior) {
        fechaAnterior = r.fecha;
        poner(`📅 ${capitalize(diaSemanaDe(r.fecha))}, ${fechaLargaDe(r.fecha)}`, "F2", 13, 20, i ? 16 : 4);
      }
      poner(`${r.hora}${r.grupo ? "  ·  " + r.grupo : ""}`, "F3", 10.5, 15, i ? 4 : 0);
      poner(r.titulo || "Nota sin título", "F2", 14, 20, 2);
      ponerWrapped(r.texto || "", "F1", 11.5, 25);
      if (r.notas && r.notas.length) {
        r.notas.forEach((n) => ponerWrapped(`-> ${n.label}: ${n.texto}`, "F3", 10, 14));
      }
      separador(16);
    });

    if (extras.generado) {
      poner(`Generado el ${extras.generado}`, "F3", 9.5, 14, 10);
    }

    // --- armar bytes ---
    const buf = [];
    const pushStr = (s) => {
      for (const c of s) buf.push(c.codePointAt(0) & 0xff);
    };
    const offsets = [];

    pushStr("%PDF-1.4\n");

    const registrar = (contenido) => {
      offsets.push(buf.length);
      pushStr(contenido);
    };

    const pageIds = pages.map((_, i) => 6 + i * 2);
    const contIds = pages.map((_, i) => 7 + i * 2);

    registrar(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
    registrar(
      `2 0 obj\n<< /Type /Pages /Kids [${pageIds.map((n) => n + " 0 R").join(" ")}] /Count ${
        pages.length
      } >>\nendobj\n`
    );
    registrar(
      `3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`
    );
    registrar(
      `4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n`
    );
    registrar(
      `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>\nendobj\n`
    );

    pages.forEach((textOps, i) => {
      let stream = "";
      // renglones del cuaderno
      for (let ry = 810; ry >= 44; ry -= 32) {
        stream += `0.81 0.89 0.97 RG 1 w 40 ${ry} m ${W - 30} ${ry} l S\n`;
      }
      // margen rojo
      stream += `1 0.79 0.83 RG 1.6 w 44 44 m 44 810 l S\n`;
      stream += textOps.join("\n") + "\n";

      registrar(
        `${pageIds[i]} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] ` +
          `/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> ` +
          `/Contents ${contIds[i]} 0 R >>\nendobj\n`
      );
      registrar(
        `${contIds[i]} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}endstream\nendobj\n`
      );
    });

    const xrefOffset = buf.length;
    const total = offsets.length + 1;
    pushStr(`xref\n0 ${total}\n0000000000 65535 f \n`);
    offsets.forEach((off) => pushStr(`${String(off).padStart(10, "0")} 00000 n \n`));
    pushStr(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

    return new Uint8Array(buf);
  }

  /* =========================================================
     DOCX (zip sin compresión + CRC32)
     ========================================================= */
  let crcTable = null;
  function crc32(u8) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
      }
    }
    let c = 0xffffffff;
    for (let i = 0; i < u8.length; i++) c = crcTable[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function zipStore(files) {
    const enc = new TextEncoder();
    const now = new Date();
    const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
    const dosDate =
      (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;

    const chunks = [];
    const central = [];
    let offset = 0;

    const u16 = (v) => [v & 0xff, (v >> 8) & 0xff];
    const u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];

    files.forEach((f) => {
      const nameBytes = enc.encode(f.name);
      const data = f.data instanceof Uint8Array ? f.data : enc.encode(f.data);
      const crc = crc32(data);

      const local = [
        ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0),
        ...u16(dosTime), ...u16(dosDate),
        ...u32(crc), ...u32(data.length), ...u32(data.length),
        ...u16(nameBytes.length), ...u16(0),
      ];
      chunks.push(new Uint8Array(local), nameBytes, data);
      central.push({ crc, size: data.length, nameBytes, offset });
      offset += local.length + nameBytes.length + data.length;
    });

    const centralChunks = [];
    let centralSize = 0;
    central.forEach((e) => {
      const head = [
        ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0),
        ...u16(dosTime), ...u16(dosDate),
        ...u32(e.crc), ...u32(e.size), ...u32(e.size),
        ...u16(e.nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
        ...u32(0), ...u32(e.offset),
      ];
      centralChunks.push(new Uint8Array(head), e.nameBytes);
      centralSize += head.length + e.nameBytes.length;
    });

    const eocd = new Uint8Array([
      ...u32(0x06054b50), ...u16(0), ...u16(0),
      ...u16(central.length), ...u16(central.length),
      ...u32(centralSize), ...u32(offset), ...u16(0),
    ]);

    const blobParts = [...chunks, ...centralChunks, eocd];
    if (typeof Blob !== "undefined") {
      return new Blob(blobParts, {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
    }
    // fallback para Node (tests)
    const totalLen = blobParts.reduce((a, p) => a + p.length, 0);
    const out = new Uint8Array(totalLen);
    let pos = 0;
    blobParts.forEach((p) => {
      out.set(p, pos);
      pos += p.length;
    });
    return out;
  }

  const xmlEsc = (s) =>
    String(s ?? "")
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;").replaceAll("'", "&apos;");

  function pArr(texto, opts) {
    opts = opts || {};
    const { bold, italic, size, center, color } = opts;
    const rPr = [
      bold ? "<w:b/>" : "",
      italic ? "<w:i/>" : "",
      size ? `<w:sz w:val="${size}"/>` : "",
      color ? `<w:color w:val="${color}"/>` : "",
    ].join("");
    const pPr = [center ? '<w:jc w:val="center"/>' : "", "<w:spacing w:after=\"120\"/>"].join("");
    return `<w:p><w:pPr>${pPr}</w:pPr><w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${xmlEsc(
      texto
    )}</w:t></w:r></w:p>`;
  }

  function construirDOCX(registros, fecha, extras) {
    extras = extras || {};
    const enc = new TextEncoder();
    const cuerpo = [];

    cuerpo.push(pArr("Diario Escolar de Voz ✏️", { bold: true, size: 44, center: true, color: "6A5FA8" }));
    if (extras.agruparPorFecha) {
      const fechas = [...new Set(registros.map((r) => r.fecha))].sort();
      const rango =
        fechas.length === 1
          ? `${capitalize(diaSemanaDe(fechas[0]))}, ${fechaLargaDe(fechas[0])}`
          : `Del ${fechaCortaDe(fechas[0])} al ${fechaCortaDe(fechas[fechas.length - 1])} · ${registros.length} notas`;
      cuerpo.push(pArr(rango, { italic: true, size: 24, center: true, color: "8A82A0" }));
    } else {
      cuerpo.push(
        pArr(`${capitalize(diaSemanaDe(fecha))}, ${fechaLargaDe(fecha)}`, {
          italic: true, size: 24, center: true, color: "8A82A0",
        })
      );
    }
    cuerpo.push(pArr(" "));

    if (!registros.length) cuerpo.push(pArr("(Sin notas para este día)", { italic: true, size: 22 }));

    let fechaAnterior = null;
    registros.forEach((r) => {
      if (extras.agruparPorFecha && r.fecha !== fechaAnterior) {
        fechaAnterior = r.fecha;
        cuerpo.push(pArr(`📅 ${capitalize(diaSemanaDe(r.fecha))}, ${fechaLargaDe(r.fecha)}`, {
          bold: true, size: 30, color: "6A5FA8",
        }));
      }
      cuerpo.push(pArr(`${r.hora}${r.grupo ? "  ·  " + r.grupo : ""}`, { bold: true, size: 20, color: "C25C82" }));
      cuerpo.push(pArr(r.titulo || "Nota sin título", { bold: true, size: 28, color: "4A4458" }));
      cuerpo.push(pArr(r.texto || "", { size: 22 }));
      if (r.notas && r.notas.length) {
        cuerpo.push(
          pArr("Notas clave: " + r.notas.map((n) => `${n.label}: ${n.texto}`).join("  |  "), {
            italic: true, size: 19, color: "6A5FA8",
          })
        );
      }
      cuerpo.push(pArr(" "));
    });

    if (extras.generado) {
      cuerpo.push(pArr(`Generado el ${extras.generado}`, { italic: true, size: 18, color: "8A82A0" }));
    }

    const documentXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
      cuerpo.join("") +
      `</w:body></w:document>`;

    const contentTypes =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      `</Types>`;

    const rels =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
      `</Relationships>`;

    return zipStore([
      { name: "[Content_Types].xml", data: enc.encode(contentTypes) },
      { name: "_rels/.rels", data: enc.encode(rels) },
      { name: "word/document.xml", data: enc.encode(documentXml) },
    ]);
  }

  const api = { construirPDF, construirDOCX, zipStore, crc32, wrapTexto };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.DEDExport = api;
})(typeof window !== "undefined" ? window : globalThis);
