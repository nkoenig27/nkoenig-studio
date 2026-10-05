// nkoenig.studio V6 — ein Licht fuer alle Objekte.
// Ohne Zutun: das Licht wandert langsam, und beim Scrollen kippen Pack/Karten leicht (wie ein Tisch,
// an dem man vorbeigeht). Maus (Desktop) bzw. Lagesensor (Android) kippen zusaetzlich.
// Schreibt pro Objekt nur CSS-Variablen; alles Sichtbare passiert in style.css.
(() => {
  const root = document.documentElement;
  const objs = [...document.querySelectorAll('[data-tilt]')];
  const depth = [...document.querySelectorAll('[data-depth]')].map((el) => ({ el, k: parseFloat(el.dataset.depth) }));
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const focus = matchMedia('(min-width: 761px) and (pointer: fine)');   // Schaerfentiefe nur dort
  const clamp = (v, a = -1, b = 1) => Math.min(b, Math.max(a, v));

  const state = new Map();
  objs.forEach((el, i) => state.set(el, { rx: 0, ry: 0, lift: 0, ph: i * 1.7 + .4, flat: el.hasAttribute('data-flat') }));

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

  const vis = new Set();
  const io = new IntersectionObserver((es) => es.forEach((e) => (e.isIntersecting ? vis.add(e.target) : vis.delete(e.target))), { rootMargin: '20% 0px' });
  objs.forEach((el) => io.observe(el));

  let mx = 0, my = 0, mouse = false, hover = null, cx = 0, cy = 0;
  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    mouse = true; cx = e.clientX; cy = e.clientY;
    mx = cx / innerWidth * 2 - 1; my = cy / innerHeight * 2 - 1;
  }, { passive: true });
  document.addEventListener('pointerleave', () => { mouse = false; hover = null; });
  objs.forEach((el) => {
    el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') hover = el; });
    el.addEventListener('pointerleave', () => { if (hover === el) hover = null; });
  });

  let gx = 0, gy = 0, gyro = false;
  addEventListener('deviceorientation', (e) => {
    if (e.beta == null || e.gamma == null) return;
    gyro = true; gx = clamp(e.gamma / 28); gy = clamp((e.beta - 45) / 28);
  }, { passive: true });

  const t0 = performance.now();
  function frame(now) {
    const t = (now - t0) / 1000;
    const W = innerWidth, H = innerHeight;
    // globales Licht: oben links, wandert langsam; Maus/Lage ziehen es mit
    const lx = -.32 + Math.sin(t * .11) * .3 + (mouse ? mx * .45 : 0) + (gyro ? gx * .5 : 0);
    const ly = -.5 + Math.cos(t * .083) * .18 + (mouse ? my * .3 : 0) + (gyro ? gy * .35 : 0);

    const reads = [];
    for (const el of vis) reads.push([el, el.getBoundingClientRect()]);
    for (const [el, r] of reads) {
      const s = state.get(el);
      const py = clamp((r.top + r.height / 2) / H * 2 - 1, -1.4, 1.4);
      const px = clamp((r.left + r.width / 2) / W * 2 - 1);
      const amp = s.flat ? .45 : 1;
      let trx = (-py * 5 + Math.sin(t * .37 + s.ph) * 1.1) * amp;
      let try_ = (Math.sin(t * .29 + s.ph * 1.7) * 1.8 + px * 2.5) * amp;
      let tl = 0;
      if (hover === el && mouse) {
        const ux = clamp((cx - r.left) / r.width * 2 - 1), uy = clamp((cy - r.top) / r.height * 2 - 1);
        trx = -uy * 9 * amp; try_ = ux * 11 * amp; tl = 1;
      } else if (gyro) {
        trx += -gy * 6 * amp; try_ += gx * 7 * amp;
      }
      const k = hover === el ? .14 : .06;
      s.rx += (trx - s.rx) * k; s.ry += (try_ - s.ry) * k; s.lift += (tl - s.lift) * .1;

      // Licht relativ zur gekippten Flaeche
      const rlx = clamp(lx + s.ry / 16), rly = clamp(ly - s.rx / 16);
      const st = el.style;
      st.setProperty('--rx', s.rx.toFixed(2) + 'deg');
      st.setProperty('--ry', s.ry.toFixed(2) + 'deg');
      st.setProperty('--lift', s.lift.toFixed(3));
      st.setProperty('--gx', (50 + rlx * 48).toFixed(1) + '%');
      st.setProperty('--gy', (50 + rly * 48).toFixed(1) + '%');
      st.setProperty('--sx', (-rlx * 14 - s.ry * .9).toFixed(1) + 'px');
      st.setProperty('--sy', (-rly * 16 + s.rx * .9).toFixed(1) + 'px');
      // Blitz auf der Kamera: der Glanzpunkt sitzt dort, wo die Flaeche zur Bildmitte zeigt -> wandert beim Scrollen ueber das Objekt
      const ox = r.left + r.width / 2, oy = r.top + r.height / 2;
      st.setProperty('--fx', (50 + clamp((W / 2 - ox) / r.width * 70 - s.ry * 5, -90, 90)).toFixed(1) + '%');
      st.setProperty('--fy', (50 + clamp((H * .42 - oy) / r.height * 70 + s.rx * 5, -90, 90)).toFixed(1) + '%');
      st.setProperty('--hx', (50 + s.ry * 4.2 + rlx * 22).toFixed(1) + '%');
      st.setProperty('--pa', (s.ry * 2.4 - s.rx * 1.6 + rlx * 14).toFixed(1) + 'deg');
      st.setProperty('--hy', (50 - s.rx * 4.2 + rly * 22).toFixed(1) + '%');
      st.setProperty('--sl', Math.max(0, -rlx).toFixed(3));
      st.setProperty('--sr', Math.max(0, rlx).toFixed(3));
      st.setProperty('--st', Math.max(0, -rly).toFixed(3));
      st.setProperty('--sb', Math.max(0, rly).toFixed(3));
      // Schaerfentiefe: Fokusebene in Bildschirmmitte, zum Rand hin leicht unscharf (in 0.5-px-Stufen)
      const dof = Math.round(Math.max(0, Math.abs(py) - .62) * 4.6) / 2;
      if (focus.matches && dof !== s.dof) { s.dof = dof; st.filter = dof ? `blur(${dof}px)` : ''; }
    }

    const y = scrollY;
    for (const d of depth) d.el.style.transform = `translate3d(0, ${(y * d.k).toFixed(1)}px, 0)`;
    raf = requestAnimationFrame(frame);
  }

  let raf = 0;
  const start = () => { cancelAnimationFrame(raf); if (!still.matches) { root.classList.add('lit'); raf = requestAnimationFrame(frame); } else root.classList.remove('lit'); };
  still.addEventListener?.('change', start);
  start();
})();
