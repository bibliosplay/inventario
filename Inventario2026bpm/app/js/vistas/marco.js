/**
 * vistas/marco.js — aloja una herramienta que ya es un HTML completo.
 *
 * Las cinco herramientas HTML del proyecto se cargan tal cual, dentro de un
 * iframe, sin reescribirlas: conservan su diseño, su modo oscuro y los datos que
 * guardan en localStorage. El iframe es perezoso (solo se crea al abrir la
 * ventana por primera vez) y se le propaga el tema del escritorio.
 */

import { rutaArchivo } from '../manifiesto.js';

export function montarMarco(h, cuerpo) {
  const marca = `
    <div class="ventana__cargando" data-cargando>
      <div class="ruedita"></div>
      <span>Cargando ${h.archivo}…</span>
    </div>`;
  cuerpo.innerHTML = marca;

  const marco = document.createElement('iframe');
  marco.src = rutaArchivo(h);
  marco.title = h.titulo;
  marco.loading = 'lazy';
  marco.setAttribute('data-herramienta', h.id);

  // puente de tema: el shell usa data-tema, las herramientas data-theme.
  // Todas son mismo origen, así que también se puede alcanzar el iframe.
  const observador = new MutationObserver(() => sincronizarTema(marco, h));
  observador.observe(document.documentElement, { attributeFilter: ['data-tema'] });

  const alCargar = () => {
    cuerpo.querySelector('[data-cargando]')?.setAttribute('hidden', '');
    sincronizarTema(marco, h);
  };
  marco.addEventListener('load', alCargar);
  cuerpo.appendChild(marco);

  return { destruir: () => observador.disconnect() };
}

function sincronizarTema(marco, h) {
  let doc;
  try {
    doc = marco.contentDocument;
  } catch {
    return;   // origen distinto: la herramienta gestiona su propio tema
  }
  if (!doc || !doc.documentElement) return;
  const oscuro = document.documentElement.dataset.tema === 'oscuro';
  doc.documentElement.dataset.theme = oscuro ? 'dark' : 'light';
}
