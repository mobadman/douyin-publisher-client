const query = new URLSearchParams(location.search);
const message = query.get('message') || '';
const seconds = Math.max(1, Number(query.get('seconds')) || 2);
const watermark = document.getElementById('watermark');
const takeoverText = document.getElementById('takeover-text');
const progress = document.getElementById('progress');
watermark.textContent = message;
takeoverText.textContent = `如需人工接管，请连续按住鼠标或任意键 ${seconds} 秒`;
if (!message) document.body.classList.add('quiet');

let timer = null;
function begin() {
  if (timer) return;
  progress.style.transition = `width ${seconds}s linear`;
  requestAnimationFrame(() => { progress.style.width = '100%'; });
  timer = setTimeout(() => window.guard.takeover(), seconds * 1000);
}
function reset() {
  if (timer) clearTimeout(timer);
  timer = null;
  progress.style.transition = 'none';
  progress.style.width = '0';
}
addEventListener('pointerdown', begin);
addEventListener('pointerup', reset);
addEventListener('pointercancel', reset);
addEventListener('keydown', begin);
addEventListener('keyup', reset);
addEventListener('blur', reset);
addEventListener('contextmenu', (event) => event.preventDefault());
