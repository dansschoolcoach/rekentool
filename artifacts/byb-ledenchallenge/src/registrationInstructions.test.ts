import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  buildRegistrationInstructions,
  copyRegistrationInstructions,
  findRegistrationParticipant,
  RegistrationInstructionsForParticipant,
} from './registrationInstructions.ts';

describe('registration instructions from an existing participant row', () => {
  it('removes the dialog and copy control after the participant is removed', () => {
    const selectedParticipantId = 12;
    const renderInstructions = (participants: Array<{ id: number; email: string }>) =>
      renderToStaticMarkup(
        createElement(
          RegistrationInstructionsForParticipant,
          {
            participants,
            participantId: selectedParticipantId,
            children: (participant: { id: number; email: string }) =>
              createElement(
                'div',
                { role: 'dialog' },
                createElement('p', null, buildRegistrationInstructions(
                  participant.email,
                  'https://ledenchallenge.example/sign-up',
                )),
                createElement(
                  'button',
                  { 'data-testid': 'button-copy-registration-instructions' },
                  'Kopieer link en tekst',
                ),
              ),
          },
        ),
      );

    const openedInstructions = renderInstructions([
      { id: selectedParticipantId, email: 'verwijderd@example.nl' },
    ]);
    assert.match(openedInstructions, /role="dialog"/);
    assert.match(openedInstructions, /button-copy-registration-instructions/);
    assert.match(openedInstructions, /verwijderd@example\.nl/);

    const instructionsAfterRemoval = renderInstructions([]);
    assert.equal(instructionsAfterRemoval, '');
    assert.doesNotMatch(instructionsAfterRemoval, /role="dialog"/);
    assert.doesNotMatch(instructionsAfterRemoval, /button-copy-registration-instructions/);
    assert.doesNotMatch(instructionsAfterRemoval, /verwijderd@example\.nl/);
  });

  it('shows and copies the current email after the participant email changes', async () => {
    const signUpUrl = 'https://ledenchallenge.example/sign-up';
    const originalEmail = 'oud@example.nl';
    const currentEmail = 'nieuw@example.nl';
    const selectedParticipantId = 12;
    let participants = [{ id: selectedParticipantId, email: originalEmail }];

    const openedParticipant = findRegistrationParticipant(participants, selectedParticipantId);
    assert.equal(openedParticipant?.email, originalEmail);

    participants = [{ id: selectedParticipantId, email: currentEmail }];
    const reopenedParticipant = findRegistrationParticipant(participants, selectedParticipantId);
    assert.equal(reopenedParticipant?.email, currentEmail);

    const displayedInstructions = buildRegistrationInstructions(
      reopenedParticipant!.email,
      signUpUrl,
    );
    let copiedInstructions = '';
    const clipboard = {
      async writeText(value: string) {
        copiedInstructions = value;
      },
    };
    await clipboard.writeText(displayedInstructions);

    assert.match(displayedInstructions, new RegExp(currentEmail));
    assert.doesNotMatch(displayedInstructions, new RegExp(originalEmail));
    assert.equal(copiedInstructions, displayedInstructions);
    assert.match(copiedInstructions, new RegExp(signUpUrl));
    assert.doesNotMatch(copiedInstructions, /wachtwoord/i);
    assert.doesNotMatch(copiedInstructions, /uitnodigingsticket/i);
  });

  it('keeps the complete text available and gives manual instructions when clipboard access is blocked', async () => {
    const displayedInstructions = buildRegistrationInstructions(
      'deelnemer@example.nl',
      'https://ledenchallenge.example/sign-up',
    );
    const blockedClipboard = {
      async writeText() {
        throw new Error('Clipboard access denied');
      },
    };
    let copyBlockedMessage = '';

    const copied = await copyRegistrationInstructions(
      displayedInstructions,
      blockedClipboard,
      () => {},
      () => {
        copyBlockedMessage = 'Selecteer de tekst hieronder en kopieer deze handmatig.';
      },
    );

    assert.equal(copied, false);
    assert.equal(
      copyBlockedMessage,
      'Selecteer de tekst hieronder en kopieer deze handmatig.',
    );
    assert.equal(
      displayedInstructions,
      buildRegistrationInstructions(
        'deelnemer@example.nl',
        'https://ledenchallenge.example/sign-up',
      ),
    );
    assert.match(displayedInstructions, /deelnemer@example\.nl/);
    assert.match(displayedInstructions, /https:\/\/ledenchallenge\.example\/sign-up/);
    assert.match(displayedInstructions, /Na het aanmelden vul je je huidige aantal actieve leden/);
  });

  it('confirms a successful copy without showing manual instructions', async () => {
    const displayedInstructions = buildRegistrationInstructions(
      'deelnemer@example.nl',
      'https://ledenchallenge.example/sign-up',
    );
    let copiedInstructions = '';
    let copySucceededMessage = '';
    let copyBlockedMessage = '';
    const acceptingClipboard = {
      async writeText(value: string) {
        copiedInstructions = value;
      },
    };

    const copied = await copyRegistrationInstructions(
      displayedInstructions,
      acceptingClipboard,
      () => {
        copySucceededMessage = 'Registratie-instructie gekopieerd';
      },
      () => {
        copyBlockedMessage = 'Selecteer de tekst hieronder en kopieer deze handmatig.';
      },
    );

    assert.equal(copied, true);
    assert.equal(copiedInstructions, displayedInstructions);
    assert.equal(copySucceededMessage, 'Registratie-instructie gekopieerd');
    assert.equal(copyBlockedMessage, '');
  });
});