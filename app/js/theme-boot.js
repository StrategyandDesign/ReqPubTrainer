/* Applies the saved theme before first paint so dark mode never flashes light.
   Kept as a separate file because the CSP disallows inline scripts. */
(function () {
  try {
    const t = localStorage.getItem('rp:theme') || 'system';
    const dark = t === 'dark' || (t !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  } catch { /* default light */ }
})();
