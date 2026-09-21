import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AdminFinancialFileSubmission } from "@workspace/api-client-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminFinancialImports } from "./AdminFinancialImports";

const { previewMutate, confirmMutate, updateSubmissionMutate, submissionRows } = vi.hoisted(() => ({
  previewMutate: vi.fn(),
  confirmMutate: vi.fn(),
  updateSubmissionMutate: vi.fn(),
  submissionRows: [] as AdminFinancialFileSubmission[],
}));

vi.mock("@workspace/api-client-react", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    data: unknown;

    constructor(message: string, status = 500, data: unknown = null) {
      super(message);
      this.status = status;
      this.data = data;
    }
  },
  getGetAdminFinancialSeasonQueryKey: (participantId: number, seasonId: number) => ["season", participantId, seasonId],
  getGetAdminFinancialSeasonsQueryKey: (participantId: number) => ["seasons", participantId],
  getGetAdminFinancialFileSubmissionsQueryKey: () => ["financial-file-submissions"],
  useGetAdminFinancialFileSubmissions: () => ({
    isLoading: false,
    isError: false,
    data: submissionRows,
  }),
  useGetAdminFinancialSeasons: () => ({
    isLoading: false,
    isError: false,
    data: [{ id: 22, name: "2026/2027", updatedAt: "2026-08-01T00:00:00.000Z" }],
  }),
  usePreviewAdminFinancialTeachersImport: () => ({ isPending: false, mutate: previewMutate }),
  usePreviewAdminFinancialSubscriptionsImport: () => ({ isPending: false, mutate: previewMutate }),
  usePreviewAdminFinancialScheduleImport: () => ({ isPending: false, mutate: previewMutate }),
  useConfirmAdminFinancialTeachersImport: () => ({ isPending: false, mutate: confirmMutate }),
  useConfirmAdminFinancialSubscriptionsImport: () => ({ isPending: false, mutate: confirmMutate }),
  useConfirmAdminFinancialScheduleImport: () => ({ isPending: false, mutate: confirmMutate }),
  useUpdateAdminFinancialFileSubmission: () => ({ isPending: false, mutate: updateSubmissionMutate }),
}));

const participants = [
  { id: 7, schoolName: "Dansschool Noord", contactName: "Nina", email: "nina@example.test", country: "Nederland" },
] as any;

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AdminFinancialImports participants={participants} />
    </QueryClientProvider>,
  );
}

describe("admin financial imports", () => {
  beforeEach(() => {
    previewMutate.mockReset();
    confirmMutate.mockReset();
    updateSubmissionMutate.mockReset();
    submissionRows.length = 0;
  });

  afterEach(cleanup);

  it("requires school and season before showing either isolated upload", async () => {
    renderPage();
    expect(screen.queryByTestId("card-import-teachers")).toBeNull();
    await userEvent.setup().selectOptions(screen.getByTestId("select-import-school"), "7");
    expect(screen.getByTestId("select-import-season")).toBeTruthy();
    expect(screen.queryByTestId("card-import-teachers")).toBeNull();
    await userEvent.setup().selectOptions(screen.getByTestId("select-import-season"), "22");
    expect(screen.getByTestId("card-import-teachers")).toBeTruthy();
    expect(screen.getByTestId("card-import-subscriptions")).toBeTruthy();
  });

  it("filters processed submissions and changes status without starting an import", async () => {
    submissionRows.push(
      {
        id: 1,
        participantId: 7,
        schoolName: "Dansschool Noord",
        seasonId: 22,
        seasonName: "2026/2027",
        fileType: "teachers",
        filename: "open.xlsx",
        sizeBytes: 1024,
        submittedAt: "2026-09-01T10:00:00.000Z",
        downloadUrl: "/open",
        status: "open",
        statusChangedAt: null,
        statusChangedBy: null,
        notificationAttemptedAt: null,
        notificationSentAt: null,
        notificationError: null,
      },
      {
        id: 2,
        participantId: 7,
        schoolName: "Dansschool Noord",
        seasonId: 22,
        seasonName: "2026/2027",
        fileType: "subscriptions",
        filename: "klaar.xlsx",
        sizeBytes: 2048,
        submittedAt: "2026-09-01T11:00:00.000Z",
        downloadUrl: "/klaar",
        status: "processed",
        statusChangedAt: "2026-09-02T12:30:00.000Z",
        statusChangedBy: "Ninny Beheer",
        notificationAttemptedAt: "2026-09-02T12:30:00.000Z",
        notificationSentAt: "2026-09-02T12:30:01.000Z",
        notificationError: null,
      },
    );
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByText("open.xlsx")).toBeTruthy();
    expect(screen.queryByText("klaar.xlsx")).toBeNull();
    await user.selectOptions(screen.getByTestId("select-submission-filter"), "all");
    expect(screen.getByText("klaar.xlsx")).toBeTruthy();
    expect(screen.getByText("Ninny Beheer")).toBeTruthy();
    expect(screen.getByText("Nog niet gewijzigd")).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Status van open.xlsx"), "in_progress");

    expect(updateSubmissionMutate).toHaveBeenCalledWith(
      { submissionId: 1, data: { status: "in_progress" } },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(previewMutate).not.toHaveBeenCalled();
    expect(confirmMutate).not.toHaveBeenCalled();
  });

  it("previews a teacher file and only confirms after the explicit replacement action", async () => {
    const user = userEvent.setup();
    previewMutate.mockImplementation((_data: unknown, options: { onSuccess: (value: unknown) => void }) => options.onSuccess({
      valid: true,
      expectedUpdatedAt: "2026-08-01T00:00:00.000Z",
      existingCount: 3,
      newCount: 1,
      errors: [],
      rows: [{ name: "Nina", hourlyRate: 35, weeklyTravel: 4 }],
    }));
    confirmMutate.mockImplementation((_data: unknown, options: { onSuccess: (value: unknown) => void }) => options.onSuccess({ importedCount: 1, updatedAt: "2026-08-02T00:00:00.000Z" }));
    renderPage();
    await user.selectOptions(screen.getByTestId("select-import-school"), "7");
    await user.selectOptions(screen.getByTestId("select-import-season"), "22");
    const file = new File(["xlsx"], "teachers.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    fireEvent.change(screen.getByTestId("input-file-teachers"), { target: { files: [file] } });
    await user.click(screen.getByTestId("button-preview-teachers"));
    expect(previewMutate).toHaveBeenCalledTimes(1);
    expect(confirmMutate).not.toHaveBeenCalled();
    expect(screen.getByText("Let op: deze actie vervangt de volledige bestaande lijst.")).toBeTruthy();
    expect(screen.getByTestId("card-import-teachers").textContent).toContain("Nu aanwezig: 3 · Nieuwe records: 1");
    await user.click(screen.getByTestId("button-confirm-teachers"));
    expect(confirmMutate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toContain("1 records geïmporteerd");
  });

  it("renders aggregate preview errors and keeps the other flow independent", async () => {
    const user = userEvent.setup();
    previewMutate.mockImplementation((_data: unknown, options: { onError: (error: unknown) => void }) => options.onError(new Error("Naam: mag niet leeg zijn; Btw: onbekend")));
    renderPage();
    await user.selectOptions(screen.getByTestId("select-import-school"), "7");
    await user.selectOptions(screen.getByTestId("select-import-season"), "22");
    const file = new File(["xlsx"], "offers.xlsx");
    fireEvent.change(screen.getByTestId("input-file-subscriptions"), { target: { files: [file] } });
    await user.click(screen.getByTestId("button-preview-subscriptions"));
    expect(screen.getByRole("alert").textContent).toContain("Naam: mag niet leeg zijn; Btw: onbekend");
    expect(screen.getByTestId("card-import-teachers")).toBeTruthy();
  });

  it("ignores a delayed preview after another file is selected", async () => {
    const user = userEvent.setup();
    let resolvePreview: ((value: unknown) => void) | undefined;
    previewMutate.mockImplementation((_data: unknown, options: { onSuccess: (value: unknown) => void }) => {
      resolvePreview = options.onSuccess;
    });
    renderPage();
    await user.selectOptions(screen.getByTestId("select-import-school"), "7");
    await user.selectOptions(screen.getByTestId("select-import-season"), "22");

    const fileA = new File(["a"], "teachers-a.xlsx");
    const fileB = new File(["b"], "teachers-b.xlsx");
    fireEvent.change(screen.getByTestId("input-file-teachers"), { target: { files: [fileA] } });
    await user.click(screen.getByTestId("button-preview-teachers"));
    fireEvent.change(screen.getByTestId("input-file-teachers"), { target: { files: [fileB] } });

    await act(async () => resolvePreview?.({
      valid: true,
      expectedUpdatedAt: "2026-08-01T00:00:00.000Z",
      existingCount: 3,
      newCount: 1,
      errors: [],
      rows: [{ name: "Reactie van bestand A", hourlyRate: 35, weeklyTravel: 4 }],
    }));

    expect(screen.queryByText("Reactie van bestand A")).toBeNull();
    expect(screen.queryByTestId("button-confirm-teachers")).toBeNull();
    expect(screen.getByTestId("button-preview-teachers")).toBeTruthy();
    expect(confirmMutate).not.toHaveBeenCalled();
  });

  it("clears the preview after a 409 conflict and requires a new preview", async () => {
    const { ApiError } = await import("@workspace/api-client-react");
    const user = userEvent.setup();
    previewMutate.mockImplementation((_data: unknown, options: { onSuccess: (value: unknown) => void }) => options.onSuccess({
      valid: true,
      expectedUpdatedAt: "2026-08-01T00:00:00.000Z",
      existingCount: 3,
      newCount: 1,
      errors: [],
      rows: [{ name: "Nina", hourlyRate: 35, weeklyTravel: 4 }],
    }));
    confirmMutate.mockImplementation((_data: unknown, options: { onError: (error: unknown) => void }) => {
      const conflict = Object.assign(Object.create(ApiError.prototype), {
        message: "Het seizoen is intussen gewijzigd.",
        status: 409,
        data: null,
      });
      options.onError(conflict);
    });
    renderPage();
    await user.selectOptions(screen.getByTestId("select-import-school"), "7");
    await user.selectOptions(screen.getByTestId("select-import-season"), "22");
    fireEvent.change(screen.getByTestId("input-file-teachers"), {
      target: { files: [new File(["xlsx"], "teachers.xlsx")] },
    });
    await user.click(screen.getByTestId("button-preview-teachers"));
    await user.click(screen.getByTestId("button-confirm-teachers"));

    expect(screen.queryByTestId("button-confirm-teachers")).toBeNull();
    expect(screen.queryByText("Nina")).toBeNull();
    expect(screen.getByTestId("button-preview-teachers")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Het seizoen is intussen gewijzigd.");

    await user.click(screen.getByTestId("button-preview-teachers"));
    expect(previewMutate).toHaveBeenCalledTimes(2);
    expect(confirmMutate).toHaveBeenCalledTimes(1);
  });

  it("previews and confirms a schedule with stable teacher and location labels", async () => {
    const user = userEvent.setup();
    previewMutate.mockImplementation((_data: unknown, options: { onSuccess: (value: unknown) => void }) => options.onSuccess({
      valid: true,
      expectedUpdatedAt: "2026-08-01T00:00:00.000Z",
      existingCount: 2,
      newCount: 1,
      metadata: {
        participantId: 7,
        seasonId: 22,
        seasonName: "2026/2027",
        templateVersion: "1",
        masterDataVersion: "2026-08-01T00:00:00.000Z",
      },
      errors: [],
      rows: [{
        name: "Hiphop 12+",
        teacherId: 9,
        teacherLabel: "Nina (docent 9)",
        locationId: 12,
        locationLabel: "Studio (locatie 12)",
        weekday: 2,
        weekdayLabel: "Dinsdag",
        startTime: "18:30",
        durationMinutes: 75,
        activeFrom: "2026-09-01",
        activeUntil: "2027-06-30",
      }],
    }));
    confirmMutate.mockImplementation((_data: unknown, options: { onSuccess: (value: unknown) => void }) => options.onSuccess({ importedCount: 1, updatedAt: "2026-08-02T00:00:00.000Z" }));
    renderPage();
    await user.selectOptions(screen.getByTestId("select-import-school"), "7");
    await user.selectOptions(screen.getByTestId("select-import-season"), "22");
    fireEvent.change(screen.getByTestId("input-file-schedule"), { target: { files: [new File(["xlsx"], "rooster.xlsx")] } });
    await user.click(screen.getByTestId("button-preview-schedule"));

    expect(screen.getByText("Nina (docent 9)")).toBeTruthy();
    expect(screen.getByText("Studio (locatie 12)")).toBeTruthy();
    expect(screen.getByText("Let op: bevestigen vervangt het volledige rooster van dit seizoen.")).toBeTruthy();
    await user.click(screen.getByTestId("button-confirm-schedule"));
    expect(confirmMutate).toHaveBeenCalledWith(
      {
        participantId: 7,
        seasonId: 22,
        data: expect.objectContaining({
          expectedUpdatedAt: "2026-08-01T00:00:00.000Z",
          templateVersion: "1",
          masterDataVersion: "2026-08-01T00:00:00.000Z",
        }),
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });
});
