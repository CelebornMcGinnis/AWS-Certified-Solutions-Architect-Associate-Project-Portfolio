// Applied before first paint to avoid a flash of the wrong theme.
// A toggle in the nav can override the system preference; that
// choice is remembered in localStorage from then on.
(function () {
  var stored = localStorage.getItem('theme');
  var theme = stored || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
})();
