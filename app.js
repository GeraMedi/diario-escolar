/* =========================================================
   Diario Escolar de Voz — PWA
   - Voz: grabar / pausar / reanudar / detener (tiempo real)
   - Título inteligente + notas clave extraídas del texto
   - Guardado local (localStorage), sin servidor
   - Exportación real a PDF (hoja de cuaderno) y Word (.docx)
   - Web Share API para WhatsApp / apps del celular
   ========================================================= */

(function () {
  "use strict";

  const STORAGE_KEY = "ded_pwa_registros_v1";

  const $ = (id) => document.getElementById(id);

  /* ================== FECHAS ================== */
  const pad = (n) => String(n).padStart(2, "0");
  const hoyISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const parseISO = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  const diaSemanaDe = (iso) =>
    parseISO(iso).toLocaleDateString("es-AR", { weekday: "long" });
  const fechaLargaDe = (iso) =>
    parseISO(iso).toLocaleDateString("es-AR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  const fechaCortaDe = (iso) => {
    const d = parseISO(iso);
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  };
  const horaAhora = () => {
    const d = new Date();
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  /* ================== ESTADO ================== */
  const state = {
    registros: [],
    fecha: hoyISO(),
    editId: null,
    tituloManual: false,
    modo: "nueva", // nueva | vista | edicion  (vista = solo lectura)
    // voz
    voz: "inactivo", // inactivo | grabando | pausado
    textoDef: "",          // texto consolidado (definitivo) de la sesión actual
    interim: "",           // texto parcial aún no finalizado
    consumidos: 0,         // cuántos resultados de la lista ya se consumieron
    huellas: [],           // huella normalizada de cada resultado consumido
    ultimoAppend: 0,       // cuándo se agregó el último texto (anti-eco del recognizer)
    sesionViva: false,     // hay una sesión de reconocimiento activa
    ultimoPintado: "",     // última escritura nuestra en la hoja (detecta edición manual)
    ultimoInicio: 0,       // cuándo arrancó la sesión actual (anti-rafaga de reinicios)
    rachas: 0,             // reinicios rápidos consecutivos (backoff)
    segundos: 0,
    timerId: null,
    rec: null,
    recSoportada: false,
  };

  function cargar() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const data = raw ? JSON.parse(raw) : [];
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }
  function persistir() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.registros));
    } catch {
      toast("⚠️ No se pudo guardar (almacenamiento lleno)");
    }
  }

  /* ================== TOAST ================== */
  let toastTimer = null;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  /* ================== SONIDOS DE GRABACIÓN ================== */
  // Tres únicos momentos con sonido: iniciar, pausar y detener.
  // Los reinicios automáticos del navegador NO suenan.
  let audioCtx = null;
  function tono(fIni, fFin, dur, vol = 0.06) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return; // jsdom / navegadores sin audio
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === "suspended") audioCtx.resume();
      const t = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(fIni, t);
      osc.frequency.linearRampToValueAtTime(fFin, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g);
      g.connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.03);
    } catch { /* sin audio disponible */ }
  }
  const sonidoIniciar = () => tono(660, 990, 0.16); // tono ascendente: empezar
  const sonidoPausa = () => tono(760, 500, 0.18);   // tono descendente: pausa
  const sonidoDetener = () => tono(560, 320, 0.26); // tono grave: fin

  /* ================== TÍTULO INTELIGENTE ================== */
  const RELLENO = /^(hoy|bueno|ehm|eh|miren|bueno|nada|as[ií]|la verdad|bueno pues|del grupo|de la clase|de los alumnos)[,\s]+/i;

  function generarTitulo(texto) {
    let t = (texto || "").trim();
    if (!t) return "";
    t = t.replace(RELLENO, "");
    // primera oración corta
    let oracion = t.match(/^[^.!?\n]{4,72}(?:[.!?]|$)/);
    let titulo = oracion ? oracion[0] : t;
    titulo = titulo.replace(/[.!?,;]+$/, "").trim();
    if (titulo.length > 68) {
      titulo = titulo.slice(0, 68);
      titulo = titulo.slice(0, titulo.lastIndexOf(" ") > 20 ? titulo.lastIndexOf(" ") : 68) + "…";
    }
    return titulo.charAt(0).toUpperCase() + titulo.slice(1);
  }

  /* ================== NOTAS CLAVE (extracción) ================== */
  const NOMBRES = ["lucia","lucía","mateo","valentina","santiago","emma","mia","benjamín","benjamin",
    "isabella","martina","thiago","julieta","bruno","camila","tomas","tomás","ana","juan","pedro",
    "maria","maría","sofia","sofía","lautaro","delfina","ignacio","renata","joaquin","joaquín",
    "emilia","bautista","olivia","felipe","josefa","agustin","agustín","catalina","derian","elian",
    "gabriel","luciano","micaela","facundo","flor","fiorela","yesica","yesica","kevin","dylan",
    "arial","rocio","rocío","pablo","andres","andrés","carla","ramiro","tiziano","veronica","verónica"];

  const REGLAS = [
    { tipo: "indisciplina", label: "⚡ Indisciplina",
      re: /\b(falt[óoa]|ausente|no (lleg[óoa]|vino|asisti[óo])|golpe[óoa]|pelea|se (pegaron|agarraron)|rompi[óoa]|llor[óoa]|no (hizo|trajo|entreg[óo]) (la )?(tarea|material)|se port[óo] mal|indisciplina|retraso|tardanza|tard[óo]|llam[óo] la atenci[óo]n|conflicto|se burl[óo]n|mal comportamiento)\b/gi },
    { tipo: "destacado", label: "🌟 Destacado",
      re: /\b(destac[óoa]|brill[óoa]|gan[óoa]|mejor[óo]|participaci[óo]n|excelente|muy bien|se esforz[óoa]|felicitaci[óo]n|campe[óo]n|logr[óoa]|avanz[óoa] mucho|10 (puntos|perfecto)|excelente trabajo)\b/gi },
    { tipo: "observacion", label: "📌 Pendiente",
      re: /\b(pendiente|revisar|avisar|llevar|recordar|confirmar|reuni[óo]n|tutor[ae]|evaluar|aprobar|licencia|cambio de (sala|aula)|material especial)\b/gi },
  ];

  function extraerNotasClave(texto) {
    const out = [];
    const t = (texto || "").trim();
    if (!t) return out;

    // 1) Reglas por palabras clave
    for (const reg of REGLAS) {
      reg.re.lastIndex = 0;
      const hits = t.match(reg.re);
      if (hits) {
        const unicos = [...new Set(hits.map((h) => h.toLowerCase()))].slice(0, 3);
        unicos.forEach((h) => out.push({ tipo: reg.tipo, label: reg.label, texto: h }));
      }
    }

    // 2) Nombres: después de alumno/a niñ/o o lista de nombres conocidos
    const vistos = new Set();
    const agregar = (n) => {
      const limpio = n.trim();
      if (!limpio || vistos.has(limpio.toLowerCase())) return;
      vistos.add(limpio.toLowerCase());
      out.push({ tipo: "alumno", label: "👤 Alumno", texto: limpio });
    };

    const trasAlumno = t.match(/\b(?:alumno|alumna|niñ[oa]s?|campe[óo]n)\s+([A-Za-zÁÉÍÓÚáéíóúñÑ]{3,})/gi);
    if (trasAlumno) {
      trasAlumno.forEach((m) => {
        const n = m.replace(/\b(?:alumno|alumna|niñ[oa]s?|campe[óo]n)\s+/i, "");
        if (n) agregar(n.charAt(0).toUpperCase() + n.slice(1));
      });
    }

    // palabras con mayúscula inicial en medio del texto (nombres propios)
    const caps = t.match(/(?:[a-z,;]\s)([A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,})/g);
    if (caps) {
      caps.slice(0, 6).forEach((m) => {
        const n = m.replace(/^[a-z,;\s]+/, "");
        agregar(n);
      });
    }

    // nombres conocidos en minúscula (el reconocimiento no respeta mayúsculas)
    const lower = " " + t.toLowerCase() + " ";
    for (const nom of NOMBRES) {
      if (out.filter((o) => o.tipo === "alumno").length >= 5) break;
      if (lower.includes(" " + nom + " ")) {
        agregar(nom.charAt(0).toUpperCase() + nom.slice(1));
      }
    }

    return out.slice(0, 8);
  }

  /* ================== RENDER HOJA ================== */
  function textoHoja() {
    return $("hojaTexto").value;
  }

  function autoGrow() {
    const ta = $("hojaTexto");
    ta.style.height = "auto";
    ta.style.height = Math.max(210, ta.scrollHeight + 4) + "px";
  }

  function renderEncabezado() {
    $("diaSemana").textContent = capitalize(diaSemanaDe(state.fecha));
    $("fechaLarga").textContent = fechaLargaDe(state.fecha);
    if ($("fechaInput").value !== state.fecha) $("fechaInput").value = state.fecha;
  }

  function renderNotasClave() {
    const cont = $("notasClave");
    const notas = extraerNotasClave(textoHoja());
    cont.innerHTML = "";
    notas.forEach((n) => {
      const el = document.createElement("span");
      el.className = "nota-clave nk-" + n.tipo;
      el.textContent = `${n.label} · ${n.texto}`;
      cont.appendChild(el);
    });
  }

  function actualizarTituloAuto() {
    if (state.tituloManual) return;
    $("notaTitulo").value = generarTitulo(textoHoja());
  }

  /* ================== GRUPO (select + otro) ================== */
  function getGrupo() {
    const sel = $("grupoSelect").value;
    if (sel === "__otro") return ($("grupoOtro").value || "").trim();
    return sel || ($("grupoOtro").value || "").trim();
  }

  function setGrupo(valor) {
    const v = (valor || "").trim();
    const sel = $("grupoSelect");
    const opciones = [...sel.options].map((o) => o.value);
    if (!v) {
      sel.value = "";
      $("grupoOtro").hidden = true;
      $("grupoOtro").value = "";
    } else if (opciones.includes(v)) {
      sel.value = v;
      $("grupoOtro").hidden = true;
      $("grupoOtro").value = "";
    } else {
      sel.value = "__otro";
      $("grupoOtro").hidden = false;
      $("grupoOtro").value = v;
    }
  }

  /* ================== MODO VISTA / EDICIÓN ================== */
  function setModo(modo) {
    state.modo = modo;
    const vista = modo === "vista";
    $("hojaTexto").readOnly = vista;
    $("notaTitulo").readOnly = vista;
    $("grupoSelect").disabled = vista;
    $("grupoOtro").disabled = vista;
    $("hojaTexto").classList.toggle("solo-lectura", vista);
    $("modoPill").hidden = !vista;
    $("btnEditarNota").hidden = !vista;
  }

  function renderEncabezadoNota() {
    const reg = state.editId
      ? state.registros.find((r) => r.id === state.editId)
      : null;
    if (reg) {
      $("notaTitulo").value = reg.titulo;
      $("hojaTexto").value = reg.texto;
      setGrupo(reg.grupo || "");
      state.tituloManual = true;
      $("pieHora").textContent = `${reg.fecha === state.fecha ? reg.hora : ""} ${reg.grupo || ""}`.trim() || "—";
    }
    autoGrow();
    renderNotasClave();
  }

  function renderListaDia() {
    const cont = $("listaGuardadas");
    const delDia = state.registros
      .filter((r) => r.fecha === state.fecha)
      .sort((a, b) => b.hora.localeCompare(a.hora));

    $("countDia").textContent = delDia.length;
    cont.innerHTML = "";

    if (!delDia.length) {
      cont.innerHTML = `<p class="vacio">Todavía no guardaste notas para este día 🌱</p>`;
      return;
    }

    delDia.forEach((r) => {
      const div = document.createElement("div");
      div.className = "chip-nota" + (r.id === state.editId ? " vista-activa" : "");
      div.innerHTML = `
        <span class="hora">${r.hora}</span>
        <div class="info">
          <strong>${esc(r.titulo || "Sin título")}</strong>
          <small>${esc((r.grupo ? r.grupo + " · " : "") + (r.texto || "").slice(0, 70))}</small>
        </div>
        <div class="acts">
          <button data-act="edit" data-id="${r.id}" title="Editar">✏️</button>
          <button data-act="del" data-id="${r.id}" title="Eliminar">🗑️</button>
        </div>`;
      div.setAttribute("data-act", "view");
      div.setAttribute("data-id", r.id);
      div.setAttribute("role", "button");
      div.setAttribute("tabindex", "0");
      div.title = "Ver nota (tocá ✏️ para editar)";
      cont.appendChild(div);
    });
  }

  function renderHistorial() {
    const cont = $("listaHistorial");
    const q = ($("buscarHistorial").value || "").trim().toLowerCase();

    // agrupa por fecha
    const porFecha = {};
    state.registros.forEach((r) => {
      if (
        !q ||
        (r.texto || "").toLowerCase().includes(q) ||
        (r.titulo || "").toLowerCase().includes(q) ||
        (r.grupo || "").toLowerCase().includes(q) ||
        fechaCortaDe(r.fecha).includes(q) ||
        diaSemanaDe(r.fecha).includes(q)
      ) {
        porFecha[r.fecha] = (porFecha[r.fecha] || 0) + 1;
      }
    });

    const fechas = Object.keys(porFecha).sort().reverse();
    cont.innerHTML = "";
    if (!fechas.length) {
      cont.innerHTML = `<p class="hist-vacio">Sin resultados 🕵️</p>`;
      return;
    }
    fechas.forEach((f) => {
      const btn = document.createElement("button");
      btn.className = "hist-item";
      btn.innerHTML = `<span class="fecha">📅 ${capitalize(diaSemanaDe(f))} ${fechaCortaDe(f)}</span>
        <span class="badge">${porFecha[f]} ${porFecha[f] === 1 ? "nota" : "notas"}</span>`;
      btn.addEventListener("click", () => {
        irAFecha(f);
        cerrarDrawer();
      });
      cont.appendChild(btn);
    });
  }

  // Cambia al día indicado y muestra su última nota en modo vista (o hoja nueva)
  function irAFecha(f) {
    const hayBorrador = textoHoja().trim() && state.modo !== "vista";
    if (hayBorrador && state.fecha !== f) {
      if (!confirm("Tenés una nota sin guardar en este día. ¿Cambiar de fecha igualmente?")) return false;
    }
    if (state.voz !== "inactivo") detenerVoz();

    state.fecha = f;
    state.editId = null;
    state.tituloManual = false;
    setModo("nueva");
    renderEncabezado();
    renderListaDia();

    // abrir la última nota creada de esa fecha en modo vista
    const delDia = state.registros.filter((r) => r.fecha === f);
    if (delDia.length) {
      const ultima = delDia[delDia.length - 1]; // se guardan en orden de creación
      verNota(ultima.id, false);
      toast(`👁️ Última nota del ${fechaCortaDe(f)} · tocá ✏️ para editar`);
    } else {
      limpiarHoja(false);
      renderListaDia();
      toast(`📅 ${fechaCortaDe(f)} — sin notas, hoja lista ✍️`);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
    return true;
  }

  function renderTodo() {
    renderEncabezado();
    renderListaDia();
    renderNotasClave();
  }

  const esc = (s) =>
    String(s ?? "")
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  /* ================== VOZ ================== */
  const norm = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();

  // Clave de comparación: minúsculas, sin acentos, sin puntuación y con
  // espacios simples. Así "¿Cómo andás, chicos!" == "como andas chicos".
  function clave(s) {
    return norm(s)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{L}\p{N} ]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // ¿La frase `x` aparece completa (por palabras) dentro de `base`?
  // `margen` acota `base` a los últimos N caracteres (cola del texto).
  function contiene(base, x, margen) {
    if (!x || !base) return false;
    const texto = margen ? base.slice(-margen) : base;
    return new RegExp("(?:^| )" + reEsc(x) + "(?: |$)").test(texto);
  }

  // ¿El texto entrante YA está escrito al final del consolidado? Chrome/Android
  // (bug conocido) devuelve la misma frase como 2 o 3 resultados finales
  // distintos; acá se filtran. Las repeticiones legítimas de una palabra sola
  // solo se filtran si llegaron inmediatamente después de haberla escrito.
  function esRepetido(base, t) {
    const x = clave(t);
    if (!x) return false;
    const b = clave(base);
    if (!b) return false;
    if (!contiene(b, x, x.length + 24)) return false; // solo la cola
    if (x.split(" ").length > 1 || x.length >= 12) return true;
    return Date.now() - state.ultimoAppend < 3000; // eco inmediato del mic
  }

  // Si el final/interino viene "pegado" a lo ya escrito (Chrome re-entrega la
  // frase completa aunque ya se consolidó su principio), devuelve cuántas
  // palabras iniciales se superponen con el final del texto consolidado.
  function palabrasSolapadas(base, t, min = 1) {
    const pb = clave(base).split(" ").filter(Boolean);
    const pt = clave(t).split(" ").filter(Boolean);
    const max = Math.min(pb.length, pt.length);
    for (let k = max; k >= min; k--) {
      if (pb.slice(pb.length - k).join(" ") === pt.slice(0, k).join(" ")) return k;
    }
    return 0;
  }

  // Devuelve el texto sin el solape inicial con lo ya consolidado. Así, si el
  // texto escrito termina en "buenos" y llega "buenos días chicos", solo se
  // agrega "días chicos" → "buenos días chicos" (una sola vez).
  function recortarSolape(t) {
    const texto = String(t || "").trim();
    const k = palabrasSolapadas(state.textoDef, texto, 1);
    if (!k) return texto;
    let cortadas = k;
    return texto
      .split(/\s+/)
      .filter((p) => {
        if (cortadas > 0 && clave(p)) { cortadas--; return false; }
        return true;
      })
      .join(" ")
      .trim();
  }

  // Única puerta de entrada de texto DEFINITIVO al diario: filtra vacíos,
  // solapes y duplicados, y solo entonces concatena.
  function agregarFinal(crudo) {
    const original = String(crudo || "").trim();
    if (!original) return;
    let texto = recortarSolape(original);
    if (!texto) {
      // la frase entera ya estaba al final: es un eco del recognizer salvo que
      // el usuario la esté diciendo de nuevo pasados unos segundos
      if (esRepetido(state.textoDef, original)) return;
      texto = original;
    }
    if (esRepetido(state.textoDef, texto)) return;
    state.textoDef +=
      (state.textoDef && !/\s$/.test(state.textoDef) ? " " : "") + texto + " ";
    state.ultimoAppend = Date.now();
  }

  // Huella de los resultados ya consumidos: permite saber en el próximo evento
  // si la lista que llega es la MISMA o si el navegador arrancó una nueva.
  function reasignarHuellas(results, hasta) {
    const n = Math.min(hasta === undefined ? results.length : hasta, results.length);
    for (let i = 0; i < n; i++) {
      const r = results[i];
      state.huellas[i] = r.isFinal ? clave(r[0] && r[0].transcript) : null;
    }
    state.huellas.length = n;
  }

  // true = sigue llegando la misma lista (los finales ya consumidos coinciden).
  // null intermedio = ese índice era un interino (puede cambiar, no cuenta).
  function listaContinua(results) {
    if (state.consumidos === 0) return true;
    if (results.length < state.consumidos) return false; // lista más corta = nueva
    for (let i = 0; i < state.consumidos; i++) {
      const habia = state.huellas[i];
      if (habia === undefined) return false; // nunca lo vimos: lista rara
      if (habia === null) continue;          // era interino: puede cambiar
      const r = results[i];
      if (clave(r && r[0] && r[0].transcript) !== habia) return false;
    }
    return true;
  }

  // ¿El primer resultado sigue siendo el mismo de antes? Si sí, la lista es la
  // vieja (Chrome la reutiliza al reiniciar) y NO hay que consumirla de nuevo.
  function esListaVieja(results) {
    if (!results.length || state.consumidos === 0) return false;
    const habia = state.huellas[0];
    const visto = clave(state.textoDef + " " + state.interim);
    const actual = clave(results[0][0] && results[0][0].transcript);
    if (!actual) return false;
    if (habia === undefined) return false;
    // o bien coincide con la huella del índice 0, o bien ese índice 0 era un
    // interino que ya estaba a la vista en la hoja
    return habia === actual || ((habia === null) && contiene(visto, actual));
  }

  // Escribe base+interim en la hoja y recuerda QUÉ escribimos, para poder
  // detectar después si el usuario editó el texto a mano.
  function pintarHojaVoz() {
    const ta = $("hojaTexto");
    ta.value = (state.textoDef + state.interim).replace(/^\s+/, "");
    state.ultimoPintado = ta.value;
    autoGrow();
    renderNotasClave();
  }

  // Dobra lo parcial (interim) en el texto definitivo usando SIEMPRE lo que
  // muestra la hoja (así nunca se pisa una edición manual). Idempotente.
  function consolidarPendiente() {
    const visible = textoHoja().replace(/^\s+/, "").trim();
    state.textoDef = visible ? visible + " " : "";
    state.interim = "";
  }

  function setupVoz() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      state.recSoportada = false;
      $("recTexto").textContent = "Voz no disponible — escribí la nota ✍️";
      toast("☹️ Tu navegador no soporta voz. Usá Chrome.");
      return;
    }
    state.recSoportada = true;
    const rec = new SR();
    rec.lang = "es-AR";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (ev) => {
      if (!state.sesionViva) return;
      const ta = $("hojaTexto");

      // 1) ¿Sigue llegando la MISMA lista de resultados? Cuando el navegador
      //    corta y reinicia la sesión (silencio, red inestable…) puede entregar
      //    una lista NUEVA (spec) o reutilizar la VIEJA (Chrome). Se decide por
      //    huella de cada resultado ya consumido, nunca "a ojo":
      //      · lista vieja  → NO se vuelve a consumir nada (evita duplicar).
      //      · lista nueva  → se dobla lo parcial visible y se arranca de cero.
      if (!listaContinua(ev.results)) {
        if (esListaVieja(ev.results)) {
          reasignarHuellas(ev.results); // misma lista, re-sincronizar huellas
        } else {
          consolidarPendiente(); // lo que ya se habló queda consolidado
          state.consumidos = 0;
          state.huellas = [];
        }
      }

      // 2) ¿El usuario editó la hoja a mano mientras grababamos? Manda él.
      if (ta.value !== state.ultimoPintado) {
        const editado = ta.value.trim();
        state.textoDef = editado ? editado + " " : "";
        state.interim = "";
        state.consumidos = Math.max(state.consumidos, ev.results.length);
        reasignarHuellas(ev.results, state.consumidos);
      }

      // 3) Separación estricta final / interino:
      //    · isFinal = true  → se consolida UNA vez (agregarFinal filtra
      //      duplicados y solapes) y el índice consumido avanza para siempre.
      //    · isFinal = false → NO se escribe al diario: el búfer temporal se
      //      limpia en cada evento y solo se MUESTRA el último interino.
      //      Concatenar todos los interinos acumulados era lo que hacía que
      //      las palabras se repitieran 2 o 3 veces mientras hablabas.
      let interim = "";
      for (let i = state.consumidos; i < ev.results.length; i++) {
        const res = ev.results[i];
        const crudo = (res[0] && res[0].transcript) || "";
        if (res.isFinal) {
          state.huellas[i] = clave(crudo);
          agregarFinal(crudo);
          state.consumidos = i + 1;
          // lo parcial anterior quedó superado por este final: se descarta
          interim = "";
        } else {
          state.huellas[i] = null; // interino: puede cambiar o desaparecer
          // gana el interino más reciente y sin el solape con lo ya escrito
          interim = recortarSolape(crudo);
        }
      }
      state.interim = interim;
      pintarHojaVoz();
    };

    rec.onerror = (ev) => {
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        toast("🎙️ Permití el micrófono en tu navegador");
        detenerVoz();
      } else if (ev.error === "no-speech") {
        $("recTexto").textContent = "Escuchando… (hablá cuando quieras)";
      } else if (ev.error === "network") {
        toast("⚠️ Sin red para reconocer voz (seguís pudiendo escribir)");
        detenerVoz();
      } else if (ev.error === "audio-capture") {
        // micrófono inutilizable: cortamos en vez de entrar en bucle
        toast("🎙️ No se pudo usar el micrófono");
        detenerVoz();
      }
      // "aborted"/"no-speech": el navegador corta la sesión y onend decide.
    };

    rec.onend = () => {
      state.sesionViva = false;
      if (state.voz === "grabando") {
        // El navegador cortó la sesión (silencio largo, red inestable…).
        // Se reinicia SIN sonido y con resguardo anti-ráfaga: si las cortadas
        // se encadenan muy seguido, esperamos un poco en vez de hacer
        // "apagar… empezar… apagar…" a lo loco.
        const ahora = Date.now();
        state.rachas = ahora - (state.ultimoInicio || 0) < 2500 ? state.rachas + 1 : 0;
        const espera = state.rachas >= 3 ? Math.min(800 * (state.rachas - 2), 5000) : 0;
        setTimeout(() => {
          if (state.voz !== "grabando") return;
          try {
            state.rec.start();
            state.sesionViva = true;
            state.ultimoInicio = Date.now();
          } catch { /* ya estaba iniciado */ }
        }, espera);
      } else if (state.voz === "pausado") {
        consolidarPendiente(); // la sesión murió estando pausado
      }
    };

    state.rec = rec;
  }

  function iniciarVoz() {
    if (state.modo === "vista") {
      toast("✏️ Tocá el lápiz para editar esta nota");
      return;
    }
    if (!state.recSoportada) {
      toast("✍️ Escribí tu nota directamente en la hoja");
      return;
    }
    if (state.voz !== "inactivo") return; // ya grabando o pausado
    const previo = textoHoja().trim();
    state.textoDef = previo ? previo + " " : "";
    state.interim = "";
    state.consumidos = 0;
    state.huellas = [];
    state.ultimoAppend = 0;
    state.sesionViva = false;
    try {
      state.rec.start();
      state.sesionViva = true;
      state.ultimoInicio = Date.now();
      state.rachas = 0;
      state.ultimoPintado = textoHoja();
      state.voz = "grabando";
      arrancarTimer();
      actualizarUIVoz();
      $("recTexto").textContent = "Grabando… contá lo que pasó 🎧";
      sonidoIniciar(); // ← único momento con sonido de "inicio"
      toast("🎙️ Escuchando…");
    } catch {
      toast("⚠️ No se pudo iniciar el micrófono");
    }
  }

  function pausarVoz() {
    if (state.voz !== "grabando") return;
    let pausadaNativamente = false;
    if (state.rec.pause) {
      // Pausa nativa: la sesión sigue viva, no se consolida nada todavía
      // (doblar el interim y luego recibir su final duplicaría el texto).
      try { state.rec.pause(); pausadaNativamente = true; } catch {}
    }
    if (!pausadaNativamente) {
      try { state.rec.stop(); } catch {}
      state.sesionViva = false;
      consolidarPendiente(); // dobla lo parcial en el definitivo
      pintarHojaVoz();
    }
    state.voz = "pausado";
    pararTimer();
    actualizarUIVoz();
    $("recTexto").textContent = "En pausa ⏸️";
    actualizarTituloAuto();
    sonidoPausa(); // ← único momento con sonido de "pausa"
  }

  function reanudarVoz() {
    if (state.voz !== "pausado") return;
    if (state.modo === "vista") {
      toast("✏️ Tocá el lápiz para editar esta nota");
      return;
    }
    const listo = () => {
      state.voz = "grabando";
      arrancarTimer();
      actualizarUIVoz();
      $("recTexto").textContent = "Grabando… 🎧";
      sonidoIniciar(); // retoma con el mismo tono de inicio
    };
    if (state.sesionViva && state.rec.resume) {
      try { state.rec.resume(); listo(); return; } catch { /* cae a start */ }
    }
    try {
      state.rec.start();
      state.sesionViva = true;
      state.ultimoInicio = Date.now();
      state.rachas = 0;
      listo();
    } catch {
      toast("⚠️ No se pudo reanudar");
    }
  }

  function detenerVoz() {
    const estabaActiva = state.voz !== "inactivo";
    try { state.rec && state.rec.stop(); } catch {}
    state.sesionViva = false;
    state.voz = "inactivo";
    if (estabaActiva) {
      consolidarPendiente();
      pintarHojaVoz();
      sonidoDetener(); // ← único momento con sonido de "fin"
    }
    state.consumidos = 0;
    state.huellas = [];
    pararTimer();
    actualizarUIVoz();
    $("recTexto").textContent = "Detenido ✋ guardá tu nota";
    actualizarTituloAuto();
    renderNotasClave();
  }

  function actualizarUIVoz() {
    const mic = $("btnMic");
    const grabando = state.voz === "grabando";
    const pausado = state.voz === "pausado";
    mic.classList.toggle("recording", grabando);
    $("btnPausa").disabled = !(grabando || pausado);
    $("btnPausa").textContent = pausado ? "▶️" : "⏸️";
    $("btnPausa").setAttribute("aria-label", pausado ? "Reanudar" : "Pausar");
    $("btnDetener").disabled = !(grabando || pausado);
    const dot = $("recDot");
    dot.classList.toggle("on", grabando);
    dot.classList.toggle("pause", pausado);
  }

  /* ---- timer ---- */
  function arrancarTimer() {
    if (state.timerId) return;
    state.timerId = setInterval(() => {
      state.segundos++;
      const m = Math.floor(state.segundos / 60), s = state.segundos % 60;
      $("recTiempo").textContent = `${pad(m)}:${pad(s)}`;
    }, 1000);
  }
  function pararTimer() {
    clearInterval(state.timerId);
    state.timerId = null;
  }

  /* ================== GUARDAR / EDITAR ================== */
  function guardarNota() {
    // Si está grabando, guardar PAUSA la grabación (no se sigue grabando
    // sola detrás de la nota guardada). Con ✏️ + ▶️ se retoma donde estaba.
    if (state.voz === "grabando") pausarVoz();
    if (state.modo === "vista") {
      toast("✏️ Estás en vista previa · tocá el lápiz para editar");
      return;
    }
    const texto = textoHoja().trim();
    if (!texto) {
      toast("✍️ La nota está vacía");
      return;
    }
    const titulo = ($("notaTitulo").value || "").trim() || generarTitulo(texto) || "Nota sin título";
    const grupo = getGrupo();
    const notas = extraerNotasClave(texto);

    if (state.editId) {
      const reg = state.registros.find((r) => r.id === state.editId);
      if (reg) {
        Object.assign(reg, { titulo, grupo, texto, notas, fecha: state.fecha });
        toast("✏️ Nota actualizada");
      }
    } else {
      const reg = {
        id: Date.now() + "-" + Math.random().toString(36).slice(2, 7),
        fecha: state.fecha,
        hora: horaAhora(),
        titulo, grupo, texto, notas,
      };
      state.registros.push(reg);
      state.editId = reg.id;
      state.tituloManual = true;
    }
    persistir();
    renderListaDia();
    setModo("vista"); // recién guardada → queda protegida hasta tocar ✏️
    $("pieHora").textContent = `${horaAhora()}${grupo ? " · " + grupo : ""}`;
    toast("💾 Guardada · tocá ✏️ si querés seguir editando");
  }

  function limpiarHoja(conToast = true) {
    state.editId = null;
    state.tituloManual = false;
    state.textoDef = "";
    state.interim = "";
    state.consumidos = 0;
    state.huellas = [];
    state.ultimoAppend = 0;
    state.segundos = 0;
    setModo("nueva");
    $("recTiempo").textContent = "00:00";
    $("hojaTexto").value = "";
    $("notaTitulo").value = "";
    setGrupo("");
    $("pieHora").textContent = "—";
    autoGrow();
    renderNotasClave();
    if (conToast) toast("🧹 Hoja nueva");
  }

  // Carga una nota en el modo indicado: "vista" (solo lectura) o "edicion"
  function cargarNota(id, modo = "vista") {
    const reg = state.registros.find((r) => r.id === id);
    if (!reg) return;
    if (state.voz !== "inactivo") detenerVoz();
    const cambiando = state.fecha !== reg.fecha;
    state.editId = reg.id;
    state.fecha = reg.fecha;
    state.tituloManual = true;
    setModo(modo);
    renderEncabezado();
    renderEncabezadoNota();
    renderListaDia();
    if (!cambiando) window.scrollTo({ top: 0, behavior: "smooth" });
    toast(modo === "vista" ? "👁️ Viendo nota · ✏️ para editar" : "✏️ Editando nota");
  }

  // Alias semántico: clic en la nota → vista; lápiz → edición
  function verNota(id, scrollear = true) {
    cargarNota(id, "vista");
    if (scrollear) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function eliminarNota(id) {
    const reg = state.registros.find((r) => r.id === id);
    if (!reg) return;
    if (!confirm(`¿Eliminar la nota "${reg.titulo}"?`)) return;
    state.registros = state.registros.filter((r) => r.id !== id);
    if (state.editId === id) limpiarHoja(false);
    persistir();
    renderListaDia();
    renderHistorial();
    toast("🗑️ Nota eliminada");
  }

  /* ================== DATOS PARA EXPORTAR ================== */
  function notasDelDia() {
    const lista = state.registros
      .filter((r) => r.fecha === state.fecha)
      .slice()
      .sort((a, b) => a.hora.localeCompare(b.hora));
    // incluir borrador actual si tiene texto y no está guardado
    const borrador = textoHoja().trim();
    if (borrador && !state.editId) {
      lista.push({
        fecha: state.fecha,
        hora: horaAhora(),
        titulo: ($("notaTitulo").value || "").trim() || generarTitulo(borrador) || "Nota sin título",
        grupo: getGrupo(),
        texto: borrador,
        notas: extraerNotasClave(borrador),
      });
    } else if (borrador && state.editId) {
      const i = lista.findIndex((r) => r.id === state.editId);
      if (i >= 0) {
        lista[i] = {
          ...lista[i],
          titulo: ($("notaTitulo").value || "").trim() || lista[i].titulo,
          grupo: getGrupo(),
          texto: borrador,
          notas: extraerNotasClave(borrador),
        };
      }
    }
    return lista;
  }

  function formatoElegido() {
    const r = document.querySelector('input[name="formato"]:checked');
    return r ? r.value : "pdf";
  }

  /* ================== EXPORTAR / COMPARTIR ================== */
  function extrasExport() {
    return { generado: `${fechaCortaDe(hoyISO())} a las ${horaAhora()} · Diario del docente` };
  }

  // Nota que se está viendo/editando en la hoja (o su borrador)
  function notaActual() {
    const texto = textoHoja().trim();
    if (!texto) return null;
    const guardada = state.editId ? state.registros.find((r) => r.id === state.editId) : null;
    return {
      id: guardada ? guardada.id : null,
      fecha: guardada ? guardada.fecha : state.fecha,
      hora: guardada ? guardada.hora : horaAhora(),
      titulo: ($("notaTitulo").value || "").trim() || generarTitulo(texto) || "Nota sin título",
      grupo: getGrupo(),
      texto,
      notas: extraerNotasClave(texto),
    };
  }

  // alcance: "nota" (hoja actual) | "dia" (día activo) | "todo" (diario completo)
  function generarArchivo(alcance = "dia") {
    let registros, extras = extrasExport();

    if (alcance === "nota") {
      const n = notaActual();
      if (!n) {
        toast("✍️ La hoja está vacía");
        return null;
      }
      registros = [n];
    } else if (alcance === "todo") {
      registros = state.registros
        .slice()
        .sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
      if (!registros.length) {
        toast("📭 Tu diario todavía no tiene notas");
        return null;
      }
      extras.agruparPorFecha = true;
    } else {
      registros = notasDelDia();
      if (!registros.length) {
        toast("📭 No hay notas para este día");
        return null;
      }
    }

    const fmt = formatoElegido();
    const base =
      alcance === "todo" ? "diario_completo"
      : alcance === "nota" ? `nota_${registros[0].fecha}`
      : `diario_${state.fecha}`;

    if (fmt === "word") {
      return {
        blob: window.DEDExport.construirDOCX(registros, registros[0].fecha, extras),
        name: `${base}.docx`,
        mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        label: "Word",
        registros,
      };
    }
    return {
      blob: new Blob([window.DEDExport.construirPDF(registros, registros[0].fecha, extras)], {
        type: "application/pdf",
      }),
      name: `${base}.pdf`,
      mime: "application/pdf",
      label: "PDF",
      registros,
    };
  }

  function descargar(archivo) {
    const url = URL.createObjectURL(archivo.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = archivo.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function exportarDia() {
    const archivo = generarArchivo("dia");
    if (!archivo) return;
    descargar(archivo);
    cerrarDrawer();
    toast(`⬇️ Día exportado en ${archivo.label}`);
  }

  /* ---- Modal de compartir: ¿nota actual o todo el diario? ---- */
  function abrirModalShare() {
    if (!textoHoja().trim() && !state.registros.length) {
      toast("📭 Todavía no hay nada para compartir");
      return;
    }
    cerrarDrawer();
    $("shareModal").hidden = false;
  }
  function cerrarModalShare() {
    $("shareModal").hidden = true;
  }

  async function compartirDia(alcance = "dia") {
    const archivo = generarArchivo(alcance);
    if (!archivo) return;
    cerrarDrawer();
    cerrarModalShare();

    const regs = archivo.registros;
    let resumen;
    if (alcance === "nota") {
      const r = regs[0];
      resumen =
        `📒 *${r.titulo}*\n📅 ${capitalize(diaSemanaDe(r.fecha))} ${fechaCortaDe(r.fecha)}` +
        `${r.grupo ? `\n🏫 ${r.grupo}` : ""}\n\n${r.texto}`;
    } else if (alcance === "todo") {
      const fechas = [...new Set(regs.map((r) => r.fecha))];
      resumen =
        `📒 *Mi Diario Escolar completo*\n📕 ${regs.length} notas · ${fechas.length} días\n` +
        ` (${fechaCortaDe(fechas[0])} → ${fechaCortaDe(fechas[fechas.length - 1])})`;
    } else {
      resumen =
        `📒 *Diario de clase — ${capitalize(diaSemanaDe(state.fecha))} ${fechaCortaDe(state.fecha)}*\n` +
        regs.map((r) => `• ${r.hora}${r.grupo ? " (" + r.grupo + ")" : ""}: ${r.titulo}`).join("\n");
    }

    const file = new File([archivo.blob], archivo.name, { type: archivo.mime });

    if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
      try {
        await navigator.share({
          title: `Diario de clase ${fechaCortaDe(state.fecha)}`,
          text: resumen,
          files: [file],
        });
        toast("📲 ¡Compartido!");
      } catch (err) {
        if (err && err.name !== "AbortError") {
          descargar(archivo);
          toast("⬇️ No se pudo compartir, se descargó el archivo");
        }
      }
    } else {
      // fallback: copiar resumen + descargar
      try {
        await navigator.clipboard.writeText(resumen);
        descargar(archivo);
        toast("📋 Resumen copiado + archivo descargado");
      } catch {
        descargar(archivo);
        toast("⬇️ Archivo descargado (tu navegador no comparte archivos)");
      }
    }
  }

  /* ================== DRAWER ================== */
  function abrirDrawer() {
    $("drawer").classList.add("open");
    const s = $("scrim");
    s.hidden = false;
    requestAnimationFrame(() => s.classList.add("show"));
  }
  function cerrarDrawer() {
    $("drawer").classList.remove("open");
    const s = $("scrim");
    s.classList.remove("show");
    setTimeout(() => { s.hidden = true; }, 280);
  }

  /* ================== EVENTOS ================== */
  function eventos() {
    // drawer
    $("btnMenu").addEventListener("click", abrirDrawer);
    $("scrim").addEventListener("click", cerrarDrawer);

    document.querySelectorAll(".drawer-item[data-panel]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const panel = $(btn.dataset.panel);
        const abrir = panel.hidden;
        document.querySelectorAll(".drawer-panel").forEach((p) => (p.hidden = true));
        document.querySelectorAll(".drawer-item").forEach((b) => b.classList.remove("active"));
        panel.hidden = !abrir;
        if (abrir) btn.classList.add("active");
        if (btn.dataset.panel === "panelHistorial") renderHistorial();
      });
    });

    $("btnExportar").addEventListener("click", () => exportarDia());
    $("btnCompartirMenu").addEventListener("click", () => abrirModalShare());
    $("btnShareTop").addEventListener("click", () => abrirModalShare());
    $("buscarHistorial").addEventListener("input", renderHistorial);

    // modal de compartir (nota actual vs todo el diario)
    $("shareModal").addEventListener("click", (e) => {
      if (e.target === $("shareModal")) { cerrarModalShare(); return; } // clic fuera
      const btn = e.target.closest("button[data-share]");
      if (!btn) return;
      const scope = btn.dataset.share;
      if (scope === "cancel") cerrarModalShare();
      else compartirDia(scope);
    });

    // grupo: "Otro…" muestra el campo libre
    $("grupoSelect").addEventListener("change", () => {
      const esOtro = $("grupoSelect").value === "__otro";
      $("grupoOtro").hidden = !esOtro;
      if (esOtro) $("grupoOtro").focus();
    });

    // lápiz de la hoja: pasa de vista a edición
    $("btnEditarNota").addEventListener("click", () => {
      setModo("edicion");
      $("hojaTexto").focus();
      toast("✏️ Editá la nota y guardá con 💾");
    });

    // voz
    $("btnMic").addEventListener("click", () => {
      if (state.voz === "inactivo") iniciarVoz();
      else detenerVoz();
    });
    $("btnPausa").addEventListener("click", () => {
      state.voz === "grabando" ? pausarVoz() : reanudarVoz();
    });
    $("btnDetener").addEventListener("click", detenerVoz);
    $("btnGuardar").addEventListener("click", guardarNota);
    $("btnNueva").addEventListener("click", () => {
      if (state.voz !== "inactivo") detenerVoz();
      limpiarHoja();
    });

    // hoja
    $("hojaTexto").addEventListener("input", () => {
      autoGrow();
      renderNotasClave();
      debounceTitulo();
    });
    $("notaTitulo").addEventListener("input", () => {
      state.tituloManual = true;
    });

    // fecha
    $("fechaInput").addEventListener("change", (e) => {
      const nueva = e.target.value || hoyISO();
      if (!irAFecha(nueva)) e.target.value = state.fecha;
    });

    // lista del día: clic en la nota → vista · ✏️ → edición · 🗑️ → eliminar
    $("listaGuardadas").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-act]");
      if (btn) {
        btn.dataset.act === "edit"
          ? cargarNota(btn.dataset.id, "edicion")
          : eliminarNota(btn.dataset.id);
        return;
      }
      const chip = e.target.closest("[data-act='view']");
      if (chip) verNota(chip.dataset.id);
    });
    // Enter/Espacio en la nota también la abre en vista
    $("listaGuardadas").addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const chip = e.target.closest("[data-act='view']");
      if (chip) {
        e.preventDefault();
        verNota(chip.dataset.id);
      }
    });

    // atajo teclado: Ctrl/Cmd + G guardar
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "g") {
        e.preventDefault();
        guardarNota();
      }
    });
  }

  let tituloTimer = null;
  function debounceTitulo() {
    clearTimeout(tituloTimer);
    tituloTimer = setTimeout(actualizarTituloAuto, 700);
  }

  /* ================== SERVICE WORKER ================== */
  function registrarSW() {
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("sw.js").catch(() => {
          /* GitHub Pages / file: fallar es inofensivo */
        });
      });
    }
  }

  /* ================== SPLASH ================== */
  function ocultarSplash() {
    const s = $("splash");
    setTimeout(() => s.classList.add("hide"), 750);
    setTimeout(() => s.remove(), 1500);
  }

  /* ================== INIT ================== */
  let inicializado = false;
  function init() {
    if (inicializado) return; // evita doble init si DOMContentLoaded se dispara 2 veces
    inicializado = true;
    state.registros = cargar();
    state.fecha = hoyISO();
    $("fechaInput").value = state.fecha;
    setModo("nueva");
    renderTodo();
    setupVoz();
    actualizarUIVoz();
    eventos();
    autoGrow();
    registrarSW();
    ocultarSplash();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
