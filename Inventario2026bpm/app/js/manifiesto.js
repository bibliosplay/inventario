/**
 * manifiesto.js — registro único de herramientas de Inventario 2026 BPM.
 *
 * Cada entrada corresponde a UN archivo de `archivos/`. El escritorio, la barra
 * de tareas, el buscador y el gestor de ventanas se generan todos a partir de
 * esta lista, así que el número de iconos y de ventanas es siempre igual al
 * número de archivos del proyecto.
 *
 * Para agregar un archivo nuevo: copia el original a `archivos/`, agrega una
 * entrada aquí y ya aparece como icono y como ventana. Nada más hay que tocar.
 *
 * Campos:
 *   id        clave única (kebab-case), también se usa en la URL (#/herramienta)
 *   archivo   nombre exacto del archivo en `archivos/`
 *   tipo      'marco'  -> se abre el HTML original dentro de un iframe
 *             'hoja'   -> la webapp provee su propia vista (vistas/*.js)
 *   vista     módulo a cargar, solo para tipo 'hoja'
 *   icono     emoji del icono del escritorio
 *   color     color de acento de la ventana y del icono
 *   titulo    nombre de la ventana
 *   etiqueta  nombre corto para el icono del escritorio
 *   resumen   una línea descriptiva
 *   tamano    {ancho, alto} en píxeles lógicos de la ventana inicial
 *   destacado si aparece en el grupo de acceso rápido del escritorio
 */

export const HERRAMIENTAS = [
  {
    id: 'explorador',
    archivo: 'Inventario73362025_por_coleccion.xlsx',
    tipo: 'hoja',
    vista: 'explorador',
    icono: '📊',
    color: '#0e6b6b',
    titulo: 'Explorador de inventario',
    etiqueta: 'Explorador',
    resumen: 'Las 24.564 fichas de la colección, el resumen por colección y el detalle de cada ejemplar.',
    tamano: { ancho: 1080, alto: 720 },
    destacado: true,
  },
  {
    id: 'documento',
    archivo: 'documento1.html',
    tipo: 'marco',
    icono: '📋',
    color: '#0e6b6b',
    titulo: 'Inventario 2026 — documento',
    etiqueta: 'Documento',
    resumen: 'El manual del proceso de inventario en 8 fases, con asistente de consulta, corrección y observaciones.',
    tamano: { ancho: 1000, alto: 740 },
    destacado: true,
  },
  {
    id: '5s',
    archivo: '5s-biblioteca.html',
    tipo: 'marco',
    icono: '📚',
    color: '#8c3b2e',
    titulo: 'Las 5S en la colección',
    etiqueta: '5S',
    resumen: 'Checklist Seiri · Seiton · Seiso · Seiketsu · Shitsuke con avance guardado en el dispositivo.',
    tamano: { ancho: 620, alto: 720 },
    destacado: true,
  },
  {
    id: 'dewey',
    archivo: 'dewey-interactivo.html',
    tipo: 'marco',
    icono: '🗂️',
    color: '#a9772f',
    titulo: 'Clasificación Decimal Dewey',
    etiqueta: 'Dewey',
    resumen: 'El fichero de las cien casillas: 10 clases y 100 divisiones con búsqueda por número o tema.',
    tamano: { ancho: 940, alto: 720 },
  },
  {
    id: 'glosario',
    archivo: 'glosario-aleph.html',
    tipo: 'marco',
    icono: '🔤',
    color: '#7a4f2b',
    titulo: 'Glosario ALEPH v.24',
    etiqueta: 'Glosario',
    resumen: 'Términos de catalogación, circulación e inventario del sistema integrado, con buscador y filtros.',
    tamano: { ancho: 900, alto: 720 },
  },
  {
    id: 'habitos',
    archivo: 'habitos-atomicos-biblioteca.html',
    tipo: 'marco',
    icono: '🗓️',
    color: '#6b2737',
    titulo: 'Hábitos de sala',
    etiqueta: 'Hábitos',
    resumen: 'Las 4 leyes del hábito aplicadas a la biblioteca: diseño, registro semanal y diagnóstico.',
    tamano: { ancho: 800, alto: 720 },
  },
];

/** Raíz del sitio. Este módulo vive en <raiz>/app/js/, de ahí el ../../. */
export const BASE = new URL('../../', import.meta.url);
export const rutaArchivo = (h) => new URL(`archivos/${h.archivo}`, BASE).href;
export const rutaDatos = (n) => new URL(`datos/${n}`, BASE).href;

export const porId = (id) => HERRAMIENTAS.find((h) => h.id === id) || null;

/**
 * Palabras clave para el buscador de la página de inicio. Se suman al título,
 * la etiqueta y el resumen, así que casi no hace falta mantenerlas.
 */
export const indice = () =>
  HERRAMIENTAS.map((h) => ({
    ...h,
    texto: normalizar(`${h.etiqueta} ${h.titulo} ${h.resumen} ${h.archivo}`),
  }));

export function normalizar(s) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}
