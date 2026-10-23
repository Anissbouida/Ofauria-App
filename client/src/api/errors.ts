/**
 * Message d'erreur lisible depuis n'importe quelle forme renvoyee par l'API ou axios.
 * Le serveur a longtemps eu deux enveloppes ({ error: { message } } et { error: 'texte' }),
 * et le client les lisait de 14 facons differentes. Un seul point d'entree ici.
 */
export function apiErrorMessage(err: unknown, fallback = 'Erreur'): string {
  if (!err) return fallback;
  const e = err as Record<string, any>;
  const data = e?.response?.data;
  if (data) {
    const er = data.error;
    if (typeof er === 'string' && er.trim()) return er;
    if (er && typeof er === 'object') {
      if (typeof er.message === 'string' && er.message.trim()) {
        const details = er.details;
        if (details && typeof details === 'object' && !Array.isArray(details)) {
          const first = Object.values(details as Record<string, string[]>).flat()[0];
          if (first) return `${er.message} : ${first}`;
        }
        if (Array.isArray(details) && details[0]) return `${er.message} : ${details[0]}`;
        return er.message;
      }
    }
    if (typeof data.message === 'string' && data.message.trim()) return data.message;
  }
  if (typeof e?.message === 'string' && e.message.trim() && !/^Request failed with status code/.test(e.message)) {
    return e.message;
  }
  return fallback;
}
