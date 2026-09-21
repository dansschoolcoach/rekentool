import { createElement, type ReactNode } from 'react';

export type RegistrationParticipant = {
  id: number;
  email: string;
};

export function findRegistrationParticipant<T extends RegistrationParticipant>(
  participants: readonly T[],
  participantId: number | null,
): T | null {
  if (participantId === null) return null;
  return participants.find((participant) => participant.id === participantId) ?? null;
}

export function RegistrationInstructionsForParticipant<T extends RegistrationParticipant>({
  participants,
  participantId,
  children,
}: {
  participants: readonly T[];
  participantId: number | null;
  children: (participant: T) => ReactNode;
}) {
  const participant = findRegistrationParticipant(participants, participantId);
  return participant ? createElement('div', null, children(participant)) : null;
}

export function buildRegistrationInstructions(email: string, signUpUrl: string) {
  return `Welkom bij de ByB Ledenchallenge 2026!

Maak je account aan via:
${signUpUrl}

Gebruik bij het registreren exact dit e-mailadres:
${email}

Na het aanmelden vul je je huidige aantal actieve leden en je doel voor extra leden tijdens de challenge in.`;
}

export type RegistrationClipboard = {
  writeText(value: string): Promise<void>;
};

export async function copyRegistrationInstructions(
  instructions: string,
  clipboard: RegistrationClipboard,
  onCopySucceeded: () => void,
  onCopyBlocked: () => void,
) {
  try {
    await clipboard.writeText(instructions);
    onCopySucceeded();
    return true;
  } catch {
    onCopyBlocked();
    return false;
  }
}