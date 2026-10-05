// nkoenig.studio V9 — Foto groß ansehen: Klick auf eine Karte, das Foto wächst mit Federschwung aus der Karte.
// Pfeile/Wischen blättern (beim Wischen folgt das Foto dem Finger), Esc oder Klick daneben legt es zurück auf die Karte.
// Bewusst ohne Titel, Zähler oder Hinweistext. Ohne JS öffnet der Link einfach das große Bild.
(() => {
  const dlg = document.getElementById('viewer');
  const links = [...document.querySelectorAll('a.zoom')];
  if (!dlg || !links.length || typeof dlg.showModal !== 'function') return;
  const img = dlg.querySelector('.v-img');
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  let i = 0, opener = null, closing = false;

  // Federkurve als CSS linear(): gedaempfte Schwingung, abgetastet (z = Daempfung, w = Eigenfrequenz rad/s)
  const hasLinear = CSS.supports('animation-timing-function', 'linear(0, 1)');
  const spring = (z, w) => {
    const T = Math.min(1.6, 6 / (z * w)), wd = w * Math.sqrt(1 - z * z), n = 48, p = [];
    for (let k = 0; k <= n; k++) {
      const t = k / n * T;
      p.push(k === n ? 1 : +(1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + z * w / wd * Math.sin(wd * t))).toFixed(4));
    }
    return hasLinear ? { easing: `linear(${p.join(', ')})`, duration: T * 1000 } : { easing: 'cubic-bezier(.2, 1.25, .35, 1)', duration: 520 };
  };
  const OPEN = spring(.62, 15), SLIDE = spring(.7, 18), BACK = spring(.8, 20);

  const thumb = (n) => links[n].querySelector('img');
  // Foto sofort mit dem schon geladenen Kartenbild zeigen (gleiches Seitenverhaeltnis), das grosse Original nachladen
  const load = (n) => {
    const t = thumb(n);
    img.style.setProperty('--ar', (t.getAttribute('width') / t.getAttribute('height')).toFixed(4));
    img.src = t.currentSrc || t.src;
    img.alt = t.alt || '';
    const big = new Image(); big.src = links[n].href;
    (big.decode ? big.decode() : Promise.resolve()).then(() => { if (i === n && dlg.open) img.src = big.src; }, () => {});
    [n - 1, n + 1].forEach((k) => { new Image().src = links[(k + links.length) % links.length].href; });   // Nachbarn vorladen
  };

  // Lage des Kartenfotos -> Transform, der das grosse Foto genau dorthin legt
  const fromCard = (n) => {
    const a = thumb(n).getBoundingClientRect(), b = img.getBoundingClientRect();
    if (!a.width || a.bottom < 0 || a.top > innerHeight) return null;
    const r = parseFloat(links[n].closest('.card')?.style.getPropertyValue('--r')) || 0;
    return `translate(${a.left + a.width / 2 - (b.left + b.width / 2)}px, ${a.top + a.height / 2 - (b.top + b.height / 2)}px) scale(${a.width / b.width}, ${a.height / b.height}) rotate(${r}deg)`;
  };

  const open = (n) => {
    opener = links[n]; i = n; closing = false;
    load(n);
    dlg.showModal();
    dlg.focus();   // Fokus auf den Dialog selbst, damit der Schliessen-Knopf nicht gleich gelb aufleuchtet
    document.documentElement.classList.add('viewing');
    if (still.matches) return;
    const from = fromCard(n);
    img.animate(from ? [{ transform: from }, { transform: 'none' }] : [{ transform: 'scale(.92)', opacity: 0 }, { transform: 'none', opacity: 1 }], OPEN);
  };

  const close = () => {
    if (!dlg.open || closing) return;
    if (still.matches) { dlg.close(); return; }
    closing = true;
    dlg.classList.add('closing');
    img.getAnimations().forEach((a) => a.cancel());
    const to = fromCard(i);
    const anim = img.animate(to ? [{ transform: 'none' }, { transform: to }] : [{ opacity: 1 }, { transform: 'scale(.94)', opacity: 0 }],
      { duration: 380, easing: 'cubic-bezier(.5, 0, .2, 1)', fill: 'forwards' });
    anim.onfinish = () => { dlg.close(); anim.cancel(); };
  };

  // Blaettern: altes Foto rutscht weg, neues kommt mit Schwung aus der anderen Richtung
  const go = (dir, from = 0) => {
    const n = (i + dir + links.length) % links.length;
    if (still.matches) { i = n; load(n); return; }
    img.getAnimations().forEach((a) => a.cancel());
    const out = img.animate([{ transform: `translateX(${from}px)` }, { transform: `translateX(${-dir * 70}px) rotate(${-dir * 2}deg)`, opacity: 0 }],
      { duration: 130, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' });
    out.onfinish = () => {
      i = n; load(n); out.cancel();
      img.animate([{ transform: `translateX(${dir * 90}px) rotate(${dir * 3}deg)`, opacity: 0 }, { transform: 'none', opacity: 1 }], SLIDE);
    };
  };

  links.forEach((a, n) => a.addEventListener('click', (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    open(n);
  }));

  dlg.querySelector('.v-close').addEventListener('click', close);
  dlg.querySelector('.v-prev').addEventListener('click', () => go(-1));
  dlg.querySelector('.v-next').addEventListener('click', () => go(1));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });   // Klick neben das Foto
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });    // Esc: auch zuruecklegen statt verschwinden
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
  });
  dlg.addEventListener('close', () => {
    closing = false;
    dlg.classList.remove('closing');
    document.documentElement.classList.remove('viewing');
    opener?.focus({ preventScroll: true }); opener = null;
  });

  // Wischen auf dem Handy: das Foto haengt am Finger und federt zurueck oder fliegt weiter
  let sx = 0, sy = 0, dx = 0, drag = false;
  img.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    sx = e.clientX; sy = e.clientY; dx = 0; drag = true;
    img.getAnimations().forEach((a) => a.cancel());
  }, { passive: true });
  img.addEventListener('pointermove', (e) => {
    if (!drag) return;
    dx = e.clientX - sx;
    if (Math.abs(e.clientY - sy) > Math.abs(dx) * 1.5 && Math.abs(dx) < 12) return;
    img.style.transform = `translateX(${dx}px) rotate(${dx / 60}deg)`;
  }, { passive: true });
  const end = () => {
    if (!drag) return;
    drag = false;
    const from = dx; img.style.transform = '';
    if (Math.abs(from) > 60) go(from < 0 ? 1 : -1, from);
    else if (from && !still.matches) img.animate([{ transform: `translateX(${from}px) rotate(${from / 60}deg)` }, { transform: 'none' }], BACK);
  };
  img.addEventListener('pointerup', end, { passive: true });
  img.addEventListener('pointercancel', end, { passive: true });
  img.draggable = false;
})();
