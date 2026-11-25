import { Check } from 'lucide-react';
import type { ReactNode } from 'react';

export function Stepper({ steps, current, completed, onSelect, disabled }: {
  steps: { key: string; phase: string; label: string }[]; current: string; completed: Set<string>;
  onSelect: (key: string) => void; disabled?: boolean;
}) {
  const done = steps.filter(s => completed.has(s.key)).length;
  const percent = steps.length ? Math.round(done * 100 / steps.length) : 0;
  return <nav className="ds-panel wz-stepper" aria-label="Étapes de configuration">
    <div className="wz-between"><strong>Votre progression</strong><strong style={{ color: 'var(--ds-accent)' }}>{percent} %</strong></div>
    <progress value={done} max={steps.length || 1} aria-label="Progression" />
    <p className="wz-muted">{done} sur {steps.length} étapes préparées</p>
    {steps.map((s, index) => <div key={s.key}>
      {(index === 0 || steps[index - 1].phase !== s.phase) && <p className="wz-phase">{s.phase}</p>}
      <button type="button" className={`wz-step ${current === s.key ? 'active' : ''}`} aria-current={current === s.key ? 'step' : undefined}
        disabled={disabled} onClick={() => onSelect(s.key)}><span className={`wz-num ${completed.has(s.key) ? 'done' : ''}`}>{completed.has(s.key) && current !== s.key ? <Check size={13} /> : index + 1}</span>{s.label}</button>
    </div>)}
  </nav>;
}

export function ChoiceCard({ selected, title, description, icon, onClick, disabled }: {
  selected: boolean; title: string; description: string; icon?: ReactNode; onClick: () => void; disabled?: boolean;
}) {
  return <button type="button" className={`wz-choice ${selected ? 'selected' : ''}`} aria-pressed={selected} disabled={disabled} onClick={onClick}>
    {icon}<span style={{ flex: 1 }}><strong>{title}</strong><span className="wz-muted" style={{ display: 'block' }}>{description}</span></span>{selected && <Check size={18} />}
  </button>;
}
