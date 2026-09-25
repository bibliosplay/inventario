#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Prueba de humo de la webapp en un Chrome headless real, vía DevTools Protocol.

Sirve el repo con un servidor estático y comprueba, como lo vería una persona:
el arranque del escritorio, los 6 iconos, el buscador, la apertura de ventanas,
el arrastre, el Explorador (resumen + detalle + búsqueda) y las 5 herramientas
HTML embebidas. También recoge cualquier error de consola o excepción.
"""
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

RAIZ = os.path.dirname(os.path.abspath(__file__))
PUERTO = 8765
DEBUG = 9222
# Ruta de Chrome/Chromium: se puede sobreescribir con la variable de entorno
# CHROME_PATH; si no, se prueban las rutas típicas de Windows, macOS y Linux.
CHROME = os.environ.get("CHROME_PATH") or next(
    (p for p in (
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium",
    ) if os.path.exists(p)),
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
)

fallos = []
consola = []


def check(nombre, condicion, detalle=""):
    if condicion:
        print(f"  [ok]    {nombre}")
    else:
        fallos.append(f"{nombre} {detalle}".strip())
        print(f"  [FALLA] {nombre}  {detalle}")


# ------------------------------------------------------------- servidor ---
class Silencio(SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def handle_one_request(self):
        # Chrome corta la descarga de items.json (6,1 MB) al cambiar de pestaña o
        # recargar. Es normal y no-interestante: sin esto, Traceback por consola.
        try:
            super().handle_one_request()
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            self.close_connection = True


def servir():
    handler = lambda *a, **k: Silencio(*a, directory=RAIZ, **k)
    httpd = ThreadingHTTPServer(("127.0.0.1", PUERTO), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


# ------------------------------------------------------------------ CDP ----
class CDP:
    def __init__(self, ws_url):
        import websocket
        self.ws = websocket.create_connection(ws_url, timeout=90)
        self.id = 0
        self.buf = []

    def enviar(self, method, **params):
        self.id += 1
        self.ws.send(json.dumps({"id": self.id, "method": method, "params": params}))
        return self.id

    def hasta(self, mid, timeout=60):
        limite = time.time() + timeout
        while time.time() < limite:
            try:
                msg = json.loads(self.ws.recv())
            except Exception:
                continue
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(f"{msg['error']}")
                return msg.get("result", {})
        raise TimeoutError("sin respuesta del navegador")

    def llamar(self, method, **params):
        return self.hasta(self.enviar(method, **params))

    def drenar(self, segundos=0.6):
        """Lee los eventos acumulados (errores de consola, excepciones)."""
        limite = time.time() + segundos
        self.ws.settimeout(0.25)
        while time.time() < limite:
            try:
                msg = json.loads(self.ws.recv())
            except Exception:
                continue
            if "method" in msg:
                self.buf.append(msg)
        self.ws.settimeout(90)

    def evaluar(self, expresion, esperar=False):
        r = self.llamar("Runtime.evaluate", expression=expresion,
                        returnByValue=True, awaitPromise=esperar)
        if "exceptionDetails" in r:
            raise RuntimeError(r["exceptionDetails"].get("text", "error") +
                               " " + str(r["exceptionDetails"].get("exception", {}).get("description", "")))
        return r.get("result", {}).get("value")

    def ir(self, url):
        self.llamar("Page.navigate", url=url)
        time.sleep(1.0)

    def clic_real(self, sel):
        """Clic de ratón de verdad sobre un elemento.

        Imprescindible: element.click() desde el código salta la comprobación de
        capas, así que da verde aunque algo invisible esté tapando el icono.
        """
        caja = self.evaluar(
            f"(()=>{{const e=document.querySelector({sel!r});"
            f"if(!e) return null; const r=e.getBoundingClientRect();"
            f"return [r.left+r.width/2, r.top+r.height/2];}})()")
        if not caja:
            return False
        x, y = caja
        for tipo, botones in (("mouseMoved", 0), ("mousePressed", 1), ("mouseReleased", 0)):
            self.llamar("Input.dispatchMouseEvent", type=tipo, x=x, y=y,
                        button="left", clickCount=1, buttons=botones)
            time.sleep(0.12)
        return True

    def tapa(self, sel):
        """True si el elemento NO es el primero bajo su propio centro (algo lo tapa)."""
        return self.evaluar(
            f"(()=>{{const e=document.querySelector({sel!r});"
            f"if(!e) return true; const r=e.getBoundingClientRect();"
            f"if(!r.width) return true;"
            f"const t=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2);"
            f"return !(t===e || e.contains(t));}})()")

    # eventos de error recogidos
    def errores(self):
        mal = []
        for m in self.buf:
            metodo, p = m["method"], m.get("params", {})
            if metodo == "Runtime.exceptionThrown":
                d = p.get("exceptionDetails", {})
                mal.append(f"excepción: {d.get('text')} {d.get('exception', {}).get('description', '')}".strip())
            elif metodo == "Log.entryAdded" and p.get("entry", {}).get("level") in ("error",):
                mal.append(f"log: {p['entry'].get('text')}")
            elif metodo == "Runtime.consoleAPICalled" and p.get("type") in ("error",):
                txt = " ".join(str(a.get("value", a.get("description", ""))) for a in p.get("args", []))
                mal.append(f"consola.error: {txt}")
        return mal


def esperar(cdp, expresion, segundos=30, etiqueta=""):
    """Espera a que la expresión JS devuelva un valor verdadero."""
    fin = time.time() + segundos
    while time.time() < fin:
        try:
            if cdp.evaluar(expresion):
                return True
        except Exception:
            pass
        time.sleep(0.3)
    print(f"    (agotado esperando {etiqueta or expresion})")
    return False


def cabecera(texto):
    """Primera cifra de un rótulo del tipo "3 de 24.564 fichas"."""
    m = re.match(r"\s*(\d+)", texto or "")
    return int(m.group(1)) if m else -1


# ------------------------------------------------------------------ main ---
def main():
    if not os.path.isfile(CHROME):
        print("Chrome no encontrado; no se puede probar")
        return 2
    # sin argumento se prueba el servidor local; con una URL, esa misma web
    externa = sys.argv[1] if len(sys.argv) > 1 else None
    perfil = tempfile.mkdtemp(prefix="bpm-chrome-")
    if not externa:
        servir()

    chrome = subprocess.Popen(
        [CHROME, "--headless=new", "--disable-gpu", "--no-first-run",
         "--no-default-browser-check", "--disable-extensions",
         f"--remote-debugging-port={DEBUG}", "--remote-allow-origins=*",
         f"--user-data-dir={perfil}", "--window-size=1440,900", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    try:
        objetivo = None
        for _ in range(60):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{DEBUG}/json/list", timeout=2) as r:
                    paginas = [t for t in json.load(r) if t["type"] == "page"]
                if paginas:
                    objetivo = paginas[0]["webSocketDebuggerUrl"]
                    break
            except Exception:
                time.sleep(0.4)
        if not objetivo:
            print("no se pudo conectar con Chrome")
            return 2

        cdp = CDP(objetivo)
        cdp.llamar("Page.enable")
        cdp.llamar("Runtime.enable")
        cdp.llamar("Log.enable")
        cdp.llamar("Emulation.setDeviceMetricsOverride", width=1440, height=900,
                   deviceScaleFactor=1, mobile=False)

        base = externa or f"http://127.0.0.1:{PUERTO}/index.html"
        print(f"\n1. Arranque  {base}")
        # sesión limpia: si no, la prueba hereda ventanas de la corrida anterior
        cdp.llamar("Page.navigate", url=base)
        time.sleep(0.8)
        cdp.evaluar("localStorage.clear()")
        cdp.ir(base)
        listo = esperar(cdp, "!!document.querySelectorAll('.icono').length", 20, "iconos")
        check("la página carga y dibuja iconos", listo)
        cdp.drenar(1.0)

        n = cdp.evaluar("document.querySelectorAll('.icono').length")
        check("hay 6 iconos en el escritorio", n == 6, f"hay {n}")

        # ¿hay algo invisible por encima de los iconos? Un clic real lo delata,
        # un .click() de código no, porque se salta la comprobación de capas.
        tapados = cdp.evaluar(
            "(()=>{const out=[];for(const e of document.querySelectorAll('.icono')){"
            "const r=e.getBoundingClientRect();"
            "const t=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2);"
            "if(!(t===e||e.contains(t))) out.push(e.dataset.id+' tapado por '+t.tagName"
            "+(t.className?'.'+String(t.className).split(' ')[0]:''));}"
            "return out;})()")
        check("ninguna capa invisible tapa los iconos", not tapados, "; ".join(tapados))

        ventanas_posibles = cdp.evaluar(
            "document.querySelector('.seccion__nota').textContent.replace(/\\s+/g,' ').trim()")
        check("la cabecera declara 6 iconos y 6 ventanas",
              "6 iconos" in ventanas_posibles and "6 ventanas" in ventanas_posibles, ventanas_posibles)

        kpi = cdp.evaluar("document.getElementById('k-total').textContent")
        check("las cifras del libro llegan a la portada", kpi == "24.564", f"k-total={kpi}")
        col = cdp.evaluar("document.getElementById('k-colecciones').textContent")
        check("las colecciones se leen del resumen", col == "18", f"k-colecciones={col}")

        print("\n2. Buscador")
        cdp.evaluar("document.getElementById('q').focus()")
        cdp.evaluar("(()=>{const q=document.getElementById('q');q.value='glosario';q.dispatchEvent(new Event('input'))})()")
        time.sleep(0.5)
        nres = cdp.evaluar("document.querySelectorAll('#resultados .resultado').length")
        check("buscar 'glosario' encuentra el resultado", nres >= 1, f"{nres} resultados")
        primer = cdp.evaluar("document.querySelector('#resultados .resultado')?.dataset.id")
        check("el primer resultado es el glosario", primer == "glosario", f"es {primer}")
        cdp.evaluar("document.querySelector('#resultados .resultado').click()")
        time.sleep(2.0)
        check("abrir desde el buscador crea la ventana",
              cdp.evaluar("document.querySelectorAll('.ventana').length") == 1)

        print("\n3. Ventanas")
        # se cierra lo que haya abierto antes: una ventana abierta tapa los iconos
        # que quedan debajo, así que el clic debe medirse con el escritorio limpio
        cdp.evaluar("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))")
        time.sleep(0.8)
        cdp.clic_real('.icono[data-id=explorador]')
        time.sleep(2.5)
        check("un clic real de ratón abre la ventana del icono",
              cdp.evaluar("!!document.querySelector('.ventana[data-id=explorador]')"))
        cdp.evaluar("document.querySelector('.icono[data-id=dewey]').click()")
        time.sleep(2.5)
        base_n = cdp.evaluar("document.querySelectorAll('.ventana').length") - 1
        total = cdp.evaluar("document.querySelectorAll('.ventana').length")
        check("se pueden abrir varias ventanas a la vez", total == base_n + 1, f"hay {total}")
        tareas = cdp.evaluar("document.querySelectorAll('.tarea').length")
        check("la barra de tareas lista las ventanas abiertas", tareas == total, f"hay {tareas}")

        marco_ok = esperar(cdp, "document.querySelector('.ventana[data-id=dewey] iframe')?.contentDocument?.readyState==='complete'", 20, "iframe dewey")
        check("la herramienta HTML se carga dentro del iframe", marco_ok)
        dewey_titulo = cdp.evaluar(
            "document.querySelector('.ventana[data-id=dewey] iframe')?.contentDocument?.title || ''")
        check("el iframe trae el archivo original", "Dewey" in dewey_titulo, dewey_titulo)

        print("\n4. Arrastrar y maximizar")
        antes = cdp.evaluar("document.querySelector('.ventana[data-id=explorador]').style.left")
        cdp.evaluar("""(()=>{
          const v=document.querySelector('.ventana[data-id=explorador]');
          const barra=v.querySelector('.ventana__barra');
          const r=barra.getBoundingClientRect();
          const ev=(t,x,y)=>barra.dispatchEvent(new PointerEvent(t,{clientX:x,clientY:y,bubbles:true,pointerId:1,button:0}));
          ev('pointerdown', r.left+40, r.top+20);
          window.dispatchEvent(new PointerEvent('pointermove',{clientX:r.left+240,clientY:r.top+140,bubbles:true,pointerId:1}));
          window.dispatchEvent(new PointerEvent('pointerup',{clientX:r.left+240,clientY:r.top+140,bubbles:true,pointerId:1}));
        })()""")
        time.sleep(0.6)
        despues = cdp.evaluar("document.querySelector('.ventana[data-id=explorador]').style.left")
        check("la ventana se puede arrastrar", antes != despues, f"{antes} -> {despues}")

        cdp.evaluar("document.querySelector('.ventana[data-id=explorador] .control--max').click()")
        time.sleep(0.6)
        check("se puede maximizar",
              cdp.evaluar("document.querySelector('.ventana[data-id=explorador]').dataset.max") == "1")
        cdp.evaluar("document.querySelector('.ventana[data-id=explorador] .control--max').click()")
        time.sleep(0.6)
        check("se puede restaurar",
              cdp.evaluar("document.querySelector('.ventana[data-id=explorador]').dataset.max") == "0")

        cdp.evaluar("document.querySelector('.ventana[data-id=explorador] .control--min').click()")
        time.sleep(0.5)
        check("se puede minimizar",
              cdp.evaluar("document.querySelector('.ventana[data-id=explorador]').hidden") is True)
        cdp.evaluar("document.querySelector('.tarea[data-id=explorador]').click()")
        time.sleep(0.5)
        check("se puede restaurar desde la barra de tareas",
              cdp.evaluar("document.querySelector('.ventana[data-id=explorador]').hidden") is False)

        print("\n5. Explorador · resumen")
        cdp.evaluar("document.querySelector('.ventana[data-id=explorador] .explo__cuerpo').scrollTop=0")
        hay_kpis = esperar(cdp, "document.querySelectorAll('.kpi').length>=5", 20, "tarjetas del resumen")
        check("se dibuja el resumen por colección", hay_kpis)
        total_kpi = cdp.evaluar("document.querySelector('.kpi .kpi__n').textContent")
        check("el total del resumen es 24.564", total_kpi == "24.564", f"dice {total_kpi}")
        filas = cdp.evaluar("document.querySelectorAll('.tabla--compacta tbody tr').length")
        check("la tabla de cifras tiene 18 colecciones + total", filas == 19, f"hay {filas} filas")
        cuadra = cdp.evaluar("!!document.querySelector('.pildora--ok')")
        check("el resumen se declara cotejado con el detalle", cuadra)

        print("\n6. Explorador · detalle (carga de 6,1 MB)")
        cdp.evaluar("document.querySelector('[data-vista=detalle]').click()")
        ok_detalle = esperar(cdp, "document.querySelectorAll('.tabla--fichas tbody tr').length>0", 90, "detalle")
        check("el detalle carga y pinta fichas", ok_detalle)
        shown = cdp.evaluar("document.querySelectorAll('.tabla--fichas tbody tr').length")
        check("la tabla trae 50 filas por página", shown == 50, f"trae {shown}")
        conteo = cdp.evaluar("document.querySelector('[data-conteo]')?.textContent || ''")
        check("el conteo indica 24.564 de 24.564", "24.564" in conteo, conteo)

        cdp.evaluar("""(()=>{const q=document.querySelector('[data-q]');
          q.value='nabokov';q.dispatchEvent(new Event('input'))})()""")
        time.sleep(1.2)
        conteo = cdp.evaluar("document.querySelector('[data-conteo]')?.textContent || ''")
        # el formato es "N de 24.564 fichas": hay que mirar la cifra de cabecera
        check("la búsqueda por texto filtra", cabecera(conteo) == 3, conteo)
        primera = cdp.evaluar("document.querySelector('.tabla--fichas tbody .tit b')?.textContent || ''")
        check("el primer resultado corresponde a la búsqueda",
              "nin" in primera.lower() or "nabokov" in primera.lower(), primera)

        cdp.evaluar("""(()=>{const q=document.querySelector('[data-q]');
          q.value='';q.dispatchEvent(new Event('input'))})()""")
        time.sleep(1.0)
        cdp.evaluar("""(()=>{const s=document.querySelector('select[data-f=coleccion]');
          s.value='PATRI';s.dispatchEvent(new Event('change'))})()""")
        time.sleep(1.0)
        conteo = cdp.evaluar("document.querySelector('[data-conteo]')?.textContent || ''")
        check("el filtro por colección reduce a 12 fichas", cabecera(conteo) == 12, conteo)
        chip = cdp.evaluar("document.querySelector('.filtros-vivos .pildora')?.textContent || ''")
        check("el filtro activo se muestra como etiqueta", "Patrimonial" in chip, chip)

        cdp.evaluar("document.querySelector('.tabla--fichas tbody tr').click()")
        time.sleep(0.6)
        campos = cdp.evaluar("document.querySelectorAll('.ficha__campo').length")
        check("al abrir una ficha se muestran sus 21 campos", campos >= 15, f"{campos} campos")
        cdp.evaluar("document.querySelector('[data-ficha-cerrar]').click()")
        cdp.evaluar("document.querySelector('[data-limpiar]').click()")
        time.sleep(1.0)
        conteo = cdp.evaluar("document.querySelector('[data-conteo]')?.textContent || ''")
        check("«quitar filtros» restablece el listado", "24.564" in conteo, conteo)

        print("\n7. Navegación por teclado")
        antes = cdp.evaluar("document.querySelectorAll('.ventana').length")
        enfocada = cdp.evaluar("document.querySelector('.ventana--foco')?.dataset.id || '(ninguna)'")
        cdp.evaluar("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))")
        time.sleep(0.5)
        abierto = cdp.evaluar("document.querySelectorAll('.ventana').length")
        check("Escape cierra la ventana enfocada",
              abierto == antes - 1, f"enfocada={enfocada}, quedan {abierto} de {antes}")

        print("\n8. Errores de consola")
        cdp.drenar(1.2)
        errores = [e for e in cdp.errores() if "favicon" not in e.lower()]
        if errores:
            for e in errores[:12]:
                print(f"    · {e[:220]}")
            check("sin errores en la consola", False, f"{len(errores)} errores")
        else:
            check("sin errores en la consola", True)

        print("\n9. Tema oscuro")
        # la sección 7 puede haber cerrado el dewey: se reabre para poder mirar su iframe
        cdp.evaluar("""(()=>{if(!document.querySelector('.ventana[data-id=dewey]'))
          document.querySelector('.icono[data-id=dewey]').click()})()""")
        esperar(cdp, "!!document.querySelector('.ventana[data-id=dewey] iframe')"
                     "?.contentDocument?.documentElement", 25, "iframe de dewey")
        cdp.evaluar("document.getElementById('tema').click()")
        time.sleep(0.8)
        tema = cdp.evaluar("document.documentElement.dataset.tema")
        check("el conmutador cambia el tema", tema == "oscuro", f"tema={tema}")
        puente = cdp.evaluar(
            "document.querySelector('.ventana[data-id=dewey] iframe')"
            "?.contentDocument?.documentElement?.dataset?.theme || ''")
        check("el tema se propaga al iframe", puente == "dark", f"iframe={puente}")
        cdp.evaluar("document.getElementById('tema').click()")
        time.sleep(0.5)
        vuelta = cdp.evaluar(
            "document.querySelector('.ventana[data-id=dewey] iframe')"
            "?.contentDocument?.documentElement?.dataset?.theme || ''")
        check("el tema vuelve al claro en el iframe", vuelta == "light", f"iframe={vuelta}")

        print("\n10. Persistencia de la sesión")
        esperado = cdp.evaluar("document.querySelectorAll('.ventana').length")
        cdp.evaluar("window.__guardado = localStorage.getItem('bpm_ventanas_v1')")
        guardado = cdp.evaluar("window.__guardado") or ""
        check("la disposición se guarda en el navegador",
              "dewey" in guardado and "cajas" in guardado, f"{len(guardado)} bytes")
        cdp.ir(base)
        esperar(cdp, "document.querySelectorAll('.ventana').length>0", 25, "restaurar sesión")
        rest = cdp.evaluar("document.querySelectorAll('.ventana').length")
        check("al recargar se restauran las ventanas", rest == esperado,
              f"vuelven {rest}, se esperaban {esperado}")

    finally:
        chrome.terminate()
        try:
            chrome.wait(timeout=10)
        except Exception:
            chrome.kill()
        shutil.rmtree(perfil, ignore_errors=True)

    print("\n" + "=" * 64)
    if fallos:
        print(f"FALLOS: {len(fallos)}")
        for f in fallos:
            print(f"  · {f}")
        return 1
    print("Todas las comprobaciones pasaron.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
