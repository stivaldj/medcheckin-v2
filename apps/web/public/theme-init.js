// Tema segue a preferência do sistema (sem toggle próprio): aplica `.dark` antes da pintura
// para não piscar, e acompanha mudanças ao vivo. O PWA é usado de madrugada — tela clara
// estoura o olho; a médica de dia continua no claro.
(function () {
  try {
    var m = window.matchMedia('(prefers-color-scheme: dark)');
    var apply = function () {
      document.documentElement.classList.toggle('dark', m.matches);
    };
    apply();
    m.addEventListener('change', apply);
  } catch {
    /* sem matchMedia (ambiente antigo): fica no claro */
  }
})();
