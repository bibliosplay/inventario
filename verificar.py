#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Verificacion estatica del repo: sintaxis JS, referencias a archivos y datos."""
import json
import os
import re
import sys

RAIZ = os.path.dirname(os.path.abspath(__file__))
fallos, avisos = [], []


def ok(msg):
    print(f"  [ok]   {msg}")


def mal(msg):
    fallos.append(msg)
    print(f"  [FALLA] {msg}")


def aviso(msg):
    avisos.append(msg)
    print(f"  [aviso] {msg}")


# ---------------------------------------------------- 1. sintaxis de los .js
print("\n1. Sintaxis de los modulos JavaScript")
import subprocess
js = []
for base, _, files in os.walk(os.path.join(RAIZ, "app")):
    for f in files:
        if f.endswith(".js"):
            js.append(os.path.join(base, f))
for ruta in sorted(js):
    rel = os.path.relpath(ruta, RAIZ)
    txt = open(ruta, encoding="utf-8").read()
    # No se comprueba el equilibrio de llaves: contar `{` y `}` a mano no sirve
    # en JS (plantillas `${}`, regex, comentarios), y un recuento ingenuo da
    # falsos positivos que hay que descartar a mano. La sintaxis de verdad la
    # valida el navegador al ejecutar el módulo, en probar.py.
    if not txt.strip():
        mal(f"{rel}: el archivo está vacío")
    else:
        ok(f"{rel} ({len(txt.splitlines())} líneas) — la sintaxis la comprueba probar.py")

# ------------------------------------- 2. referencias a archivos del repo
print("\n2. Referencias entre archivos")
manifiesto = open(os.path.join(RAIZ, "app/js/manifiesto.js"), encoding="utf-8").read()
entradas = re.findall(r"archivo:\s*'([^']+)'", manifiesto)
print(f"   manifiesto declara {len(entradas)} herramientas")
if len(entradas) != 7:
    aviso(f"el manifiesto declara {len(entradas)} entradas (se esperaban 7)")
for nombre in entradas:
    existe = os.path.isfile(os.path.join(RAIZ, "archivos", nombre))
    (ok if existe else mal)(f"archivos/{nombre}")

reales = os.listdir(os.path.join(RAIZ, "archivos"))
faltan = set(reales) - set(entradas)
sobran = set(entradas) - set(reales)
if sobran:
    mal(f"el manifiesto nombra archivos que no están: {sobran}")
if faltan:
    aviso(f"archivos sin entrada en el manifiesto (no aparecerá como icono): {faltan}")
if not faltan and not sobran:
    ok("el manifiesto y archivos/ coinciden exactamente")

# html/css referenciados
html = open(os.path.join(RAIZ, "index.html"), encoding="utf-8").read()
for ref in re.findall(r'(?:href|src)="([^"]+)"', html):
    if ref.startswith(("http", "data:", "#")):
        continue
    (ok if os.path.isfile(os.path.join(RAIZ, ref)) else mal)(f"index.html -> {ref}")

for base, _, files in os.walk(os.path.join(RAIZ, "app")):
    for f in files:
        if not f.endswith((".js", ".css")):
            continue
        ruta = os.path.join(base, f)
        rel = os.path.relpath(ruta, RAIZ)
        txt = open(ruta, encoding="utf-8").read()
        for ref in re.findall(r"from\s+'([^']+)'|import\('([^']+)'\)", txt):
            ref = ref[0] or ref[1]
            if not ref or ref.startswith("http"):
                continue
            destino = os.path.normpath(os.path.join(base, ref))
            (ok if os.path.isfile(destino) else mal)(f"{rel} -> {ref}")

# ---------------------------------------------------------- 3. integridad
print("\n3. Datos")
items = json.load(open(os.path.join(RAIZ, "datos/items.json"), encoding="utf-8"))
res = json.load(open(os.path.join(RAIZ, "datos/resumen.json"), encoding="utf-8"))
if items["meta"]["registros"] == len(items["filas"]) == 24564:
    ok(f"items.json: {len(items['filas']):,} filas, {len(items['columnas'])} columnas")
else:
    mal(f"items.json: {len(items['filas'])} filas, declarado {items['meta']['registros']}")
if res["control"]["cuadra"] and not res["control"]["desviaciones"]:
    ok(f"resumen.json cuadra con el detalle ({res['control']['totalResumen']:,} registros, 0 desviaciones)")
else:
    mal(f"resumen.json no cuadra: {res['control']}")
if res["control"]["totalResumen"] == res["control"]["filasDetalle"] == len(items["filas"]):
    ok("las tres fuentes coinciden en 24.564")
else:
    mal("las fuentes no coinciden")

# ------------------------------------- 4. claves usadas por el explorador
print("\n4. Contrato entre el explorador y los datos")
ETIQUETAS = {
    "nSistema", "titulo", "autor", "codigo", "nota", "proceso", "item",
    "clasificacion", "inventario", "coleccion", "editorial", "isbn",
    "descripcion", "material", "fCreacion", "fActualiz", "estadistica",
    "fInventario", "fUltimoInv", "itemizador", "estado",
}
exp = open(os.path.join(RAIZ, "app/js/vistas/explorador.js"), encoding="utf-8").read()
usadas = set(re.findall(r"D\.valor\([^,]+,\s*'([^']+)'\)", exp))
usadas |= set(re.findall(r"pos\['([^']+)'\]", exp))
# las listas del explorador son multilínea: hay que quitar también las comas,
# o el separador se cuela como si fuera el nombre de un campo
for nom in ("BUSCABLES", "VISIBLES"):
    m = re.search(nom + r" = \[([^\]]+)\]", exp)
    if m:
        usadas |= set(re.sub(r"[',\s]+", " ", m.group(1)).split())
faltantes = usadas - ETIQUETAS
if faltantes:
    mal(f"el explorador usa claves que no existen: {faltantes}")
else:
    ok(f"las {len(usadas)} claves que usa el explorador existen en el contrato")
reales_claves = {c["k"] for c in items["columnas"]}
if reales_claves == ETIQUETAS:
    ok("el esquema de items.json coincide con ETIQUETAS del explorador")
else:
    mal(f"diferencia de esquema: {ETIQUETAS ^ reales_claves}")

# ------------------------------------------------------------- resumen
print("\n" + "=" * 62)
print(f"fallos: {len(fallos)}   avisos: {len(avisos)}")
for f in fallos:
    print(f"  FALLA  {f}")
for a in avisos:
    print(f"  aviso  {a}")
sys.exit(1 if fallos else 0)
