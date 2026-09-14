// Tema: "system" (padrão) segue o aparelho; "light"/"dark" é escolha manual guardada neste
// aparelho (localStorage `mc-theme`). Aplica `.dark` ANTES da pintura para não piscar e acompanha
// a troca do sistema ao vivo enquanto a escolha for "system". O PWA é usado de madrugada — tela
// clara estoura o olho; quem quiser o contrário escolhe no botão do cabeçalho.
(function () {
  var KEY = 'mc-theme';
  var m = null;
  try {
    m = window.matchMedia('(prefers-color-scheme: dark)');
  } catch {
    m = null; // sem matchMedia (ambiente antigo): "system" fica no claro
  }
  function pref() {
    try {
      var v = window.localStorage.getItem(KEY);
      return v === 'light' || v === 'dark' ? v : 'system';
    } catch {
      return 'system'; // localStorage bloqueado (modo privado): segue o sistema
    }
  }
  function apply() {
    var p = pref();
    var dark = p === 'dark' || (p === 'system' && !!(m && m.matches));
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.setAttribute('data-theme-pref', p);
  }
  apply();
  if (m) m.addEventListener('change', apply);
  // O botão do cabeçalho chama isto; a regra de "quem ganha" fica num lugar só.
  window.__mcTheme = {
    get: pref,
    set: function (p) {
      try {
        if (p === 'system') window.localStorage.removeItem(KEY);
        else window.localStorage.setItem(KEY, p);
      } catch {
        // sem localStorage a escolha vale só nesta aba — melhor que não trocar
        document.documentElement.setAttribute('data-theme-pref', p);
        document.documentElement.classList.toggle(
          'dark',
          p === 'dark' || (p === 'system' && !!(m && m.matches)),
        );
        return;
      }
      apply();
    },
  };
})();
