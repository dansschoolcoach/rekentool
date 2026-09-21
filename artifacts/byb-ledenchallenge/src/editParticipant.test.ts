import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { findEditableParticipant } from './editParticipant.ts';

describe('editing an existing participant', () => {
  it('removes the form and save action after the participant is removed', () => {
    const editingParticipantId = 12;
    const renderEditor = (participants: Array<{ id: number; schoolName: string }>) => {
      const participant = findEditableParticipant(participants, editingParticipantId);
      if (!participant) return '';
      return renderToStaticMarkup(
        createElement(
          'form',
          { 'data-testid': 'form-participant-modal' },
          createElement('h2', null, participant.schoolName),
          createElement(
            'button',
            { type: 'submit', 'data-testid': 'button-save-participant' },
            'Opslaan',
          ),
        ),
      );
    };

    const openedEditor = renderEditor([
      { id: editingParticipantId, schoolName: 'Verwijderde dansschool' },
    ]);
    assert.match(openedEditor, /form-participant-modal/);
    assert.match(openedEditor, /button-save-participant/);

    const editorAfterRemoval = renderEditor([]);
    assert.equal(editorAfterRemoval, '');
    assert.doesNotMatch(editorAfterRemoval, /form-participant-modal/);
    assert.doesNotMatch(editorAfterRemoval, /button-save-participant/);
    assert.doesNotMatch(editorAfterRemoval, /Verwijderde dansschool/);
  });
});