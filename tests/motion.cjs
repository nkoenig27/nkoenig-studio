// Regression checks for interrupted navigation, gestures and animation scheduling.
// Run: node tests/motion.cjs (no browser or dependencies required).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const rootPath = path.resolve(__dirname, '..');
class Target {
  constructor(classes = []) {
    this.events = new Map(); this.classes = new Set(classes); this.attrs = {};
    this.values = {}; this.writes = 0; this.reads = 0; this.animations = []; this.capture = null;
    this.classList = { contains: k => this.classes.has(k), add: k => this.classes.add(k),
      remove: k => this.classes.delete(k), toggle: (k, on) => on ? this.classes.add(k) : this.classes.delete(k) };
    this.style = { setProperty: (k, v) => { this.values[k] = v; this.writes++; },
      getPropertyValue: k => this.values[k] || '', removeProperty: k => delete this.values[k] };
    this.offsetWidth = 300; this.offsetHeight = 450;
    this.rect = { left: 100, top: 200, width: 300, height: 450 };
  }
  addEventListener(k, fn) { if (!this.events.has(k)) this.events.set(k, []); this.events.get(k).push(fn); }
  emit(k, extra = {}) { const e = { target: this, preventDefault() {}, ...extra }; for (const fn of this.events.get(k) || []) fn(e); }
  dispatchEvent(e) { this.emit(e.type); }
  hasAttribute(k) { return k in this.attrs; }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k] || null; }
  getBoundingClientRect() { this.reads++; const r = this.rect; return { ...r, top: r.top - (this.runtime?.scrollY || 0), bottom: r.top + r.height - (this.runtime?.scrollY || 0) }; }
  focus() { this.focused = true; }
  hasPointerCapture(id) { return this.capture === id; }
  setPointerCapture(id) { this.capture = id; }
  releasePointerCapture(id) { this.capture = null; this.emit('lostpointercapture', { pointerId: id }); }
  getAnimations() { return this.animations.filter(a => a.pending); }
  animate(frames, options) {
    let resolve, reject;
    const a = { frames, options, pending: true, finished: new Promise((a, b) => { resolve = a; reject = b; }) };
    a.finish = () => { if (a.pending) { a.pending = false; resolve(); } };
    a.cancel = () => { if (a.pending) { a.pending = false; reject(new Error('cancelled')); } };
    this.animations.push(a); return a;
  }
}
const flush = async () => { for (let n = 0; n < 8; n++) await Promise.resolve(); };
function environment() {
  const win = new Target(), doc = new Target(), root = new Target(), body = new Target();
  doc.documentElement = root; doc.body = body; doc.hidden = false;
  const media = new Map(), rafs = new Map(), timers = new Map(), images = [], observers = [], resizers = [];
  let clock = 0, id = 0;
  class IO { constructor(cb) { this.cb = cb; this.targets = []; observers.push(this); } observe(el) { this.targets.push(el); } }
  class RO { constructor(cb) { this.cb = cb; resizers.push(this); } observe() {} }
  class Image extends Target {
    constructor() { super(); images.push(this); }
    decode() { return Promise.resolve(); }
    loaded() { this.onload?.(); }
  }
  const ctx = { document: doc, navigator: {}, CSS: { supports: () => true }, Image,
    IntersectionObserver: IO, ResizeObserver: RO, Event: class { constructor(type) { this.type = type; } },
    performance: { now: () => clock }, innerWidth: 1200, innerHeight: 900, scrollY: 0,
    addEventListener: win.addEventListener.bind(win),
    matchMedia: (query) => {
      if (!media.has(query)) { const q = new Target(); q.matches = !query.includes('reduced'); media.set(query, q); }
      return media.get(query);
    },
    requestAnimationFrame: cb => { rafs.set(++id, cb); return id; }, cancelAnimationFrame: k => rafs.delete(k),
    setTimeout: (cb, ms) => { timers.set(++id, { cb, due: clock + ms }); return id; }, clearTimeout: k => timers.delete(k)
  };
  ctx.getComputedStyle = el => { const a = el.getAnimations().at(-1); return {
    transform: a?.frames[0].transform || el.style.transform || 'none',
    opacity: String(a?.frames[0].opacity ?? (el.style.opacity || '1'))
  }; };
  vm.createContext(ctx);
  const tick = (ms = 1000 / 60) => {
    clock += ms;
    const callbacks = [...rafs.values()]; rafs.clear(); callbacks.forEach(cb => cb(clock));
    for (const [k, t] of [...timers]) if (t.due <= clock) { timers.delete(k); t.cb(); }
  };
  return { ctx, doc, root, win, media, rafs, images, observers, resizers, tick,
    run: name => vm.runInContext(fs.readFileSync(path.join(rootPath, 'js', name), 'utf8'), ctx) };
}
function viewerFixture() {
  const e = environment(), dlg = new Target(), img = new Target(), buttons = {};
  for (const k of ['.v-close', '.v-prev', '.v-next']) buttons[k] = new Target();
  img.offsetWidth = 600; img.offsetHeight = 900;
  const links = Array.from({ length: 5 }, (_, n) => {
    const a = new Target(), t = new Target(), card = new Target();
    t.attrs = { width: '900', height: '1350' }; t.src = t.currentSrc = `thumb-${n}`; t.alt = `photo-${n}`;
    a.href = `large-${n}`; a.querySelector = () => t; a.closest = () => card; return a;
  });
  dlg.querySelector = k => k === '.v-img' ? img : buttons[k];
  dlg.showModal = () => { dlg.open = true; };
  dlg.close = () => { dlg.open = false; dlg.emit('close'); };
  e.doc.getElementById = () => dlg; e.doc.querySelectorAll = () => links;
  e.run('viewer.js');
  const finish = async () => { img.getAnimations().at(-1)?.finish(); await flush(); };
  const settle = async () => { for (let n = 0; n < 4 && img.getAnimations().length; n++) await finish(); };
  const open = async () => { links[0].emit('click', { button: 0 }); await settle(); };
  const pointer = (type, x, y, extra = {}) => img.emit(type, { pointerType: 'touch', isPrimary: true, pointerId: 1, clientX: x, clientY: y, ...extra });
  return { ...e, dlg, img, links, buttons, finish, settle, open, pointer };
}
(async () => {
  {
    const e = viewerFixture();
    e.links[0].emit('click', { button: 0 });
    e.buttons['.v-close'].emit('click'); await e.settle();
    assert.equal(e.dlg.open, false, 'closing during opening finishes cleanly');
    e.links[0].emit('click', { button: 0 }); await e.settle();
    assert.equal(e.dlg.open, true, 'viewer can reopen immediately after interrupted opening');
  }
  {
    const e = viewerFixture(); await e.open();
    for (let n = 0; n < 3; n++) e.buttons['.v-next'].emit('click');
    await e.settle(); assert.equal(e.img.alt, 'photo-3', 'rapid navigation preserves every input');
    e.buttons['.v-prev'].emit('click'); e.buttons['.v-next'].emit('click');
    await e.settle(); assert.equal(e.img.alt, 'photo-3', 'direction reversal returns to desired photo');
    e.buttons['.v-next'].emit('click'); e.buttons['.v-close'].emit('click');
    e.buttons['.v-next'].emit('click'); await e.settle();
    assert.equal(e.dlg.open, false, 'close cannot be interrupted by navigation');
    assert.equal(e.root.classList.contains('viewing'), false);
    assert.equal(e.links[0].focused, true, 'focus returns to opener');
    e.images.forEach(im => im.loaded()); await flush();
    assert.equal(e.dlg.open, false, 'late image loads do not reopen dialog');
  }
  {
    const e = viewerFixture(); await e.open();
    e.buttons['.v-next'].emit('click'); await e.settle();
    e.images.find(im => im.src === 'large-1').loaded(); await flush();
    assert.equal(e.img.src, 'large-1');
    e.images.find(im => im.src === 'large-0').loaded(); await flush();
    assert.equal(e.img.src, 'large-1', 'old decode cannot replace current image');
  }
  {
    const e = viewerFixture(); await e.open();
    e.pointer('pointerdown', 300, 200); e.tick(16); e.pointer('pointermove', 260, 201); e.pointer('pointerup', 260, 201);
    await e.settle(); assert.equal(e.img.alt, 'photo-1', 'short fast swipe advances');
    e.pointer('pointerdown', 300, 200); e.tick(200); e.pointer('pointermove', 270, 201); e.tick(150); e.pointer('pointerup', 270, 201);
    await e.settle(); assert.equal(e.img.alt, 'photo-1', 'short slow drag returns');
    e.pointer('pointerdown', 300, 200); e.tick(16); e.pointer('pointermove', 300, 240);
    e.tick(16); e.pointer('pointermove', 160, 250); e.pointer('pointerup', 160, 250);
    await e.settle(); assert.equal(e.img.alt, 'photo-1', 'vertical gesture cannot turn into navigation');
    e.pointer('pointerdown', 300, 200); e.tick(16); e.pointer('pointermove', 160, 200); e.pointer('pointercancel', 160, 200);
    await e.settle(); assert.equal(e.img.alt, 'photo-1', 'cancelled swipe never navigates');
    assert.equal(e.img.capture, null);
  }
  {
    const e = viewerFixture(); await e.open();
    e.buttons['.v-next'].emit('click');
    const q = e.media.get('(prefers-reduced-motion: reduce)'); q.matches = true; q.emit('change');
    assert.equal(e.img.alt, 'photo-1'); assert.equal(e.img.getAnimations().length, 0);
    e.buttons['.v-close'].emit('click'); assert.equal(e.dlg.open, false);
    await flush();
  }
  const lightFixture = () => {
    const e = environment(), cards = [new Target(['card', 'loose']), new Target(['booster'])];
    cards.forEach(c => { c.runtime = e.ctx; });
    e.doc.querySelectorAll = s => s === '[data-tilt]' ? cards : [];
    e.run('light.js');
    e.observers[0].cb(cards.map(target => ({ target, isIntersecting: true })));
    return { ...e, cards };
  };
  {
    const e = lightFixture();
    for (let n = 0; n < 180; n++) e.tick();
    assert.equal(e.cards[0].reads, 1, 'stationary layout is read once, not every frame');
    e.cards[0].rect.top = 220; e.resizers[0].cb(); e.tick(34);
    assert.equal(e.cards[0].reads, 2, 'resize invalidates layout');
    for (let n = 0; n < 6; n++) { e.ctx.scrollY += 100; e.win.emit('scroll'); e.tick(); }
    assert.match(e.cards[0].style.filter, /blur/);
    for (let n = 0; n < 90; n++) e.tick();
    assert.equal(e.cards[0].style.filter, '', 'photos become sharp after scroll settles');
    e.doc.hidden = true; e.doc.emit('visibilitychange'); assert.equal(e.rafs.size, 0);
    e.tick(10000); e.doc.hidden = false; e.doc.emit('visibilitychange'); e.tick();
    assert.equal(e.rafs.size, 1); assert.ok(Math.abs(parseFloat(e.cards[0].values['--ty'])) < 14);
    e.root.classList.add('viewing'); e.doc.emit('scenechange'); assert.equal(e.rafs.size, 0);
    e.root.classList.remove('viewing'); e.doc.emit('scenechange'); assert.equal(e.rafs.size, 1);
    const q = e.media.get('(prefers-reduced-motion: reduce)'); q.matches = true; q.emit('change');
    assert.equal(e.rafs.size, 0); assert.equal(Object.keys(e.cards[0].values).length, 0);
    q.matches = false; q.emit('change'); e.tick(); assert.ok(e.cards[0].values['--rx']);
  }
  const angles = [];
  for (const hz of [30, 60, 120]) {
    const e = lightFixture();
    e.cards[0].emit('pointerenter', { pointerType: 'mouse' });
    e.win.emit('pointermove', { pointerType: 'mouse', clientX: 370, clientY: 580, target: { closest: () => e.cards[0] } });
    for (let n = 0; n < hz; n++) e.tick(1000 / hz);
    const angle = parseFloat(e.cards[0].values['--ry']); angles.push(angle);
    assert.ok(Number.isFinite(angle) && angle > 5 && angle < 9, `stable hover at ${hz} Hz`);
  }
  assert.ok(Math.max(...angles) - Math.min(...angles) < .15, 'consistent motion across refresh rates');
  console.log('PASS: rapid navigation, direction reversal, close races, stale decodes, touch intent/cancellation, reduced motion, visibility, cached layout, scroll settling, 30/60/120 Hz.');
})().catch(error => { console.error(error); process.exitCode = 1; });
