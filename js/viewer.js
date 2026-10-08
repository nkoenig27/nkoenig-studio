// Foto-Grossansicht: unterbrechbare Uebergaenge und richtungsgebundene Touch-Gesten.
(() => {
  const dlg = document.getElementById('viewer');
  const links = [...document.querySelectorAll('a.zoom')];
  if (!dlg || !links.length || typeof dlg.showModal !== 'function') return;
  const img = dlg.querySelector('.v-img');
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const wrap = (n) => (n + links.length) % links.length;
  let i = 0, desired = 0, opener = null, closing = false;
  let transition = null, revision = 0, loadRevision = 0, preloadTimer = 0, drag = null;

  const hasLinear = CSS.supports('animation-timing-function', 'linear(0, 1)');
  const spring = (z, w) => {
    const T = Math.min(1.2, 6 / (z * w)), wd = w * Math.sqrt(1 - z * z), p = [];
    for (let k = 0; k <= 48; k++) {
      const t = k / 48 * T;
      p.push(k === 48 ? 1 : +(1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + z * w / wd * Math.sin(wd * t))).toFixed(4));
    }
    return hasLinear ? { easing: `linear(${p.join(', ')})`, duration: T * 1000 }
      : { easing: 'cubic-bezier(.2, 1, .3, 1)', duration: 360 };
  };
  const OPEN = spring(.8, 20), SLIDE = spring(.84, 24), BACK = spring(.88, 26);
  const thumb = (n) => links[n].querySelector('img');
  const sceneChanged = () => document.dispatchEvent(new Event('scenechange'));

  // Decodierung wiederverwenden; alte Ladeergebnisse duerfen kein neueres Foto ersetzen.
  const large = new Map();
  const getLarge = (n) => {
    if (large.has(n)) return large.get(n);
    const big = new Image(); big.decoding = 'async';
    const entry = { src: links[n].href, ready: false };
    const loaded = new Promise((resolve, reject) => { big.onload = resolve; big.onerror = reject; });
    big.src = entry.src;
    entry.promise = loaded.then(() => big.decode ? big.decode() : undefined)
      .then(() => { entry.ready = true; return entry.src; }, () => { large.delete(n); return null; });
    large.set(n, entry);
    return entry;
  };
  const load = (n) => {
    const ticket = ++loadRevision, t = thumb(n), entry = getLarge(n);
    img.style.setProperty('--ar', (t.getAttribute('width') / t.getAttribute('height')).toFixed(4));
    img.src = entry.ready ? entry.src : t.currentSrc || t.src;
    img.alt = t.alt || '';
    entry.promise.then(async (src) => {
      if (transition) await transition.finished.catch(() => {});
      if (src && ticket === loadRevision && i === n && dlg.open && !closing) img.src = src;
    });
    clearTimeout(preloadTimer);
    if (!navigator.connection?.saveData && !/2g/.test(navigator.connection?.effectiveType || '')) {
      preloadTimer = setTimeout(() => {
        if (ticket === loadRevision && dlg.open && !closing) {
          getLarge(wrap(n - 1)); getLarge(wrap(n + 1));
        }
      }, 250);
    }
  };

  // Sichtbare Position uebernehmen, bevor die alte Animation abgebrochen wird.
  const interrupt = () => {
    const style = getComputedStyle(img);
    const frame = { transform: style.transform, opacity: style.opacity };
    revision++;
    transition?.cancel(); transition = null;
    img.style.transform = ''; img.style.opacity = '';
    return frame;
  };
  const animate = (frames, options, done = () => {}) => {
    const ticket = revision;
    const a = img.animate(frames, { ...options, fill: 'both' });
    transition = a;
    a.finished.then(() => {
      if (ticket !== revision || transition !== a) return;
      transition = null; a.cancel(); done();
    }, () => {});
  };
  const fromCard = (n) => {
    const t = thumb(n), a = t.getBoundingClientRect();
    if (!a.width || a.bottom < 0 || a.top > innerHeight) return null;
    const r = parseFloat(links[n].closest('.card')?.style.getPropertyValue('--r')) || 0;
    // Untransformierte Abmessungen: laufende Viewer-Animationen beeinflussen das Ziel nicht.
    return `translate(${a.left + a.width / 2 - innerWidth / 2}px, ${a.top + a.height / 2 - innerHeight / 2}px) `
      + `rotate(${r}deg) scale(${t.offsetWidth / img.offsetWidth}, ${t.offsetHeight / img.offsetHeight})`;
  };
  const clearDrag = () => {
    if (!drag) return;
    const id = drag.id; drag = null;
    if (img.hasPointerCapture(id)) img.releasePointerCapture(id);
  };
  const open = (n) => {
    if (dlg.open) return;
    interrupt(); clearDrag();
    opener = links[n]; i = desired = n; closing = false;
    load(n); dlg.showModal(); dlg.focus({ preventScroll: true });
    document.documentElement.classList.add('viewing'); sceneChanged();
    if (still.matches) return;
    const from = fromCard(n);
    animate(from ? [{ transform: from, opacity: 1 }, { transform: 'none', opacity: 1 }]
      : [{ transform: 'scale(.96)', opacity: 0 }, { transform: 'none', opacity: 1 }], OPEN);
  };
  const close = () => {
    if (!dlg.open || closing) return;
    const current = interrupt(); clearDrag();
    closing = true; loadRevision++; clearTimeout(preloadTimer);
    if (still.matches) { dlg.close(); return; }
    dlg.classList.add('closing');
    const to = fromCard(i);
    animate([current, { transform: to || 'scale(.96)', opacity: to ? 1 : 0 }],
      { duration: 280, easing: 'cubic-bezier(.4, 0, .2, 1)' }, () => dlg.close());
  };
  const go = (dir) => {
    if (!dlg.open || closing) return;
    const current = interrupt(); clearDrag();
    desired = wrap(desired + dir);
    const n = desired;
    if (still.matches) { i = n; load(n); return; }
    animate([current, { transform: `translateX(${-dir * 48}px)`, opacity: 0 }],
      { duration: 90, easing: 'cubic-bezier(.4, 0, 1, 1)' }, () => {
        i = n; load(n);
        animate([{ transform: `translateX(${dir * 60}px) rotate(${dir * 1.2}deg)`, opacity: 0 },
          { transform: 'none', opacity: 1 }], SLIDE);
      });
  };

  links.forEach((a, n) => a.addEventListener('click', (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault(); open(n);
  }));
  dlg.querySelector('.v-close').addEventListener('click', close);
  dlg.querySelector('.v-prev').addEventListener('click', () => go(-1));
  dlg.querySelector('.v-next').addEventListener('click', () => go(1));
  dlg.addEventListener('click', (e) => { if (e.target === dlg && !drag) close(); });
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
  });
  dlg.addEventListener('close', () => {
    interrupt(); clearDrag(); loadRevision++; clearTimeout(preloadTimer);
    closing = false; dlg.classList.remove('closing');
    document.documentElement.classList.remove('viewing'); sceneChanged();
    opener?.focus({ preventScroll: true }); opener = null;
  });

  const end = (cancelled = false) => {
    if (!drag) return;
    const d = drag, current = interrupt(); clearDrag();
    const speed = performance.now() - d.time < 90 ? d.speed : 0;
    const threshold = Math.max(40, Math.min(100, img.offsetWidth * .18));
    if (!cancelled && d.axis === 'x' && (Math.abs(d.dx) > threshold
      || (Math.abs(d.dx) > 18 && Math.abs(speed) > .45 && Math.sign(speed) === Math.sign(d.dx)))) {
      // go() uebernimmt die sichtbare Position der Wischgeste.
      img.style.transform = current.transform; img.style.opacity = current.opacity;
      go(d.dx < 0 ? 1 : -1);
    } else if (!still.matches && dlg.open && !closing) {
      animate([current, { transform: 'none', opacity: 1 }], BACK);
    }
  };
  img.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || !dlg.open || closing) return;
    if (!e.isPrimary) { end(true); return; }
    const frame = interrupt();
    desired = i;
    drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, dx: 0, lastX: e.clientX,
      time: performance.now(), speed: 0, axis: null, frame };
    img.style.transform = frame.transform; img.style.opacity = frame.opacity;
    img.setPointerCapture(e.pointerId);
  }, { passive: true });
  img.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const d = drag, dx = e.clientX - d.sx, dy = e.clientY - d.sy, now = performance.now();
    if (!d.axis && Math.max(Math.abs(dx), Math.abs(dy)) > 8) {
      if (Math.abs(dx) > Math.abs(dy) * 1.15) d.axis = 'x';
      else if (Math.abs(dy) > Math.abs(dx) * 1.15) d.axis = 'y';
    }
    d.speed = d.speed * .35 + (e.clientX - d.lastX) / Math.max(1, now - d.time) * .65;
    d.time = now; d.lastX = e.clientX; d.dx = dx;
    if (d.axis !== 'x' || still.matches) return;
    img.style.transform = `translateX(${dx}px) rotate(${dx / 100}deg) ${d.frame.transform === 'none' ? '' : d.frame.transform}`;
  }, { passive: true });
  img.addEventListener('pointerup', (e) => { if (drag?.id === e.pointerId) end(); }, { passive: true });
  img.addEventListener('pointercancel', (e) => { if (drag?.id === e.pointerId) end(true); }, { passive: true });
  img.addEventListener('lostpointercapture', (e) => { if (drag?.id === e.pointerId) end(true); });
  still.addEventListener?.('change', () => {
    if (!still.matches || !dlg.open) return;
    interrupt(); clearDrag();
    if (closing) dlg.close(); else { i = desired; load(i); }
  });
  img.draggable = false;
})();
