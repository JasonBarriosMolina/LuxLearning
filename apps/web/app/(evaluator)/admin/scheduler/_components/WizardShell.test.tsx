import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WizardShell } from './WizardShell';

// Trello *LUX SCHEDULER* (Mack, 2026-09-10): "no puedo ir a disponibilidad o
// estudiantes... se quedó pegado en armando rompecabezas" — el stepper no
// dejaba saltar a un paso ya completado. Ahora los pasos "done" son clickeables.
describe('WizardShell — stepper navigation', () => {
  it('calls onStepClick when a completed step is clicked', () => {
    const onStepClick = vi.fn();
    render(
      <WizardShell step={4} onStepClick={onStepClick}>
        <div>contenido</div>
      </WizardShell>
    );
    // Step 2 ("Parámetros") is completed (2 < 4) — should be clickable
    fireEvent.click(screen.getByText('Parámetros').closest('button')!);
    expect(onStepClick).toHaveBeenCalledWith(2);
  });

  it('does not call onStepClick for the active or future steps', () => {
    const onStepClick = vi.fn();
    render(
      <WizardShell step={4} onStepClick={onStepClick}>
        <div>contenido</div>
      </WizardShell>
    );
    const activeBtn = screen.getByText('Disponibilidad').closest('button')!; // step 4 label per WIZARD_STEPS
    fireEvent.click(activeBtn);
    expect(onStepClick).not.toHaveBeenCalled();
  });

  it('renders the stepper as non-interactive when onStepClick is not provided', () => {
    render(
      <WizardShell step={4}>
        <div>contenido</div>
      </WizardShell>
    );
    const btn = screen.getByText('Parámetros').closest('button')! as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
