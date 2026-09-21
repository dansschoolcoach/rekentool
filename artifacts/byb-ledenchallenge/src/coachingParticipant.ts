import { createElement, type ReactNode } from 'react';

export type CoachingParticipant = {
  id: number;
};

export function findCoachingParticipant<T extends CoachingParticipant>(
  participants: readonly T[],
  participantId: number | null,
): T | null {
  if (participantId === null) return null;
  return participants.find((participant) => participant.id === participantId) ?? null;
}

export function CoachingForParticipant<T extends CoachingParticipant>({
  participants,
  participantId,
  children,
}: {
  participants: readonly T[];
  participantId: number | null;
  children: (participant: T) => ReactNode;
}) {
  const participant = findCoachingParticipant(participants, participantId);
  return participant ? createElement('div', null, children(participant)) : null;
}