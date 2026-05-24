// Tiny toast notification helper. Used by both server-driven events (Steam
// notifications forwarded from the agent) and local UI feedback.

const root = () => document.getElementById('toasts');

export function toast(message, variant = 'info', ms = 4500) {
  const el = document.createElement('div');
  el.className = `cd-toast ${variant}`;
  el.textContent = message;
  root().appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity 0.3s, transform 0.3s';
    el.style.opacity = '0';
    el.style.transform = 'translateX(40px)';
    setTimeout(() => el.remove(), 320);
  }, ms);
}
