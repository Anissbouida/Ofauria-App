/**
 * Garde contre le double clic (scénario 1, constat 119).
 *
 * Un double clic sur un bouton d'enregistrement envoyait deux requêtes : le bouton n'est
 * désactivé (« Enregistrement… ») qu'au rendu suivant, et le second clic arrive avant. Ici,
 * un second clic sur le MÊME bouton principal ou d'envoi dans les 800 ms est ignoré.
 * Limité aux boutons d'action (odoo-btn-primary, type=submit) : les pavés numériques et
 * les boutons +/− qu'on tape vite ne sont pas concernés. Monté une fois (main.tsx).
 */
const WINDOW_MS = 800;
const SELECTOR = 'button.odoo-btn-primary, button[type="submit"], input[type="submit"]';

export function installDoubleClickGuard(doc: Document = document): () => void {
  const last = new WeakMap<Element, number>();
  const onClick = (e: MouseEvent) => {
    const target = e.target as Element | null;
    const btn = target?.closest?.(SELECTOR);
    if (!btn) return;
    const now = performance.now();
    const prev = last.get(btn);
    if (prev !== undefined && now - prev < WINDOW_MS) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    last.set(btn, now);
  };
  doc.addEventListener('click', onClick, true);
  return () => doc.removeEventListener('click', onClick, true);
}
