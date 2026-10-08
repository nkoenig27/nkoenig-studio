// nkoenig.studio V9 — ein Licht und eine Physik fuer alle Objekte.
// Jedes Objekt haengt an gedaempften Federn, Masse und Steifigkeit je Material: Kippen, Heben, Nachschwingen.
// Ohne Zutun wandert das Licht langsam (30 Updates/s); Eingaben folgen der Displayfrequenz.
// Beim Scrollen bleiben die Dinge mit Traegheit kurz zurueck,
// kippen im Fahrtwind und schwingen nach, Karten rutschen in ihren Huellen. Maus kippt und hebt,
// Druecken (Maus oder Finger) drueckt sie auf den Tisch. Lagesensor (Android) kippt zusaetzlich.
// Schreibt pro Objekt nur CSS-Variablen (und nur, wenn sie sich aendern); alles Sichtbare passiert in style.css.
(() => {
  const root = document.documentElement;
  const objs = [...document.querySelectorAll('[data-tilt]')];
  const depth = [...document.querySelectorAll('[data-depth]')].map((el) => ({ el, k: parseFloat(el.dataset.depth), y: null }));
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const focus = matchMedia('(min-width: 761px) and (pointer: fine)');   // Schaerfentiefe nur dort
  const clamp = (v, a = -1, b = 1) => Math.min(b, Math.max(a, v));

  // Material: w = Eigenfrequenz in rad/s (steifer = schneller), z = Daempfung (< 1 schwingt nach),
  // lag = wie stark es beim Anfahren/Bremsen des Scrollens zurueckbleibt, slide = Karte rutscht in der Huelle
  const MAT = {
    booster: { w: 11, z: .72, lag: .9, slide: 0 },
    poster:  { w: 8, z: .85, lag: .5, slide: 0 },
    one:     { w: 9, z: .82, lag: .6, slide: 0 },
    top:     { w: 12, z: .76, lag: .8, slide: .5 },
    sleeve:  { w: 13, z: .72, lag: 1, slide: .8 },
    loose:   { w: 13, z: .7, lag: 1, slide: 0 },
  };
  const matOf = (el) => {
    const c = el.classList;
    return c.contains('booster') ? MAT.booster : c.contains('poster') ? MAT.poster : c.contains('one') ? MAT.one
      : c.contains('top') ? MAT.top : c.contains('sleeve') ? MAT.sleeve : MAT.loose;
  };

  const state = new Map();
  objs.forEach((el, i) => state.set(el, {
    rx: 0, vrx: 0, ry: 0, vry: 0, lift: 0, vlift: 0, ty: 0, vty: 0, iy: 0, viy: 0,
    ph: i * 1.7 + .4, flat: el.hasAttribute('data-flat'), booster: el.classList.contains('booster'),
    m: matOf(el), press: false, fan: el.classList.contains('fan'), rect: null, c: {},
  }));

  // Kleine Integrationsschritte: dieselbe Daempfung auch nach einem langsamen Frame.
  const spring = (s, k, target, w, z, dt, force = 0) => {
    const v = 'v' + k;
    const steps = Math.ceil(dt * 120), h = dt / steps;
    for (let n = 0; n < steps; n++) {
      s[v] += (-w * w * (s[k] - target) - 2 * z * w * s[v] + force) * h;
      s[k] += s[v] * h;
    }
  };
  // CSS-Variable nur schreiben, wenn sich der Wert wirklich aendert (spart Stil-Neuberechnung)
  const put = (el, c, k, v) => { if (c[k] !== v) { c[k] = v; el.style.setProperty(k, v); } };

  // jede Huelle ein Einzelstueck: Kratzerbild, Glanzwinkel, Sitz, Knick (fester Zufall, bei jedem Besuch gleich)
  let seed = 27;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  document.querySelectorAll('.card').forEach((el) => {
    const st = el.style;
    st.setProperty('--so', `${(rnd() * 600) | 0}px ${(rnd() * 600) | 0}px`);
    st.setProperty('--sa', (102 + rnd() * 26).toFixed(1) + 'deg');
    st.setProperty('--ck', ((rnd() - .5) * 1.6).toFixed(2) + 'deg');
    st.setProperty('--cdx', ((rnd() - .5) * 1.4).toFixed(2) + 'cqw');
    st.setProperty('--cdy', ((rnd() - .5) * 1.2).toFixed(2) + 'cqw');
    st.setProperty('--ws', (115 + rnd() * 45).toFixed(0) + '%');
    st.setProperty('--wp', `${(rnd() * 100) | 0}% ${(rnd() * 100) | 0}%`);
    st.setProperty('--fa', (rnd() > .5 ? 8 + rnd() * 20 : 160 + rnd() * 20).toFixed(0) + 'deg');
    st.setProperty('--fp', (25 + rnd() * 50).toFixed(1) + '%');
  });

  // Druckraster erst zeigen, wenn das Foto da ist (sonst laege das Punktmuster kurz auf leerem Karton)
  document.querySelectorAll('.zoom img, .pic img').forEach((im) => {
    const done = () => im.parentElement.classList.add('inked');
    if (im.complete && im.naturalWidth) done(); else im.addEventListener('load', done, { once: true });
  });

  // Acrylbloecke werfen Kaustik: die klaren Raender lassen Licht durch, die Fase buendelt es an der fernen Ecke
  document.querySelectorAll('.card.one').forEach((el) => {
    const k = document.createElement('i'); k.className = 'caustic'; k.setAttribute('aria-hidden', 'true');
    el.insertBefore(k, el.querySelector('.tilt'));
  });

  let layoutDirty = true;
  const invalidate = () => { layoutDirty = true; };
  const ro = new ResizeObserver(invalidate);
  objs.forEach((el) => ro.observe(el));
  ro.observe(document.body);
  addEventListener('resize', invalidate, { passive: true });
  document.fonts?.ready.then(invalidate);
  const vis = new Set(), visibleDepth = new Set();
  const io = new IntersectionObserver((es) => {
    for (const e of es) {
      const s = state.get(e.target), set = s ? vis : visibleDepth;
      if (e.isIntersecting) {
        set.add(e.target);
        if (s) s.rect = null;
        else {
          const d = depth.find((item) => item.el === e.target);
          d.y = scrollY * d.k;
        }
      } else {
        set.delete(e.target);
        if (s) { s.press = false; if (hover === e.target) hover = null; }
      }
      e.target.classList.toggle('motion-visible', e.isIntersecting);
    }
    start();
  }, { rootMargin: '15% 0px' });
  objs.forEach((el) => io.observe(el));
  depth.forEach((d) => io.observe(d.el));

  let mx = 0, my = 0, mouse = false, hover = null, cx = 0, cy = 0, touchStart = null;
  let activeUntil = 0;
  const interact = () => { activeUntil = performance.now() + 700; };
  addEventListener('scroll', interact, { passive: true });
  addEventListener('pointermove', (e) => {
    cx = e.clientX; cy = e.clientY;
    if (touchStart && Math.hypot(cx - touchStart.x, cy - touchStart.y) > 8) release();
    if (e.pointerType !== 'mouse') return;
    mouse = true; mx = cx / innerWidth * 2 - 1; my = cy / innerHeight * 2 - 1;
    hover = e.target.closest?.('[data-tilt]') || null;
    interact();
  }, { passive: true });
  document.addEventListener('pointerleave', () => { mouse = false; hover = null; interact(); });
  objs.forEach((el) => {
    el.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse') { hover = el; mouse = true; cx = e.clientX; cy = e.clientY; interact(); }
    });
    el.addEventListener('pointerleave', () => { if (hover === el) { hover = null; interact(); } });
    // Druecken: Objekt geht auf den Tisch, beim Loslassen federt es mit Ueberschwingen zurueck
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !e.isPrimary) return;
      state.get(el).press = true; cx = e.clientX; cy = e.clientY;
      if (e.pointerType === 'touch') touchStart = { x: cx, y: cy };
      interact();
    }, { passive: true });
  });
  const release = () => { touchStart = null; objs.forEach((el) => { state.get(el).press = false; }); interact(); };
  addEventListener('pointerup', release, { passive: true });
  addEventListener('pointercancel', release, { passive: true });
  addEventListener('blur', release);

  let gx = 0, gy = 0, gyro = false;
  addEventListener('deviceorientation', (e) => {
    if (e.beta == null || e.gamma == null) return;
    gyro = true; gx = clamp(e.gamma / 28); gy = clamp((e.beta - 45) / 28);
    interact();
  }, { passive: true });

  // Licht und Scroll-Traegheit
  const L = { x: -.32, vx: 0, y: -.5, vy: 0 };
  let lastY = scrollY, vs = 0, acc = 0;
  let sceneTime = 0, tp = null, raf = 0;

  function frame(now) {
    raf = 0;
    // Eingaben folgen der Displayfrequenz; langsames Ruhelicht benoetigt nur 30 Updates/s.
    if (tp != null && now > activeUntil && now - tp < 1000 / 30 - 1) {
      raf = requestAnimationFrame(frame); return;
    }
    const dt = tp == null ? 1 / 60 : Math.min(.08, Math.max(.001, (now - tp) / 1000)); tp = now;
    sceneTime += dt;
    const t = sceneTime;
    const W = innerWidth, H = innerHeight;

    // Scrollgeschwindigkeit (px/s, geglaettet) und ihre Aenderung = Beschleunigung, die alle Objekte spueren
    const y = scrollY;
    let raw = (y - lastY) / dt; lastY = y;
    if (Math.abs(raw) > 9000) raw = 0;   // Sprung (Anker, wiederhergestellte Position) ist kein Scrollen
    const vs0 = vs;
    vs += (raw - vs) * (1 - Math.exp(-dt / .07));
    acc = clamp((vs - vs0) / dt, -40000, 40000);

    // globales Licht: oben links, wandert langsam; Maus/Lage ziehen es weich mit (Feder, kritisch gedaempft)
    const tlx = -.32 + Math.sin(t * .11) * .16 + (mouse ? mx * .45 : 0) + (gyro ? gx * .5 : 0);
    const tly = -.5 + Math.cos(t * .083) * .09 + (mouse ? my * .3 : 0) + (gyro ? gy * .35 : 0);
    const lightSpeed = mouse || gyro ? 9 : 4;
    spring(L, 'x', tlx, lightSpeed, 1, dt); spring(L, 'y', tly, lightSpeed, 1, dt);
    const lx = L.x, ly = L.y;

    const reads = [];
    // Aussenkonturen bleiben beim Kippen stabil. Layout nur nach Groessenaenderungen lesen.
    for (const el of vis) {
      const s = state.get(el);
      if (layoutDirty || !s.rect) {
        const r = el.getBoundingClientRect();
        s.rect = { left: r.left, top: r.top + y, width: r.width, height: r.height };
      }
      reads.push([el, { ...s.rect, top: s.rect.top - y }]);
    }
    layoutDirty = false;
    for (const [el, r] of reads) {
      const s = state.get(el), m = s.m, c = s.c;
      const py = clamp((r.top + r.height / 2) / H * 2 - 1, -1.4, 1.4);
      const px = clamp((r.left + r.width / 2) / W * 2 - 1);
      const amp = (s.flat ? .45 : s.fan ? .55 : 1) * (focus.matches ? 1 : .7);
      // Ruhelage: Tisch, an dem man vorbeigeht + leichtes Atmen + Fahrtwind beim Scrollen
      let trx = (-py * 3 + Math.sin(t * .37 + s.ph) * .22 + clamp(vs * .0013, -3, 3)) * amp;
      let try_ = (Math.sin(t * .29 + s.ph * 1.7) * .35 + px * 1.5) * amp;
      let tl = 0, w = m.w, z = m.z;
      const pointed = (hover === el && mouse) || s.press;
      if (pointed) {
        const ux = clamp((cx - r.left) / r.width * 2 - 1), uy = clamp((cy - r.top) / r.height * 2 - 1);
        trx = -uy * 7 * amp; try_ = ux * 9 * amp; tl = .75;
        w = Math.max(18, w * 1.65); z = .86;
      } else if (gyro) {
        trx += -gy * 6 * amp; try_ += gx * 7 * amp;
      }
      if (s.press) tl = -.3;
      spring(s, 'rx', trx, w, z, dt);
      spring(s, 'ry', try_, w, z, dt);
      spring(s, 'lift', tl, w * 1.15, z, dt);
      // Traegheit: beim Anfahren bleibt es zurueck, beim Bremsen schiesst es kurz weiter
      spring(s, 'ty', 0, m.w, m.z, dt, acc * .012 * m.lag);
      s.ty = clamp(s.ty, -14, 14);
      if (m.slide) { spring(s, 'iy', 0, m.w * .7, .65, dt, acc * .005 * m.slide); s.iy = clamp(s.iy, -2, 2); }

      // Licht relativ zur gekippten Flaeche
      const rlx = clamp(lx + s.ry / 16), rly = clamp(ly - s.rx / 16);
      put(el, c, '--rx', s.rx.toFixed(2) + 'deg');
      put(el, c, '--ry', s.ry.toFixed(2) + 'deg');
      put(el, c, '--nrx', clamp(s.rx / 10, -1.5, 1.5).toFixed(3));
      put(el, c, '--nry', clamp(s.ry / 10, -1.5, 1.5).toFixed(3));
      put(el, c, '--tm', Math.min(1, Math.hypot(s.rx, s.ry) / 10).toFixed(3));
      put(el, c, '--lift', s.lift.toFixed(3));
      put(el, c, '--ty', s.ty.toFixed(1) + 'px');
      if (m.slide) put(el, c, '--iy', s.iy.toFixed(2) + 'px');
      put(el, c, '--gx', (50 + rlx * 48).toFixed(1) + '%');
      put(el, c, '--gy', (50 + rly * 48).toFixed(1) + '%');
      put(el, c, '--sx', (-rlx * 14 - s.ry * .9).toFixed(1) + 'px');
      put(el, c, '--sy', (-rly * 16 + s.rx * .9).toFixed(1) + 'px');
      // Blitz auf der Kamera: der Glanzpunkt sitzt dort, wo die Flaeche zur Bildmitte zeigt -> wandert beim Scrollen ueber das Objekt
      const ox = r.left + r.width / 2, oy = r.top + r.height / 2;
      const fx = 50 + clamp((W / 2 - ox) / r.width * 70 - s.ry * 5, -90, 90);
      const fy = 50 + clamp((H * .42 - oy) / r.height * 70 + s.rx * 5, -90, 90);
      put(el, c, '--fx', fx.toFixed(1) + '%');
      put(el, c, '--fy', fy.toFixed(1) + '%');
      // Hof um den Glanzpunkt (Bloom): nur, solange der Punkt auf dem Objekt liegt
      const bfy = s.booster ? fy - 23 : fy;
      const ex = Math.max(0, Math.abs(fx - 50) - 44), ey = Math.max(0, Math.abs(bfy - 50) - 44);
      let bloom = Math.max(0, 1 - Math.hypot(ex, ey) / 10);
      if (s.booster && fx > 7.5 && fx < 92.5 && bfy > 10.8 && bfy < 66.8) bloom *= .2;   // aufs Portrait kein harter Blitz
      put(el, c, '--bloom', bloom.toFixed(2));
      put(el, c, '--hx', (50 + s.ry * 4.2 + rlx * 22).toFixed(1) + '%');
      put(el, c, '--pa', (s.ry * 2.4 - s.rx * 1.6 + rlx * 14).toFixed(1) + 'deg');
      put(el, c, '--hy', (50 - s.rx * 4.2 + rly * 22).toFixed(1) + '%');
      put(el, c, '--sl', Math.max(0, -rlx).toFixed(3));
      put(el, c, '--sr', Math.max(0, rlx).toFixed(3));
      put(el, c, '--st', Math.max(0, -rly).toFixed(3));
      put(el, c, '--sb', Math.max(0, rly).toFixed(3));
      // Beim Betrachten immer scharf; nur schnelle Scrollbewegung bekommt leichte Bewegungsunschaerfe.
      const dof = focus.matches && !pointed && !s.booster && !s.flat && !s.fan
        ? Math.round(clamp((Math.abs(vs) - 500) / 2500, 0, 1) * 4) / 4 : 0;
      if (dof !== s.dof) { s.dof = dof; el.style.filter = dof ? `blur(${dof}px)` : ''; }
    }

    // Tiefenebenen folgen dem Scrollen weich nach (schwimmen leicht hinterher)
    const ky = 1 - Math.exp(-dt * 7);
    for (const d of depth) {
      if (!visibleDepth.has(d.el)) continue;
      const target = y * d.k;
      d.y = d.y == null ? target : d.y + (target - d.y) * ky;
      const v = d.y.toFixed(1);
      if (v !== d.v) { d.v = v; d.el.style.transform = `translate3d(0, ${v}px, 0)`; }
    }
    raf = requestAnimationFrame(frame);
  }

  const start = () => {
    const enabled = !still.matches;
    const running = enabled && !document.hidden && !root.classList.contains('viewing') && (vis.size || visibleDepth.size);
    root.classList.toggle('lit', enabled);
    root.classList.toggle('scene-paused', !running);
    if (!running) {
      cancelAnimationFrame(raf); raf = 0; tp = null;
      release(); mouse = false; hover = null;
      for (const [el, s] of state) {
        s.vrx = s.vry = s.vlift = s.vty = s.viy = 0;
        if (!enabled) {
          s.rx = s.ry = s.lift = s.ty = s.iy = 0;
          for (const k of Object.keys(s.c)) el.style.removeProperty(k);
          s.c = {}; el.style.filter = ''; s.dof = 0;
        }
      }
      if (!enabled) for (const d of depth) {
        d.y = null; d.v = null; d.el.style.transform = '';
      }
    } else if (!raf) {
      tp = null; lastY = scrollY; vs = acc = 0; layoutDirty = true;
      raf = requestAnimationFrame(frame);
    }
  };
  const resetInput = () => { mouse = false; hover = null; release(); };
  addEventListener('blur', resetInput);
  addEventListener('resize', resetInput, { passive: true });
  document.addEventListener('visibilitychange', start);
  document.addEventListener('scenechange', start);
  focus.addEventListener?.('change', () => { invalidate(); interact(); });
  still.addEventListener?.('change', start);
  start();
})();
