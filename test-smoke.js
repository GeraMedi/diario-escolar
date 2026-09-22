// Smoke test con jsdom: carga la app y simula el flujo del docente
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const dir = __dirname;
const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");

const errores = [];
const dom = new JSDOM(html, {
  url: "http://localhost:8321/index.html",
  runScripts: "dangerously",
  resources: undefined,
  pretendToBeVisual: true,
  beforeParse(window) {
    window.onerror = (msg) => errores.push("onerror: " + msg);
    window.addEventListener("error", (e) => errores.push("error: " + (e.message || e)));
    window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));
    window.scrollTo = () => {};
    window.URL.createObjectURL = () => "blob:fake";
    window.URL.revokeObjectURL = () => {};
    window.confirm = () => true;
  },
});
const { window } = dom;
const { document } = window;

let failures = 0;
const check = (name, cond, extra) => {
  console.log((cond ? "PASS " : "FAIL ") + name + (cond ? "" : "  <-- " + (extra || "")));
  if (!cond) failures++;
};

for (const src of ["exporters.js", "app.js"]) {
  const code = fs.readFileSync(path.join(dir, src), "utf8");
  try {
    window.eval(code);
  } catch (e) {
    errores.push(`eval ${src}: ${e.message}`);
  }
}
document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  check("Sin errores al cargar", errores.length === 0, errores.join(" | "));
  await sleep(900);
  check("Splash oculto tras init", document.getElementById("splash") === null || document.getElementById("splash").className.includes("hide"));

  /* ---------- GRUPOS ---------- */
  const grupoSel = document.getElementById("grupoSelect");
  const valores = [...grupoSel.options].map((o) => o.value);
  check("Select de grupo existe (no datalist)", !!grupoSel && grupoSel.tagName === "SELECT");
  check("Incluye 6° A", valores.includes("6° A"));
  check("Incluye 6° B", valores.includes("6° B"));
  check("Incluye opción Otro", valores.includes("__otro"));

  grupoSel.value = "3° A";
  grupoSel.dispatchEvent(new window.Event("change", { bubbles: true }));
  check("Elegir grupo no muestra campo libre", document.getElementById("grupoOtro").hidden === true);
  grupoSel.value = "__otro";
  grupoSel.dispatchEvent(new window.Event("change", { bubbles: true }));
  check("Elegir Otro muestra campo libre", document.getElementById("grupoOtro").hidden === false);
  grupoSel.value = "6° A";
  grupoSel.dispatchEvent(new window.Event("change", { bubbles: true }));
  check("Volver a elegir un grupo muestra todos (select conserva opciones)",
    [...grupoSel.options].length === valores.length && grupoSel.value === "6° A");
  grupoSel.value = "3° A";
  grupoSel.dispatchEvent(new window.Event("change", { bubbles: true }));

  /* ---------- NOTA 1 ---------- */
  const ta = document.getElementById("hojaTexto");
  ta.value = "Hoy Lucía y Mateo participaron mucho en matemática. Falta Lucas. Hubo un conflicto en el recreo.";
  ta.dispatchEvent(new window.Event("input", { bubbles: true }));
  await sleep(850);

  check("Título auto generado", document.getElementById("notaTitulo").value.length > 5,
    "titulo: '" + document.getElementById("notaTitulo").value + "'");
  check("Notas clave renderizadas", document.getElementById("notasClave").children.length > 0);

  document.getElementById("btnGuardar").click();
  await sleep(50);
  const guardadas = document.getElementById("listaGuardadas");
  check("Nota aparece en la lista del día", guardadas.querySelectorAll(".chip-nota").length === 1);
  check("Persistió en localStorage", (window.localStorage.getItem("ded_pwa_registros_v1") || "").includes("Lucía"));

  /* ---------- MODO VISTA tras guardar ---------- */
  check("Tras guardar queda en VISTA (readOnly)", ta.readOnly === true);
  check("Píldora de vista visible", document.getElementById("modoPill").hidden === false);
  check("Lápiz visible para editar", document.getElementById("btnEditarNota").hidden === false);

  // en vista: guardar y micrófono se bloquean
  const toastEl = document.getElementById("toast");
  document.getElementById("btnGuardar").click();
  await sleep(20);
  check("Guardar en vista avisa en vez de modificar",
    toastEl.textContent.includes("vista") || toastEl.textContent.includes("lápiz"), toastEl.textContent);
  document.getElementById("btnMic").click();
  await sleep(20);
  check("Micrófono en vista pide editar", toastEl.textContent.includes("lápiz"), toastEl.textContent);

  // lápiz → edición
  document.getElementById("btnEditarNota").click();
  check("Lápiz pasa a edición (no readOnly)", ta.readOnly === false);
  check("Píldora desaparece al editar", document.getElementById("modoPill").hidden === true);

  /* ---------- NOTA 2 ---------- */
  document.getElementById("btnNueva").click();
  check("Nueva nota habilita edición", ta.readOnly === false);
  ta.value = "Mateo no trajo la tarea y hubo pelea. Pendiente: avisar a la tutora.";
  ta.dispatchEvent(new window.Event("input", { bubbles: true }));
  document.getElementById("btnGuardar").click();
  await sleep(30);
  check("Dos notas en la lista", guardadas.querySelectorAll(".chip-nota").length === 2);

  /* ---------- CLIC EN NOTA → VISTA (no edición) ---------- */
  const chips = guardadas.querySelectorAll(".chip-nota");
  chips[0].click();
  await sleep(30);
  check("Clic en nota abre en VISTA", ta.readOnly === true && ta.value.length > 10);
  check("La nota abierta queda resaltada", !!guardadas.querySelector(".chip-nota.vista-activa"));

  /* ---------- LÁPIZ DE LA LISTA → EDICIÓN ---------- */
  guardadas.querySelector('button[data-act="edit"]').click();
  await sleep(30);
  check("Lápiz de la lista abre en EDICIÓN", ta.readOnly === false);

  /* ---------- HISTORIAL: día → última nota en vista ---------- */
  // crear un registro en otra fecha directo en storage
  const key = "ded_pwa_registros_v1";
  const regs = JSON.parse(window.localStorage.getItem(key));
  regs.push({
    id: "vieja-1", fecha: "2026-09-10", hora: "08:00", titulo: "Nota vieja 1",
    grupo: "5° A", texto: "Primera nota del día viejo", notas: [],
  });
  regs.push({
    id: "vieja-2", fecha: "2026-09-10", hora: "10:00", titulo: "Nota vieja 2",
    grupo: "5° A", texto: "Segunda y última nota del día viejo", notas: [],
  });
  window.localStorage.setItem(key, JSON.stringify(regs));
  // recargar app para que lea storage
  window.eval("void 0");
  // re-init limpio: nueva instancia
  const dom2 = new JSDOM(html, {
    url: "http://localhost:8321/index.html",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(w) {
      w.scrollTo = () => {};
      w.URL.createObjectURL = () => "blob:fake";
      w.URL.revokeObjectURL = () => {};
      w.confirm = () => true;
      w.localStorage.setItem(key, JSON.stringify(regs));
    },
  });
  for (const src of ["exporters.js", "app.js"]) {
    dom2.window.eval(fs.readFileSync(path.join(dir, src), "utf8"));
  }
  dom2.window.document.dispatchEvent(new dom2.window.Event("DOMContentLoaded", { bubbles: true }));
  await sleep(900);

  const d2 = dom2.window.document;
  d2.getElementById("btnMenu").click();
  d2.querySelector('[data-panel="panelHistorial"]').click();
  check("Historial lista días", d2.getElementById("listaHistorial").querySelectorAll(".hist-item").length >= 2);

  const itemViejo = [...d2.getElementById("listaHistorial").querySelectorAll(".hist-item")]
    .find((b) => b.textContent.includes("10/09/2026"));
  check("Existe el día 10/09/2026", !!itemViejo);
  itemViejo.click();
  await sleep(50);

  const ta2 = d2.getElementById("hojaTexto");
  check("Día del historial muestra la ÚLTIMA nota", ta2.value.includes("última nota del día viejo"), "texto: " + ta2.value);
  check("Se muestra en VISTA (solo lectura)", ta2.readOnly === true);
  check("Drawer cerrado tras elegir día", !d2.getElementById("drawer").classList.contains("open"));
  check("Fecha cambiada al día elegido", d2.getElementById("fechaInput").value === "2026-09-10");
  check("La nota vieja se resalta en la lista", !!d2.getElementById("listaGuardadas").querySelector(".chip-nota.vista-activa"));
  check("Hay 2 notas listadas ese día", d2.getElementById("listaGuardadas").querySelectorAll(".chip-nota").length === 2);

  // clic en la otra nota → cambia a ella
  const otroChip = [...d2.getElementById("listaGuardadas").querySelectorAll(".chip-nota strong")]
    .find((s) => s.textContent.includes("Nota vieja 1"));
  otroChip.closest(".chip-nota").click();
  await sleep(30);
  check("Clic en otra nota la carga en vista", ta2.value.includes("Primera nota") && ta2.readOnly === true);

  // lápiz del modal → editar
  d2.getElementById("btnEditarNota").click();
  check("Lápiz de la hoja habilita edición", ta2.readOnly === false);

  /* ---------- COMPARTIR: modal con 2 opciones ---------- */
  d2.getElementById("btnShareTop").click();
  check("Modal de compartir se abre", d2.getElementById("shareModal").hidden === false);
  const opciones = [...d2.querySelectorAll("#shareModal button[data-share]")].map((b) => b.dataset.share);
  check("Tiene opción nota actual", opciones.includes("nota"));
  check("Tiene opción todo el diario", opciones.includes("todo"));
  check("Tiene cancelar", opciones.includes("cancel"));

  d2.querySelector('#shareModal button[data-share="cancel"]').click();
  check("Cancelar cierra el modal", d2.getElementById("shareModal").hidden === true);

  // compartir "todo" → fallback a descarga (jsdom no tiene share API)
  let descargado = null;
  dom2.window.HTMLAnchorElement.prototype.click = function () { descargado = this.download; };
  d2.getElementById("btnShareTop").click();
  d2.querySelector('#shareModal button[data-share="todo"]').click();
  await sleep(80);
  check("Compartir 'todo' genera diario_completo", (descargado || "").startsWith("diario_completo"), "obtuvo: " + descargado);
  check("Modal cerrado al compartir", d2.getElementById("shareModal").hidden === true);

  // compartir "nota actual"
  descargado = null;
  d2.getElementById("btnShareTop").click();
  d2.querySelector('#shareModal button[data-share="nota"]').click();
  await sleep(80);
  check("Compartir 'nota' genera nota_<fecha>", /^nota_\d{4}-\d{2}-\d{2}\./.test(descargado || ""), "obtuvo: " + descargado);

  /* ---------- EXPORTACIÓN día (drawer) ---------- */
  descargado = null;
  d2.querySelector('input[name="formato"][value="pdf"]').checked = true;
  d2.getElementById("btnExportar").click();
  check("Exportar día sigue funcionando", (descargado || "").startsWith("diario_2026-"), "obtuvo: " + descargado);

  check("Sin errores durante la sesión", errores.length === 0, errores.join(" | "));

  console.log(failures === 0 ? "\nSMOKE OK ✅" : `\n${failures} fallas ❌`);
  process.exit(failures ? 1 : 0);
})();
