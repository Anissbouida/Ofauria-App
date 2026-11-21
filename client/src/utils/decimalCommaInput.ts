/**
 * Virgule décimale dans les champs numériques (scénario 1, constat 118).
 *
 * Un <input type="number"> suit la langue du NAVIGATEUR, pas celle de l'application : dans
 * un navigateur en anglais, la virgule est refusée en silence et « 1,5 » devient « 15 »
 * (une erreur ×10 sur une quantité de fiche, un prix, un poids). On remplace la virgule
 * tapée par un point, que tous les navigateurs acceptent : « 1,5 » reste 1,5 quelle que
 * soit la langue du poste. Monté une fois au démarrage (main.tsx), pour toute l'application.
 */
export function installDecimalCommaInput(doc: Document = document): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || t.type !== 'number') return;
    if (e.key !== ',' || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    // insertText passe par le chemin d'édition normal : React reçoit l'événement input.
    doc.execCommand('insertText', false, '.');
  };
  doc.addEventListener('keydown', onKeyDown, true);
  return () => doc.removeEventListener('keydown', onKeyDown, true);
}
