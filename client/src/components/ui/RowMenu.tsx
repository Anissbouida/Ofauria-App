import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { MoreHorizontal, type LucideIcon } from 'lucide-react';
import './row-menu.css';

export interface RowMenuItem {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/**
 * Menu « ⋯ » d'une ligne de liste : les actions secondaires, avec leur libellé, au lieu
 * d'une rangée d'icônes. L'action principale reste un bouton visible à côté.
 * Se ferme au clic extérieur, sur Échap et au défilement ; le clic ne remonte pas à la ligne.
 * La liste est en position fixe (calculée à l'ouverture) pour ne pas être rognée par un
 * tableau qui défile, et s'ouvre vers le haut près du bas de l'écran.
 */
export function RowMenu({ items, label = 'Plus d\'actions' }: { items: RowMenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties>({});
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  const visible = items.filter(Boolean);
  if (!visible.length) return null;
  return (
    <div className="row-menu" ref={ref} onClick={e => e.stopPropagation()}>
      <button type="button" className="row-menu-trigger" aria-label={label} aria-haspopup="menu" aria-expanded={open}
        onClick={e => {
          const r = e.currentTarget.getBoundingClientRect();
          const right = window.innerWidth - r.right;
          setPos(r.bottom + 260 > window.innerHeight ? { bottom: window.innerHeight - r.top + 4, right } : { top: r.bottom + 4, right });
          setOpen(o => !o);
        }}>
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="row-menu-list" role="menu" style={pos}>
          {visible.map(it => {
            const Icon = it.icon;
            return (
              <button key={it.label} type="button" role="menuitem" disabled={it.disabled}
                className={`row-menu-item${it.danger ? ' danger' : ''}`}
                onClick={() => { setOpen(false); it.onSelect(); }}>
                {Icon && <Icon size={14} />} {it.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
