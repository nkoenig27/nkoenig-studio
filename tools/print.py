#!/usr/bin/env python3
"""V9 Druck: rechnet die Fotos der Karten als gedruckte Abzuege (Offsetdruck, CMYK).

1) img/print/<id>-<breite>.webp  — eingebacken, was ein Druck mit dem Bild macht:
   - Farbauszug in C, M, Y, K (einfacher Unterfarbenabbau)
   - Tonwertzuwachs: Mitteltoene laufen dunkler zu, wie Farbe auf saugendem Karton
   - Farbe laeuft aus: Kanten weich und entlang der Papierfaser (img/tex/fiber.webp) ausgefranst
   - Passerversatz: Magenta- und Cyan-Platte sitzen einen Hauch daneben -> Farbsaeume an harten Kanten
   - Schmitzen beim Portrait: schwacher Doppeldruck der Schwarzplatte
   - Papierfaser zeichnet sich in den Lichtern ab
   Die Farben bleiben die des Originals: nur der Unterschied zwischen diesem Druck und einem perfekten
   Druck wird auf das Foto gelegt.
2) img/print/rosette.webp, rosette-k.webp — das Raster selbst als nahtlose Kachel (C 18, M 72, Y 0, K 45 Grad,
   gleiche Rasterweite -> Rosette). Liegt per CSS (overlay) auf dem Foto: so wirkt es nur in den Mitteltoenen,
   wie ein echtes Raster, und die Bilddateien bleiben klein.
Die Grossansicht zeigt weiter das saubere Original (img/<id>-1600.webp).

Aufruf:  python3 tools/print.py
Braucht: numpy, Pillow (mit WebP)."""
import os
import numpy as np
from PIL import Image

SITE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
IMG = os.path.join(SITE, "img")
OUT = os.path.join(IMG, "print")

CARDS = ["svIlYNz19pQ", "S_MXibn6oHI", "wWiVD-IsDns", "lqy07Ffdkoc", "yNxP-sdPEx0", "iYcURjI3aZ8", "kGuBcBm0E1g",
         "Gth9FScaFCk", "XPmTnY4AHtk", "qIIUsbRZCtw", "wElIrmSa0AU", "tongwU50wgE", "xKY4ZHJDITA"]
WIDTHS = (640, 1080, 1600)   # + 2100 fuer Bilder, die so gross vorliegen
CELLS = 180          # gedachte Rasterzellen ueber die Bildbreite: bestimmt, wie weit die Platten daneben sitzen
INK = {   # Durchlass der Druckfarben (sRGB, ungefaehr Euroskala)
    "c": np.array([.0, .62, .88]), "m": np.array([.9, .0, .5]), "y": np.array([1, .9, .0]), "k": np.array([.12, .12, .13])}
PAPER = np.array([.975, .962, .935])


def load(path, w=None):
    im = Image.open(path).convert("RGB")
    if w and im.width != w:
        im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    return np.asarray(im, np.float32) / 255


def save(arr, path, q=80):
    Image.fromarray((np.clip(arr, 0, 1) * 255 + .5).astype(np.uint8)).save(path, "WEBP", quality=q, method=6)
    print(f"{os.path.relpath(path, SITE):34s} {os.path.getsize(path) // 1024} KB")


def blur(a, s):
    """Gauss per FFT, Raender gespiegelt"""
    if a.ndim == 3:
        return np.stack([blur(a[..., i], s) for i in range(a.shape[2])], -1)
    h, w = a.shape
    p = int(3 * s) + 2
    b = np.pad(a, p, mode="reflect")
    H, W = b.shape
    ky, kx = np.meshgrid(np.fft.fftfreq(H), np.fft.fftfreq(W), indexing="ij")
    f = np.fft.fft2(b) * np.exp(-(kx ** 2 + ky ** 2) * s ** 2 * 2 * np.pi ** 2)
    return np.real(np.fft.ifft2(f))[p:p + h, p:p + w].astype(np.float32)


def shift(a, dx, dy):
    """um Bruchteile von Pixeln verschieben; was hereinwandert ist unbedrucktes Papier (0)"""
    h, w = a.shape
    ix, iy = int(np.floor(dx)), int(np.floor(dy))
    fx, fy = dx - ix, dy - iy
    p = max(abs(ix), abs(iy)) + 2
    b = np.pad(a, p)
    def at(ox, oy):
        return b[p - oy:p - oy + h, p - ox:p - ox + w]
    return ((1 - fx) * (1 - fy) * at(ix, iy) + fx * (1 - fy) * at(ix + 1, iy)
            + (1 - fx) * fy * at(ix, iy + 1) + fx * fy * at(ix + 1, iy + 1))


def fiber(h, w, scale):
    """Papierfaser der Seite (img/tex/fiber.webp), gekachelt, Mittelwert 0, Streuung 1"""
    t = Image.open(os.path.join(IMG, "tex", "fiber.webp")).convert("L")
    t = t.resize((max(8, round(t.width * scale)), max(8, round(t.height * scale))), Image.LANCZOS)
    a = np.asarray(t, np.float32) / 255
    a = np.tile(a, (h // a.shape[0] + 1, w // a.shape[1] + 1))[:h, :w]
    return (a - a.mean()) / (a.std() + 1e-6)


def separate(rgb):
    """einfacher Farbauszug mit Unterfarbenabbau"""
    k = 1 - rgb.max(-1)
    k = np.clip((k - .12) / .88, 0, 1) ** 1.1          # Schwarz erst in den Tiefen
    d = np.maximum(1 - k, 1e-4)[..., None]
    cmy = np.clip((1 - rgb - k[..., None]) / d, 0, 1)
    return {"c": cmy[..., 0], "m": cmy[..., 1], "y": cmy[..., 2], "k": k}


def press(rgb, cell, plates="cmyk", seed=0, misreg=(.42, .24), slur=None, gain=.2, bleed=.55):
    """wie dieser Druck vom perfekten abweicht, aufs Original gelegt"""
    h, w, _ = rgb.shape
    fib = fiber(h, w, cell / 9)
    rough = blur(np.random.default_rng(seed).standard_normal((h, w)).astype(np.float32), .7)
    rough = (fib * .5 + rough / (rough.std() + 1e-6) * .5)
    sep = separate(rgb) if plates == "cmyk" else {"k": 1 - rgb.mean(-1)}

    out, ideal = np.ones((h, w, 3), np.float32) * PAPER, np.ones((h, w, 3), np.float32) * PAPER
    for n, cov in sep.items():
        plate = np.clip(cov + gain * cov * (1 - cov), 0, 1)          # Tonwertzuwachs (~5 % bei 50 %)
        # Farbe laeuft aus: weicher, und an Kanten je nach Faser mal mehr, mal weniger
        soft = blur(plate, bleed)
        edge = np.abs(soft - plate)
        plate = np.clip(soft + edge * rough * .9, 0, 1)
        if slur:                                                        # Schmitzen: schwacher Doppeldruck
            plate = np.maximum(plate, shift(plate, *slur) * .3)
        if n == "m": plate = shift(plate, misreg[0] * cell, misreg[1] * cell)
        if n == "c": plate = shift(plate, -misreg[1] * cell * .5, misreg[0] * cell * .4)
        out *= 1 - plate[..., None] * (1 - INK[n])
        ideal *= 1 - cov[..., None] * (1 - INK[n])
    out *= 1 + fib[..., None] * .022                                   # Faser zeichnet sich in den Lichtern ab
    return np.clip(rgb + (out - ideal), 0, 1)


def lattice(T, e1, angle_aa=1.4):
    """Punktraster als Kachel T x T. e1 = ganzzahliger Gittervektor (e2 senkrecht dazu, gleich lang),
    damit die Kachel nahtlos ist. Gibt Deckung 0..1 bei 50 % Flaechendeckung zurueck (runde Punkte)."""
    e1 = np.array(e1, np.float32); e2 = np.array([-e1[1], e1[0]], np.float32)
    c2 = float(e1 @ e1)
    y, x = np.mgrid[0:T, 0:T].astype(np.float32) + .5
    u = (x * e1[0] + y * e1[1]) / c2
    v = (x * e2[0] + y * e2[1]) / c2
    spot = (np.cos(2 * np.pi * u) + np.cos(2 * np.pi * v)) / 2
    return np.clip(spot / (angle_aa * 2 * np.pi / np.sqrt(c2)) + .5, 0, 1)


def rosette(T=360, plates="cmyk"):
    """Rasterkachel um 50 % Grau (neutral fuer overlay). Gleiche Rasterweite (~12.7 px), Winkel 18/72/0/45 Grad.
    Gerechnet auf 360 px, gespeichert auf 180 px (bleibt nahtlos, Datei klein)."""
    vec = {"c": (12, 4), "m": (4, 12), "y": (12, 0), "k": (9, 9)}
    weight = {"c": .9, "m": .9, "y": .55, "k": 1}
    col = np.ones((T, T, 3), np.float32)
    for n in plates:
        d = lattice(T, vec[n])
        col *= 1 - (d * weight[n])[..., None] * (1 - INK[n])
    col -= col.mean((0, 1))
    col = np.clip(.5 + col / (np.abs(col).max() + 1e-6) * .42, 0, 1)
    im = Image.fromarray((col * 255 + .5).astype(np.uint8)).resize((T // 2, T // 2), Image.LANCZOS)
    return np.asarray(im, np.float32) / 255


def main():
    os.makedirs(OUT, exist_ok=True)
    for i, cid in enumerate(CARDS):
        src = os.path.join(IMG, f"{cid}-2100.webp")
        if not os.path.exists(src):
            src = os.path.join(IMG, f"{cid}-1600.webp")
        for w in WIDTHS + ((2100,) if src.endswith("-2100.webp") else ()):
            save(press(load(src, w), w / CELLS, seed=i, bleed=w / 1200), os.path.join(OUT, f"{cid}-{w}.webp"))
    # Portrait auf der Folie: nur Schwarz, wenig Zuwachs, etwas Schmitzen
    cell = 1240 / 150
    save(press(load(os.path.join(IMG, "niklas-1240.webp")), cell, plates="k", seed=99,
               slur=(cell * .2, cell * .34), gain=.06, bleed=.8), os.path.join(OUT, "niklas-1240.webp"))
    save(rosette(), os.path.join(OUT, "rosette.webp"), q=88)
    save(rosette(plates="k"), os.path.join(OUT, "rosette-k.webp"), q=88)


if __name__ == "__main__":
    main()
