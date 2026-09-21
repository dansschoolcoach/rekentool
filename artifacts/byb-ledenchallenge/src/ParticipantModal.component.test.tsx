import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Participant } from '@workspace/api-client-react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ParticipantModal, participantEmailConflictMessage, participantInvalidEmailMessage } from './participantManagement';

const conflictMessage = 'Er bestaat al een deelnemer met dit e-mailadres.';

expect(participantEmailConflictMessage).toBe(conflictMessage);

function ConflictHarness({ participant, onSave }: { participant?: Participant; onSave: ReturnType<typeof vi.fn> }) {
  const [conflict, setConflict] = useState(false);
  return (
    <>
      {conflict && <p role="alert">{conflictMessage}</p>}
      <ParticipantModal
        participant={participant}
        saving={false}
        onClose={vi.fn()}
        onSave={(data) => {
          onSave(data);
          setConflict(true);
        }}
      />
    </>
  );
}

afterEach(cleanup);

describe('dubbele e-mailadressen in deelnemersbeheer', () => {
  it('laat bij toevoegen de conflictmelding en alle ingevoerde waarden staan', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ConflictHarness onSave={onSave} />);

    await user.type(screen.getByTestId('input-participant-school-name'), 'Nieuwe dansschool');
    await user.type(screen.getByTestId('input-participant-contact-name'), 'Nieuwe beheerder');
    await user.type(screen.getByTestId('input-participant-email'), 'BESTAAND@EXAMPLE.TEST');
    await user.click(screen.getByTestId('button-save-participant'));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      schoolName: 'Nieuwe dansschool',
      contactName: 'Nieuwe beheerder',
      email: 'BESTAAND@EXAMPLE.TEST',
    }));

    expect(screen.getByRole('alert').textContent).toBe(conflictMessage);
    expect((screen.getByTestId('input-participant-school-name') as HTMLInputElement).value).toBe('Nieuwe dansschool');
    expect((screen.getByTestId('input-participant-contact-name') as HTMLInputElement).value).toBe('Nieuwe beheerder');
    expect((screen.getByTestId('input-participant-email') as HTMLInputElement).value).toBe('BESTAAND@EXAMPLE.TEST');
    expect((screen.getByTestId('button-save-participant') as HTMLButtonElement).disabled).toBe(false);
  });

  it('laat bij wijzigen de conflictmelding en gewijzigde waarden staan', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const participant = {
      id: 2,
      schoolName: 'Te wijzigen school',
      contactName: 'Huidige beheerder',
      email: 'eigen@example.test',
      startingMembers: null,
      country: 'Nederland',
    } as Participant;
    render(<ConflictHarness participant={participant} onSave={onSave} />);

    const contactName = screen.getByTestId('input-participant-contact-name');
    const email = screen.getByTestId('input-participant-email');
    await user.clear(contactName);
    await user.type(contactName, 'Gewijzigde beheerder');
    await user.clear(email);
    await user.type(email, 'BESTAAND@EXAMPLE.TEST');
    await user.click(screen.getByTestId('button-save-participant'));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      contactName: 'Gewijzigde beheerder',
      email: 'BESTAAND@EXAMPLE.TEST',
    }));

    expect(screen.getByRole('alert').textContent).toBe(conflictMessage);
    expect((contactName as HTMLInputElement).value).toBe('Gewijzigde beheerder');
    expect((email as HTMLInputElement).value).toBe('BESTAAND@EXAMPLE.TEST');
    expect((screen.getByTestId('button-save-participant') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('ongeldige e-mailadressen in deelnemersbeheer', () => {
  it('legt bij toevoegen uit dat een apenstaartje ontbreekt zonder op te slaan', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ParticipantModal saving={false} onClose={vi.fn()} onSave={onSave} />);

    await user.type(screen.getByTestId('input-participant-school-name'), 'Nieuwe dansschool');
    await user.type(screen.getByTestId('input-participant-contact-name'), 'Nieuwe beheerder');
    await user.type(screen.getByTestId('input-participant-email'), 'beheerder.example.nl');
    await user.click(screen.getByTestId('button-save-participant'));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe(participantInvalidEmailMessage);
  });

  it('legt bij wijzigen uit dat het domein een punt nodig heeft zonder op te slaan', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const participant = {
      id: 4,
      schoolName: 'Bestaande dansschool',
      contactName: 'Bestaande beheerder',
      email: 'beheerder@example.nl',
      startingMembers: null,
      country: 'Nederland',
    } as Participant;
    render(<ParticipantModal participant={participant} saving={false} onClose={vi.fn()} onSave={onSave} />);

    const email = screen.getByTestId('input-participant-email');
    await user.clear(email);
    await user.type(email, 'beheerder@example');
    await user.click(screen.getByTestId('button-save-participant'));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe(participantInvalidEmailMessage);
  });
});

describe('gelijktijdige profielwijzigingen', () => {
  it('laadt actuele serverwaarden wanneer een conflict expliciet wordt teruggegeven', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const participant = {
      id: 3,
      schoolName: 'Dansschool Oud',
      contactName: 'Beheerder Oud',
      email: 'oud@example.test',
      startingMembers: null,
      country: 'Nederland',
    } as Participant;
    const view = render(
      <ParticipantModal participant={participant} saving={false} onClose={vi.fn()} onSave={onSave} />,
    );

    const contactName = screen.getByTestId('input-participant-contact-name') as HTMLInputElement;
    await user.clear(contactName);
    await user.type(contactName, 'Lokale oude wijziging');

    const refreshedParticipant = {
      ...participant,
      schoolName: 'Dansschool Actueel',
      contactName: 'Beheerder Actueel',
      email: 'actueel@example.test',
      country: 'België',
    } as Participant;
    view.rerender(
      <ParticipantModal participant={refreshedParticipant} saving={false} onClose={vi.fn()} onSave={onSave} />,
    );

    expect((screen.getByTestId('input-participant-school-name') as HTMLInputElement).value).toBe('Dansschool Actueel');
    expect(contactName.value).toBe('Beheerder Actueel');
    expect((screen.getByTestId('input-participant-email') as HTMLInputElement).value).toBe('actueel@example.test');
    expect((screen.getByTestId('input-participant-country') as HTMLSelectElement).value).toBe('België');

    await user.click(screen.getByTestId('button-save-participant'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      schoolName: 'Dansschool Actueel',
      contactName: 'Beheerder Actueel',
      email: 'actueel@example.test',
      country: 'België',
    }));
    expect(onSave).not.toHaveBeenCalledWith(expect.objectContaining({
      contactName: 'Lokale oude wijziging',
    }));
  });
});