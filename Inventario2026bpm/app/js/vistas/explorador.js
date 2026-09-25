/**
 * vistas/explorador.js — vista propia para el archivo .xlsx
 *
 * Traduce la hoja de cálculo a algo navegable:
 *   · Resumen  — las cifras oficiales por colección y estado, tal como la hoja
 *                "Resumen" del libro, más los cruces derivados de las 24.564
 *                fichas (materiales y clasificación Dewey).
 *   · Detalle  — las fichas una a una, con búsqueda, filtros, orden y
 *                exportación a CSV.
 *
 * El libro pesa 7,2 MB, así que `datos/items.json` (6,1 MB, con las columnas de
 * pocos valores repetidos codificadas por diccionario) se trae solo cuando se
 * pide la vista de detalle, y no al abrir la ventana.
 */

import { rutaDatos, rutaArchivo } from '../manifiesto.js';

/* ------------------------------------------------------------------ datos -- */

const ETIQUETAS = {
  nSistema: 'N° sistema', titulo: 'Título', autor: 'Autor', codigo: 'Código de barras',
  nota: 'Nota interna', proceso: 'Estatus de proceso', item: 'Estatus de ítem',
  clasificacion: 'Clasificación', inventario: 'N° de inventario', coleccion: 'Colección',
  editorial: 'Editorial', isbn: 'ISBN', descripcion: 'Descripción', material: 'Material',
  fCreacion: 'Fecha de creación', fActualiz: 'Fecha de actualización',
  estadistica: 'Estadística', fInventario: 'Fecha de inventario',
  fUltimoInv: 'Último inventario', itemizador: 'Itemizador', estado: 'Observación',
};
const ORDEN_ETIQUETAS = Object.keys(ETIQUETAS);

// columnas por las que se busca texto libre
const BUSCABLES = ['titulo', 'autor', 'clasificacion', 'codigo', 'isbn', 'nSistema', 'descripcion'];
// columnas de la tabla de fichas, en orden
const VISIBLES = ['nSistema', 'titulo', 'autor', 'clasificacion', 'coleccion', 'material', 'estado', 'codigo'];

const nf = new Intl.NumberFormat('es-CL');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const pct = (n, t) => (t ? `${Math.round((n / t) * 100)}%` : '0%');

let RESUMEN = null;         // datos/resumen.json  (8 KB, siempre)  → el objeto
let promesaResumen = null;  // ...en curso, en vuelo
let ITEMS = null;           // datos/items.json    (6,1 MB, bajo demanda)
let cargandoItems = null;

function cargarResumen() {
  if (RESUMEN) return Promise.resolve(RESUMEN);
  if (promesaResumen) return promesaResumen;
  promesaResumen = fetch(rutaDatos('resumen.json'))
    .then((r) => {
      if (!r.ok) throw new Error(`resumen.json respondió ${r.status}`);
      return r.json();
    })
    .then((datos) => {
      RESUMEN = datos;          // el asiento guarda los datos, no la promesa
      return datos;
    });
  return promesaResumen;
}

function cargarItems() {
  if (ITEMS) return Promise.resolve(ITEMS);
  if (cargandoItems) return cargandoItems;
  cargandoItems = fetch(rutaDatos('items.json'))
    .then((r) => {
      if (!r.ok) throw new Error(`items.json respondió ${r.status}`);
      return r.json();
    })
    .then((doc) => {
      // Las columnas comprimidas guardan índices en lugar del texto; se
      // resuelven al leer, para no expandir 24.564 × 21 cadenas en memoria.
      const cols = doc.columnas.map((c) => ({
        clave: c.k,
        etiqueta: ETIQUETAS[c.k] || c.k,
        dic: c.d ? doc.diccionarios[c.k] : null,
      }));
      const pos = Object.fromEntries(cols.map((c, i) => [c.clave, i]));
      const valor = (fila, clave) => {
        const v = fila[pos[clave]];
        return cols[pos[clave]].dic ? cols[pos[clave]].dic[v] : v;
      };
      ITEMS = { ...doc, cols, pos, filas: doc.filas, valor };
      // índice de búsqueda, una cadena por ficha
      ITEMS.busqueda = new Array(doc.filas.length);
      for (let i = 0; i < doc.filas.length; i++) {
        let s = '';
        for (const k of BUSCABLES) s += `${valor(doc.filas[i], k)}  `;
        ITEMS.busqueda[i] = norm(s);
      }
      ITEMS.colecciones = [...new Set(doc.filas.map((f) => valor(f, 'coleccion') || 'SIN COLECCION'))].sort();
      return ITEMS;
    });
  return cargandoItems;
}

const nombreColeccion = (cod) => RESUMEN.colecciones[cod]?.nombre || cod;
// La columna `estado` guarda el texto largo ("USO INTERNO - …"), no la clave de
// color, así que se busca por `texto`. `clave` solo se usa para agrupar en el resumen.
const estadoDe = (texto) => RESUMEN.estados.find((e) => e.texto === texto);
const etiquetaEstado = (texto) => estadoDe(texto)?.etiqueta || texto;

/* ------------------------------------------------------------------ mount -- */

export async function montar(h, cuerpo) {
  cuerpo.innerHTML = `
    <div class="explo">
      <div class="explo__espera"><div class="ruedita"></div><span>Leyendo el resumen del libro…</span></div>
    </div>`;

  try {
    await cargarResumen();
  } catch (e) {
    cuerpo.innerHTML = `<div class="vacio">No se pudo cargar el resumen: ${esc(e.message)}</div>`;
    return;
  }

  const R = RESUMEN;
  const filtros = { coleccion: '', estado: '', material: '', texto: '', orden: null, dir: 1, pagina: 0, porPagina: 50 };

  const raiz = document.createElement('div');
  raiz.className = 'explo';
  raiz.innerHTML = `
    <nav class="explo__pestanas" role="tablist">
      <button role="tab" data-vista="resumen" aria-selected="true">Resumen por colección</button>
      <button role="tab" data-vista="detalle" aria-selected="false">Detalle de fichas</button>
      <a class="explo__origen" href="${rutaArchivo(h)}" download
         title="Descargar el libro original">${esc(R.meta.fuente)} · 7,2 MB</a>
    </nav>
    <div class="explo__cuerpo"></div>`;
  cuerpo.replaceChildren(raiz);   // sustituye el spinner, no lo deja debajo

  const panel = raiz.querySelector('.explo__cuerpo');

  const ver = async (vista) => {
    raiz.querySelectorAll('[data-vista]').forEach((b) =>
      b.setAttribute('aria-selected', String(b.dataset.vista === vista)));
    panel.replaceChildren();
    panel.scrollTop = 0;
    if (vista === 'resumen') panel.appendChild(construirResumen((col) => verDetalle(panel, raiz, filtros, col)));
    else await verDetalle(panel, raiz, filtros, null);
  };

  raiz.querySelectorAll('[data-vista]').forEach((b) => { b.onclick = () => ver(b.dataset.vista); });
  ver('resumen');
}

/* --------------------------------------------------------------- resumen -- */

function construirResumen(alElegir) {
  const R = RESUMEN;
  const totales = { Total: 0, Verde: 0, Rosado: 0, Celeste: 0, Gris: 0 };
  for (const cod of R.orden) {
    const v = R.colecciones[cod];
    for (const k of ['Verde', 'Rosado', 'Celeste', 'Gris']) totales[k] += v[k] || 0;
    totales.Total += v.Total;
  }
  const porNombre = Object.fromEntries(R.estados.map((e) => [e.clave, e]));

  const div = document.createElement('div');
  div.className = 'explo__panel';
  div.innerHTML = `
    <div class="explo__aviso">
      <span>Cifras de la hoja <b>Resumen</b> del libro: <b>${nf.format(totales.Total)}</b> registros,
      exactamente el número de filas de la hoja <b>Total</b>.</span>
      ${R.control.desviaciones.length
        ? `<span class="pildora pildora--alerta">${R.control.desviaciones.length} discrepancias frente al detalle</span>`
        : `<span class="pildora pildora--ok">Cotejado con el detalle: sin discrepancias</span>`}
    </div>

    <div class="kpis">
      <div class="kpi">
        <span class="kpi__n">${nf.format(totales.Total)}</span>
        <span class="kpi__t">Total inventariado</span>
        <span class="kpi__p">${R.orden.length} colecciones</span>
      </div>
      ${R.estados.map((e) => `
        <div class="kpi kpi--${e.clave.toLowerCase()}">
          <span class="kpi__n">${nf.format(totales[e.clave])}</span>
          <span class="kpi__t">${esc(e.etiqueta)}</span>
          <span class="kpi__p">${pct(totales[e.clave], totales.Total)} del total</span>
        </div>`).join('')}
    </div>

    <section class="bloque">
      <header class="bloque__cab">
        <h3>Estado por colección</h3>
        <div class="leyenda">
          ${R.estados.map((e) => `<span class="leyenda__it"><i style="background:${e.color}"></i>${esc(e.etiqueta)}</span>`).join('')}
        </div>
      </header>
      <div class="barras">
        ${R.orden.slice().sort((a, b) => R.colecciones[b].Total - R.colecciones[a].Total).map((cod) => {
          const v = R.colecciones[cod];
          return `
          <button class="barra-fila" data-ir="coleccion" data-valor="${esc(cod)}" title="Ver las fichas de ${esc(v.nombre)}">
            <span class="barra-fila__nom">${esc(v.nombre)}</span>
            <span class="barra-fila__code">${esc(cod)}</span>
            <span class="barra-fila__pista">
              ${['Verde', 'Rosado', 'Celeste', 'Gris'].map((k) => {
                const w = v.Total ? (v[k] / v.Total) * 100 : 0;
                return w > 0
                  ? `<i style="width:${w}%;background:${porNombre[k].color}" title="${esc(porNombre[k].etiqueta)}: ${nf.format(v[k])}"></i>`
                  : '';
              }).join('')}
            </span>
            <span class="barra-fila__tot">${nf.format(v.Total)}</span>
          </button>`;
        }).join('')}
      </div>
    </section>

    <section class="bloque">
      <header class="bloque__cab">
        <h3>Cifras completas</h3>
        <button class="boton boton--mini" data-exportar="resumen">Exportar CSV</button>
      </header>
      <div class="tabla-envoltura">
        <table class="tabla tabla--compacta">
          <thead>
            <tr>
              <th>Colección</th><th>Código</th>
              ${R.estados.map((e) => `<th class="der">${esc(e.etiqueta)}</th>`).join('')}
              <th class="der">Total</th>
            </tr>
          </thead>
          <tbody>
            ${R.orden.map((cod) => {
              const v = R.colecciones[cod];
              return `<tr data-ir="coleccion" data-valor="${esc(cod)}" tabindex="0" title="Ver las fichas de ${esc(v.nombre)}">
                <td>${esc(v.nombre)}</td>
                <td class="mono">${esc(cod)}</td>
                ${R.estados.map((e) => `<td class="der"><i class="punto" style="background:${e.color}"></i>${nf.format(v[e.clave] || 0)}</td>`).join('')}
                <td class="der"><b>${nf.format(v.Total)}</b></td>
              </tr>`;
            }).join('')}
            <tr class="tabla__total">
              <td>Total</td><td></td>
              ${R.estados.map((e) => `<td class="der">${nf.format(totales[e.clave])}</td>`).join('')}
              <td class="der"><b>${nf.format(totales.Total)}</b></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="bloque">
      <header class="bloque__cab"><h3>Materiales y clasificación</h3></header>
      <div class="dos-columnas">
        <div>
          <h4 class="sub">Tipo de material</h4>
          <div class="barras">
            ${Object.entries(R.perfiles.material).map(([k, n]) => `
              <button class="barra-fila" data-ir="material" data-valor="${esc(k)}" title="Ver las ${nf.format(n)} fichas de ${esc(k)}">
                <span class="barra-fila__nom">${esc(k)}</span>
                <span class="barra-fila__pista"><i style="width:${(n / totales.Total) * 100}%;background:var(--acento)"></i></span>
                <span class="barra-fila__tot">${nf.format(n)}</span>
              </button>`).join('')}
          </div>
        </div>
        <div>
          <h4 class="sub">Clasificación Dewey (2 cifras)</h4>
          <div class="dewey">
            ${Object.entries(R.perfiles.dewey).slice(0, 25).map(([k, n]) => `
              <button class="dewey__it" data-ir="texto" data-valor="${esc(k)}" title="Filtrar por la clase ${esc(k)} — ${nf.format(n)} fichas">
                <b>${esc(k)}</b><span>${nf.format(n)}</span>
              </button>`).join('')}
          </div>
          <p class="nota">Las 25 clases con más ejemplares. Haz clic en cualquiera para filtrar el detalle.</p>
        </div>
      </div>
    </section>`;

  div.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ir]');
    if (b) alElegir({ tipo: b.dataset.ir, valor: b.dataset.valor });
    if (e.target.closest('[data-exportar]')) exportarResumen();
  });
  div.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const b = e.target.closest('[data-ir]');
    if (b) { e.preventDefault(); alElegir({ tipo: b.dataset.ir, valor: b.dataset.valor }); }
  });
  return div;
}

function exportarResumen() {
  const R = RESUMEN;
  const filas = [['Codigo', 'Coleccion', ...R.estados.map((e) => e.etiqueta), 'Total']];
  for (const cod of R.orden) {
    const v = R.colecciones[cod];
    filas.push([cod, v.nombre, ...R.estados.map((e) => v[e.clave] || 0), v.Total]);
  }
  descargarCSV('inventario-2026-resumen.csv', filas);
}

/* --------------------------------------------------------------- detalle -- */

async function verDetalle(panel, raiz, f, elegir) {
  panel.innerHTML = `
    <div class="explo__espera">
      <div class="ruedita"></div>
      <span>Cargando las ${nf.format(RESUMEN.control.filasDetalle)} fichas…</span>
      <small>La primera vez se descarga el detalle completo (6,1 MB). Después queda en caché.</small>
    </div>`;

  let D;
  try {
    D = await cargarItems();
  } catch (e) {
    panel.innerHTML = `<div class="vacio">No se pudo cargar el detalle: ${esc(e.message)}</div>`;
    return;
  }

  if (elegir) {
    Object.assign(f, { coleccion: '', estado: '', material: '', texto: '', pagina: 0 });
    f[elegir.tipo] = elegir.tipo === 'texto' ? norm(elegir.valor) : elegir.valor;
  }
  raiz.querySelectorAll('[data-vista]').forEach((b) =>
    b.setAttribute('aria-selected', String(b.dataset.vista === 'detalle')));
  panel.scrollTop = 0;

  const vista = document.createElement('div');
  vista.className = 'explo__panel';
  vista.innerHTML = plantillaDetalle(D);
  panel.appendChild(vista);

  const estado = { encontrados: [], paginas: 1 };
  cablear(vista, f, D, estado);
  refrescar(vista, f, D, estado);
}

function plantillaDetalle(D) {
  return `
    <div class="controles">
      <div class="campo-busca">
        <span aria-hidden="true">🔎</span>
        <input class="campo" type="search" data-q autocomplete="off"
               placeholder="Buscar en título, autor, clasificación, código de barras, ISBN…">
      </div>
      <select class="campo" data-f="coleccion" aria-label="Filtrar por colección">
        <option value="">Todas las colecciones</option>
        ${D.colecciones.map((c) => `<option value="${esc(c)}">${esc(nombreColeccion(c))} — ${esc(c)}</option>`).join('')}
      </select>
      <select class="campo" data-f="material" aria-label="Filtrar por material">
        <option value="">Todos los materiales</option>
        ${Object.entries(RESUMEN.perfiles.material).map(([k, n]) => `<option value="${esc(k)}">${esc(k)} — ${nf.format(n)}</option>`).join('')}
      </select>
      <select class="campo" data-f="estado" aria-label="Filtrar por estado">
        <option value="">Todos los estados</option>
        ${RESUMEN.estados.map((e) => `<option value="${esc(e.texto)}">${esc(e.etiqueta)}</option>`).join('')}
      </select>
      <button class="boton" data-limpiar>Quitar filtros</button>
      <button class="boton boton--acento" data-exportar="fichas">Exportar CSV</button>
    </div>

    <div class="filtros-vivos" data-vivos hidden></div>

    <div class="tabla-envoltura">
      <table class="tabla tabla--fichas">
        <thead>
          <tr>${VISIBLES.map((c) => `
            <th data-orden="${c}" title="Ordenar por ${esc(ETIQUETAS[c])}">
              ${esc(ETIQUETAS[c])}<span class="flecha"></span>
            </th>`).join('')}</tr>
        </thead>
        <tbody data-tbody></tbody>
      </table>
    </div>

    <div class="paginado">
      <button class="boton boton--mini" data-pag="0" aria-label="Primera página">« Inicio</button>
      <button class="boton boton--mini" data-pag="-1" aria-label="Página anterior">‹ Anterior</button>
      <span class="paginado__info" data-info></span>
      <button class="boton boton--mini" data-pag="1" aria-label="Página siguiente">Siguiente ›</button>
      <button class="boton boton--mini" data-pag="fin" aria-label="Última página">Fin »</button>
      <label class="paginado__tam">
        <span>por página</span>
        <select class="campo" data-porpagina>
          <option>25</option><option selected>50</option><option>100</option><option>200</option>
        </select>
      </label>
      <span class="paginado__conteo" data-conteo></span>
    </div>

    <div class="ficha" data-ficha hidden>
      <header class="ficha__cab">
        <h3 data-ficha-titulo></h3>
        <button class="boton boton--mini" data-ficha-cerrar>Cerrar</button>
      </header>
      <dl class="ficha__campos" data-ficha-campos></dl>
    </div>`;
}

function cablear(vista, f, D, estado) {
  const q = vista.querySelector('[data-q]');
  let temporizador;
  q.addEventListener('input', () => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => {
      f.texto = norm(q.value.trim());
      f.pagina = 0;
      refrescar(vista, f, D, estado);
    }, 180);
  });

  vista.querySelectorAll('select[data-f]').forEach((s) => {
    s.addEventListener('change', () => { f[s.dataset.f] = s.value; f.pagina = 0; refrescar(vista, f, D, estado); });
  });

  vista.querySelector('[data-limpiar]').onclick = () => {
    Object.assign(f, { coleccion: '', estado: '', material: '', texto: '', pagina: 0, orden: null });
    q.value = '';
    vista.querySelectorAll('select[data-f]').forEach((s) => { s.value = ''; });
    refrescar(vista, f, D, estado);
  };

  vista.querySelector('[data-porpagina]').addEventListener('change', (e) => {
    f.porPagina = Number(e.target.value);
    f.pagina = 0;
    refrescar(vista, f, D, estado);
  });

  vista.querySelectorAll('[data-pag]').forEach((b) => {
    b.onclick = () => {
      const destino = b.dataset.pag;
      f.pagina = destino === 'fin' ? estado.paginas - 1
        : destino === '0' ? 0
        : Math.min(estado.paginas - 1, Math.max(0, f.pagina + Number(destino)));
      refrescar(vista, f, D, estado);
    };
  });

  vista.querySelectorAll('th[data-orden]').forEach((th) => {
    th.addEventListener('click', () => {
      if (f.orden === th.dataset.orden) f.dir = -f.dir;
      else { f.orden = th.dataset.orden; f.dir = 1; }
      refrescar(vista, f, D, estado);
    });
  });

  vista.querySelector('[data-ficha-cerrar]').onclick = () => { vista.querySelector('[data-ficha]').hidden = true; };
  vista.querySelector('[data-exportar]').onclick = () => exportarFichas(estado.encontrados, D);
  vista.querySelector('[data-vivos]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-quitar]');
    if (!b) return;
    f[b.dataset.quitar] = '';
    if (b.dataset.quitar === 'texto') q.value = '';
    const sel = vista.querySelector(`select[data-f="${b.dataset.quitar}"]`);
    if (sel) sel.value = '';
    f.pagina = 0;
    refrescar(vista, f, D, estado);
  });
  vista.querySelector('tbody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-i]');
    if (tr) abrirFicha(vista, D, Number(tr.dataset.i));
  });
}

/** Recorre las 24.564 filas y devuelve los índices que pasan los filtros. */
function filtrar(f, D) {
  const salida = [];
  const palabras = f.texto ? f.texto.split(/\s+/).filter(Boolean) : null;
  for (let i = 0; i < D.filas.length; i++) {
    const fila = D.filas[i];
    if (f.coleccion && (D.valor(fila, 'coleccion') || 'SIN COLECCION') !== f.coleccion) continue;
    if (f.estado && D.valor(fila, 'estado') !== f.estado) continue;
    if (f.material && D.valor(fila, 'material') !== f.material) continue;
    if (palabras && !palabras.every((p) => D.busqueda[i].includes(p))) continue;
    salida.push(i);
  }
  if (f.orden) {
    const pos = D.pos[f.orden];
    const dic = D.cols[pos].dic;
    const dir = f.dir;
    salida.sort((a, b) => {
      const va = D.filas[a][pos];
      const vb = D.filas[b][pos];
      return dic ? (va - vb) * dir : String(va).localeCompare(String(vb), 'es', { numeric: true }) * dir;
    });
  }
  return salida;
}

function refrescar(vista, f, D, estado) {
  const encontrados = filtrar(f, D);
  estado.encontrados = encontrados;
  const paginas = Math.max(1, Math.ceil(encontrados.length / f.porPagina));
  f.pagina = Math.min(f.pagina, paginas - 1);
  estado.paginas = paginas;
  const desde = f.pagina * f.porPagina;
  const hasta = Math.min(desde + f.porPagina, encontrados.length);
  const trozo = encontrados.slice(desde, hasta);

  vista.querySelector('[data-conteo]').innerHTML =
    `<b>${nf.format(encontrados.length)}</b> de ${nf.format(D.filas.length)} fichas`;

  const activos = [];
  if (f.coleccion) activos.push(['coleccion', nombreColeccion(f.coleccion)]);
  if (f.estado) activos.push(['estado', etiquetaEstado(f.estado)]);
  if (f.material) activos.push(['material', f.material]);
  if (f.texto) activos.push(['texto', `“${f.texto}”`]);
  const vivos = vista.querySelector('[data-vivos]');
  vivos.hidden = !activos.length;
  vivos.innerHTML = activos
    ? `<span class="filtros-vivos__et">Filtros:</span>` + activos.map(([k, v]) =>
        `<span class="pildora">${esc(v)}<button data-quitar="${k}" aria-label="Quitar el filtro ${esc(v)}">×</button></span>`).join('')
    : '';

    const porEstado = Object.fromEntries(RESUMEN.estados.map((e) => [e.texto, e]));
  vista.querySelector('[data-tbody]').innerHTML = trozo.length
    ? trozo.map((i) => {
        const fila = D.filas[i];
        const desc = D.valor(fila, 'descripcion');
        const est = porEstado[D.valor(fila, 'estado')] || { color: '#999', etiqueta: D.valor(fila, 'estado') || '(sin estado)' };
        return `<tr data-i="${i}" tabindex="0" title="Ver la ficha completa">
          <td class="mono">${esc(D.valor(fila, 'nSistema'))}</td>
          <td class="tit"><b>${esc(D.valor(fila, 'titulo') || '—')}</b>${desc ? `<span>${esc(desc)}</span>` : ''}</td>
          <td>${esc(D.valor(fila, 'autor') || '—')}</td>
          <td class="mono">${esc(D.valor(fila, 'clasificacion') || '—')}</td>
          <td class="mono">${esc(D.valor(fila, 'coleccion') || '—')}</td>
          <td>${esc(D.valor(fila, 'material') || '—')}</td>
          <td><span class="punto-et" style="--c:${est.color}">${esc(est.etiqueta)}</span></td>
          <td class="mono">${esc(D.valor(fila, 'codigo') || '—')}</td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="${VISIBLES.length}"><div class="vacio">Ninguna ficha coincide con los filtros aplicados.</div></td></tr>`;

  vista.querySelector('[data-info]').textContent = encontrados.length
    ? `Página ${nf.format(f.pagina + 1)} de ${nf.format(paginas)} · ${nf.format(desde + 1)}–${nf.format(hasta)}`
    : 'Sin resultados';

  vista.querySelectorAll('th[data-orden]').forEach((th) => {
    const activo = th.dataset.orden === f.orden;
    th.classList.toggle('orden-activo', activo);
    th.querySelector('.flecha').textContent = activo ? (f.dir === 1 ? '▲' : '▼') : '';
  });
}

function abrirFicha(vista, D, i) {
  const fila = D.filas[i];
  const panel = vista.querySelector('[data-ficha]');
  panel.querySelector('[data-ficha-titulo]').textContent = D.valor(fila, 'titulo') || 'Ficha sin título';
  panel.querySelector('[data-ficha-campos]').innerHTML = ORDEN_ETIQUETAS.map((c) => {
    let v = D.valor(fila, c);
    if (c === 'estado') v = etiquetaEstado(v);
    if (c === 'coleccion') v = v || '(sin colección asignada)';
    if (!v) return '';
    return `<div class="ficha__campo${c === 'nota' ? ' ficha__campo--ancho' : ''}">
      <dt>${esc(ETIQUETAS[c])}</dt><dd>${esc(v)}</dd></div>`;
  }).join('');
  panel.hidden = false;
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* --------------------------------------------------------------- export --- */

function descargarCSV(nombre, filas) {
  const cuerpo = filas.map((f) => f.map((celda) => {
    const s = String(celda ?? '');
    return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF' + cuerpo], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function exportarFichas(indices, D) {
  if (!indices.length) return;
  const filas = [[
    'N_sistema', 'Titulo', 'Autor', 'Codigo_barras', 'Clasificacion', 'Coleccion',
    'Material', 'Descripcion', 'Observacion', 'Fecha_inventario', 'Ultimo_inventario',
  ]];
  for (const i of indices) {
    const f = D.filas[i];
    filas.push([
      D.valor(f, 'nSistema'), D.valor(f, 'titulo'), D.valor(f, 'autor'),
      D.valor(f, 'codigo'), D.valor(f, 'clasificacion'),
      D.valor(f, 'coleccion') || 'SIN COLECCION', D.valor(f, 'material'),
      D.valor(f, 'descripcion'), etiquetaEstado(D.valor(f, 'estado')),
      D.valor(f, 'fInventario'), D.valor(f, 'fUltimoInv'),
    ]);
  }
  descargarCSV(`inventario-2026-fichas-${indices.length}.csv`, filas);
}
