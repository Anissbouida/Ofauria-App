/** Interrupteur commun, compatible avec les classes historiques du Design System. */
export function Switch({ checked, onChange, disabled, label }: {
  checked: boolean; onChange: (value: boolean) => void; disabled?: boolean; label?: string;
}) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
    onClick={() => onChange(!checked)} className={`odoo-toggle${checked ? ' on' : ''}`}>
    <span className="odoo-toggle-knob" />
  </button>;
}
