import { useMutation, useQuery } from '@tanstack/react-query';

const seasons = [
  { id: 2, name: '2026/2027', startDate: '2026-09-01', endDate: '2027-07-01' },
];

const monthDetail = {
  month: '2026-09-01',
  isSaved: true,
  updatedAt: '2026-09-10T12:00:00.000Z',
  contributionRevenue: 1200,
  taxArrears: 0,
  salaryOverride: null,
  revenue: 1111,
  costs: 222,
  grossProfit: 889,
  taxReserve: 100,
  netProfit: 789,
  salary: 500,
  bankBalance: 3500,
  fixedCosts: [{ group: 'Marketing', description: 'Campagne', frequency: 'monthly', amount: 125 }],
  previousMonth: null,
  previousMonthFixedCosts: [],
  activities: [{ name: 'Workshop', amount: 250 }],
  lessonInputs: [],
  lessonProfitability: [],
  cumulative: null,
};

const seasonDetail = {
  ...seasons[0],
  country: 'Nederland',
  hasStarterDeduction: false,
  defaultSalary: 500,
  teachers: [],
  locations: [],
  subscriptions: [],
  lessons: [],
  closures: [],
  months: [monthDetail],
  costTrends: [],
  lessonSeasonForecast: {
    months: [],
    lessons: [],
    locationRentBreakdowns: [],
    unallocatedLocations: [],
    overallocatedLocations: [],
  },
};

const taxYearSummary = {
  calculationVersion: '2026',
  preliminaryPayments: 0,
  coveredMonths: [],
  missingMonths: [],
  hasCountryConflict: false,
  isComplete: true,
  grossProfit: 889,
  estimatedTax: 100,
  effectiveReservePercentage: 11.2,
  extraToSave: 0,
  updatedAt: null,
};

type ProfilePreferences = { masterDataRoute: 'manual' | 'excel' | null };
const profilePreferences: ProfilePreferences = { masterDataRoute: null };
const idleMutation = { isPending: false, mutate: () => undefined, mutateAsync: async () => undefined };

export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(response: Response, data: unknown) {
    super(`HTTP ${response.status}`);
    this.status = response.status;
    this.data = data;
  }
}

export const ParticipantCountry = { Nederland: 'Nederland', België: 'België' } as const;
export type ParticipantCountry = (typeof ParticipantCountry)[keyof typeof ParticipantCountry];
export const getGetChallengeQueryKey = () => ['challenge'];
export const getGetDashboardQueryKey = () => ['dashboard'];
export const getGetParticipantsQueryKey = () => ['participants'];
export const getGetWeeklyEntriesQueryKey = () => ['weekly-entries'];
export const getGetAdminWeeklyEntriesQueryKey = () => ['admin-weekly-entries'];
export const getGetLeaderboardQueryKey = () => ['leaderboard'];
export const getGetParticipantRecoveryStatusQueryKey = () => ['participant-recovery-status'];
export const getGetAdminFinancialFileSubmissionsQueryKey = () => ['admin-financial-file-submissions'];
export const getGetMessagesQueryKey = () => ['messages'];
export const getGetAdminParticipantMessagesQueryKey = (participantId: number) => ['admin-participant-messages', participantId];
export const getGetAdminParticipantViewQueryKey = (participantId: number) => ['admin-participant-view', participantId];

const emptyQuery = () => ({ isLoading: false, isError: false, data: [] });

export const getGetFinancialMonthQueryKey = (seasonId: number, month: string) => ['financial-month', seasonId, month];
export const getGetFinancialSeasonQueryKey = (seasonId: number) => ['financial-season', seasonId];
export const getGetFinancialSeasonsQueryKey = () => ['financial-seasons'];
export const getGetFinancialFileSubmissionsQueryKey = (seasonId: number) => ['financial-file-submissions', seasonId];
export const getGetFinancialTaxYearQueryKey = (calendarYear: number) => ['financial-tax-year', calendarYear];
export const getGetProfilePreferencesQueryKey = () => ['profile-preferences'];
export const getGetAdminFinancialSeasonsQueryKey = (participantId: number) => ['admin-financial-seasons', participantId];
export const getGetAdminFinancialSeasonQueryKey = (participantId: number, seasonId: number) => ['admin-financial-season', participantId, seasonId];
export const getGetAdminFinancialMonthQueryKey = (participantId: number, seasonId: number, month: string) => ['admin-financial-month', participantId, seasonId, month];
export const getGetAdminFinancialTaxYearQueryKey = (participantId: number, calendarYear: number) => ['admin-financial-tax-year', participantId, calendarYear];

export const useGetDashboard = (options?: { query?: Record<string, unknown> }) => {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const response = await fetch('/api/dashboard');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    },
    retry: false,
    ...(options?.query ?? {}),
  });
};
export const useGetMessages = () => ({ isLoading: false, isError: false, data: [] });
export const useGetChallenge = emptyQuery;
export const useGetLeaderboard = emptyQuery;
export const useGetParticipants = emptyQuery;
export const useGetWeeks = emptyQuery;
export const useGetWeeklyEntries = emptyQuery;
export const useGetAdminWeeklyEntries = emptyQuery;
export const useGetParticipantRecoveryStatus = emptyQuery;
export const useGetAdminFinancialFileSubmissions = emptyQuery;
export const useGetAdminParticipantMessages = emptyQuery;
export const useGetAdminParticipantView = emptyQuery;
export const useCreateParticipant = () => idleMutation;
export const useDeleteParticipant = () => idleMutation;
export const useUpdateChallenge = () => idleMutation;
export const useUpdateParticipant = () => idleMutation;
export const useUpsertWeeklyEntry = () => idleMutation;
export const useUpdateAdminWeeklyEntry = () => idleMutation;
export const useUpdateProfile = () => useMutation({
  mutationFn: async ({ data }: { data: Record<string, unknown> }) => {
    const response = await fetch('/api/profile/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  },
});
export const useCreateParticipantMessage = () => idleMutation;
export const useSendParticipantReminder = () => idleMutation;
export const useUpdateAdminParticipantProfile = () => idleMutation;
export const useUpsertAdminParticipantWeeklyEntry = () => idleMutation;
export const useConfirmAdminFinancialScheduleImport = () => idleMutation;
export const useConfirmAdminFinancialSubscriptionsImport = () => idleMutation;
export const useConfirmAdminFinancialTeachersImport = () => idleMutation;
export const usePreviewAdminFinancialScheduleImport = () => idleMutation;
export const usePreviewAdminFinancialSubscriptionsImport = () => idleMutation;
export const usePreviewAdminFinancialTeachersImport = () => idleMutation;
export const useUpdateAdminFinancialFileSubmission = () => idleMutation;
export const useConfirmParticipantImport = () => idleMutation;
export const usePreviewParticipantImport = () => idleMutation;
export const useGetProfilePreferences = () => ({ isLoading: false, isError: false, isSuccess: true, data: profilePreferences });
export const useUpdateProfilePreferences = (options?: { mutation?: { onSuccess?: (saved: typeof profilePreferences) => void } }) => ({
  isPending: false,
  mutate: (
    { data }: { data: { masterDataRoute: 'manual' | 'excel' } },
    callbacks?: { onSuccess?: () => void },
  ) => {
    const saved = { ...profilePreferences, ...data };
    options?.mutation?.onSuccess?.(saved);
    callbacks?.onSuccess?.();
  },
});
export const useGetFinancialSeasons = () => ({ isLoading: false, isError: false, data: seasons });
export const useGetAdminFinancialSeasons = useGetFinancialSeasons;
export const useGetFinancialSeason = () => ({ isLoading: false, isError: false, data: seasonDetail });
export const useGetAdminFinancialSeason = useGetFinancialSeason;
export const useGetFinancialMonth = () => ({ isLoading: false, isError: false, data: monthDetail });
export const useGetAdminFinancialMonth = useGetFinancialMonth;
export const useGetFinancialTaxYear = () => ({ isLoading: false, isError: false, data: taxYearSummary });
export const useGetAdminFinancialTaxYear = useGetFinancialTaxYear;
export const useGetFinancialFileSubmissions = () => ({ isLoading: false, isError: false, data: [] });
export const useCreateFinancialSeason = () => idleMutation;
export const useUpdateFinancialSeason = () => idleMutation;
export const useCreateAdminFinancialSeason = () => idleMutation;
export const useUpdateAdminFinancialSeason = () => idleMutation;
export const useUpsertFinancialMonth = () => idleMutation;
export const useUpsertAdminFinancialMonth = () => idleMutation;
export const useUpdateFinancialTaxYear = () => idleMutation;
export const useUpdateAdminFinancialTaxYear = () => idleMutation;
export const useRequestFinancialFileSubmissionUpload = () => idleMutation;
export const useCreateFinancialFileSubmission = () => idleMutation;

export type FinancialSeason = typeof seasons[number];
export type FinancialMonthInput = Record<string, unknown>;
export type FinancialMonthDetail = typeof monthDetail;
export type FinancialSeasonDetail = typeof seasonDetail;
export type FinancialTaxYearSummary = typeof taxYearSummary;
export type FinancialSeasonInput = Record<string, unknown>;
export type FinancialSeasonCountry = 'Nederland' | 'België';
export type FinancialLessonInput = any;
export type FinancialTeacherInput = any;
export type FinancialLocationInput = any;
export type FinancialSubscriptionInput = any;
export type FinancialClosureInput = any;