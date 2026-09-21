import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError, type AdminFinancialFileSubmission, type Participant, type ParticipantImportPreview } from '@workspace/api-client-react';
import { getCreateParticipantUrl } from '@workspace/api-client-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminPage, AppShell } from './App';
import { ParticipantManagementFlow, participantEmailConflictMessage, participantVersionConflictMessage } from './participantManagement';
import { ParticipantRecoveryWarning } from './ParticipantRecoveryWarning';

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  createError: null as Error | null,
  createSuccess: null as Participant | null,
  updateError: null as Error | null,
  updateVariables: null as unknown,
  previewRequests: [] as Array<{
    file: File;
    onSuccess?: (preview: ParticipantImportPreview) => void;
  }>,
  confirmFile: null as File | null,
  financialSubmissions: [] as Array<Pick<AdminFinancialFileSubmission, 'status'> | AdminFinancialFileSubmission>,
  financialSubmissionsError: false,
  financialSubmissionUpdateError: null as Error | null,
}));

const existingParticipant = {
  id: 7,
  schoolName: 'Bestaande school',
  contactName: 'Bestaande beheerder',
  email: 'bestaand@example.test',
  startingMembers: null,
  targetNewMembers: null,
  country: 'Nederland',
  revision: 1,
  updatedAt: '2026-09-12T10:00:00.000Z',
  totals: { signups: 0, attendance: 0, enrolled: 0 },
  scores: { growthPercent: 0, conversionPercent: 0, attendancePercent: 0 },
} as Participant;
const participants = [existingParticipant];
const challenge = { startDate: '2026-09-14', endDate: '2026-10-11' };
const adminEntries: never[] = [];

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock('@clerk/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@clerk/react')>();
  return {
    ...actual,
    useUser: () => ({
      user: {
        firstName: 'Beheerder',
        publicMetadata: { role: 'admin' },
        primaryEmailAddress: { emailAddress: 'beheerder@example.test' },
      },
    }),
    useClerk: () => ({ signOut: vi.fn() }),
  };
});

vi.mock('@workspace/api-client-react', async (importOriginal) => {
  const React = await import('react');
  const actual = await importOriginal<typeof import('@workspace/api-client-react')>();
  const idleMutation = () => ({ isPending: false, error: null, mutate: vi.fn() });
  return {
    ...actual,
    useGetParticipants: () => ({ isLoading: false, isError: false, data: participants, refetch: vi.fn() }),
    useGetChallenge: () => ({ isLoading: false, isError: false, data: challenge, refetch: vi.fn() }),
    useGetParticipantRecoveryStatus: () => ({ isError: false, data: { overdueCount: 0, records: [] } }),
    getGetAdminFinancialFileSubmissionsQueryKey: () => ['financial-file-submissions'],
    useGetAdminFinancialFileSubmissions: () => {
      if (mocks.financialSubmissionsError) {
        return { isLoading: false, isError: true, data: undefined };
      }
      return useQuery({
        queryKey: ['financial-file-submissions'],
        queryFn: async () => mocks.financialSubmissions.map(submission => ({ ...submission })),
        initialData: () => mocks.financialSubmissions.map(submission => ({ ...submission })),
      });
    },
    useGetAdminFinancialSeasons: () => ({ isLoading: false, isError: false, data: [] }),
    usePreviewAdminFinancialTeachersImport: idleMutation,
    usePreviewAdminFinancialSubscriptionsImport: idleMutation,
    usePreviewAdminFinancialScheduleImport: idleMutation,
    useConfirmAdminFinancialTeachersImport: idleMutation,
    useConfirmAdminFinancialSubscriptionsImport: idleMutation,
    useConfirmAdminFinancialScheduleImport: idleMutation,
    useUpdateAdminFinancialFileSubmission: () => {
      const [error, setError] = React.useState<Error | null>(null);
      return {
        isPending: false,
        error,
        mutate: vi.fn((variables, options) => {
          if (mocks.financialSubmissionUpdateError) {
            setError(mocks.financialSubmissionUpdateError);
            options?.onError?.(mocks.financialSubmissionUpdateError);
            return;
          }
          const submission = mocks.financialSubmissions.find(item => 'id' in item && item.id === variables.submissionId);
          if (submission) submission.status = variables.data.status;
          options?.onSuccess?.();
        }),
      };
    },
    useGetAdminWeeklyEntries: () => ({ isLoading: false, isError: false, data: adminEntries, refetch: vi.fn() }),
    useDeleteParticipant: idleMutation,
    usePreviewParticipantImport: () => ({
      isPending: false,
      error: null,
      reset: vi.fn(),
      mutate: vi.fn((variables, options) => {
        mocks.previewRequests.push({
          file: variables.data.file,
          onSuccess: options?.onSuccess,
        });
      }),
    }),
    useConfirmParticipantImport: () => ({
      isPending: false,
      error: null,
      reset: vi.fn(),
      mutate: vi.fn((variables) => {
        mocks.confirmFile = variables.data.file;
      }),
    }),
    useUpdateChallenge: idleMutation,
    useUpdateAdminWeeklyEntry: idleMutation,
    useCreateParticipant: () => {
      const [error, setError] = React.useState<Error | null>(null);
      return {
        isPending: false,
        error,
        mutate: vi.fn((_variables, options) => {
          if (mocks.createError) {
            setError(mocks.createError);
            options?.onError?.(mocks.createError);
            return;
          }
          if (mocks.createSuccess) options?.onSuccess?.(mocks.createSuccess);
        }),
      };
    },
    useUpdateParticipant: () => {
      const [error, setError] = React.useState<Error | null>(null);
      return {
        isPending: false,
        error,
        mutate: vi.fn((variables, options) => {
          mocks.updateVariables = variables;
          if (mocks.updateError) {
            setError(mocks.updateError);
            options?.onError?.(mocks.updateError);
          }
        }),
      };
    },
  };
});

function apiError(status: number, data: object = { error: participantEmailConflictMessage }) {
  return new ApiError(
    new Response(JSON.stringify(data), { status }),
    data,
    { method: 'POST', url: '/admin/participants' },
  );
}

function participantManagement(participantList: Participant[], onParticipantCreated = vi.fn()) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <ParticipantManagementFlow
        participants={participantList}
        onOpenRegistration={vi.fn()}
        onOpenCoaching={vi.fn()}
        onParticipantCreated={onParticipantCreated}
      />
    </QueryClientProvider>
  );
}

function renderParticipantManagement(onParticipantCreated = vi.fn()) {
  return render(
    participantManagement(participants, onParticipantCreated),
  );
}

beforeEach(() => {
  mocks.toast.mockReset();
  mocks.createError = null;
  mocks.createSuccess = null;
  mocks.updateError = null;
  mocks.updateVariables = null;
  mocks.previewRequests = [];
  mocks.confirmFile = null;
  mocks.financialSubmissions = [];
  mocks.financialSubmissionsError = false;
  mocks.financialSubmissionUpdateError = null;
});

describe('gelijktijdige profielwijzigingen in Beheer', () => {
  it('bewaart de openingsrevisie en toont na 409 de actuele waarden', async () => {
    const user = userEvent.setup();
    const currentParticipant = {
      ...existingParticipant,
      contactName: 'Andere beheerder',
      email: 'actueel@example.test',
      revision: 2,
      updatedAt: '2026-09-12T10:01:00.000Z',
    };
    mocks.updateError = apiError(409, {
      error: 'Deze deelnemer is intussen gewijzigd.',
      currentParticipant,
    });
    const view = render(participantManagement(participants));

    await user.click(screen.getByTestId(`button-edit-participant-${existingParticipant.id}`));
    const contactName = screen.getByTestId('input-participant-contact-name') as HTMLInputElement;
    await user.clear(contactName);
    await user.type(contactName, 'Mijn lokale wijziging');

    view.rerender(participantManagement([currentParticipant]));
    expect(contactName.value).toBe('Mijn lokale wijziging');

    await user.click(screen.getByTestId('button-save-participant'));

    expect(mocks.updateVariables).toEqual(expect.objectContaining({
      id: existingParticipant.id,
      data: expect.objectContaining({
        contactName: 'Mijn lokale wijziging',
        revision: 1,
      }),
    }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      description: participantVersionConflictMessage,
      variant: 'destructive',
    })));
    expect((screen.getByTestId('input-participant-contact-name') as HTMLInputElement).value).toBe('Andere beheerder');
    expect((screen.getByTestId('input-participant-email') as HTMLInputElement).value).toBe('actueel@example.test');
    expect(screen.getByTestId('form-participant-modal')).toBeTruthy();
  });
});

afterEach(cleanup);

describe('beheernavigatie', () => {
  const routes = [
    ['/beheer', 'overzicht'],
    ['/beheer/challenge', 'challenge'],
    ['/beheer/deelnemers', 'deelnemers'],
    ['/beheer/excelbestanden', 'excelbestanden'],
    ['/beheer/financien', 'financiën'],
    ['/beheer/deelnemer/7', 'deelnemers'],
    ['/beheer/financien/2026-09', 'financiën'],
  ] as const;

  it.each(routes)('markeert bij %s het juiste menuonderdeel', (route, activeItem) => {
    window.history.pushState({}, '', route);
    render(<AppShell><div>Beheerinhoud</div></AppShell>);

    const links = screen.getAllByTestId(/^link-nav-beheer-/);
    expect(links).toHaveLength(5);
    expect(screen.getByTestId(`link-nav-beheer-${activeItem}`).getAttribute('aria-current')).toBe('page');
    expect(links.filter((link) => link.getAttribute('aria-current') === 'page')).toHaveLength(1);
  });

  it.each([
    ['overzicht', '/beheer'],
    ['challenge', '/beheer/challenge'],
    ['deelnemers', '/beheer/deelnemers'],
    ['excelbestanden', '/beheer/excelbestanden'],
    ['financiën', '/beheer/financien'],
  ] as const)('houdt %s mobiel bereikbaar en sluit het menu na de keuze', async (item, route) => {
    window.history.pushState({}, '', '/beheer');
    const user = userEvent.setup();
    render(<AppShell><div>Beheerinhoud</div></AppShell>);

    await user.click(screen.getByTestId('button-open-mobile-nav'));
    const openSidebarClasses = screen.getByTestId('app-sidebar').className.split(/\s+/);
    expect(openSidebarClasses).toContain('translate-x-0');
    expect(openSidebarClasses).not.toContain('-translate-x-full');
    expect(screen.getByTestId('button-close-mobile-nav')).toBeTruthy();

    await user.click(screen.getByTestId(`link-nav-beheer-${item}`));

    expect(window.location.pathname).toBe(route);
    const closedSidebarClasses = screen.getByTestId('app-sidebar').className.split(/\s+/);
    expect(closedSidebarClasses).toContain('-translate-x-full');
    expect(closedSidebarClasses).not.toContain('translate-x-0');
    expect(screen.queryByTestId('button-close-mobile-nav')).toBeNull();
  });
});

describe('openstaande financiële bestanden op het beheeroverzicht', () => {
  function renderAdminOverview() {
    window.history.pushState({}, '', '/beheer');
    return render(
      <QueryClientProvider client={new QueryClient()}>
        <AdminPage />
      </QueryClientProvider>,
    );
  }

  it('telt alle nog niet verwerkte inzendingen en linkt naar Excelbestanden', () => {
    mocks.financialSubmissions = [
      { status: 'open' },
      { status: 'in_progress' },
      { status: 'processed' },
    ];

    renderAdminOverview();

    const card = screen.getByTestId('card-open-financial-files');
    expect(card.textContent).toContain('2');
    expect(card.textContent).toContain('financiële bestanden wachten op behandeling');
    expect(card.getAttribute('href')).toBe('/beheer/excelbestanden');
  });

  it('blijft bruikbaar als de inzendingen niet kunnen worden opgehaald', () => {
    mocks.financialSubmissionsError = true;

    renderAdminOverview();

    expect(screen.getByText('Overzicht')).toBeTruthy();
    expect(screen.getByText('deelnemende scholen')).toBeTruthy();
    expect(screen.getByText('profielen vragen aandacht')).toBeTruthy();
    expect(screen.queryByTestId('card-open-financial-files')).toBeNull();
  });

  it('werkt de wachtrijtelling direct bij na verwerking via Excelbestanden', async () => {
    mocks.financialSubmissions = [{
      id: 31,
      participantId: 7,
      schoolName: 'Bestaande school',
      seasonId: 22,
      seasonName: '2026/2027',
      fileType: 'teachers',
      filename: 'docenten.xlsx',
      sizeBytes: 1024,
      submittedAt: '2026-09-20T10:00:00.000Z',
      downloadUrl: '/docenten.xlsx',
      status: 'open',
      statusChangedAt: null,
      statusChangedBy: null,
      notificationAttemptedAt: null,
      notificationSentAt: null,
      notificationError: null,
    }];
    const user = userEvent.setup();
    const queryClient = new QueryClient();
    window.history.pushState({}, '', '/beheer');
    render(
      <QueryClientProvider client={queryClient}>
        <AdminPage />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('card-open-financial-files').textContent).toContain('1');
    await user.click(screen.getByTestId('card-open-financial-files'));
    await user.selectOptions(screen.getByLabelText('Status van docenten.xlsx'), 'processed');
    await waitFor(() => expect(screen.getByText('Er zijn geen openstaande aanleveringen.')).toBeTruthy());

    act(() => {
      window.history.pushState({}, '', '/beheer');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    await waitFor(() => expect(screen.getByTestId('card-open-financial-files').textContent).toContain('0'));
    expect(window.location.pathname).toBe('/beheer');
  });

  it('houdt de wachtrijtelling gelijk als verwerken wordt afgewezen', async () => {
    mocks.financialSubmissions = [{
      id: 31,
      participantId: 7,
      schoolName: 'Bestaande school',
      seasonId: 22,
      seasonName: '2026/2027',
      fileType: 'teachers',
      filename: 'docenten.xlsx',
      sizeBytes: 1024,
      submittedAt: '2026-09-20T10:00:00.000Z',
      downloadUrl: '/docenten.xlsx',
      status: 'open',
      statusChangedAt: null,
      statusChangedBy: null,
      notificationAttemptedAt: null,
      notificationSentAt: null,
      notificationError: null,
    }];
    mocks.financialSubmissionUpdateError = apiError(500, {
      error: 'De status kon niet worden gewijzigd.',
    });
    const user = userEvent.setup();
    const queryClient = new QueryClient();
    window.history.pushState({}, '', '/beheer');
    render(
      <QueryClientProvider client={queryClient}>
        <AdminPage />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('card-open-financial-files').textContent).toContain('1');
    await user.click(screen.getByTestId('card-open-financial-files'));
    await user.selectOptions(screen.getByLabelText('Status van docenten.xlsx'), 'processed');

    expect((await screen.findByRole('alert')).textContent).toContain('De status kon niet worden gewijzigd.');
    expect(window.location.pathname).toBe('/beheer/excelbestanden');

    act(() => {
      window.history.pushState({}, '', '/beheer');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    await waitFor(() => expect(screen.getByTestId('card-open-financial-files').textContent).toContain('1'));
    expect(window.location.pathname).toBe('/beheer');
  });
});

describe('bestandswissel tijdens importcontrole', () => {
  it('negeert een late preview van bestand A en houdt de geldige preview van bestand B importeerbaar', async () => {
    const user = userEvent.setup();
    const fileA = new File(['bestand-a'], 'bestand-a.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const fileB = new File(['bestand-b'], 'bestand-b.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const previewA = {
      valid: true,
      rows: [{
        row: 2,
        schoolName: 'School A',
        contactName: 'Contact A',
        email: 'a@example.test',
        country: 'Nederland',
      }],
      issues: [],
    } as ParticipantImportPreview;
    const previewB = {
      valid: true,
      rows: [{
        row: 2,
        schoolName: 'School B',
        contactName: 'Contact B',
        email: 'b@example.test',
        country: 'België',
      }],
      issues: [],
    } as ParticipantImportPreview;
    renderParticipantManagement();

    const input = screen.getByTestId('input-participant-import');
    await user.upload(input, fileA);
    await user.click(screen.getByTestId('button-preview-participant-import'));
    expect(mocks.previewRequests).toHaveLength(1);

    await user.upload(input, fileB);
    expect(screen.getByText('bestand-b.xlsx')).toBeTruthy();

    await user.click(screen.getByTestId('button-preview-participant-import'));
    expect(mocks.previewRequests).toHaveLength(2);
    await act(async () => {
      mocks.previewRequests[1]?.onSuccess?.(previewB);
    });

    expect(screen.getByText('School B')).toBeTruthy();
    expect(screen.getByTestId('button-confirm-participant-import').textContent).toContain('1 deelnemers importeren');

    await act(async () => {
      mocks.previewRequests[0]?.onSuccess?.(previewA);
    });

    expect(screen.getByText('School B')).toBeTruthy();
    expect(screen.queryByText('School A')).toBeNull();
    expect(screen.getByTestId('button-confirm-participant-import').textContent).toContain('1 deelnemers importeren');

    await user.click(screen.getByTestId('button-confirm-participant-import'));
    expect(mocks.confirmFile).toBe(fileB);
  });
});

describe('openstaand accountherstel in Beheer', () => {
  it('behoudt de bestaande route voor het aanmaken van deelnemers', () => {
    expect(getCreateParticipantUrl()).toBe('/api/admin/participants');
  });

  it('toont alleen interne recordcontext en wachttijd voor te oude herstelrecords', () => {
    render(<ParticipantRecoveryWarning status={{
      overdueCount: 1,
      records: [{ releaseId: 31, participantId: 7, waitingMinutes: 22 }],
    }} />);

    expect(screen.getByTestId('participant-recovery-warning').textContent).toContain('1 accountherstel wacht te lang');
    expect(screen.getByTestId('participant-recovery-warning').textContent).toContain('Herstelrecord 31 · deelnemer 7 · 22 minuten wachtend');
    expect(screen.getByTestId('participant-recovery-warning').textContent).not.toContain('@');
    expect(screen.getByTestId('participant-recovery-warning').textContent).not.toContain('clerk');
  });

  it('verdwijnt zodra er geen te oude herstelrecords meer zijn', () => {
    const view = render(<ParticipantRecoveryWarning status={{
      overdueCount: 1,
      records: [{ releaseId: 31, participantId: 7, waitingMinutes: 22 }],
    }} />);

    view.rerender(<ParticipantRecoveryWarning status={{ overdueCount: 0, records: [] }} />);
    expect(screen.queryByTestId('participant-recovery-warning')).toBeNull();
  });

  it('meldt een mislukte statuscontrole zonder deelnemers- of accountgegevens te tonen', () => {
    render(<ParticipantRecoveryWarning
      status={{
        overdueCount: 1,
        records: [{ releaseId: 31, participantId: 7, waitingMinutes: 22 }],
      }}
      statusUnavailable
    />);

    const message = screen.getByTestId('participant-recovery-status-error');
    expect(message.textContent).toContain('Herstelstatus tijdelijk niet beschikbaar');
    expect(message.textContent).toContain('automatisch opnieuw gecontroleerd');
    expect(message.textContent).not.toContain('31');
    expect(message.textContent).not.toContain('7');
    expect(message.textContent).not.toContain('@');
    expect(message.textContent?.toLowerCase()).not.toContain('clerk');
    expect(screen.queryByTestId('participant-recovery-warning')).toBeNull();
  });
});

describe('dubbele e-mailmelding in Beheer', () => {
  it('toont bij aanmaken alleen voor 409 de conflictmelding en behoudt de invoer', async () => {
    const user = userEvent.setup();
    mocks.createError = apiError(409);
    renderParticipantManagement();

    await user.click(screen.getByTestId('button-add-participant'));
    await user.type(screen.getByTestId('input-participant-school-name'), 'Nieuwe school');
    await user.type(screen.getByTestId('input-participant-contact-name'), 'Nieuwe beheerder');
    await user.type(screen.getByTestId('input-participant-email'), 'BESTAAND@EXAMPLE.TEST');
    await user.click(screen.getByTestId('button-save-participant'));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      description: participantEmailConflictMessage,
      variant: 'destructive',
    })));
    expect(mocks.toast).toHaveBeenCalledTimes(1);
    expect((screen.getByTestId('input-participant-school-name') as HTMLInputElement).value).toBe('Nieuwe school');
    expect((screen.getByTestId('input-participant-contact-name') as HTMLInputElement).value).toBe('Nieuwe beheerder');
    expect((screen.getByTestId('input-participant-email') as HTMLInputElement).value).toBe('BESTAAND@EXAMPLE.TEST');
    expect((screen.getByTestId('button-save-participant') as HTMLButtonElement).disabled).toBe(false);
  });

  it('toont bij wijzigen alleen voor 409 de conflictmelding en behoudt de invoer', async () => {
    const user = userEvent.setup();
    mocks.updateError = apiError(409);
    renderParticipantManagement();

    await user.click(screen.getByTestId(`button-edit-participant-${existingParticipant.id}`));
    const contactName = screen.getByTestId('input-participant-contact-name') as HTMLInputElement;
    const email = screen.getByTestId('input-participant-email') as HTMLInputElement;
    await user.clear(contactName);
    await user.type(contactName, 'Gewijzigde beheerder');
    await user.clear(email);
    await user.type(email, 'BESTAAND@EXAMPLE.TEST');
    await user.click(screen.getByTestId('button-save-participant'));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      description: participantEmailConflictMessage,
      variant: 'destructive',
    })));
    expect(mocks.toast).toHaveBeenCalledTimes(1);
    expect(contactName.value).toBe('Gewijzigde beheerder');
    expect(email.value).toBe('BESTAAND@EXAMPLE.TEST');
    expect((screen.getByTestId('button-save-participant') as HTMLButtonElement).disabled).toBe(false);
  });

  it('houdt een niet-conflictfout algemeen', async () => {
    const user = userEvent.setup();
    mocks.createError = apiError(500);
    renderParticipantManagement();

    await user.click(screen.getByTestId('button-add-participant'));
    await user.type(screen.getByTestId('input-participant-school-name'), 'Nieuwe school');
    await user.type(screen.getByTestId('input-participant-contact-name'), 'Beheerder');
    await user.type(screen.getByTestId('input-participant-email'), 'nieuw@example.test');
    await user.click(screen.getByTestId('button-save-participant'));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      description: 'Controleer de gegevens en probeer het opnieuw.',
    })));
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({
      description: participantEmailConflictMessage,
    }));
    expect(mocks.toast).toHaveBeenCalledTimes(1);
  });

  it('sluit na succesvol toevoegen het formulier en meldt het resultaat aan de beheerpagina', async () => {
    const user = userEvent.setup();
    const onParticipantCreated = vi.fn();
    mocks.createSuccess = {
      ...existingParticipant,
      id: 8,
      schoolName: 'Nieuwe school',
      contactName: 'Nieuwe beheerder',
      email: 'nieuw@example.test',
    };
    renderParticipantManagement(onParticipantCreated);

    await user.click(screen.getByTestId('button-add-participant'));
    await user.type(screen.getByTestId('input-participant-school-name'), 'Nieuwe school');
    await user.type(screen.getByTestId('input-participant-contact-name'), 'Nieuwe beheerder');
    await user.type(screen.getByTestId('input-participant-email'), 'nieuw@example.test');
    await user.click(screen.getByTestId('button-save-participant'));

    await waitFor(() => expect(screen.queryByTestId('form-participant-modal')).toBeNull());
    expect(onParticipantCreated).toHaveBeenCalledWith(mocks.createSuccess);
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Deelnemer toegevoegd',
    }));
  });
});