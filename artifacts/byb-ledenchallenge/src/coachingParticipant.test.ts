import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CoachingForParticipant } from './coachingParticipant.ts';

describe('coaching for an existing participant', () => {
  it('removes the panel and its actions after the participant is removed', () => {
    const selectedParticipantId = 12;
    const renderCoaching = (participants: Array<{ id: number; schoolName: string }>) =>
      renderToStaticMarkup(
        createElement(
          CoachingForParticipant,
          {
            participants,
            participantId: selectedParticipantId,
            children: (participant: { id: number; schoolName: string }) =>
              createElement(
                'div',
                { role: 'dialog' },
                createElement('h2', null, participant.schoolName),
                createElement(
                  'button',
                  { 'data-testid': 'button-send-reminder' },
                  'Stuur herinnering',
                ),
                createElement(
                  'button',
                  { 'data-testid': 'button-post-message' },
                  'Bericht plaatsen',
                ),
              ),
          },
        ),
      );

    const openedCoaching = renderCoaching([
      { id: selectedParticipantId, schoolName: 'Verwijderde dansschool' },
    ]);
    assert.match(openedCoaching, /role="dialog"/);
    assert.match(openedCoaching, /button-send-reminder/);
    assert.match(openedCoaching, /button-post-message/);

    const coachingAfterRemoval = renderCoaching([]);
    assert.equal(coachingAfterRemoval, '');
    assert.doesNotMatch(coachingAfterRemoval, /role="dialog"/);
    assert.doesNotMatch(coachingAfterRemoval, /button-send-reminder/);
    assert.doesNotMatch(coachingAfterRemoval, /button-post-message/);
    assert.doesNotMatch(coachingAfterRemoval, /Verwijderde dansschool/);
  });
});