// Runs before first paint so the page never flashes the wrong theme.
// Stored choice wins; otherwise follow the operating system.
(function () {
  var saved = null;
  try { saved = localStorage.getItem("theme"); } catch (e) { /* private mode */ }
  var dark = saved ? saved === "dark"
                   : window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
})();
