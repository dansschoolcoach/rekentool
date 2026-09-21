export type EditableParticipant = {
  id: number;
};

export function findEditableParticipant<T extends EditableParticipant>(
  participants: readonly T[],
  participantId: number | null,
): T | null {
  if (participantId === null) return null;
  return participants.find((participant) => participant.id === participantId) ?? null;
}