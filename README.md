# 📒 Diario Escolar de Voz (DED)

**PWA móvil para docentes de primaria.** Grabá con voz lo que pasó en clase, mirá la
transcripción en vivo sobre una hoja de cuaderno, y exportá el día a PDF o Word.
Funciona **sin internet** y **sin login**: todo se guarda en el teléfono.

## ✨ Funciones

| Área | Qué hace |
|---|---|
| 🎙️ **Voz dinámica** | Grabar, pausar, reanudar y detener. Transcripción en tiempo real (Web Speech API, es-AR). |
| 📄 **Hoja de cuaderno** | Encabezado automático con día de la semana y fecha (con selector para cambiarla). |
| 💡 **Título inteligente** | Se genera solo a partir del texto hablado (y es editable a mano). |
| 🏷️ **Notas clave** | Extrae automáticamente alumnos mencionados, destacados, incidencias y pendientes, mostrados como stickers en la hoja. |
| 📚 **Historial / Buscador** | En el menú lateral: busca por fecha, grupo o palabra. Al elegir un día te lleva a su **última nota en modo vista**. |
| 👁️ **Modo vista / ✏️ edición** | Las notas se abren en solo lectura para no modificarlas sin querer; el lápiz habilita la edición. |
| 📥 **Exportación** | PDF con diseño idéntico a la hoja de cuaderno, o Word `.docx` real. Sin librerías: se generan desde cero. |
| 📲 **Compartir** | Elegís **solo la nota actual** o **todo el diario** → Web Share API (WhatsApp u otras apps). |
| 🔒 **Local** | `localStorage` únicamente. Nada viaja a un servidor. |
| 📱 **Instalable** | `manifest.json` + splash screen → "Agregar a pantalla de inicio". |
| 📴 **Offline** | Service worker cachea el shell de la app. |

## 🗂 Estructura

```
├── index.html          # app (mobile first)
├── style.css           # estética hoja de cuaderno pastel
├── app.js              # lógica: voz, notas, export, share, drawer
├── exporters.js        # generador de PDF y DOCX desde cero (sin libs)
├── sw.js               # service worker (offline)
├── manifest.json       # PWA instalable + splash
├── icons/              # iconos 192 / 512 / maskable / apple-touch
├── make-icons.ps1      # regenera los íconos PNG
├── test-exporters.js   # valida PDF (xref) y DOCX (zip + CRC32)
└── test-ids.js         # valida que existan los IDs del DOM
```

## 🧪 Tests

```bash
node test-exporters.js   # estructura PDF y DOCX (incluye multi-fecha)
node test-ids.js         # IDs del DOM
node test-smoke.js       # flujo completo con jsdom (requiere: npm i --no-save jsdom)
```

## 🚀 Subir a GitHub Pages

1. Creá un repo en GitHub (puede ser **público** o con Pages habilitado en privado).
2. Desde esta carpeta:

   ```bash
   git init
   git add .
   git commit -m "Diario Escolar de Voz - PWA"
   git branch -M main
   git remote add origin https://github.com/TU-USUARIO/TU-REPO.git
   git push -u origin main
   ```

3. En GitHub: **Settings → Pages → Source: Deploy from a branch → `main` / `/ (root)` → Save**.
4. Esperá un minuto: tu app queda en
   `https://TU-USUARIO.github.io/TU-REPO/`
5. Desde el celular (Chrome/Edge Android o Safari iOS), abrí el link → menú ⋮ →
   **"Instalar aplicación"** / **"Agregar a pantalla de inicio"**.

> 📌 El `manifest.json` usa rutas relativas (`"./"`), así que funciona igual en la raíz
> de un dominio o dentro de una subcarpeta de GitHub Pages.

## 🎤 Nota sobre el reconocimiento de voz

- **Android / Chrome**: funciona perfecto, incluso offline (usa servicios de Google).
- **iOS / Safari**: el soporte es limitado; si no está disponible, la app lo avisa y
  podés escribir directamente en la hoja.
- En `file://` (abrir el HTML con doble clic) **no funciona la voz ni el service worker**:
  usá un servidor local o el link de GitHub Pages.

## 📱 Probar en local

```bash
npx http-server -p 8321        # y abrir http://localhost:8321
# o
python -m http.server 8000     # y abrir http://localhost:8000
```
