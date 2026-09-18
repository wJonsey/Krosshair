// Loading screen. A classic script (not a module) so it runs while the engine is still downloading.
// main.js reports real milestones through window.__boot; the plates are just something to shoot meanwhile.
(() => {
  const el = document.querySelector('#boot');
  if (!el) return;
  const $ = (selector) => el.querySelector(selector);
  const range = $('#boot-range');
  const reticle = $('#boot-reticle');
  const logo = $('#boot-logo');
  const logoK = $('#boot-logo-k');
  const bar = $('#boot-bar');
  const status = $('#boot-status');
  const enter = $('#boot-enter');
  const steps = [...el.querySelectorAll('[data-step]')];
  const labels = { engine: 'Downloading engine…', arena: 'Building Kestrel Yard…', link: 'Connecting…', optics: 'Zeroing optics…' };
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let shots = 0;
  let hits = 0;
  let ready = false;
  let closed = false;
  let spawnTimer = null;

  // ----- progress -----
  function refresh() {
    const done = steps.filter((item) => item.classList.contains('done') || item.classList.contains('warn')).length;
    bar.style.width = `${(done / steps.length) * 100}%`;
    const next = steps.find((item) => !item.classList.contains('done') && !item.classList.contains('warn'));
    steps.forEach((item) => item.classList.toggle('active', item === next));
    if (!ready) { if (next) status.textContent = labels[next.dataset.step]; return; }
    // The game is playable before the socket opens; say so rather than pretend.
    const link = steps.find((item) => item.dataset.step === 'link');
    status.textContent = link.classList.contains('done') ? 'Ready.' : link.classList.contains('warn') ? 'Ready. Server unreachable, retrying…' : 'Ready. Connecting…';
  }
  function step(id, state = 'done') {
    const item = steps.find((entry) => entry.dataset.step === id);
    if (!item || closed) return;
    item.classList.remove('done', 'warn');
    item.classList.add(state);
    refresh();
  }
  function fail(text) {
    if (closed) return;
    el.classList.add('failed');
    status.textContent = text;
    enter.textContent = 'Reload';
    enter.classList.remove('hidden');
    enter.onclick = () => location.reload();
  }
  function markReady() {
    if (ready || closed) return;
    ready = true;
    step('optics');
    el.classList.add('ready');
    // Coming back into a live match (refresh / reconnect) should not wait on a click.
    let rejoining = false;
    let refreshed = false; // set by net.js when the page reloads itself to pick up a new deploy
    try { rejoining = Boolean(sessionStorage.getItem('krosshair:room')); refreshed = Boolean(sessionStorage.getItem('krosshair:skipintro')); sessionStorage.removeItem('krosshair:skipintro'); } catch { /* private mode */ }
    if (rejoining || refreshed || new URLSearchParams(location.search).has('skipintro')) { close(); return; }
    enter.classList.remove('hidden');
    enter.focus({ preventScroll: true });
  }
  function close() {
    if (closed) return;
    closed = true;
    clearInterval(spawnTimer);
    removeEventListener('pointermove', aim);
    removeEventListener('keydown', onKey);
    el.classList.add('leaving');
    setTimeout(() => el.remove(), calm ? 0 : 650);
  }
  enter.addEventListener('click', (event) => { event.stopPropagation(); if (ready) close(); });
  function onKey(event) { if (ready && (event.code === 'Enter' || event.code === 'Space')) { event.preventDefault(); close(); } }
  addEventListener('keydown', onKey);

  // ----- the logo tracks your aim -----
  function aim(event) {
    reticle.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
    el.classList.toggle('has-pointer', event.pointerType === 'mouse');
    const box = logo.getBoundingClientRect();
    const dx = event.clientX - (box.left + box.width / 2);
    const dy = event.clientY - (box.top + box.height / 2);
    const pull = Math.min(1, Math.hypot(dx, dy) / 420);
    const angle = Math.atan2(dy, dx);
    logoK.style.transform = `translate(${Math.cos(angle) * pull * 7}px, ${Math.sin(angle) * pull * 7}px)`;
    logo.style.setProperty('--tilt-x', `${(-dy / innerHeight) * 16}deg`);
    logo.style.setProperty('--tilt-y', `${(dx / innerWidth) * 16}deg`);
  }
  addEventListener('pointermove', aim);

  // ----- warm-up range -----
  function score() {
    $('#boot-hits').textContent = hits;
    $('#boot-acc').textContent = shots ? `${Math.round((hits / shots) * 100)}% ACC` : '-';
  }
  function spark(x, y, hit) {
    const mark = document.createElement('span');
    mark.className = hit ? 'boot-spark hit' : 'boot-spark';
    mark.style.left = `${x}px`;
    mark.style.top = `${y}px`;
    range.appendChild(mark);
    setTimeout(() => mark.remove(), 450);
  }
  function kick() {
    reticle.classList.remove('kick'); logo.classList.remove('kick');
    void reticle.offsetWidth; // restart the animation
    reticle.classList.add('kick'); logo.classList.add('kick');
  }
  el.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button')) return;
    shots += 1;
    const plate = event.target.closest('.boot-plate');
    if (plate && !plate.classList.contains('down')) {
      hits += 1;
      plate.classList.add('down');
      setTimeout(() => plate.remove(), 300);
    }
    spark(event.clientX, event.clientY, Boolean(plate));
    kick();
    score();
  });
  function spawn() {
    if (document.hidden || range.querySelectorAll('.boot-plate').length >= 4) return;
    const plate = document.createElement('i');
    plate.className = 'boot-plate';
    // Keep plates out of the middle column where the logo and progress sit.
    const side = Math.random() < 0.5 ? 0.06 + Math.random() * 0.2 : 0.74 + Math.random() * 0.2;
    const size = 34 + Math.random() * 30;
    plate.style.cssText = `left:${side * 100}%;top:${14 + Math.random() * 66}%;width:${size}px;height:${size}px;--drift:${(Math.random() - 0.5) * 120}px`;
    range.appendChild(plate);
    setTimeout(() => { if (!plate.classList.contains('down')) plate.remove(); }, 2600);
  }
  spawn();
  spawnTimer = setInterval(spawn, 750);

  // ----- when the engine never arrives -----
  addEventListener('error', (event) => { if (!ready && event.filename) fail('Failed to start. Reload to try again.'); });
  setTimeout(() => { if (!ready && !closed && !el.classList.contains('failed')) status.textContent += ' Still loading. Slow connection?'; }, 15000);

  refresh();
  window.__boot = { step, ready: markReady, fail };

  // ----- phones and tablets -----
  // Krosshair needs a mouse and keyboard (pointer lock, right-click to scope, a dozen keys), so touch
  // devices stop here and the engine is never downloaded. A tablet with a mouse attached counts as a laptop.
  const ua = navigator.userAgent || '';
  const touchOnly = navigator.maxTouchPoints > 0 && !matchMedia('(any-pointer: fine)').matches;
  const mobile = navigator.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod|Windows Phone|Mobile/i.test(ua) || touchOnly;
  if (mobile) {
    closed = true;
    clearInterval(spawnTimer);
    el.classList.add('blocked');
    $('.boot-steps').remove(); $('.boot-meter').remove(); $('.boot-score').remove(); enter.remove(); range.remove();
    status.outerHTML = '<div class="boot-block"><h2>Desktop only.</h2><p>Krosshair needs a mouse and keyboard.</p><p>Play at <b>krosshair.online</b> on a computer.</p><a href="https://discord.gg/uFVygVtKzt" target="_blank" rel="noopener noreferrer">Join the Discord →</a></div>';
    return;
  }
  import(new URL('client/main.js', document.baseURI).href).catch((error) => { console.error(error); fail('Download failed. Check your connection and reload.'); });
})();
