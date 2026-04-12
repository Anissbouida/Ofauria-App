/**
 * Télécharge un blob en tant que fichier.
 * Compatible web (navigateur) et mobile (Capacitor WebView).
 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();

  // Fallback pour WebView Capacitor : ouvrir dans un nouvel onglet
  // si le click() ne déclenche pas le téléchargement
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 1000);
}

/**
 * Ouvre un blob directement (ex: PDF) dans une nouvelle fenêtre/onglet.
 * Plus fiable dans Capacitor WebView que le téléchargement.
 */
export function openBlob(blob: Blob) {
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
