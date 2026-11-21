import { describe, it, expect, vi } from 'vitest';
import { installDoubleClickGuard } from './doubleClickGuard';

// Document minimal : on capte le gestionnaire installé et on simule des clics.
function fakeDoc() {
  let handler: ((e: MouseEvent) => void) | null = null;
  const doc = {
    addEventListener: (_t: string, h: (e: MouseEvent) => void) => { handler = h; },
    removeEventListener: () => { handler = null; },
  } as unknown as Document;
  const click = (target: unknown) => {
    const e = { target, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
    handler!(e as unknown as MouseEvent);
    return e;
  };
  return { doc, click };
}
const button = (isAction: boolean) => {
  const el = { closest: (sel: string) => (isAction && sel.includes('odoo-btn-primary') ? el : null) };
  return el;
};

describe('Garde contre le double clic (constat 119)', () => {
  it('le second clic rapproché sur un bouton d\'enregistrement est ignoré', () => {
    const { doc, click } = fakeDoc();
    installDoubleClickGuard(doc);
    const save = button(true);
    expect(click(save).stopImmediatePropagation).not.toHaveBeenCalled();
    const second = click(save);
    expect(second.stopImmediatePropagation).toHaveBeenCalled();
    expect(second.preventDefault).toHaveBeenCalled();
  });

  it('un bouton ordinaire (pavé, +/−) n\'est pas freiné', () => {
    const { doc, click } = fakeDoc();
    installDoubleClickGuard(doc);
    const plus = button(false);
    click(plus);
    expect(click(plus).stopImmediatePropagation).not.toHaveBeenCalled();
  });

  it('deux boutons différents restent indépendants', () => {
    const { doc, click } = fakeDoc();
    installDoubleClickGuard(doc);
    click(button(true));
    expect(click(button(true)).stopImmediatePropagation).not.toHaveBeenCalled();
  });
});
