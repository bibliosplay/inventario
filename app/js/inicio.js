/**
 * inicio.js — página de inicio: escritorio, iconos, buscador y barra de tareas.
 *
 * Todo lo que se ve sale de HERRAMIENTAS (manifiesto.js): una entrada por
 * archivo de `archivos/`. El número de iconos del escritorio y de ventanas
 * posibles es, por tanto, siempre el número de archivos del proyecto.
 */

import { HERRAMIENTAS, indice, normalizar, rutaArchivo, rutaDatos } from './manifiesto.js';
import { crearGestor } from './gestor.js';
import { montarMarco } from './vistas/marco.js';

const nf = new Intl.NumberFormat('es-CL');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const $ = (sel) => document.querySelector(sel);

/** Enlaces a los originales, derivados del mismo manifiesto que los iconos. */
function pintarPie() {
  $('#pie-archivos').innerHTML = HERRAMIENTAS
    .map((h) => `<a class="pie__enlace" href="${rutaArchivo(h)}" title="Abrir el archivo original">${esc(h.archivo)}</a>`)
    .join('');
}

/* ------------------------------------------------------------------ tema -- */

const CLAVE_TEMA = 'bpm_tema';
function aplicarTema(t) {
  document.documentElement.dataset.tema = t;
  try { localStorage.setItem(CLAVE_TEMA, t); } catch { /* sin almacenamiento */ }
  const b = $('#tema');
  if (b) {
    b.textContent = t === 'oscuro' ? '☀' : '☾';
    b.title = t === 'oscuro' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro';
    b.setAttribute('aria-label', b.title);
  }
}

const alternarTema = () => aplicarTema(document.documentElement.dataset.tema === 'oscuro' ? 'claro' : 'oscuro');

/* ---------------------------------------------------------------- iconos -- */

function pintarIconos() {
  const rejilla = $('#rejilla');
  rejilla.innerHTML = HERRAMIENTAS.map((h) => `
    <button class="icono" data-id="${h.id}" style="--tono-icono:${h.color}"
            title="${esc(h.resumen)}">
      <span class="icono__marca" aria-hidden="true">${h.icono}<span class="icono__punto"></span></span>
      <span class="icono__nombre">${esc(h.etiqueta)}</span>
      <span class="icono__archivo">${esc(h.archivo)}</span>
      <span class="icono__detalle">${esc(h.resumen)}</span>
    </button>`).join('');

  rejilla.querySelectorAll('.icono').forEach((b) => {
    b.addEventListener('click', () => abrir(b.dataset.id));
  });
}

const marcarAbiertas = (ids) => {
  document.querySelectorAll('.icono').forEach((b) => {
    b.dataset.activo = ids.includes(b.dataset.id) ? '1' : '0';
  });
};

/* -------------------------------------------------------------- buscador -- */

function montarBuscador() {
  const campo = $('#q');
  const caja = $('#resultados');
  const base = indice();
  let cursor = -1;

  const cerrar = () => { caja.hidden = true; cursor = -1; };

  function pintar(q) {
    const limpio = normalizar(q.trim());
    if (!limpio) return cerrar();
    const hallados = base
      .map((h) => ({ h, p: puntuar(h.texto, limpio) }))
      .filter((x) => x.p > 0)
      .sort((a, b) => b.p - a.p)
      .slice(0, 8);

    if (!hallados.length) {
      caja.innerHTML = '<p class="vacio" style="padding:18px 12px">Ninguna herramienta coincide con esa búsqueda.</p>';
      caja.hidden = false;
      return;
    }
    caja.innerHTML = hallados.map(({ h }, i) => `
      <button class="resultado" data-id="${h.id}" data-i="${i}" aria-selected="false" role="option">
        <span class="resultado__icono" aria-hidden="true">${h.icono}</span>
        <span class="resultado__txt">
          <span class="resultado__titulo">${resaltar(h.titulo, q.trim())}</span>
          <span class="resultado__meta">${esc(h.archivo)}</span>
        </span>
      </button>`).join('');
    caja.hidden = false;
    cursor = -1;
    caja.querySelectorAll('.resultado').forEach((b) => {
      b.addEventListener('click', () => { campo.value = ''; cerrar(); abrir(b.dataset.id); });
    });
  }

  function mover(delta) {
    const items = [...caja.querySelectorAll('.resultado')];
    if (!items.length) return;
    cursor = (cursor + delta + items.length) % items.length;
    items.forEach((b, i) => b.setAttribute('aria-selected', String(i === cursor)));
    items[cursor].scrollIntoView({ block: 'nearest' });
  }

  campo.addEventListener('input', () => pintar(campo.value));
  campo.addEventListener('focus', () => { if (campo.value) pintar(campo.value); });
  campo.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); mover(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); mover(-1); }
    else if (e.key === 'Enter') {
      const sel = caja.querySelector('.resultado[aria-selected="true"]') || caja.querySelector('.resultado');
      if (sel) { e.preventDefault(); campo.value = ''; cerrar(); abrir(sel.dataset.id); }
    } else if (e.key === 'Escape') { campo.value = ''; cerrar(); campo.blur(); }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.buscador')) cerrar();
  });
  $('#limpiar').addEventListener('click', () => { campo.value = ''; cerrar(); campo.focus(); });

  // Ctrl/Cmd + K enfoca el buscador, como en cualquier escritorio
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      campo.focus();
      campo.select();
    }
  });
}

/** Puntúa por dónde aparece la palabra: el nombre pesa más que el resumen. */
function puntuar(texto, q) {
  let p = 0;
  for (const palabra of q.split(/\s+/).filter(Boolean)) {
    if (texto.includes(palabra)) p += 2;
  }
  if (texto.startsWith(q)) p += 6;
  return p;
}

function resaltar(texto, q) {
  const palabras = normalizar(q).split(/\s+/).filter(Boolean).sort((a, b) => b.length - a.length);
  let salida = esc(texto);
  for (const p of palabras) {
    if (p.length < 2) continue;
    const re = new RegExp(`(${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    salida = salida.replace(re, '<mark>$1</mark>');
  }
  return salida;
}

/* ------------------------------------------------------------- barreno --- */

let gestor;

/** Carga la vista que corresponde al tipo de herramienta. */
async function alAbrirContenido(h, cuerpo) {
  try {
    if (h.tipo === 'marco') {
      return montarMarco(h, cuerpo);
    }
    const mod = await import(`./vistas/${h.vista}.js`);
    return await mod.montar(h, cuerpo);
  } catch (e) {
    // una herramienta que falle no debe dejar la ventana en blanco
    console.error(`No se pudo abrir «${h.titulo}»:`, e);
    cuerpo.innerHTML = `<div class="vacio">
      <p><b>No se pudo abrir ${h.etiqueta}.</b></p>
      <p style="font-size:12.5px;margin-top:6px">${esc(e.message || e)}</p>
      <p style="font-size:12.5px;margin-top:10px">
        Puedes abrir el archivo original:
        <a href="${rutaArchivo(h)}" target="_blank" rel="noopener">${esc(h.archivo)}</a>
      </p></div>`;
  }
}

function abrir(id) {
  gestor.abrir(id);
  if (location.hash !== `#/${id}`) history.replaceState(null, '', `#/${id}`);
}

/* ---------------------------------------------------------------- arranque */

async function arrancar() {
  aplicarTema(document.documentElement.dataset.tema || 'claro');
  pintarIconos();
  pintarPie();
  montarBuscador();

  // iconos y ventanas posibles: uno por cada entrada del manifiesto
  const total = HERRAMIENTAS.length;
  $('#k-iconos').textContent = total;
  $('#k-ventanas').textContent = total;

  gestor = crearGestor({
    zona: $('#zona'),
    barraTareas: $('#tareas'),
    manifiesto: HERRAMIENTAS,
    alAbrirContenido,
    alCambiar: marcarAbiertas,
  });

  $('#tema').addEventListener('click', alternarTema);
  $('#reiniciar').addEventListener('click', () => {
    gestor.reiniciarDisposicion();
    history.replaceState(null, '', location.pathname);
  });

  // los dos botones que pliegan la barra de tareas hacen lo mismo
  const plegarBarra = (e) => {
    const visible = gestor.alternarBarraTareas();
    for (const b of document.querySelectorAll('#b-tareas, #b-minimizar')) {
      b.dataset.activo = visible ? '1' : '0';
      b.title = b.ariaLabel = visible ? 'Ocultar la barra de tareas' : 'Mostrar la barra de tareas';
    }
  };
  $('#b-tareas').addEventListener('click', plegarBarra);
  $('#b-minimizar').addEventListener('click', plegarBarra);

  // cifras de cabecera, desde el resumen del libro (8 KB)
  try {
    const R = await fetch(rutaDatos('resumen.json')).then((r) => r.json());
    const total = R.control.totalResumen;
    const encontrados = R.orden.reduce((a, cod) => a + R.colecciones[cod].Verde, 0);
    $('#k-total').textContent = nf.format(total);
    $('#k-colecciones').textContent = R.orden.length;
    $('#k-archivos').textContent = HERRAMIENTAS.length;
    $('#encontrados').textContent = nf.format(encontrados);
    $('#pct-encontrados').textContent = `${Math.round((encontrados / total) * 100)}% de la colección verificada en estante`;
  } catch {
    $('#k-total').textContent = '—';
  }

  // vuelve como se dejó, o abre lo que diga la URL
  gestor.restaurarSesion();
  const desdeUrl = location.hash.replace(/^#\//, '');
  if (desdeUrl && HERRAMIENTAS.some((h) => h.id === desdeUrl)) gestor.abrir(desdeUrl);
}

document.addEventListener('DOMContentLoaded', arrancar);
