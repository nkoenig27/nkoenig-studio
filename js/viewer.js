// nkoenig.studio V8 — Foto groß ansehen: Klick auf eine Karte, dann Pfeile/Wischen, Esc oder Klick daneben schließt.
// Bewusst ohne Titel, Zähler oder Hinweistext. Ohne JS öffnet der Link einfach das große Bild.
(() => {
  const dlg = document.getElementById('viewer');
  const links = [...document.querySelectorAll('a.zoom')];
  if (!dlg || !links.length || typeof dlg.showModal !== 'function') return;
  const img = dlg.querySelector('.v-img');
  let i = 0, opener = null;

  const show = (n) => {
    i = (n + links.length) % links.length;
    img.src = links[i].href;
    img.alt = links[i].querySelector('img')?.alt || '';
    // Nachbarn vorladen, damit Blättern sofort sitzt
    [i - 1, i + 1].forEach((k) => { new Image().src = links[(k + links.length) % links.length].href; });
  };

  links.forEach((a, n) => a.addEventListener('click', (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    opener = a; show(n);
    dlg.showModal();
    dlg.focus();   // Fokus auf den Dialog selbst, damit der Schliessen-Knopf nicht gleich gelb aufleuchtet
    document.documentElement.classList.add('viewing');
  }));

  dlg.querySelector('.v-close').addEventListener('click', () => dlg.close());
  dlg.querySelector('.v-prev').addEventListener('click', () => show(i - 1));
  dlg.querySelector('.v-next').addEventListener('click', () => show(i + 1));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });   // Klick neben das Foto
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); show(i - 1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); show(i + 1); }
  });
  dlg.addEventListener('close', () => {
    document.documentElement.classList.remove('viewing');
    opener?.focus({ preventScroll: true }); opener = null;
  });

  // Wischen auf dem Handy
  let sx = 0, sy = 0, st = 0;
  img.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') { sx = e.clientX; sy = e.clientY; st = e.timeStamp; } }, { passive: true });
  img.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'touch' || !st) return;
    const dx = e.clientX - sx, dy = e.clientY - sy; st = 0;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) show(i + (dx < 0 ? 1 : -1));
  }, { passive: true });
  img.draggable = false;
})();
