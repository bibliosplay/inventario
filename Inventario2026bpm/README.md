# Inventario 2026 BPM

Escritorio web con los seis archivos del inventario de la Biblioteca PCM (Sede Madrid).

Se abre `index.html` y aparece un escritorio: un icono por archivo, y cada icono abre
su contenido en una ventana que se puede mover, maximizar, minimizar y cerrar.

## Los seis archivos

| Icono | Archivo | Cómo se abre |
|---|---|---|
| Explorador del inventario | `Inventario73362025_por_coleccion.xlsx` | vista propia con filtros y búsqueda |
| Glosario ALEPH | `glosario-aleph.html` | tal cual, en un iframe |
| Clasificación Dewey | `dewey-interactivo.html` | tal cual, en un iframe |
| Hábitos atómicos | `habitos-atomicos-biblioteca.html` | tal cual, en un iframe |
| 5S de la biblioteca | `5s-biblioteca.html` | tal cual, en un iframe |
| Documento 1 | `documento1.html` | tal cual, en un iframe |

Los cinco HTML se cargan **sin tocar**, dentro de un iframe: conservan su diseño, su
modo oscuro y lo que guardan en el navegador. El `.xlsx` no se puede mostrar en el
navegador, así que se lee una copia de sus datos y se pinta en la ventana del
Explorador.

## Qué se puede hacer

- **Portada**: cifras del libro, buscador de herramientas con `Ctrl+K` y navegación con flechas.
- **Ventanas**: arrastrar por la barra de título, redimensionar por el borde inferior
  derecho, minimizar a la barra de tareas, maximizar, cerrar con `Esc`. El escritorio
  recuerda la disposición y las deja como estaban al recargar.
- **Explorador**:
  - *Resumen por colección*: totales por colección y por estado, perfiles de material y
    de clasificación Dewey. Las cifras se recalculan a partir del detalle, y la propia
    vista avisa si no cuadran con la hoja de resumen del libro.
  - *Detalle de fichas*: las 24.564 fichas, buscables por título, autor, clasificación,
    código de barras e ISBN, con filtros por colección, estado, material y Dewey, orden
    por columna y exportación a CSV.
- **Tema claro y oscuro**, también dentro de los iframes.
- Sin conexión, sin dependencias y sin paso de compilación.

## Estructura

```
index.html                 el escritorio
app/estilos/               base, escritorio, ventana, explorador
app/js/manifiesto.js       el registro de las 6 herramientas
app/js/gestor.js           ventanas: mover, maximizar, minimizar, recordar
app/js/inicio.js           portada, buscador, arranque
app/js/vistas/marco.js     ventana que incrusta un HTML
app/js/vistas/explorador.js  la vista del XLSX
datos/resumen.json         cifras por colección (8 KB)
datos/items.json           las 24.564 fichas (6,1 MB)
archivos/                  los 6 archivos originales, sin modificar
verificar.py               comprueba referencias y que los datos cuadran
probar.py                  prueba la web en un navegador de verdad
```

`app/js/manifiesto.js` es el único sitio donde se declara qué hay: añadir una
herramienta es añadir una entrada ahí y dejar el archivo en `archivos/`. Los iconos, las
ventanas, la barra de tareas y el buscador se generan solos.

## Publicar

Es un sitio estático: vale cualquier alojamiento.

- **GitHub Pages**: subir el contenido a la raíz de un repositorio.
- **En local**: abrir `index.html` directamente; los módulos usan rutas relativas, así que
  funciona sin servidor.

## Comprobar que sigue bien

```sh
python verificar.py   # referencias entre archivos, y que las cifras cuadren
python probar.py      # abre Chrome y prueba la web de punta a punta
```

`verificar.py` no necesita nada más que Python. `probar.py` además necesita
`pip install websocket-client` y un Chrome instalado.

## Los datos

`datos/items.json` guarda las 24.564 fichas en 21 campos. Catorce de esos campos se
repiten en casi todos los registros, así que van en un diccionario y cada fila guarda
su índice: el archivo pesa 6,1 MB en vez de más de 30. El `.xlsx` original pesa 7,2 MB,
así que la web carga menos que el libro.

El libro tiene 20 hojas, pero el detalle de la hoja `TOTAL` (24.564 registros) ya
contiene todo lo de las demás. Las cifras de la hoja `RESUMEN` se reconstruyen a
partir del detalle, y coinciden en los 24.564 registros; la vista lo comprueba cada vez
que se abre.

Dos fechas del libro (2.154 celdas) estaban guardadas como número de serie de Excel y
salían como 5 dígitos sueltos. En `items.json` están ya como fecha.

El ISBN se conserva: 20.648 fichas tienen un ISBN distinto del número de sistema.

## Los archivos originales

`archivos/` contiene los seis archivos tal como estaban, byte a byte. No se modifican,
no se reescriben ni se les cambia el nombre: se cargan como son. `verificar.py`
comprueba que el manifiesto y esa carpeta digan lo mismo.

## Licencia

MIT. Ver [LICENSE](LICENSE).
