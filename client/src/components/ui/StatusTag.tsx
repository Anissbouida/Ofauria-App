import { PencilLine, Clock, CircleDashed, TriangleAlert, CalendarX, CircleCheck, Ban, type LucideIcon } from 'lucide-react';

/**
 * Étiquette de statut commune (lisibilité 2026-11-15) : couleur + icône + libellé, jamais la
 * couleur seule. Styles .kl-tag dans styles/index.css (toutes les paires ≥ 4,7:1).
 *
 * Même règle de couleur partout :
 *   draft     gris   — brouillon, rien d'engagé
 *   todo      ambre  — à traiter : une action est attendue (à payer, à facturer, à remettre)
 *   progress  bleu   — en cours, partiel
 *   blocked   rouge  — bloqué, litige
 *   late      rouge plein — échéance dépassée
 *   done      vert   — terminé, soldé
 *   cancelled gris   — annulé
 */
export type StatusTone = 'draft' | 'todo' | 'progress' | 'blocked' | 'late' | 'done' | 'cancelled';

const TONES: Record<StatusTone, { cls: string; Icon: LucideIcon }> = {
  draft: { cls: 'x', Icon: PencilLine },
  todo: { cls: 'o', Icon: Clock },
  progress: { cls: 'b', Icon: CircleDashed },
  blocked: { cls: 'r', Icon: TriangleAlert },
  late: { cls: 'rs', Icon: CalendarX },
  done: { cls: 'g', Icon: CircleCheck },
  cancelled: { cls: 'x', Icon: Ban },
};

/** Couleur de colonne Kanban (KanbanLane.tone) correspondant à un ton de statut. */
export const LANE_TONE: Record<StatusTone, 'grey' | 'red' | 'orange' | 'green' | 'blue'> = {
  draft: 'grey', todo: 'orange', progress: 'blue', blocked: 'red', late: 'red', done: 'green', cancelled: 'grey',
};

export function StatusTag({ tone, label, icon, title }: { tone: StatusTone; label: string; icon?: LucideIcon; title?: string }) {
  const t = TONES[tone] ?? TONES.draft;
  const Icon = icon ?? t.Icon;
  return (
    <span className={`kl-tag ${t.cls}`} title={title}>
      <Icon size={12} strokeWidth={2.4} aria-hidden="true" />{label}
    </span>
  );
}
