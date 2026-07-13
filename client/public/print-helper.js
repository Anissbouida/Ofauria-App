/**
 * Cable les boutons Imprimer / Fermer de la fenetre "Bons de Transfert"
 * (module Controle des ventes). Fichier servi par le site : autorise par la
 * CSP (script-src 'self'), contrairement au JS inline qui est bloque en prod.
 */
(function () {
  window.__printWired = true;
  var btnPrint = document.getElementById('btn-print');
  var btnClose = document.getElementById('btn-close');
  if (btnPrint) btnPrint.addEventListener('click', function () { window.print(); });
  if (btnClose) btnClose.addEventListener('click', function () { window.close(); });
})();
