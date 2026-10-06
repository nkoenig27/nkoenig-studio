// nkoenig.studio V10 — ein Licht und eine Physik fuer alle Objekte.
// Jedes Objekt haengt an gedaempften Federn, Masse und Steifigkeit je Material: Kippen, Heben, Nachschwingen.
// Ohne Zutun wandert das Licht langsam. Beim Scrollen bleiben die Dinge mit Traegheit kurz zurueck,
// kippen im Fahrtwind und schwingen nach, Karten rutschen in ihren Huellen. Maus kippt und hebt,
// Druecken drueckt sie auf den Tisch.
// Handy/Tablet ("unter der Lampe"): Scrollen ist die Geste. Jedes Objekt kommt unten schraeg ins Bild, liegt auf Hoehe
// der Lampe flach im Licht (Blitz und Glanz laufen darueber) und kippt oben zur anderen Seite weg; Paare gespiegelt.
// Der Daumen gibt beim Antippen einen Stoss und drueckt das Objekt in den Tisch, solange er aufliegt.
// Lagesensor: Android sofort, iOS nach Freigabe (Antippen der Pack-Folie). Ruht alles, schlaeft die Schleife.
// Bei "Bewegung reduzieren": ein ruhig beleuchtetes Standbild statt Bewegung.
// Schreibt pro Objekt nur CSS-Variablen (und nur, wenn sie sich aendern); alles Sichtbare passiert in style.css.
(() => {
  const root = document.documentElement;
  const objs = [...document.querySelectorAll('[data-tilt]')];
  const depth = [...document.querySelectorAll('[data-depth]')].map((el) => ({ el, k: parseFloat(el.dataset.depth), y: null }));
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const focus = matchMedia('(min-width: 761px) and (pointer: fine)');   // Schaerfentiefe nur dort
  const touch = matchMedia('(hover: none) and (pointer: coarse)');      // Handy/Tablet: Scrollen und Lage sind die Gesten
  const clamp = (v, a = -1, b = 1) => Math.min(b, Math.max(a, v));

  // Stellschrauben fuer Touch-Geraete ("unter der Lampe")
  const P = {
    lamp: .42,     // Lampenlinie als Anteil der Bildhoehe: dort liegt ein Objekt flach im Licht
    ax: 7.5,       // Kippen vor/zurueck am Bildrand (Grad)
    ay: 4.5,       // Kippen seitlich am Bildrand, Paare gespiegelt -> Drehung ueber die Diagonale (Grad)
    wind: .003,    // Fahrtwind-Kippen je px/s
    visc: .004,    // zaeher Nachlauf je px/s (wie in Fluessigkeit), x Material.lag
    slide: .002,   // Karte rutscht in der Huelle je px/s, x Material.slide
    air: 5000,     // ab dieser Geschwindigkeit (px/s) hebt das Luftkissen voll an
    shad: 10,      // Schatten kriecht vom Bildzentrum weg (px am Bildrand, x Hoehe ueber dem Tisch)
    view: 1,       // Blickwinkel in dicke Halter: am Bildrand sieht man schraeg hinein
    kfx: 26, kfy: 50, kfr: 2,   // Blitz: Versatz je Spaltenlage, Lauf je Objekthoehe, Einfluss der Kippung
    poke: .7,      // Staerke des Stosses beim Antippen
  };

  // Material: w = Eigenfrequenz in rad/s (steifer = schneller), z = Daempfung (< 1 schwingt nach),
  // lag = wie stark es beim Anfahren/Bremsen des Scrollens zurueckbleibt, slide = Karte rutscht in der Huelle,
  // air = wie leicht es sich im Fahrtwind vom Tisch hebt, amp = wie weit es unter der Lampe kippt (Handy)
  const MAT = {
    booster: { w: 7.5, z: .36, lag: 1.1, slide: 0,  air: .5,  amp: .9 },    // aufgeblasene Folie: weich, wippt nach
    poster:  { w: 5.5, z: .6,  lag: .7,  slide: 0,  air: .2,  amp: 1 },     // laminiert, schwer
    one:     { w: 6,   z: .56, lag: .8,  slide: 0,  air: .15, amp: .8 },    // dicker Acrylblock, Karte sitzt fest
    top:     { w: 8,   z: .44, lag: 1,   slide: .6, air: .45, amp: .95 },   // Toploader: Karte hat etwas Spiel
    sleeve:  { w: 9.5, z: .34, lag: 1.2, slide: 1,  air: .9,  amp: 1.1 },   // Penny Sleeve: leicht, flattert, Karte rutscht
    loose:   { w: 10,  z: .3,  lag: 1.3, slide: 0,  air: 1,   amp: 1.15 },  // lose Karte
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
    m: matOf(el), press: false, c: {},
    alt: i % 2 ? 1 : -1,                   // Objekte ueber die volle Breite kippen abwechselnd zur einen oder anderen Seite
    jit: 1 + ((i * 37) % 21 - 10) / 100,   // jedes Objekt kippt etwas anders weit (+-10 %), damit es nicht nach Vorlage aussieht
  }));

  // gedaempfte Feder, semi-implizit integriert (bleibt auch bei ruckelnden Frames stabil); snap = sofort am Ziel
  let snap = false;
  const spring = (s, k, target, w, z, dt, force = 0) => {
    const v = 'v' + k;
    if (snap) { s[k] = target; s[v] = 0; return; }
    s[v] += (-w * w * (s[k] - target) - 2 * z * w * s[v] + force) * dt;
    s[k] += s[v] * dt;
  };
  // CSS-Variable nur schreiben, wenn sich der Wert wirklich aendert (spart Stil-Neuberechnung)
  const put = (el, c, k, v) => { if (c[k] !== v) { c[k] = v; el.style.setProperty(k, v); } };
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };

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

  const vis = new Set();
  const io = new IntersectionObserver((es) => {
    es.forEach((e) => (e.isIntersecting ? vis.add(e.target) : vis.delete(e.target)));
    wake();
  }, { rootMargin: '20% 0px' });
  objs.forEach((el) => io.observe(el));

  // ---------- Maus ----------
  let mx = 0, my = 0, mouse = false, hover = null, cx = 0, cy = 0;
  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    cx = e.clientX; cy = e.clientY;
    mouse = true; mx = cx / innerWidth * 2 - 1; my = cy / innerHeight * 2 - 1;
  }, { passive: true });
  document.addEventListener('pointerleave', () => { mouse = false; hover = null; });
  objs.forEach((el) => {
    el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') hover = el; });
    el.addEventListener('pointerleave', () => { if (hover === el) hover = null; });
    // Druecken: Objekt geht auf den Tisch, beim Loslassen federt es mit Ueberschwingen zurueck
    el.addEventListener('pointerdown', (e) => {
      if (e.button === 0 && e.pointerType !== 'touch') { state.get(el).press = true; cx = e.clientX; cy = e.clientY; }
    }, { passive: true });
  });
  const release = () => objs.forEach((el) => { state.get(el).press = false; });
  addEventListener('pointerup', release, { passive: true });
  addEventListener('pointercancel', release, { passive: true });
  addEventListener('blur', () => { release(); finger = null; });

  // ---------- Finger ----------
  // Touch-Ereignisse statt Pointer: iOS schickt beim Scrollbeginn pointercancel, touchmove kommt aber weiter.
  // Antippen: kleiner Stoss an der Fingerstelle, sofort sichtbar (Impuls statt Ziel). Liegt der Daumen auf,
  // drueckt er das Objekt in den Tisch, auch waehrend gescrollt wird. Antippen oeffnet Fotos wie bisher.
  let finger = null;
  document.addEventListener('touchstart', (e) => {
    const p = e.touches[0];
    finger = null;
    if (!p || e.touches.length > 1) return;
    cx = p.clientX; cy = p.clientY;
    const el = p.target.closest?.('[data-tilt]');
    if (el && !still.matches) {
      const s = state.get(el), r = el.getBoundingClientRect(), k = P.poke * s.m.amp;
      const ux = clamp((cx - r.left) / r.width * 2 - 1), uy = clamp((cy - r.top) / r.height * 2 - 1);
      s.vlift -= 9 * k; s.vrx += -uy * 110 * k; s.vry += ux * 130 * k;
      finger = el;
    }
    wake();
  }, { passive: true });
  document.addEventListener('touchmove', (e) => { const p = e.touches[0]; if (p) { cx = p.clientX; cy = p.clientY; } }, { passive: true });
  document.addEventListener('touchend', (e) => { if (!e.touches.length) finger = null; }, { passive: true });
  document.addEventListener('touchcancel', () => { finger = null; }, { passive: true });

  // ---------- Lagesensor ----------
  // Android liefert ihn ohne Rueckfrage. iOS erst nach DeviceOrientationEvent.requestPermission(), und das nur aus einer
  // Nutzergeste: gefragt wird ausschliesslich beim Antippen der Pack-Folie (nie beim Portrait-Link, nie von selbst).
  // Abgelehnt: 30 Tage Ruhe. Kommen schon Werte (frueher erlaubt), wird nicht gefragt.
  // Die Nulllage gleitet langsam mit, damit es im Stehen, Sitzen und Liegen gleich wirkt.
  const DOE = window.DeviceOrientationEvent;
  let gyro = false, ob = 0, og = 0, nb = null, ng = 0, gx = 0, gy = 0;
  document.querySelector('.booster')?.addEventListener('click', (e) => {
    if (gyro || typeof DOE?.requestPermission !== 'function' || e.target.closest('a')) return;
    if (Date.now() - (+store('nk-lage') || 0) < 2592e6) return;
    DOE.requestPermission().then((r) => { if (r !== 'granted') store('nk-lage', String(Date.now())); }, () => {});
  });
  addEventListener('deviceorientation', (e) => {
    if (e.beta == null || e.gamma == null) return;
    let b = e.beta, g = e.gamma;
    const a = screen.orientation?.angle ?? window.orientation ?? 0;   // quer gehalten: Achsen tauschen
    if (a === 90) [b, g] = [-g, b]; else if (a === -90 || a === 270) [b, g] = [g, -b]; else if (a === 180) { b = -b; g = -g; }
    if (nb == null) { nb = b; ng = g; }
    if (!still.matches && Math.abs(b - ob) + Math.abs(g - og) > .4) wake();
    ob = b; og = g; gyro = true;
  }, { passive: true });

  addEventListener('scroll', () => wake(), { passive: true });
  addEventListener('resize', () => wake(), { passive: true });

  // Licht und Scroll-Traegheit
  const L = { x: -.32, vx: 0, y: -.5, vy: 0 };
  let lastY = scrollY, vs = 0, acc = 0;
  let t0 = 0, tp = 0, fc = 0, calm = 0;
  // Bildhoehe fuer die Lampenlinie: springt nicht mit der ein-/ausfahrenden Adressleiste (iOS)
  let Hc = innerHeight, Wc = innerWidth;

  function frame(now) {
    if (!t0) t0 = tp = now;
    const dt = Math.min(.034, Math.max(.001, (now - tp) / 1000)); tp = now;
    const t = snap ? 0 : (now - t0) / 1000;
    const W = innerWidth, H = innerHeight;
    if (W !== Wc || Math.abs(H - Hc) > 160) { Wc = W; Hc = H; }
    const T = touch.matches;
    const lightNow = !T || snap || finger || !(++fc & 1);   // auf dem Handy Lichtwerte nur jedes zweite Bild

    // Scrollgeschwindigkeit (px/s, geglaettet) und ihre Aenderung = Beschleunigung, die alle Objekte spueren
    const y = scrollY;
    let raw = (y - lastY) / dt; lastY = y;
    if (Math.abs(raw) > 9000 || snap) raw = 0;   // Sprung (Anker, wiederhergestellte Position) ist kein Scrollen
    const vs0 = vs;
    vs = snap ? 0 : vs + (raw - vs) * (1 - Math.exp(-dt / .07));
    acc = snap ? 0 : clamp((vs - vs0) / dt, -40000, 40000);

    // Lage: Abweichung von der langsam mitgleitenden Nulllage
    if (gyro && !snap) {
      const kn = 1 - Math.exp(-dt / 2.5);
      nb += (ob - nb) * kn; ng += (og - ng) * kn;
      gx = clamp((og - ng) / 20); gy = clamp((ob - nb) / 20);
    }

    // globales Licht: oben links, wandert langsam; Maus/Lage ziehen es weich mit (Feder, kritisch gedaempft)
    const gl = gyro && !snap;
    const tlx = -.32 + Math.sin(t * .11) * .3 + (mouse ? mx * .45 : 0) + (gl ? gx * .5 : 0);
    const tly = -.5 + Math.cos(t * .083) * .18 + (mouse ? my * .3 : 0) + (gl ? gy * .35 : 0);
    spring(L, 'x', tlx, 3.2, 1, dt); spring(L, 'y', tly, 3.2, 1, dt);
    const lx = L.x, ly = L.y;

    let energy = Math.abs(vs) / 40 + Math.abs(L.vx) + Math.abs(L.vy);
    const reads = [];
    for (const el of (snap ? objs : vis)) reads.push([el, el.getBoundingClientRect()]);
    for (const [el, r] of reads) {
      const s = state.get(el), m = s.m, c = s.c;
      const ox = r.left + r.width / 2, oy = r.top + r.height / 2;
      const py = clamp(oy / H * 2 - 1, -1.4, 1.4);
      const px = clamp(ox / W * 2 - 1);
      const amp = s.flat ? (T ? .7 : .45) : 1;
      const breathe = snap || T ? 0 : 1;   // Atmen: am Desktop sichtbar, auf dem Handy (<= 1 px) nicht -> dort aus, damit die Schleife schlafen kann
      const lam = Hc * P.lamp;
      let trx, try_;
      if (T) {
        // Sammlergeste: Lage zur Lampenlinie (unten +1, Lampe 0, oben -1); in der Lichtzone fast flach, zum Rand hin staerker
        const u = clamp((oy - lam) / (oy > lam ? Hc - lam : lam), -1.1, 1.1);
        const cu = u * (.4 + .6 * Math.abs(u)) * m.amp * s.jit;
        const side = px < -.12 ? -1 : px > .12 ? 1 : s.alt;   // Spalte: links/rechts kippen gespiegelt
        trx = (-cu * P.ax + Math.sin(t * .37 + s.ph) * 1.1 * breathe + clamp(vs * P.wind, -7, 7)) * amp;
        try_ = (cu * P.ay * side + Math.sin(t * .29 + s.ph * 1.7) * 1.8 * breathe) * amp;
      } else {
        // Ruhelage: Tisch, an dem man vorbeigeht + leichtes Atmen + Fahrtwind beim Scrollen
        trx = (-py * 5 + Math.sin(t * .37 + s.ph) * 1.1 * breathe + clamp(vs * .0021, -5.5, 5.5)) * amp;
        try_ = (Math.sin(t * .29 + s.ph * 1.7) * 1.8 * breathe + px * 2.5) * amp;
      }
      let tl = 0, w = m.w, z = m.z;
      const pressed = s.press || finger === el;
      if ((hover === el && mouse) || pressed) {
        const ux = clamp((cx - r.left) / r.width * 2 - 1), uy = clamp((cy - r.top) / r.height * 2 - 1);
        const k = finger === el ? .7 : 1;
        trx = -uy * 9 * amp * k; try_ = ux * 11 * amp * k; tl = 1;
        w *= 1.35;   // unter der Hand folgt es schneller
      } else if (gyro && !snap) {
        trx += -gy * 6 * amp; try_ += gx * 7 * amp;
      }
      if (snap) { trx = 0; try_ = 0; }   // Standbild: flach, nur das Licht steht passend zur Lage im Bild
      if (pressed) tl = -.55;
      // Luftkissen: schnelles Wischen hebt leichte Dinge etwas vom Tisch, beim Ausrollen legen sie sich wieder ab
      else if (T && !hover) tl = Math.min(1, Math.abs(vs) / P.air) * .55 * m.air;
      spring(s, 'rx', trx, w, z, dt);
      spring(s, 'ry', try_, w, z, dt);
      spring(s, 'lift', tl, w * 1.15, z, dt);
      // Traegheit: beim Anfahren bleibt es zurueck, beim Bremsen schiesst es kurz weiter;
      // auf dem Handy zusaetzlich zaeh wie in Fluessigkeit: Nachlauf proportional zur Geschwindigkeit
      spring(s, 'ty', T ? clamp(vs * P.visc * m.lag, -16, 16) : 0, w * .8, z, dt, acc * .03 * m.lag);
      s.ty = clamp(s.ty, -26, 26);
      if (m.slide) {
        // Karte rutscht in der Huelle: beim Scrollen und (Handy) wenn man es neigt
        const ti = T ? clamp(vs * P.slide * m.slide + (gl ? gy * 3 * m.slide : 0), -7, 7) : 0;
        spring(s, 'iy', ti, w * .55, .28, dt, acc * .012 * m.slide);
        s.iy = clamp(s.iy, T ? -8 : -4, T ? 8 : 4);
      }
      energy += Math.abs(s.vrx) + Math.abs(s.vry) + Math.abs(s.vty) + Math.abs(s.viy) + Math.abs(s.vlift) * 10;

      // Licht relativ zur gekippten Flaeche
      const rlx = clamp(lx + s.ry / 16), rly = clamp(ly - s.rx / 16);
      // Blickwinkel der Kamera auf dicke Halter (Handy): am Bildrand sieht man schraeg hinein, die Karte darin wandert
      const vx = T ? (ox - W / 2) / (Hc * .6) * P.view : 0, vy = T ? (oy - lam) / (Hc * .6) * P.view : 0;
      put(el, c, '--rx', s.rx.toFixed(2) + 'deg');
      put(el, c, '--ry', s.ry.toFixed(2) + 'deg');
      put(el, c, '--nrx', clamp(s.rx / 10 - vy * 1.6, -2.2, 2.2).toFixed(3));
      put(el, c, '--nry', clamp(s.ry / 10 + vx * 1.6, -2.2, 2.2).toFixed(3));
      put(el, c, '--tm', Math.min(1, Math.hypot(s.rx, s.ry) / 10).toFixed(3));
      put(el, c, '--lift', s.lift.toFixed(3));
      put(el, c, '--ty', s.ty.toFixed(1) + 'px');
      if (m.slide) put(el, c, '--iy', s.iy.toFixed(2) + 'px');
      // Schatten: globales Licht + (Handy) Blitz an der Kamera wirft ihn vom Bildzentrum weg -> unter das Objekt in der Lichtzone
      put(el, c, '--sx', (-rlx * 14 - s.ry * .9 + vx * P.shad).toFixed(1) + 'px');
      put(el, c, '--sy', (-rly * 16 + s.rx * .9 + vy * P.shad * 1.4).toFixed(1) + 'px');
      // Blitz auf der Kamera: der Glanzpunkt sitzt dort, wo die Flaeche zur Bildmitte zeigt -> wandert beim Scrollen ueber das Objekt
      const fx = 50 + clamp((W / 2 - ox) / r.width * (T ? P.kfx : 70) - s.ry * 5, -90, 90);
      const fy = 50 + clamp((H * .42 - oy) / r.height * (T ? P.kfy : 70) + s.rx * (T ? P.kfr : 5), -90, 90);
      put(el, c, '--fx', fx.toFixed(1) + '%');
      put(el, c, '--fy', fy.toFixed(1) + '%');
      // Hof um den Glanzpunkt (Bloom): nur, solange der Punkt auf dem Objekt liegt
      const bfy = s.booster ? fy - 23 : fy;
      const ex = Math.max(0, Math.abs(fx - 50) - 44), ey = Math.max(0, Math.abs(bfy - 50) - 44);
      let bloom = Math.max(0, 1 - Math.hypot(ex, ey) / 10);
      if (s.booster && fx > 7.5 && fx < 92.5 && bfy > 10.8 && bfy < 66.8) bloom *= .2;   // aufs Portrait kein harter Blitz
      put(el, c, '--bloom', bloom.toFixed(2));
      if (lightNow) {
        put(el, c, '--gx', (50 + rlx * 48).toFixed(1) + '%');
        put(el, c, '--gy', (50 + rly * 48).toFixed(1) + '%');
        put(el, c, '--hx', (50 + s.ry * 4.2 + rlx * 22).toFixed(1) + '%');
        put(el, c, '--pa', (s.ry * 2.4 - s.rx * 1.6 + rlx * 14).toFixed(1) + 'deg');
        put(el, c, '--hy', (50 - s.rx * 4.2 + rly * 22).toFixed(1) + '%');
        put(el, c, '--sl', Math.max(0, -rlx).toFixed(3));
        put(el, c, '--sr', Math.max(0, rlx).toFixed(3));
        put(el, c, '--st', Math.max(0, -rly).toFixed(3));
        put(el, c, '--sb', Math.max(0, rly).toFixed(3));
      }
      // Schaerfentiefe: Fokusebene in Bildschirmmitte, zum Rand hin leicht unscharf (in 0.5-px-Stufen)
      const dof = snap ? 0 : Math.round(Math.max(0, Math.abs(py) - .62) * 4.6) / 2;
      if (focus.matches && dof !== s.dof) { s.dof = dof; el.style.filter = dof ? `blur(${dof}px)` : ''; }
    }
    if (snap) return;

    // Tiefenebenen folgen dem Scrollen weich nach (schwimmen leicht hinterher)
    const ky = 1 - Math.exp(-dt * 7);
    for (const d of depth) {
      const target = y * d.k;
      d.y = d.y == null ? target : d.y + (target - d.y) * ky;
      energy += Math.abs(target - d.y) / 4;
      const v = d.y.toFixed(1);
      if (v !== d.v) { d.v = v; d.el.style.transform = `translate3d(0, ${v}px, 0)`; }
    }

    // Handy: ruht alles (kein Scrollen, kein Finger, Federn ausgeschwungen), schlaeft die Schleife bis zur naechsten Beruehrung
    calm = T && !finger && energy < .4 ? calm + dt : 0;
    raf = calm > 1.2 ? 0 : requestAnimationFrame(frame);
  }

  let raf = 0, settleT = 0;
  // Standbild bei "Bewegung reduzieren": alles einmal in Ruhelage ausleuchten, nach dem Scrollen neu
  const settle = () => { snap = true; frame(performance.now()); snap = false; };
  function wake() {
    if (still.matches) { clearTimeout(settleT); settleT = setTimeout(settle, 150); return; }
    calm = 0;
    if (!raf) { lastY = scrollY; raf = requestAnimationFrame((n) => { tp = n - 16; frame(n); }); }
  }
  const start = () => {
    cancelAnimationFrame(raf); raf = 0;
    if (!still.matches) { root.classList.add('lit'); t0 = 0; wake(); }
    else { root.classList.remove('lit'); settle(); }
  };
  still.addEventListener?.('change', start);
  start();
})();
