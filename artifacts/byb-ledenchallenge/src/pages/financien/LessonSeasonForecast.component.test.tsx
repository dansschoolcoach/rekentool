import type { FinancialLessonInput, FinancialLessonSeasonForecast } from '@workspace/api-client-react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LessonSeasonForecast } from './LessonSeasonForecast';

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

describe('LessonSeasonForecast zaalhuurverdeling', () => {
  it('koppelt per zaal het contract en toegewezen bedrag aan de juiste les', async () => {
    const forecast: FinancialLessonSeasonForecast = {
      months: ['2026-09-01'],
      unallocatedLocations: [],
      overallocatedLocations: [],
      locationRentBreakdowns: [{
        locationId: 1,
        locationName: 'Studio Noord',
        rentPerTerm: 600,
        rentTermCount: 3,
        contractTotal: 1800,
        scheduledLessonCount: 12,
        allocatedCost: 1800,
        previouslyAllocatedCost: 600,
        remainingAllocatedCost: 1200,
        unallocatedCost: 0,
        remainingScheduledLessonCount: 8,
        lessons: [{
          lessonId: 11,
          lessonName: 'Modern',
          scheduledLessonCount: 12,
          allocatedCost: 1800,
        }],
      }],
      lessons: [{
        lessonId: 11,
        lessonName: 'Modern',
        totalLessonCount: 4,
        totalRevenue: 2000,
        totalCost: 1000,
        totalLocationRentCost: 600,
        locationRentCalculation: {
          frequency: 'hour',
          rate: 200,
          durationMinutes: 45,
          lessonCount: 4,
          totalCost: 600,
        },
        totalProfit: 1000,
        actualMonthCount: 1,
        forecastMonthCount: 0,
        unknownMonthCount: 0,
        promotionGap: null,
        status: 'healthy',
        months: [{
          month: '2026-09-01',
          status: 'actual',
          missingInputs: [],
          saved: true,
          lessonCount: 4,
          attendance: 18,
          revenue: 2000,
          cost: 1000,
          locationRentCost: 600,
          locationRentCalculation: {
            frequency: 'hour',
            rate: 200,
            durationMinutes: 45,
            lessonCount: 4,
            totalCost: 600,
          },
          profit: 1000,
          breakEvenAttendance: 9,
          promotionGap: null,
        }],
      }],
    };
    const lessons: FinancialLessonInput[] = [{
      id: 11,
      name: 'Modern',
      teacherId: null,
      teacherClientId: null,
      locationId: 1,
      locationClientId: null,
      weekday: 1,
      startTime: '19:00',
      durationMinutes: 60,
      activeFrom: '2026-09-01',
      activeUntil: '2026-09-30',
    }];

    render(
      <LessonSeasonForecast
        forecast={forecast}
        selectedMonth="2026-09-01"
        lessons={lessons}
        onSelectMonth={vi.fn()}
      />,
    );

    const locationCard = screen.getByTestId('location-rent-1');
    expect(locationCard.textContent).toContain('Studio Noord');
    expect(locationCard.textContent).toContain('€ 600,00 × 3 termijnen = € 1.800,00');
    expect(locationCard.textContent).toContain('Modern (12×)');
    expect(locationCard.textContent).toContain('Reeds opgeslagen: € 600,00 · resterend: € 1.200,00 over 8 momenten');
    expect(screen.getByTestId('row-month-11').textContent).toContain('waarvan zaalhuur € 600,00');
    expect(screen.getByTestId('row-month-11').textContent).toContain('€ 200,00 × 45 min ÷ 60 × 4 lesmomenten = € 600,00');
    expect(screen.queryByText('Meeste geblokkeerde lessen eerst')).toBeNull();

    await userEvent.click(screen.getByTestId('toggle-view-season'));
    expect(screen.getByTestId('row-season-11').textContent).toContain('waarvan zaalhuur € 600,00');
    expect(screen.getByTestId('row-season-11').textContent).toContain('€ 200,00 × 45 min ÷ 60 × 4 lesmomenten = € 600,00');
    expect(screen.queryByText('Meeste geblokkeerde lessen eerst')).toBeNull();

    cleanup();
    forecast.lessons[0].locationRentCalculation = {
      frequency: 'session',
      rate: 150,
      durationMinutes: null,
      lessonCount: 4,
      totalCost: 600,
    };
    forecast.lessons[0].months[0].locationRentCalculation = forecast.lessons[0].locationRentCalculation;
    render(
      <LessonSeasonForecast
        forecast={forecast}
        selectedMonth="2026-09-01"
        lessons={lessons}
        onSelectMonth={vi.fn()}
      />,
    );
    expect(screen.getByTestId('row-month-11').textContent).toContain('€ 150,00 × 4 lesmomenten = € 600,00');
  });

  it('waarschuwt met locatie en bedragen als opgeslagen huur boven het nieuwe contract ligt', () => {
    const forecast: FinancialLessonSeasonForecast = {
      months: [],
      lessons: [],
      unallocatedLocations: [],
      overallocatedLocations: [{
        locationId: 1,
        locationName: 'Studio Noord',
        previouslyAllocatedCost: 1800,
        contractTotal: 1200,
      }],
      locationRentBreakdowns: [],
    };

    render(
      <LessonSeasonForecast
        forecast={forecast}
        selectedMonth="2026-09-01"
        lessons={[]}
        onSelectMonth={vi.fn()}
      />,
    );

    const warning = screen.getByTestId('overallocated-rent-warning');
    expect(warning.textContent).toContain('Studio Noord');
    expect(warning.textContent).toContain('€ 1.800,00 opgeslagen');
    expect(warning.textContent).toContain('nieuwe contract € 1.200,00');
    expect(warning.textContent).toContain('geen negatieve zaalhuur');
  });
});

describe('LessonSeasonForecast maandstatussen', () => {
  it('verwijdert de oude lesrij en bedragen na een maandwissel zonder maandrecord', () => {
    const forecast: FinancialLessonSeasonForecast = {
      months: ['2026-09-01', '2026-10-01'],
      unallocatedLocations: [],
      overallocatedLocations: [],
      locationRentBreakdowns: [],
      lessons: [{
        lessonId: 11,
        lessonName: 'Modern',
        totalLessonCount: 4,
        totalRevenue: 500,
        totalCost: 200,
        totalLocationRentCost: 100,
        totalProfit: 300,
        actualMonthCount: 1,
        forecastMonthCount: 0,
        unknownMonthCount: 0,
        promotionGap: null,
        locationRentCalculation: null,
        status: 'healthy',
        months: [{
          month: '2026-09-01',
          status: 'actual',
          missingInputs: [],
          saved: true,
          lessonCount: 4,
          attendance: 18,
          revenue: 500,
          cost: 200,
          locationRentCost: 100,
          locationRentCalculation: null,
          profit: 300,
          breakEvenAttendance: 8,
          promotionGap: null,
        }],
      }],
    };
    const lessons: FinancialLessonInput[] = [{
      id: 11,
      name: 'Modern',
      teacherId: null,
      teacherClientId: null,
      locationId: 1,
      locationClientId: null,
      weekday: 1,
      startTime: '19:00',
      durationMinutes: 60,
      activeFrom: '2026-09-01',
      activeUntil: '2026-10-31',
    }];

    const { rerender } = render(
      <LessonSeasonForecast
        forecast={forecast}
        selectedMonth="2026-09-01"
        lessons={lessons}
        onSelectMonth={vi.fn()}
      />,
    );

    expect(screen.getByTestId('row-month-11').textContent).toContain('Modern');
    expect(screen.getByTestId('row-month-11').textContent).toContain('€ 500,00');
    expect(screen.getByTestId('row-month-11').textContent).toContain('€ 300,00');

    rerender(
      <LessonSeasonForecast
        forecast={forecast}
        selectedMonth="2026-10-01"
        lessons={lessons}
        onSelectMonth={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('row-month-11')).toBeNull();
    expect(screen.getByText('Geen lesgegevens beschikbaar.')).toBeTruthy();
    expect(screen.queryByText('Modern')).toBeNull();
    expect(screen.queryByText('€ 500,00')).toBeNull();
    expect(screen.queryByText('€ 300,00')).toBeNull();
  });

  it('behoudt na een maandwissel alleen lessen met een record voor de gekozen maand', () => {
    const forecast: FinancialLessonSeasonForecast = {
      months: ['2026-09-01', '2026-10-01'],
      unallocatedLocations: [],
      overallocatedLocations: [],
      locationRentBreakdowns: [],
      lessons: [
        {
          lessonId: 11,
          lessonName: 'Modern',
          totalLessonCount: 4,
          totalRevenue: 500,
          totalCost: 200,
          totalLocationRentCost: 100,
          totalProfit: 300,
          actualMonthCount: 1,
          forecastMonthCount: 0,
          unknownMonthCount: 0,
          promotionGap: null,
          locationRentCalculation: null,
          status: 'healthy',
          months: [{
            month: '2026-09-01',
            status: 'actual',
            missingInputs: [],
            saved: true,
            lessonCount: 4,
            attendance: 18,
            revenue: 500,
            cost: 200,
            locationRentCost: 100,
            locationRentCalculation: null,
            profit: 300,
            breakEvenAttendance: 8,
            promotionGap: null,
          }],
        },
        {
          lessonId: 12,
          lessonName: 'Jazz',
          totalLessonCount: 8,
          totalRevenue: 1300,
          totalCost: 550,
          totalLocationRentCost: 250,
          totalProfit: 750,
          actualMonthCount: 2,
          forecastMonthCount: 0,
          unknownMonthCount: 0,
          promotionGap: null,
          locationRentCalculation: null,
          status: 'healthy',
          months: [
            {
              month: '2026-09-01',
              status: 'actual',
              missingInputs: [],
              saved: true,
              lessonCount: 4,
              attendance: 20,
              revenue: 700,
              cost: 300,
              locationRentCost: 150,
              locationRentCalculation: null,
              profit: 400,
              breakEvenAttendance: 9,
              promotionGap: null,
            },
            {
              month: '2026-10-01',
              status: 'actual',
              missingInputs: [],
              saved: true,
              lessonCount: 4,
              attendance: 17,
              revenue: 600,
              cost: 250,
              locationRentCost: 100,
              locationRentCalculation: null,
              profit: 350,
              breakEvenAttendance: 8,
              promotionGap: null,
            },
          ],
        },
      ],
    };
    const lessons: FinancialLessonInput[] = [
      {
        id: 11,
        name: 'Modern',
        teacherId: null,
        teacherClientId: null,
        locationId: 1,
        locationClientId: null,
        weekday: 1,
        startTime: '19:00',
        durationMinutes: 60,
        activeFrom: '2026-09-01',
        activeUntil: '2026-10-31',
      },
      {
        id: 12,
        name: 'Jazz',
        teacherId: null,
        teacherClientId: null,
        locationId: 1,
        locationClientId: null,
        weekday: 1,
        startTime: '20:00',
        durationMinutes: 60,
        activeFrom: '2026-09-01',
        activeUntil: '2026-10-31',
      },
    ];

    const { rerender } = render(
      <LessonSeasonForecast
        forecast={forecast}
        selectedMonth="2026-09-01"
        lessons={lessons}
        onSelectMonth={vi.fn()}
      />,
    );

    expect(screen.getByTestId('row-month-11')).toBeTruthy();
    expect(screen.getByTestId('row-month-12')).toBeTruthy();
    expect(screen.getByTestId('text-selected-weekday').textContent).toBe('Maandag');

    rerender(
      <LessonSeasonForecast
        forecast={forecast}
        selectedMonth="2026-10-01"
        lessons={lessons}
        onSelectMonth={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('row-month-11')).toBeNull();
    expect(screen.queryByText('Modern')).toBeNull();
    const remainingRow = screen.getByTestId('row-month-12');
    expect(remainingRow.textContent).toContain('Jazz');
    expect(screen.getByTestId('text-selected-weekday').textContent).toBe('Maandag');
    expect(remainingRow.textContent).toContain('€ 250,00');
    expect(remainingRow.textContent).toContain('€ 600,00');
    expect(remainingRow.textContent).toContain('€ 350,00');
    expect(screen.queryByText('€ 500,00')).toBeNull();
    expect(screen.queryByText('€ 300,00')).toBeNull();
  });

  it('behoudt een gekozen lesdag bij wisselen tussen maand- en seizoensweergave', async () => {
    const forecast: FinancialLessonSeasonForecast = {
      months: ['2026-09-01'],
      unallocatedLocations: [],
      overallocatedLocations: [],
      locationRentBreakdowns: [],
      lessons: [
        {
          lessonId: 11,
          lessonName: 'Modern',
          totalLessonCount: 4,
          totalRevenue: 500,
          totalCost: 200,
          totalLocationRentCost: 100,
          totalProfit: 300,
          actualMonthCount: 1,
          forecastMonthCount: 0,
          unknownMonthCount: 0,
          promotionGap: null,
          locationRentCalculation: null,
          status: 'healthy',
          months: [{
            month: '2026-09-01',
            status: 'actual',
            missingInputs: [],
            saved: true,
            lessonCount: 4,
            attendance: 18,
            revenue: 500,
            cost: 200,
            locationRentCost: 100,
            locationRentCalculation: null,
            profit: 300,
            breakEvenAttendance: 8,
            promotionGap: null,
          }],
        },
        {
          lessonId: 12,
          lessonName: 'Jazz',
          totalLessonCount: 4,
          totalRevenue: 700,
          totalCost: 250,
          totalLocationRentCost: 120,
          totalProfit: 450,
          actualMonthCount: 1,
          forecastMonthCount: 0,
          unknownMonthCount: 0,
          promotionGap: null,
          locationRentCalculation: null,
          status: 'healthy',
          months: [{
            month: '2026-09-01',
            status: 'actual',
            missingInputs: [],
            saved: true,
            lessonCount: 4,
            attendance: 20,
            revenue: 700,
            cost: 250,
            locationRentCost: 120,
            locationRentCalculation: null,
            profit: 450,
            breakEvenAttendance: 7,
            promotionGap: null,
          }],
        },
      ],
    };
    const lessons: FinancialLessonInput[] = [
      {
        id: 11,
        name: 'Modern',
        teacherId: null,
        teacherClientId: null,
        locationId: 1,
        locationClientId: null,
        weekday: 1,
        startTime: '19:00',
        durationMinutes: 60,
        activeFrom: '2026-09-01',
        activeUntil: '2026-09-30',
      },
      {
        id: 12,
        name: 'Jazz',
        teacherId: null,
        teacherClientId: null,
        locationId: 1,
        locationClientId: null,
        weekday: 3,
        startTime: '20:00',
        durationMinutes: 60,
        activeFrom: '2026-09-01',
        activeUntil: '2026-09-30',
      },
    ];

    const { rerender, unmount } = render(
      <LessonSeasonForecast
        forecast={forecast}
        selectedMonth="2026-09-01"
        lessons={lessons}
        onSelectMonth={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByTestId('tab-weekday-3'));
    expect(screen.getByTestId('text-selected-weekday').textContent).toBe('Woensdag');
    expect(screen.queryByTestId('row-month-11')).toBeNull();
    expect(screen.getByTestId('row-month-12').textContent).toContain('€ 700,00');
    expect(screen.getByTestId('row-month-12').textContent).toContain('€ 450,00');

    const updatedForecast: FinancialLessonSeasonForecast = {
      ...forecast,
      lessons: forecast.lessons.map(lesson => lesson.lessonId === 12
        ? {
            ...lesson,
            totalRevenue: 760,
            totalProfit: 500,
            months: lesson.months.map(month => ({
              ...month,
              revenue: 760,
              profit: 500,
            })),
          }
        : lesson),
    };

    rerender(
      <LessonSeasonForecast
        forecast={updatedForecast}
        selectedMonth="2026-09-01"
        lessons={lessons}
        onSelectMonth={vi.fn()}
      />,
    );

    expect(screen.getByTestId('text-selected-weekday').textContent).toBe('Woensdag');
    expect(screen.getByTestId('tab-weekday-3').getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByTestId('row-month-11')).toBeNull();
    expect(screen.getByTestId('row-month-12').textContent).toContain('€ 760,00');
    expect(screen.getByTestId('row-month-12').textContent).toContain('€ 500,00');

    await userEvent.click(screen.getByTestId('toggle-view-season'));
    expect(screen.getByTestId('text-selected-weekday').textContent).toBe('Woensdag');
    expect(screen.queryByTestId('row-season-11')).toBeNull();
    expect(screen.getByTestId('row-season-12').textContent).toContain('€ 760,00');
    expect(screen.getByTestId('row-season-12').textContent).toContain('€ 500,00');

    await userEvent.click(screen.getByTestId('toggle-view-month'));
    expect(screen.getByTestId('text-selected-weekday').textContent).toBe('Woensdag');
    expect(screen.queryByTestId('row-month-11')).toBeNull();
    expect(screen.getByTestId('row-month-12').textContent).toContain('€ 760,00');
    expect(screen.getByTestId('row-month-12').textContent).toContain('€ 500,00');

    unmount();
    render(
      <LessonSeasonForecast
        forecast={updatedForecast}
        selectedMonth="2026-09-01"
        lessons={lessons}
        onSelectMonth={vi.fn()}
      />,
    );

    expect(screen.getByTestId('text-selected-weekday').textContent).toBe('Woensdag');
    expect(screen.getByTestId('tab-weekday-3').getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByTestId('row-month-11')).toBeNull();
    expect(screen.getByTestId('row-month-12').textContent).toContain('€ 760,00');
  });

  it('behoudt een opgeslagen zondag bij wisselen tussen maand- en seizoensweergave', async () => {
    sessionStorage.setItem('byb:financial-forecast:selected-weekday:v1', '7');
    const forecast: FinancialLessonSeasonForecast = {
      months: ['2026-09-01'],
      unallocatedLocations: [],
      overallocatedLocations: [],
      locationRentBreakdowns: [],
      lessons: [
        {
          lessonId: 11,
          lessonName: 'Modern',
          totalLessonCount: 4,
          totalRevenue: 500,
          totalCost: 200,
          totalLocationRentCost: 100,
          totalProfit: 300,
          actualMonthCount: 1,
          forecastMonthCount: 0,
          unknownMonthCount: 0,
          promotionGap: null,
          locationRentCalculation: null,
          status: 'healthy',
          months: [{
            month: '2026-09-01',
            status: 'actual',
            missingInputs: [],
            saved: true,
            lessonCount: 4,
            attendance: 18,
            revenue: 500,
            cost: 200,
            locationRentCost: 100,
            locationRentCalculation: null,
            profit: 300,
            breakEvenAttendance: 8,
            promotionGap: null,
          }],
        },
        {
          lessonId: 12,
          lessonName: 'Jazz',
          totalLessonCount: 4,
          totalRevenue: 700,
          totalCost: 250,
          totalLocationRentCost: 120,
          totalProfit: 450,
          actualMonthCount: 1,
          forecastMonthCount: 0,
          unknownMonthCount: 0,
          promotionGap: null,
          locationRentCalculation: null,
          status: 'healthy',
          months: [{
            month: '2026-09-01',
            status: 'actual',
            missingInputs: [],
            saved: true,
            lessonCount: 4,
            attendance: 20,
            revenue: 700,
            cost: 250,
            locationRentCost: 120,
            locationRentCalculation: null,
            profit: 450,
            breakEvenAttendance: 7,
            promotionGap: null,
          }],
        },
      ],
    };
    const lessons: FinancialLessonInput[] = [
      {
        id: 11,
        name: 'Modern',
        teacherId: null,
        teacherClientId: null,
        locationId: 1,
        locationClientId: null,
        weekday: 1,
        startTime: '19:00',
        durationMinutes: 60,
        activeFrom: '2026-09-01',
        activeUntil: '2026-09-30',
      },
      {
        id: 12,
        name: 'Jazz',
        teacherId: null,
        teacherClientId: null,
        locationId: 1,
        locationClientId: null,
        weekday: 0,
        startTime: '20:00',
        durationMinutes: 60,
        activeFrom: '2026-09-01',
        activeUntil: '2026-09-30',
      },
    ];

    render(
      <LessonSeasonForecast
        forecast={forecast}
        selectedMonth="2026-09-01"
        lessons={lessons}
        onSelectMonth={vi.fn()}
      />,
    );

    expect(screen.getByTestId('text-selected-weekday').textContent).toBe('Zondag');
    expect(screen.getByTestId('tab-weekday-0').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('row-month-12').textContent).toContain('Jazz');
    expect(screen.queryByTestId('row-month-11')).toBeNull();

    await userEvent.click(screen.getByTestId('toggle-view-season'));

    expect(screen.getByTestId('text-selected-weekday').textContent).toBe('Zondag');
    expect(screen.getByTestId('tab-weekday-0').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('row-season-12').textContent).toContain('Jazz');
    expect(screen.queryByTestId('row-season-11')).toBeNull();

    await userEvent.click(screen.getByTestId('toggle-view-month'));

    expect(screen.getByTestId('text-selected-weekday').textContent).toBe('Zondag');
    expect(screen.getByTestId('tab-weekday-0').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('row-month-12').textContent).toContain('Jazz');
    expect(screen.queryByTestId('row-month-11')).toBeNull();
  });

  it('bewaart een handmatig gekozen zondag en herstelt die na opnieuw openen', async () => {
    const forecast: FinancialLessonSeasonForecast = {
      months: ['2026-09-01'],
      unallocatedLocations: [],
      overallocatedLocations: [],
      locationRentBreakdowns: [],
      lessons: [
        {
          lessonId: 11,
          lessonName: 'Modern',
          totalLessonCount: 4,
          totalRevenue: 500,
          totalCost: 200,
          totalLocationRentCost: 100,
          totalProfit: 300,
          actualMonthCount: 1,
          forecastMonthCount: 0,
          unknownMonthCount: 0,
          promotionGap: null,
          locationRentCalculation: null,
          status: 'healthy',
          months: [{
            month: '2026-09-01',
            status: 'actual',
            missingInputs: [],
            saved: true,
            lessonCount: 4,
            attendance: 18,
            revenue: 500,
            cost: 200,
            locationRentCost: 100,
            locationRentCalculation: null,
            profit: 300,
            breakEvenAttendance: 8,
            promotionGap: null,
          }],
        },
        {
          lessonId: 12,
          lessonName: 'Jazz',
          totalLessonCount: 4,
          totalRevenue: 700,
          totalCost: 250,
          totalLocationRentCost: 120,
          totalProfit: 450,
          actualMonthCount: 1,
          forecastMonthCount: 0,
          unknownMonthCount: 0,
          promotionGap: null,
          locationRentCalculation: null,
          status: 'healthy',
          months: [{
            month: '2026-09-01',
            status: 'actual',
            missingInputs: [],
            saved: true,
            lessonCount: 4,
            attendance: 20,
            revenue: 700,
            cost: 250,
            locationRentCost: 120,
            locationRentCalculation: null,
            profit: 450,
            breakEvenAttendance: 7,
            promotionGap: null,
          }],
        },
      ],
    };
    const lessons: FinancialLessonInput[] = [
      {
        id: 11,
        name: 'Modern',
        teacherId: null,
        teacherClientId: null,
        locationId: 1,
        locationClientId: null,
        weekday: 1,
        startTime: '19:00',
        durationMinutes: 60,
        activeFrom: '2026-09-01',
        activeUntil: '2026-09-30',
      },
      {
        id: 12,
        name: 'Jazz',
        teacherId: null,
        teacherClientId: null,
        locationId: 1,
        locationClientId: null,
        weekday: 0,
        startTime: '20:00',
        durationMinutes: 60,
        activeFrom: '2026-09-01',
        activeUntil: '2026-09-30',
      },
    ];

    const { unmount } = render(
      <LessonSeasonForecast
        forecast={forecast}
        selectedMonth="2026-09-01"
        lessons={lessons}
        onSelectMonth={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByTestId('tab-weekday-0'));

    expect(sessionStorage.getItem('byb:financial-forecast:selected-weekday:v1')).toBe('7');
    expect(screen.getByTestId('text-selected-weekday').textContent).toBe('Zondag');
    expect(screen.getByTestId('row-month-12').textContent).toContain('Jazz');
    expect(screen.queryByTestId('row-month-11')).toBeNull();

    unmount();
    render(
      <LessonSeasonForecast
        forecast={forecast}
        selectedMonth="2026-09-01"
        lessons={lessons}
        onSelectMonth={vi.fn()}
      />,
    );

    expect(screen.getByTestId('text-selected-weekday').textContent).toBe('Zondag');
    expect(screen.getByTestId('tab-weekday-0').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('row-month-12').textContent).toContain('Jazz');
    expect(screen.queryByTestId('row-month-11')).toBeNull();
  });

  it.each(['geen-weekdag', '8'])(
    'negeert de ongeldige opgeslagen lesdag %s en houdt tabs en lesrijen bruikbaar',
    async storedWeekday => {
      sessionStorage.setItem('byb:financial-forecast:selected-weekday:v1', storedWeekday);
      const forecast: FinancialLessonSeasonForecast = {
        months: ['2026-09-01'],
        unallocatedLocations: [],
        overallocatedLocations: [],
        locationRentBreakdowns: [],
        lessons: [
          {
            lessonId: 11,
            lessonName: 'Modern',
            totalLessonCount: 4,
            totalRevenue: 500,
            totalCost: 200,
            totalLocationRentCost: 100,
            totalProfit: 300,
            actualMonthCount: 1,
            forecastMonthCount: 0,
            unknownMonthCount: 0,
            promotionGap: null,
            locationRentCalculation: null,
            status: 'healthy',
            months: [{
              month: '2026-09-01',
              status: 'actual',
              missingInputs: [],
              saved: true,
              lessonCount: 4,
              attendance: 18,
              revenue: 500,
              cost: 200,
              locationRentCost: 100,
              locationRentCalculation: null,
              profit: 300,
              breakEvenAttendance: 8,
              promotionGap: null,
            }],
          },
          {
            lessonId: 12,
            lessonName: 'Jazz',
            totalLessonCount: 4,
            totalRevenue: 700,
            totalCost: 250,
            totalLocationRentCost: 120,
            totalProfit: 450,
            actualMonthCount: 1,
            forecastMonthCount: 0,
            unknownMonthCount: 0,
            promotionGap: null,
            locationRentCalculation: null,
            status: 'healthy',
            months: [{
              month: '2026-09-01',
              status: 'actual',
              missingInputs: [],
              saved: true,
              lessonCount: 4,
              attendance: 20,
              revenue: 700,
              cost: 250,
              locationRentCost: 120,
              locationRentCalculation: null,
              profit: 450,
              breakEvenAttendance: 7,
              promotionGap: null,
            }],
          },
        ],
      };
      const lessons: FinancialLessonInput[] = [
        {
          id: 11,
          name: 'Modern',
          teacherId: null,
          teacherClientId: null,
          locationId: 1,
          locationClientId: null,
          weekday: 3,
          startTime: '19:00',
          durationMinutes: 60,
          activeFrom: '2026-09-01',
          activeUntil: '2026-09-30',
        },
        {
          id: 12,
          name: 'Jazz',
          teacherId: null,
          teacherClientId: null,
          locationId: 1,
          locationClientId: null,
          weekday: 5,
          startTime: '20:00',
          durationMinutes: 60,
          activeFrom: '2026-09-01',
          activeUntil: '2026-09-30',
        },
      ];

      render(
        <LessonSeasonForecast
          forecast={forecast}
          selectedMonth="2026-09-01"
          lessons={lessons}
          onSelectMonth={vi.fn()}
        />,
      );

      expect(screen.getByTestId('text-selected-weekday').textContent).toBe('Woensdag');
      expect(screen.getByTestId('tab-weekday-3').getAttribute('aria-selected')).toBe('true');
      expect(screen.getByTestId('tab-weekday-5').getAttribute('aria-selected')).toBe('false');
      expect(screen.getByTestId('row-month-11').textContent).toContain('Modern');
      expect(screen.queryByTestId('row-month-12')).toBeNull();

      await userEvent.click(screen.getByTestId('tab-weekday-5'));

      expect(screen.getByTestId('text-selected-weekday').textContent).toBe('Vrijdag');
      expect(screen.getByTestId('tab-weekday-5').getAttribute('aria-selected')).toBe('true');
      expect(screen.queryByTestId('row-month-11')).toBeNull();
      expect(screen.getByTestId('row-month-12').textContent).toContain('Jazz');
    },
  );

  it.each([
    { storedWeekday: '1', selectedDay: 'Maandag', selectedTab: '1', selectedLessonId: 11, hiddenLessonId: 12 },
    { storedWeekday: '7', selectedDay: 'Zondag', selectedTab: '0', selectedLessonId: 12, hiddenLessonId: 11 },
  ])(
    'selecteert de beschikbare lesdag voor opgeslagen waarde $storedWeekday',
    ({ storedWeekday, selectedDay, selectedTab, selectedLessonId, hiddenLessonId }) => {
      sessionStorage.setItem('byb:financial-forecast:selected-weekday:v1', storedWeekday);
      const forecast: FinancialLessonSeasonForecast = {
        months: ['2026-09-01'],
        unallocatedLocations: [],
        overallocatedLocations: [],
        locationRentBreakdowns: [],
        lessons: [
          {
            lessonId: 11,
            lessonName: 'Modern',
            totalLessonCount: 4,
            totalRevenue: 500,
            totalCost: 200,
            totalLocationRentCost: 100,
            totalProfit: 300,
            actualMonthCount: 1,
            forecastMonthCount: 0,
            unknownMonthCount: 0,
            promotionGap: null,
            locationRentCalculation: null,
            status: 'healthy',
            months: [{
              month: '2026-09-01',
              status: 'actual',
              missingInputs: [],
              saved: true,
              lessonCount: 4,
              attendance: 18,
              revenue: 500,
              cost: 200,
              locationRentCost: 100,
              locationRentCalculation: null,
              profit: 300,
              breakEvenAttendance: 8,
              promotionGap: null,
            }],
          },
          {
            lessonId: 12,
            lessonName: 'Jazz',
            totalLessonCount: 4,
            totalRevenue: 700,
            totalCost: 250,
            totalLocationRentCost: 120,
            totalProfit: 450,
            actualMonthCount: 1,
            forecastMonthCount: 0,
            unknownMonthCount: 0,
            promotionGap: null,
            locationRentCalculation: null,
            status: 'healthy',
            months: [{
              month: '2026-09-01',
              status: 'actual',
              missingInputs: [],
              saved: true,
              lessonCount: 4,
              attendance: 20,
              revenue: 700,
              cost: 250,
              locationRentCost: 120,
              locationRentCalculation: null,
              profit: 450,
              breakEvenAttendance: 7,
              promotionGap: null,
            }],
          },
        ],
      };
      const lessons: FinancialLessonInput[] = [
        {
          id: 11,
          name: 'Modern',
          teacherId: null,
          teacherClientId: null,
          locationId: 1,
          locationClientId: null,
          weekday: 1,
          startTime: '19:00',
          durationMinutes: 60,
          activeFrom: '2026-09-01',
          activeUntil: '2026-09-30',
        },
        {
          id: 12,
          name: 'Jazz',
          teacherId: null,
          teacherClientId: null,
          locationId: 1,
          locationClientId: null,
          weekday: 0,
          startTime: '20:00',
          durationMinutes: 60,
          activeFrom: '2026-09-01',
          activeUntil: '2026-09-30',
        },
      ];

      render(
        <LessonSeasonForecast
          forecast={forecast}
          selectedMonth="2026-09-01"
          lessons={lessons}
          onSelectMonth={vi.fn()}
        />,
      );

      expect(screen.getByTestId('text-selected-weekday').textContent).toBe(selectedDay);
      expect(screen.getByTestId(`tab-weekday-${selectedTab}`).getAttribute('aria-selected')).toBe('true');
      expect(screen.getByTestId(`row-month-${selectedLessonId}`)).toBeTruthy();
      expect(screen.queryByTestId(`row-month-${hiddenLessonId}`)).toBeNull();
    },
  );

  it('houdt de lesdagkeuze bruikbaar wanneer sessionStorage lezen en schrijven blokkeert', async () => {
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Opslag lezen is geblokkeerd', 'SecurityError');
    });
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Opslag schrijven is geblokkeerd', 'SecurityError');
    });
    const forecast: FinancialLessonSeasonForecast = {
      months: ['2026-09-01'],
      unallocatedLocations: [],
      overallocatedLocations: [],
      locationRentBreakdowns: [],
      lessons: [
        {
          lessonId: 11,
          lessonName: 'Modern',
          totalLessonCount: 4,
          totalRevenue: 500,
          totalCost: 200,
          totalLocationRentCost: 100,
          totalProfit: 300,
          actualMonthCount: 1,
          forecastMonthCount: 0,
          unknownMonthCount: 0,
          promotionGap: null,
          locationRentCalculation: null,
          status: 'healthy',
          months: [{
            month: '2026-09-01',
            status: 'actual',
            missingInputs: [],
            saved: true,
            lessonCount: 4,
            attendance: 18,
            revenue: 500,
            cost: 200,
            locationRentCost: 100,
            locationRentCalculation: null,
            profit: 300,
            breakEvenAttendance: 8,
            promotionGap: null,
          }],
        },
        {
          lessonId: 12,
          lessonName: 'Jazz',
          totalLessonCount: 4,
          totalRevenue: 700,
          totalCost: 250,
          totalLocationRentCost: 120,
          totalProfit: 450,
          actualMonthCount: 1,
          forecastMonthCount: 0,
          unknownMonthCount: 0,
          promotionGap: null,
          locationRentCalculation: null,
          status: 'healthy',
          months: [{
            month: '2026-09-01',
            status: 'actual',
            missingInputs: [],
            saved: true,
            lessonCount: 4,
            attendance: 20,
            revenue: 700,
            cost: 250,
            locationRentCost: 120,
            locationRentCalculation: null,
            profit: 450,
            breakEvenAttendance: 7,
            promotionGap: null,
          }],
        },
      ],
    };
    const lessons: FinancialLessonInput[] = [
      {
        id: 11,
        name: 'Modern',
        teacherId: null,
        teacherClientId: null,
        locationId: 1,
        locationClientId: null,
        weekday: 1,
        startTime: '19:00',
        durationMinutes: 60,
        activeFrom: '2026-09-01',
        activeUntil: '2026-09-30',
      },
      {
        id: 12,
        name: 'Jazz',
        teacherId: null,
        teacherClientId: null,
        locationId: 1,
        locationClientId: null,
        weekday: 3,
        startTime: '20:00',
        durationMinutes: 60,
        activeFrom: '2026-09-01',
        activeUntil: '2026-09-30',
      },
    ];

    try {
      render(
        <LessonSeasonForecast
          forecast={forecast}
          selectedMonth="2026-09-01"
          lessons={lessons}
          onSelectMonth={vi.fn()}
        />,
      );

      expect(getItemSpy).toHaveBeenCalled();
      expect(screen.getByTestId('text-selected-weekday').textContent).toBe('Maandag');
      expect(screen.getByTestId('tab-weekday-1').getAttribute('aria-selected')).toBe('true');

      await userEvent.click(screen.getByTestId('tab-weekday-3'));

      expect(setItemSpy).toHaveBeenCalled();
      expect(screen.getByTestId('text-selected-weekday').textContent).toBe('Woensdag');
      expect(screen.getByTestId('tab-weekday-3').getAttribute('aria-selected')).toBe('true');
      expect(screen.queryByTestId('row-month-11')).toBeNull();
      expect(screen.getByTestId('row-month-12').textContent).toContain('Jazz');
    } finally {
      getItemSpy.mockRestore();
      setItemSpy.mockRestore();
    }
  });

  it('herstelt een gekozen lesdag nadat die tijdelijk niet beschikbaar of de forecast volledig leeg was', async () => {
    const forecast: FinancialLessonSeasonForecast = {
      months: ['2026-09-01', '2026-10-01'],
      unallocatedLocations: [],
      overallocatedLocations: [],
      locationRentBreakdowns: [],
      lessons: [
        {
          lessonId: 11,
          lessonName: 'Modern',
          totalLessonCount: 4,
          totalRevenue: 500,
          totalCost: 200,
          totalLocationRentCost: 100,
          totalProfit: 300,
          actualMonthCount: 1,
          forecastMonthCount: 0,
          unknownMonthCount: 0,
          promotionGap: null,
          locationRentCalculation: null,
          status: 'healthy',
          months: [{
            month: '2026-09-01',
            status: 'actual',
            missingInputs: [],
            saved: true,
            lessonCount: 4,
            attendance: 18,
            revenue: 500,
            cost: 200,
            locationRentCost: 100,
            locationRentCalculation: null,
            profit: 300,
            breakEvenAttendance: 8,
            promotionGap: null,
          }],
        },
        {
          lessonId: 12,
          lessonName: 'Jazz',
          totalLessonCount: 8,
          totalRevenue: 1300,
          totalCost: 550,
          totalLocationRentCost: 250,
          totalProfit: 750,
          actualMonthCount: 2,
          forecastMonthCount: 0,
          unknownMonthCount: 0,
          promotionGap: null,
          locationRentCalculation: null,
          status: 'healthy',
          months: [
            {
              month: '2026-09-01',
              status: 'actual',
              missingInputs: [],
              saved: true,
              lessonCount: 4,
              attendance: 20,
              revenue: 700,
              cost: 300,
              locationRentCost: 150,
              locationRentCalculation: null,
              profit: 400,
              breakEvenAttendance: 9,
              promotionGap: null,
            },
            {
              month: '2026-10-01',
              status: 'actual',
              missingInputs: [],
              saved: true,
              lessonCount: 4,
              attendance: 17,
              revenue: 600,
              cost: 250,
              locationRentCost: 100,
              locationRentCalculation: null,
              profit: 350,
              breakEvenAttendance: 8,
              promotionGap: null,
            },
          ],
        },
      ],
    };
    const lessons: FinancialLessonInput[] = [
      {
        id: 11,
        name: 'Modern',
        teacherId: null,
        teacherClientId: null,
        locationId: 1,
        locationClientId: null,
        weekday: 1,
        startTime: '19:00',
        durationMinutes: 60,
        activeFrom: '2026-09-01',
        activeUntil: '2026-10-31',
      },
      {
        id: 12,
        name: 'Jazz',
        teacherId: null,
        teacherClientId: null,
        locationId: 1,
        locationClientId: null,
        weekday: 3,
        startTime: '20:00',
        durationMinutes: 60,
        activeFrom: '2026-09-01',
        activeUntil: '2026-10-31',
      },
    ];

    const { rerender } = render(
      <LessonSeasonForecast
        forecast={forecast}
        selectedMonth="2026-09-01"
        lessons={lessons}
        onSelectMonth={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByTestId('tab-weekday-3'));
    expect(screen.getByTestId('text-selected-weekday').textContent).toBe('Woensdag');
    expect(screen.getByTestId('tab-weekday-3').getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByTestId('row-month-11')).toBeNull();
    expect(screen.getByTestId('row-month-12').textContent).toContain('Jazz');
    expect(screen.getByTestId('row-month-12').textContent).toContain('€ 700,00');
    expect(screen.getByTestId('row-month-12').textContent).toContain('€ 400,00');

    const forecastWithoutWednesday: FinancialLessonSeasonForecast = {
      ...forecast,
      lessons: forecast.lessons.map(lesson => lesson.lessonId === 12
        ? {
            ...lesson,
            months: lesson.months.filter(month => month.month !== '2026-09-01'),
          }
        : lesson),
    };

    rerender(
      <LessonSeasonForecast
        forecast={forecastWithoutWednesday}
        selectedMonth="2026-09-01"
        lessons={lessons}
        onSelectMonth={vi.fn()}
      />,
    );

    expect(screen.getByTestId('text-selected-weekday').textContent).toBe('Maandag');
    expect(screen.getByTestId('tab-weekday-1').getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByTestId('tab-weekday-3')).toBeNull();
    expect(screen.queryByTestId('row-month-12')).toBeNull();
    const fallbackRow = screen.getByTestId('row-month-11');
    expect(fallbackRow.textContent).toContain('Modern');
    expect(fallbackRow.textContent).toContain('€ 500,00');
    expect(fallbackRow.textContent).toContain('€ 300,00');
    expect(screen.queryByText('Jazz')).toBeNull();
    expect(screen.queryByText('€ 700,00')).toBeNull();
    expect(screen.queryByText('€ 400,00')).toBeNull();

    const restoredForecast: FinancialLessonSeasonForecast = {
      ...forecast,
      lessons: forecast.lessons.map(lesson => lesson.lessonId === 12
        ? {
            ...lesson,
            totalRevenue: 1460,
            totalProfit: 850,
            months: lesson.months.map(month => month.month === '2026-09-01'
              ? {
                  ...month,
                  revenue: 860,
                  profit: 500,
                }
              : month),
          }
        : lesson),
    };

    rerender(
      <LessonSeasonForecast
        forecast={restoredForecast}
        selectedMonth="2026-09-01"
        lessons={lessons}
        onSelectMonth={vi.fn()}
      />,
    );

    expect(screen.getByTestId('text-selected-weekday').textContent).toBe('Woensdag');
    expect(screen.getByTestId('tab-weekday-3').getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByTestId('row-month-11')).toBeNull();
    const restoredRow = screen.getByTestId('row-month-12');
    expect(restoredRow.textContent).toContain('Jazz');
    expect(restoredRow.textContent).toContain('€ 860,00');
    expect(restoredRow.textContent).toContain('€ 500,00');

    const emptyForecast: FinancialLessonSeasonForecast = {
      ...restoredForecast,
      lessons: [],
    };

    rerender(
      <LessonSeasonForecast
        forecast={emptyForecast}
        selectedMonth="2026-09-01"
        lessons={lessons}
        onSelectMonth={vi.fn()}
      />,
    );

    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByTestId('text-selected-weekday')).toBeNull();
    expect(screen.getByText('Geen lesgegevens beschikbaar.')).toBeTruthy();
    expect(screen.queryByTestId('row-month-12')).toBeNull();

    rerender(
      <LessonSeasonForecast
        forecast={restoredForecast}
        selectedMonth="2026-09-01"
        lessons={lessons}
        onSelectMonth={vi.fn()}
      />,
    );

    expect(screen.getByTestId('text-selected-weekday').textContent).toBe('Woensdag');
    expect(screen.getByTestId('tab-weekday-3').getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByTestId('row-month-11')).toBeNull();
    const restoredAfterEmptyRow = screen.getByTestId('row-month-12');
    expect(restoredAfterEmptyRow.textContent).toContain('Jazz');
    expect(restoredAfterEmptyRow.textContent).toContain('€ 860,00');
    expect(restoredAfterEmptyRow.textContent).toContain('€ 500,00');
  });

  it('houdt een nul-lesmaand herkenbaar met nulbedragen in maand- en seizoensweergave', async () => {
    const forecast: FinancialLessonSeasonForecast = {
      months: ['2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01'],
      unallocatedLocations: [],
      overallocatedLocations: [],
      locationRentBreakdowns: [],
      lessons: [{
        lessonId: 11,
        lessonName: 'Modern',
        totalLessonCount: 8,
        totalRevenue: 900,
        totalCost: 400,
        totalLocationRentCost: 200,
        totalProfit: 500,
        actualMonthCount: 1,
        forecastMonthCount: 1,
        unknownMonthCount: 1,
        promotionGap: null,
        locationRentCalculation: null,
        status: 'healthy',
        months: [
          {
            month: '2026-09-01',
            status: 'no_lessons',
            missingInputs: [],
            saved: false,
            lessonCount: 0,
            attendance: 0,
            revenue: 0,
            cost: 0,
            locationRentCost: 0,
            locationRentCalculation: null,
            profit: 0,
            breakEvenAttendance: null,
            promotionGap: null,
          },
          {
            month: '2026-10-01',
            status: 'actual',
            missingInputs: [],
            saved: true,
            lessonCount: 4,
            attendance: 18,
            revenue: 500,
            cost: 200,
            locationRentCost: 100,
            locationRentCalculation: null,
            profit: 300,
            breakEvenAttendance: 8,
            promotionGap: null,
          },
          {
            month: '2026-11-01',
            status: 'forecast',
            missingInputs: [],
            saved: false,
            lessonCount: 4,
            attendance: 16,
            revenue: 400,
            cost: 200,
            locationRentCost: 100,
            locationRentCalculation: null,
            profit: 200,
            breakEvenAttendance: 8,
            promotionGap: null,
          },
          {
            month: '2026-12-01',
            status: 'unknown',
            missingInputs: ['contribution'],
            saved: false,
            lessonCount: 0,
            attendance: null,
            revenue: null,
            cost: 0,
            locationRentCost: 0,
            locationRentCalculation: null,
            profit: null,
            breakEvenAttendance: null,
            promotionGap: null,
          },
        ],
      }],
    };
    const lessons: FinancialLessonInput[] = [{
      id: 11,
      name: 'Modern',
      teacherId: null,
      teacherClientId: null,
      locationId: 1,
      locationClientId: null,
      weekday: 1,
      startTime: '19:00',
      durationMinutes: 60,
      activeFrom: '2026-09-01',
      activeUntil: '2026-12-31',
    }];

    const { rerender } = render(
      <LessonSeasonForecast
        forecast={forecast}
        selectedMonth="2026-09-01"
        lessons={lessons}
        onSelectMonth={vi.fn()}
      />,
    );

    const monthRowElement = screen.getByTestId('row-month-11');
    const monthRow = within(monthRowElement);
    expect(monthRow.getByText('Geen lessen')).toBeTruthy();
    const monthCells = monthRowElement.querySelectorAll('td');
    expect(monthCells[4]?.textContent).toContain('€ 0,00');
    expect(monthCells[5]?.textContent).toBe('€ 0,00');
    expect(monthCells[6]?.textContent).toBe('€ 0,00');

    rerender(
      <LessonSeasonForecast
        forecast={forecast}
        selectedMonth="2026-10-01"
        lessons={lessons}
        onSelectMonth={vi.fn()}
      />,
    );

    const updatedMonthRowElement = screen.getByTestId('row-month-11');
    const updatedMonthRow = within(updatedMonthRowElement);
    expect(updatedMonthRow.getByText('Werkelijk')).toBeTruthy();
    expect(updatedMonthRow.queryByText('Geen lessen')).toBeNull();
    const updatedMonthCells = updatedMonthRowElement.querySelectorAll('td');
    expect(updatedMonthCells[4]?.textContent).toContain('€ 200,00');
    expect(updatedMonthCells[5]?.textContent).toContain('€ 500,00');
    expect(updatedMonthCells[6]?.textContent).toBe('€ 300,00');
    expect(updatedMonthRowElement.textContent).not.toContain('€ 0,00');

    await userEvent.click(screen.getByTestId('toggle-view-season'));
    await userEvent.click(screen.getByTestId('button-toggle-lesson-11'));

    const seasonDetails = within(screen.getByText('Maandelijkse Verdeling').closest('div')!);
    expect(seasonDetails.getByText('Geen lessen')).toBeTruthy();
    expect(seasonDetails.getByText('Werkelijk')).toBeTruthy();
    expect(seasonDetails.getByText('Prognose')).toBeTruthy();
    expect(seasonDetails.getByText('Onbekend: contributie')).toBeTruthy();

    const noLessonsDetailRow = seasonDetails.getByText('Geen lessen').closest('tr')!;
    const detailCells = noLessonsDetailRow.querySelectorAll('td');
    expect(detailCells[4]?.textContent).toContain('€ 0,00');
    expect(detailCells[5]?.textContent).toBe('€ 0,00');
    expect(detailCells[6]?.textContent).toBe('€ 0,00');
  });

  it('vat ontbrekende invoer per maand samen en opent de gekozen maand', async () => {
    const onSelectMonth = vi.fn();
    const missingMonth = (
      lessonId: number,
      lessonName: string,
      month: string,
      missingInputs: Array<'contribution' | 'attendance'>,
    ) => ({
      lessonId,
      lessonName,
      totalLessonCount: 4,
      totalRevenue: 0,
      totalCost: 100,
      totalLocationRentCost: 50,
      totalProfit: -100,
      actualMonthCount: 0,
      forecastMonthCount: 0,
      unknownMonthCount: 1,
      promotionGap: null,
      locationRentCalculation: null,
      status: 'unknown' as const,
      months: [{
        month,
        status: 'unknown' as const,
        missingInputs,
        saved: false,
        lessonCount: 4,
        attendance: null,
        revenue: null,
        cost: 100,
        locationRentCost: 50,
        locationRentCalculation: null,
        profit: null,
        breakEvenAttendance: null,
        promotionGap: null,
      }],
    });
    const jazz = missingMonth(21, 'Jazz', '2026-10-01', ['contribution']);
    jazz.months.push({
      ...jazz.months[0],
      missingInputs: ['attendance'],
    });
    const forecast: FinancialLessonSeasonForecast = {
      months: ['2026-10-01', '2026-11-01', '2026-12-01'],
      unallocatedLocations: [],
      overallocatedLocations: [],
      locationRentBreakdowns: [],
      lessons: [
        jazz,
        missingMonth(22, 'Ballet', '2026-10-01', ['attendance']),
        missingMonth(23, 'Modern', '2026-11-01', ['contribution', 'attendance']),
        missingMonth(24, 'Tap', '2026-12-01', ['attendance']),
        missingMonth(25, 'Hiphop', '2026-12-01', ['contribution']),
      ],
    };
    const lessons: FinancialLessonInput[] = forecast.lessons.map((lesson, index) => ({
      id: lesson.lessonId,
      name: lesson.lessonName,
      teacherId: null,
      teacherClientId: null,
      locationId: 1,
      locationClientId: null,
      weekday: 1,
      startTime: `${18 + index}:00`,
      durationMinutes: 60,
      activeFrom: '2026-09-01',
      activeUntil: '2026-12-31',
    }));

    const { rerender } = render(
      <LessonSeasonForecast
        forecast={forecast}
        selectedMonth="2026-09-01"
        lessons={lessons}
        onSelectMonth={onSelectMonth}
      />,
    );

    expect(screen.queryByText('Meeste geblokkeerde lessen eerst')).toBeNull();

    await userEvent.click(screen.getByTestId('toggle-view-season'));

    const summary = screen.getByTestId('summary-missing-months');
    expect(within(summary).getByText('Meeste geblokkeerde lessen eerst')).toBeTruthy();
    expect(within(summary).getAllByText('oktober 2026')).toHaveLength(1);
    expect(summary.textContent).toContain('contributie en ledenaantallen ontbreken');
    expect(screen.getByTestId('button-open-missing-month-2026-10-01').textContent).toContain('2 lessen geblokkeerd');
    expect(screen.getByTestId('button-open-missing-month-2026-11-01').textContent).toContain('1 les geblokkeerd');
    expect(screen.getByTestId('button-open-missing-month-2026-12-01').textContent).toContain('2 lessen geblokkeerd');
    expect(screen.getByTestId('missing-inputs-21').textContent).toBe('1 maand mist invoer');
    expect(screen.getByTestId('missing-inputs-22').textContent).toBe('1 maand mist invoer');
    expect(screen.getByTestId('missing-inputs-23').textContent).toBe('1 maand mist invoer');
    expect(
      within(summary)
        .getAllByRole('button')
        .map(button => button.getAttribute('data-testid')),
    ).toEqual([
      'button-open-missing-month-2026-10-01',
      'button-open-missing-month-2026-12-01',
      'button-open-missing-month-2026-11-01',
    ]);

    await userEvent.click(screen.getByTestId('button-open-missing-month-2026-10-01'));
    expect(onSelectMonth).toHaveBeenCalledWith('2026-10-01');
    expect(screen.getByTestId('toggle-view-month').textContent).toContain('september 2026');
    expect(screen.queryByTestId('summary-missing-months')).toBeNull();

    await userEvent.click(screen.getByTestId('toggle-view-season'));
    await userEvent.click(screen.getByTestId('button-open-missing-month-2026-12-01'));
    expect(onSelectMonth).toHaveBeenCalledWith('2026-12-01');

    await userEvent.click(screen.getByTestId('toggle-view-season'));
    await userEvent.click(screen.getByTestId('button-open-missing-month-2026-11-01'));
    expect(onSelectMonth).toHaveBeenCalledWith('2026-11-01');

    await userEvent.click(screen.getByTestId('toggle-view-season'));
    expect(screen.getByTestId('summary-missing-months')).toBeTruthy();
    expect(screen.getByText('Meeste geblokkeerde lessen eerst')).toBeTruthy();

    const resolvedForecast = structuredClone(forecast);
    for (const lesson of resolvedForecast.lessons) {
      lesson.status = 'healthy';
      lesson.unknownMonthCount = 0;
      lesson.forecastMonthCount = lesson.months.length;
      for (const month of lesson.months) {
        month.status = 'forecast';
        month.missingInputs = [];
      }
    }

    rerender(
      <LessonSeasonForecast
        forecast={resolvedForecast}
        selectedMonth="2026-09-01"
        lessons={lessons}
        onSelectMonth={onSelectMonth}
      />,
    );

    expect(screen.queryByTestId('summary-missing-months')).toBeNull();
    expect(screen.queryByText('Meeste geblokkeerde lessen eerst')).toBeNull();
  });
});