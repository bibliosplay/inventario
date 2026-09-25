/**
 * gestor.js — gestor de ventanas del escritorio.
 *
 * Ventanas arrastrables y redimensionables, con minimizar / maximizar / restaurar,
 * orden de enfoque (z-index), barra de tareas y una disposición en cascada.
 * Todo se apoya en Pointer Events, así que funciona igual con ratón, dedo y
 * lápiz. La geometría y el juego de ventanas abiertas se guardan en
 * localStorage para que la página vuelva como se dejó.
 */

const CLAVE = 'bpm_ventanas_v1';
const ESCALON = 30;          // desplazamiento de la cascada, en píxeles
const MARGEN = 12;           // separación mínima respecto al borde del escritorio
const ANCHO_MIN = 320;
const ALTO_MIN = 220;
const ALTO_BARRA = 42;
const MOVIL = '(max-width: 760px)';

const svg = (d) =>
  `<svg viewBox="0 0 14 14" aria-hidden="true"><path d="${d}"/></svg>`;
const ICONO_MIN = svg('M2 5.5h10');
const ICONO_MAX = svg('M3 3h8v8H3z');
const ICONO_RESTAURAR = svg('M5 5h6v6H5zM3 3h6v2');
const ICONO_CERRAR = svg('M3.5 3.5l7 7M10.5 3.5l-7 7');

const limitar = (v, min, max) => Math.min(Math.max(v, min), Math.max(min, max));

export function crearGestor({ zona, barraTareas, manifiesto, alCambiar, alAbrirContenido }) {
  const ventanas = new Map();          // id -> { el, estado, caja }
  let foco = null;
  let z = 10;
  let cascada = 0;
  const movil = matchMedia(MOVIL);

  // ---------------------------------------------------------- persistencia --
  let guardado = { cajas: {}, abiertas: [] };
  try {
    guardado = JSON.parse(localStorage.getItem(CLAVE)) || guardado;
  } catch { /* almacenamiento no disponible: se sigue sin recordatorio */ }

  const persistir = () => {
    const cajas = {};
    for (const [id, v] of ventanas) {
      if (v.estado === 'min') continue;
      cajas[id] = v.estado === 'max' ? { max: true } : { ...v.caja };
    }
    try {
      localStorage.setItem(CLAVE, JSON.stringify({ cajas, abiertas: [...ventanas.keys()] }));
    } catch { /* sin espacio o sin permiso: es aceptable */ }
  };

  // ------------------------------------------------------------- geometría --
  // El área de ventanas ya viene sin la barra superior ni la de tareas, así que
  // basta con medir su propio rectángulo.
  const area = () => {
    const r = zona.getBoundingClientRect();
    return { w: r.width, h: r.height };
  };

  function cajaInicial(h) {
    const { w: aw, h: ah } = area();
    const w = Math.min(h.tamano.ancho, aw - MARGEN * 2);
    const alto = Math.min(h.tamano.alto, ah - MARGEN * 2);
    const limite = Math.max(0, Math.floor((aw + MARGEN * 2 - w) / MARGEN));
    const paso = (cascada++ % (limite + 1)) * (MARGEN + ESCALON);
    return {
      x: limitar(MARGEN + paso, MARGEN, Math.max(MARGEN, aw - w - MARGEN)),
      y: limitar(MARGEN + paso, MARGEN, Math.max(MARGEN, ah - alto - MARGEN)),
      w, h: alto,
    };
  }

  function aplicarCaja(v) {
    const { w: aw, h: ah } = area();
    const ancho = Math.min(v.caja.w, aw - MARGEN * 2);
    const alto = Math.min(v.caja.h, ah - MARGEN * 2);
    v.el.style.width = `${ancho}px`;
    v.el.style.height = `${alto}px`;
    v.el.style.left = `${limitar(v.caja.x, MARGEN, Math.max(MARGEN, aw - ancho - MARGEN))}px`;
    v.el.style.top = `${limitar(v.caja.y, MARGEN, Math.max(MARGEN, ah - alto - MARGEN))}px`;
  }

  // ------------------------------------------------------------ construcción -
  function construir(h) {
    const el = document.createElement('section');
    el.className = 'ventana';
    el.dataset.id = h.id;
    el.style.setProperty('--tono', h.color);
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', h.titulo);
    el.tabIndex = -1;
    el.innerHTML = `
      <header class="ventana__barra">
        <span class="ventana__punto"></span>
        <span class="ventana__icono" aria-hidden="true">${h.icono}</span>
        <h2 class="ventana__titulo">${h.titulo}</h2>
        <span class="ventana__archivo">${h.archivo}</span>
        <div class="controles">
          <button class="control control--min" title="Minimizar" aria-label="Minimizar ${h.titulo}">${ICONO_MIN}</button>
          <button class="control control--max" title="Maximizar" aria-label="Maximizar ${h.titulo}">${ICONO_MAX}</button>
          <button class="control control--cerrar" title="Cerrar" aria-label="Cerrar ${h.titulo}">${ICONO_CERRAR}</button>
        </div>
      </header>
      <div class="ventana__cuerpo"></div>
      ${['n', 's', 'e', 'o', 'ne', 'no', 'se', 'so']
        .map((d) => `<div class="mango mango--${d}" data-mango="${d}"></div>`).join('')}`;

    const v = { h, el, estado: 'normal', caja: null, cuerpo: el.querySelector('.ventana__cuerpo') };
    ventanas.set(h.id, v);

    el.addEventListener('pointerdown', () => enfocar(h.id), true);
    el.querySelector('.control--min').onclick = (e) => { e.stopPropagation(); minimizar(h.id); };
    el.querySelector('.control--max').onclick = (e) => { e.stopPropagation(); alternarMax(h.id); };
    el.querySelector('.control--cerrar').onclick = (e) => { e.stopPropagation(); cerrar(h.id); };
    el.querySelector('.ventana__barra').addEventListener('dblclick', (e) => {
      if (e.target.closest('.control')) return;
      alternarMax(h.id);
    });
    el.querySelector('.ventana__barra').addEventListener('pointerdown', (e) => iniciarArrastre(e, v));
    el.querySelectorAll('.mango').forEach((m) =>
      m.addEventListener('pointerdown', (e) => iniciarResize(e, v, m.dataset.mango)));

    zona.appendChild(el);
    return v;
  }

  /** Inserta el contenido de la herramienta; los marcos cargan perezosamente. */
  function montar(v) {
    if (v.montado) return;
    v.montado = true;
    // alAbrirContenido puede devolver un objeto { destruir() } (p.ej. el
    // MutationObserver del puente de tema en marco.js): se guarda para
    // poder liberarlo cuando la ventana se cierre, y así no acumular
    // observadores fantasma cada vez que se abre y cierra la herramienta.
    Promise.resolve(alAbrirContenido(v.h, v.cuerpo)).then((r) => {
      if (r && typeof r.destruir === 'function') v.destruir = r.destruir;
    });
  }

  // ---------------------------------------------------------------- acciones -
  function abrir(id) {
    const h = manifiesto.find((x) => x.id === id);
    if (!h) return null;
    let v = ventanas.get(id);
    if (!v) {
      v = construir(h);
      v.caja = guardado.cajas?.[id]?.max ? null : guardado.cajas?.[id] || cajaInicial(h);
      if (v.caja) aplicarCaja(v);
      if (!v.caja) maximizar(id, true);
    }
    if (v.estado === 'min') restaurar(id);
    enfocar(id);
    montar(v);
    persistir();
    sincronizar();
    return v;
  }

  function cerrar(id) {
    const v = ventanas.get(id);
    if (!v) return;
    v.destruir?.();
    v.el.remove();
    ventanas.delete(id);
    if (foco === id) foco = null;
    const siguiente = [...ventanas.entries()].reverse().find(([, x]) => x.estado !== 'min');
    if (siguiente) enfocar(siguiente[0]);
    sincronizar();
    persistir();
  }

  function minimizar(id) {
    const v = ventanas.get(id);
    if (!v) return;
    v.estado = 'min';
    v.el.hidden = true;
    if (foco === id) foco = null;
    const siguiente = [...ventanas.entries()].reverse().find(([, x]) => x.estado !== 'min');
    if (siguiente) enfocar(siguiente[0]);
    sincronizar();
    persistir();
  }

  function restaurar(id) {
    const v = ventanas.get(id);
    if (!v) return;
    v.estado = v.el.dataset.max === '1' ? 'max' : 'normal';
    v.el.hidden = false;
    sincronizar();
  }

  function maximizar(id, silencioso) {
    const v = ventanas.get(id);
    if (!v) return;
    if (v.estado === 'max') {
      v.estado = 'normal';
      v.el.dataset.max = '0';
      v.caja = v.previa || v.caja || cajaInicial(v.h);
      aplicarCaja(v);
      v.previa = null;
    } else {
      // Si la ventana se restauró ya maximizada (guardado.cajas[id] = {max:true}),
      // v.caja es null: aquí se calcula una caja "normal" de referencia para que,
      // al desmaximizar, siempre haya una geometría válida que aplicar.
      if (!v.previa) v.previa = v.caja ? { ...v.caja } : cajaInicial(v.h);
      v.estado = 'max';
      v.el.dataset.max = '1';
      v.el.style.left = '0px';
      v.el.style.top = '0px';
      v.el.style.width = '100%';
      v.el.style.height = '100%';
    }
    v.el.querySelector('.control--max').innerHTML = v.estado === 'max' ? ICONO_RESTAURAR : ICONO_MAX;
    v.el.querySelector('.control--max').title = v.estado === 'max' ? 'Restaurar' : 'Maximizar';
    if (!silencioso) { persistir(); sincronizar(); }
  }

  const alternarMax = (id) => maximizar(id);

  function enfocar(id) {
    const v = ventanas.get(id);
    if (!v) return;
    if (foco === id && v.el.style.zIndex) return;
    foco = id;
    v.el.style.zIndex = ++z;
    v.el.classList.remove('ventana--sin-animacion');
    for (const t of barraTareas.querySelectorAll('.tarea')) {
      t.setAttribute('aria-pressed', String(t.dataset.id === id));
    }
  }

  /** ¿Ya hay una ventana para esta herramienta? ¿Está visible? */
  const estaAbierta = (id) => ventanas.has(id);
  const estaVisible = (id) => ventanas.get(id)?.estado !== 'min';

  function alternar(id) {
    if (!ventanas.has(id)) return abrir(id);
    if (foco === id && !movil.matches) return minimizar(id);
    return restaurar(id);
  }

  // ------------------------------------------------------------ arrastre ----
  function iniciarArrastre(e, v) {
    if (e.target.closest('.control') || e.button > 0) return;
    e.preventDefault();
    const { w: aw, h: ah } = area();
    const r = v.el.getBoundingClientRect();
    const zonaR = zona.getBoundingClientRect();
    const offX = e.clientX - r.left;
    const offY = e.clientY - r.top;
    let cajaPrevia = { ...v.caja };
    let movida = false;

    const mover = (ev) => {
      movida = true;
      const x = limitar(ev.clientX - zonaR.left - offX, MARGEN, aw - r.width - MARGEN);
      const y = limitar(ev.clientY - zonaR.top - offY, 0, Math.max(0, ah - r.height));
      v.caja.x = Math.round(x);
      v.caja.y = Math.round(y);
      v.el.style.left = `${v.caja.x}px`;
      v.el.style.top = `${v.caja.y}px`;
      if (v.estado === 'max') {
        // al arrastrar una ventana maximizada, sale flotando bajo el cursor
        v.estado = 'normal';
        v.el.dataset.max = '0';
        v.el.querySelector('.control--max').innerHTML = ICONO_MAX;
      }
    };
    const soltar = () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      window.removeEventListener('pointercancel', soltar);
      document.body.style.userSelect = '';
      if (movida) { v.caja = { w: r.width, h: r.height, x: v.caja.x, y: v.caja.y }; persistir(); }
      else v.caja = cajaPrevia;
      sincronizar();
    };
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
    window.addEventListener('pointercancel', soltar);
  }

  // -------------------------------------------------------------- resize ----
  function iniciarResize(e, v, lado) {
    if (e.button > 0) return;
    e.preventDefault();
    e.stopPropagation();
    const { w: aw, h: ah } = area();
    const r = v.el.getBoundingClientRect();
    const zonaR = zona.getBoundingClientRect();
    const ini = { x: e.clientX, y: e.clientY, w: r.width, h: r.height };
    const totales = { ...ini };

    const mover = (ev) => {
      const dx = ev.clientX - ini.x;
      const dy = ev.clientY - ini.y;
      let { w, h, x, y } = totales;

      if (lado.includes('e')) w = Math.max(ANCHO_MIN, ini.w + dx);
      if (lado.includes('s')) h = Math.max(ALTO_MIN, ini.h + dy);
      if (lado.includes('o')) {
        w = Math.max(ANCHO_MIN, ini.w - dx);
        x = ini.x - (w - ini.w);
      }
      if (lado.includes('n')) {
        h = Math.max(ALTO_MIN, ini.h - dy);
        y = ini.y - (h - ini.h);
        if (y < 0) { h += y; y = 0; }
      }
      if (x < MARGEN) { w -= MARGEN - x; x = MARGEN; }
      if (y < 0) { y = 0; }
      if (w > aw - MARGEN * 2) w = aw - MARGEN * 2;
      if (h > ah - MARGEN) h = ah - MARGEN;

      v.caja = { w: Math.round(w), h: Math.round(h), x: Math.round(x), y: Math.round(y) };
      v.el.style.width = `${v.caja.w}px`;
      v.el.style.height = `${v.caja.h}px`;
      v.el.style.left = `${v.caja.x}px`;
      v.el.style.top = `${v.caja.y}px`;
    };
    const soltar = () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      window.removeEventListener('pointercancel', soltar);
      document.body.style.userSelect = '';
      persistir();
    };
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
    window.addEventListener('pointercancel', soltar);
  }

  // --------------------------------------------------------- barra tareas ---
  function pintarTareas() {
    const lista = barraTareas.querySelector('.tareas__lista');
    if (!ventanas.size) {
      lista.innerHTML = '<span class="tareas__vacio">Ninguna ventana abierta — elige una herramienta del escritorio</span>';
      return;
    }
    lista.innerHTML = [...ventanas.values()]
      .map((v) => `
        <button class="tarea" data-id="${v.h.id}" style="--tono:${v.h.color}"
                aria-pressed="${foco === v.h.id}" title="${v.h.titulo}">
          <span class="tarea__punto"></span>
          <span class="tarea__ico" aria-hidden="true">${v.h.icono}</span>
          <span class="tarea__txt">${v.h.etiqueta}</span>
        </button>`).join('');
    lista.querySelectorAll('.tarea').forEach((b) => {
      b.onclick = () => alternar(b.dataset.id);
    });
  }

  function sincronizar() {
    pintarTareas();
    barraTareas.dataset.visible = ventanas.size ? '1' : '0';
    // sin ventanas abiertas la zona no debe robarle el ratón a los iconos
    zona.dataset.vacia = ventanas.size ? '0' : '1';
    // la tercera fila del grid se colapsa cuando no hay ventanas o el usuario
    // la ocultó a mano, así que el área de trabajo recupera ese alto
    if (barraTareas.dataset.oculta !== '1') {
      document.querySelector('.escritorio')?.setAttribute('data-tareas', ventanas.size ? '1' : '0');
    }
    alCambiar?.([...ventanas.keys()]);
  }

  // ------------------------------------------------------------- globales --
  const ajustar = () => {
    for (const v of ventanas.values()) if (v.estado === 'normal') aplicarCaja(v);
    persistir();
  };
  window.addEventListener('resize', ajustar);
  movil.addEventListener('change', ajustar);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && foco && !e.defaultPrevented) {
      const dentroDeDialogo = e.target.closest?.('input, textarea, [contenteditable]');
      if (!dentroDeDialogo) cerrar(foco);
    }
  });

  // ---------------------------------------------------------------- público -
  sincronizar();   // estado inicial: sin ventanas, la zona no debe tapar los iconos

  return {
    abrir,
    cerrar,
    alternar,
    enfocar,
    estaAbierta,
    estaVisible,
    alternarMax,
    reiniciarDisposicion() {
      guardado = { cajas: {}, abiertas: [] };
      try { localStorage.removeItem(CLAVE); } catch { /* sin almacenamiento */ }
      [...ventanas.keys()].forEach(cerrar);
    },
    restaurarSesion() {
      const ids = Array.isArray(guardado.abiertas) ? guardado.abiertas : [];
      ids.filter((id) => manifiesto.some((h) => h.id === id)).forEach(abrir);
    },
    /** Muestra u oculta la barra de tareas; devuelve si queda visible. */
    alternarBarraTareas() {
      const escritorio = document.querySelector('.escritorio');
      const visible = escritorio?.getAttribute('data-tareas') === '1';
      escritorio?.setAttribute('data-tareas', visible ? '0' : '1');
      barraTareas.dataset.oculta = visible ? '1' : '0';
      ajustar();
      return !visible;
    },
    get abiertas() { return [...ventanas.keys()]; },
  };
}
