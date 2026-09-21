import type { ReactNode } from 'react';

export function ClerkProvider({ children }: { children: ReactNode }) {
  return children;
}

export function SignIn() {
  return null;
}

export function SignUp() {
  return null;
}

export function useAuth() {
  return { isLoaded: true, isSignedIn: true, userId: 'contrast-test-user' };
}

export function useClerk() {
  return { signOut: async () => undefined };
}

export function useUser() {
  return {
    user: {
      firstName: 'Contrast',
      publicMetadata: { role: 'participant' },
      primaryEmailAddress: { emailAddress: 'contrast@example.test' },
    },
  };
}

export function publishableKeyFromHost() {
  return 'pk_test_route_protection';
}