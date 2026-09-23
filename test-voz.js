// Test de la lógica de voz con un SpeechRecognition falso (jsdom):
// - no repetir texto cuando el navegador re-emite resultados viejos
// - no repetir texto cuando la sesión se corta y se reinicia (lista nueva
//   por spec O lista reutilizada tipo Chrome)
// - guardar mientras graba → PAUSA la grabación y los eventos tardíos no
//   escriben en la nota ya guardada
// - reanudar continúa sin duplicar ni perder texto
// - editar a mano durante la grabación no se pisa con la voz
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const dir = __dirname;
const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");

const errores = [];
const dom = new JSDOM(html, {
  url: "http://localhost:8321/index.html",
  runScripts: "dangerously",
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

// ---- SpeechRecognition falso ----
// start() lanza igual que Chrome si ya estaba corriendo; stop() dispara
// onend de forma ASÍNCRONA (como el navegador de verdad).
class FakeSR {
  constructor() {
    FakeSR.last = this;
    this.started = false;
    this.starts = 0;
  }
  start() {
    if (this.started) throw new Error("InvalidStateError");
    this.started = true;
    this.starts++;
  }
  stop() {
    if (!this.started) return;
    this.started = false;
    setTimeout(() => this.onend && this.onend(), 0);
  }
}
window.SpeechRecognition = FakeSR;

for (const src of ["exporters.js", "app.js"]) {
  try {
    window.eval(fs.readFileSync(path.join(dir, src), "utf8"));
  } catch (e) {
    errores.push(`eval ${src}: ${e.message}`);
  }
}
document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));

let failures = 0;
const check = (name, cond, extra) => {
  console.log((cond ? "PASS " : "FAIL ") + name + (cond ? "" : "  <-- " + (extra || "")));
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const mkRes = (t, f) => {
  const r = [{ transcript: t }];
  r.isFinal = f;
  return r;
};
// dispara onresult con la lista dada (resultIndex 0: el peor caso)
const fire = (arr) => FakeSR.last.onresult({ resultIndex: 0, results: arr });
const $ = (id) => document.getElementById(id);

(async () => {
  check("Sin errores al cargar", errores.length === 0, errores.join(" | "));
  const rec = FakeSR.last;
  check("Reconocedor creado", !!rec && rec.continuous === true && rec.interimResults === true);

  const ta = $("hojaTexto");

  /* ---------- 1. FLUJO NORMAL ---------- */
  $("btnMic").click();
  check("Mic arranca en grabando", $("recDot").classList.contains("on"));
  check("Botones habilitados al grabar", $("btnPausa").disabled === false && $("btnDetener").disabled === false);

  fire([mkRes("hola", false)]);
  check("Interim se muestra", ta.value === "hola", "valor: '" + ta.value + "'");
  fire([mkRes("hola", true), mkRes("buenos días a todos", false)]);
  check("Final consolida y muestra el parcial", ta.value === "hola buenos días a todos",
    "valor: '" + ta.value + "'");
  fire([mkRes("hola", true), mkRes("buenos días a todos", true)]);
  check("Final completo sin espacios raros", ta.value === "hola buenos días a todos ",
    "valor: '" + ta.value + "'");

  /* ---------- 2. RE-EMISIÓN DE EVENTOS VIEJOS (bug clásico) ---------- */
  const listaA = [mkRes("hola", true), mkRes("buenos días a todos", true)];
  fire(listaA); // el navegador vuelve a notificar desde resultIndex 0
  fire(listaA);
  check("Re-emisión no duplica el texto", ta.value === "hola buenos días a todos ",
    "valor: '" + ta.value + "'");

  /* ---------- 3. CORTE + REINICIO con lista NUEVA (spec) ---------- */
  rec.started = false;
  rec.onend(); // el navegador cortó la sesión → la app la reinicia sola
  await sleep(20);
  check("Reinicio automático mantiene grabando (sin sonido)", $("recDot").classList.contains("on"));
  check("Se reinició una sola vez (starts=2)", rec.starts === 2, "starts=" + rec.starts);
  // lista nueva del reinicio: empieza con un parcial
  fire([mkRes("cómo andan chicos", false)]);
  check("Tras reinicio con lista nueva: conserva lo anterior y agrega el parcial",
    ta.value === "hola buenos días a todos cómo andan chicos", "valor: '" + ta.value + "'");
  fire([mkRes("cómo andan chicos", true)]);
  check("Final tras reinicio no duplica", ta.value === "hola buenos días a todos cómo andan chicos ",
    "valor: '" + ta.value + "'");

  /* ---------- 4. CORTE + REINICIO con lista REUTILIZADA (Chrome) ---------- */
  rec.started = false;
  rec.onend();
  await sleep(20);
  // Chrome reutiliza la lista de la sesión actual y agrega resultados nuevos
  fire([
    mkRes("cómo andan chicos", true),
    mkRes("hoy hubo mucha participación", false),
  ]);
  check("Tras reinicio con lista reutilizada: no duplica lo viejo",
    ta.value === "hola buenos días a todos cómo andan chicos hoy hubo mucha participación",
    "valor: '" + ta.value + "'");
  fire([
    mkRes("cómo andan chicos", true),
    mkRes("hoy hubo mucha participación", true),
  ]);
  check("Finaliza sin duplicar",
    ta.value === "hola buenos días a todos cómo andan chicos hoy hubo mucha participación ",
    "valor: '" + ta.value + "'");

  /* ---------- 5. PAUSA / REANUDAR ---------- */
  $("btnPausa").click();
  await sleep(20);
  check("Pausa cambia estado", !$("recDot").classList.contains("on") && $("recTexto").textContent.includes("pausa"));
  check("Pausa habilita reanudar (▶️)", $("btnPausa").textContent === "▶️");
  const valorEnPausa = ta.value;
  fire([mkRes("esto no debería aparecer", true)]); // evento tardío tras pausar
  check("Evento tardío en pausa no escribe", ta.value === valorEnPausa, "valor: '" + ta.value + "'");

  $("btnPausa").click(); // reanudar
  await sleep(10);
  check("Reanudar vuelve a grabar", $("recDot").classList.contains("on"));
  fire([
    mkRes("cómo andan chicos", true),
    mkRes("hoy hubo mucha participación", true),
    mkRes("y el recreo se cortó", false),
  ]);
  check("Al reanudar continúa sin duplicar ni perder",
    ta.value === "hola buenos días a todos cómo andan chicos hoy hubo mucha participación y el recreo se cortó",
    "valor: '" + ta.value + "'");

  /* ---------- 6. GUARDAR MIENTRAS GRABA → PAUSA ---------- */
  $("btnGuardar").click();
  await sleep(20);
  check("Guardar con grabación activa → en pausa", !$("recDot").classList.contains("on"));
  check("Guardar deja la nota en vista (readOnly)", ta.readOnly === true);
  check("Nota guardada en la lista", document.querySelectorAll("#listaGuardadas .chip-nota").length === 1);
  const guardadas = JSON.parse(window.localStorage.getItem("ded_pwa_registros_v1"));
  check("Texto guardado sin duplicados y con el interim",
    guardadas[0].texto === "hola buenos días a todos cómo andan chicos hoy hubo mucha participación y el recreo se cortó",
    guardadas[0].texto);

  const valorGuardado = ta.value;
  fire([mkRes("frase posterior al guardado", true)]); // evento tardío tras guardar
  check("Tras guardar, los eventos tardíos NO tocan la hoja",
    ta.value === valorGuardado, "valor: '" + ta.value + "'");
  await sleep(20);
  check("No se reinicia la sesión estando pausada", rec.started === false);

  /* ---------- 7. VOLVER A GRABAR (✏️ + ▶️) ---------- */
  $("btnPausa").click(); // en vista debe avisar que edite
  check("Reanudar en vista pide editar", $("toast").textContent.includes("lápiz"),
    $("toast").textContent);
  $("btnEditarNota").click();
  $("btnPausa").click();
  await sleep(10);
  check("Con ✏️ se puede reanudar", $("recDot").classList.contains("on"));
  fire([
    mkRes("cómo andan chicos", true),
    mkRes("hoy hubo mucha participación", true),
    mkRes("y el recreo se cortó", true),  // el parcial de antes ya era parte del texto
    mkRes("seguimos la clase después", false),
  ]);
  check("Regrabado continúa exactamente donde estaba (sin repetir lo ya hablado)",
    ta.value === "hola buenos días a todos cómo andan chicos hoy hubo mucha participación y el recreo se cortó seguimos la clase después",
    "valor: '" + ta.value + "'");

  /* ---------- 8. DETENER ---------- */
  $("btnDetener").click();
  await sleep(20);
  check("Detener apaga el estado", !$("recDot").classList.contains("on"));
  check("Detener deshabilita pausa/detener", $("btnPausa").disabled === true && $("btnDetener").disabled === true);
  const valorDetenido = ta.value;
  fire([mkRes("esto tampoco", true)]);
  check("Evento tardío tras detener no escribe", ta.value === valorDetenido, "valor: '" + ta.value + "'");
  await sleep(20);
  check("No hay reinicios fantasmas tras detener", rec.started === false);

  /* ---------- 9. EDICIÓN MANUAL DURANTE LA GRABACIÓN ---------- */
  $("btnNueva").click();
  $("btnMic").click();
  fire([mkRes("texto original", true)]);
  check("Nueva sesión arranca de cero", ta.value === "texto original ", "valor: '" + ta.value + "'");
  ta.value = "el docente escribió esto a mano ";
  fire([mkRes("texto original", true), mkRes("palabra que quedó en el aire", false)]);
  check("Edición manual manda (no se pisa con la voz)",
    ta.value === "el docente escribió esto a mano ", "valor: '" + ta.value + "'");
  fire([
    mkRes("texto original", true),
    mkRes("palabra que quedó en el aire", true),
    mkRes("la voz siguió después", false),
  ]);
  check("La voz sigue agregando después de la edición manual",
    ta.value === "el docente escribió esto a mano la voz siguió después",
    "valor: '" + ta.value + "'");
  $("btnDetener").click();
  await sleep(20);

  /* ---------- 10. ANDROID/CHROME: repite la MISMA palabra 2 o 3 veces ---------- */
  $("btnNueva").click();
  $("btnMic").click();
  fire([mkRes("sí", true)]);
  check("Una palabra sola se escribe una vez", ta.value === "sí ", "valor: '" + ta.value + "'");
  fire([mkRes("sí", true), mkRes("sí", true)]); // el bug devuelve dos finales iguales
  check("Palabra duplicada por el recognizer no repite", ta.value === "sí ", "valor: '" + ta.value + "'");
  fire([mkRes("sí", true), mkRes("sí", true), mkRes("sí", true)]);
  check("Palabra triplicada por el recognizer no repite", ta.value === "sí ", "valor: '" + ta.value + "'");

  // misma patología con una frase completa
  fire([
    mkRes("sí", true), mkRes("sí", true), mkRes("sí", true),
    mkRes("hoy trabajamos en equipo", true),
  ]);
  check("Frase nueva se agrega", ta.value === "sí hoy trabajamos en equipo ",
    "valor: '" + ta.value + "'");
  fire([
    mkRes("sí", true), mkRes("sí", true), mkRes("sí", true),
    mkRes("hoy trabajamos en equipo", true),
    mkRes("hoy trabajamos en equipo", true),
  ]);
  check("Frase re-entregada no duplica", ta.value === "sí hoy trabajamos en equipo ",
    "valor: '" + ta.value + "'");

  /* ---------- 11. INTERINOS: búfer temporal sin acumular ---------- */
  fire([
    mkRes("sí", true), mkRes("sí", true), mkRes("sí", true),
    mkRes("hoy trabajamos en equipo", true),
    mkRes("hoy trabajamos en equipo", true),
    mkRes("y la", false),
    mkRes("y la próxima", false),
    mkRes("y la próxima semana hay feria", false),
  ]);
  check("Se muestra SOLO el último interino (no se concatenan)",
    ta.value === "sí hoy trabajamos en equipo y la próxima semana hay feria",
    "valor: '" + ta.value + "'");
  fire([
    mkRes("sí", true), mkRes("sí", true), mkRes("sí", true),
    mkRes("hoy trabajamos en equipo", true),
    mkRes("hoy trabajamos en equipo", true),
    mkRes("y la próxima semana hay feria", true),
  ]);
  check("El final del parcial se consolida una sola vez",
    ta.value === "sí hoy trabajamos en equipo y la próxima semana hay feria ",
    "valor: '" + ta.value + "'");
  $("btnDetener").click();
  await sleep(20);

  /* ---------- 12. RE-ENTREGA DE LA FRASE COMPLETA con solape ---------- */
  $("btnNueva").click();
  $("btnMic").click();
  fire([mkRes("buenos", true)]);
  check("Primer final de la frase", ta.value === "buenos ", "valor: '" + ta.value + "'");
  fire([mkRes("buenos", true), mkRes("buenos días chicos", false)]);
  check("El interino repite lo ya escrito: se recorta en pantalla",
    ta.value === "buenos días chicos", "valor: '" + ta.value + "'");
  fire([mkRes("buenos", true), mkRes("buenos días chicos", true)]);
  check("El final agrega solo lo nuevo (sin repetir 'buenos')",
    ta.value === "buenos días chicos ", "valor: '" + ta.value + "'");
  fire([mkRes("buenos", true), mkRes("buenos días chicos", true), mkRes("buenos días chicos", true)]);
  check("La frase completa re-entregada no duplica",
    ta.value === "buenos días chicos ", "valor: '" + ta.value + "'");

  /* ---------- 13. REINICIO con lista vieja re-interpretada ---------- */
  rec.started = false;
  rec.onend(); // el navegador corta y reinicia solo
  await sleep(20);
  check("Se puede seguir grabando tras el corte", $("recDot").classList.contains("on"));
  fire([
    mkRes("buenos", true),
    mkRes("buenos días chicos de la tarde", true), // viejo, re-interpretado
    mkRes("buenos días chicos", true),
    mkRes("y seguimos la clase", false),
  ]);
  check("Lista vieja re-interpretada NO se vuelve a consumir",
    ta.value === "buenos días chicos y seguimos la clase", "valor: '" + ta.value + "'");
  fire([
    mkRes("buenos", true),
    mkRes("buenos días chicos de la tarde", true),
    mkRes("buenos días chicos", true),
    mkRes("y seguimos la clase", true),
  ]);
  check("Y el nuevo final se consolida una sola vez",
    ta.value === "buenos días chicos y seguimos la clase ", "valor: '" + ta.value + "'");
  $("btnDetener").click();
  await sleep(20);

  check("Sin errores durante la sesión", errores.length === 0, errores.join(" | "));
  console.log(failures === 0 ? "\nVOZ OK ✅" : `\n${failures} fallas ❌`);
  process.exit(failures ? 1 : 0);
})();
