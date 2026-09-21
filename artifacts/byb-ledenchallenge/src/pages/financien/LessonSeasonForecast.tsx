import { useState, Fragment } from 'react';
import type { FinancialLessonInput, FinancialLessonSeasonForecast } from '@workspace/api-client-react';
import { TrendingUp, TrendingDown, ChevronDown, ChevronUp, AlertCircle, Info, Calendar } from 'lucide-react';
import { groupLessonsByWeekday } from './lessonWeekdayGroups';

const selectedWeekdayStorageKey = 'byb:financial-forecast:selected-weekday:v1';

function readSelectedWeekday() {
  try {
    const storedWeekday = Number(sessionStorage.getItem(selectedWeekdayStorageKey));
    if (!Number.isInteger(storedWeekday) || storedWeekday < 1 || storedWeekday > 7) {
      return 1;
    }
    return storedWeekday === 7 ? 0 : storedWeekday;
  } catch {
    return 1;
  }
}

function rememberSelectedWeekday(weekday: number) {
  try {
    sessionStorage.setItem(selectedWeekdayStorageKey, String(weekday === 0 ? 7 : weekday));
  } catch {
    // The in-memory selection remains usable when browser storage is unavailable.
  }
}

function fmtEuro(amount?: number | null) {
  if (amount == null) return '—';
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(amount);
}

function fmtMonth(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' });
}

function fmtMissingInputs(inputs: Array<'contribution' | 'attendance'>) {
  return inputs.length > 0
    ? inputs.map(input => input === 'contribution' ? 'contributie' : 'ledenaantallen').join(' en ')
    : 'invoer';
}

function RentCalculation({ calculation }: {
  calculation: NonNullable<FinancialLessonSeasonForecast['lessons'][number]['locationRentCalculation']>;
}) {
  return (
    <div className="text-[10px] whitespace-nowrap" data-testid="rent-calculation">
      {calculation.frequency === 'hour'
        ? <>{fmtEuro(calculation.rate)} × {calculation.durationMinutes} min ÷ 60 × {calculation.lessonCount} lesmomenten = {fmtEuro(calculation.totalCost)}</>
        : <>{fmtEuro(calculation.rate)} × {calculation.lessonCount} lesmomenten = {fmtEuro(calculation.totalCost)}</>}
    </div>
  );
}

function collectMissingMonths(forecast: FinancialLessonSeasonForecast) {
  const missingByMonth = new Map<string, {
    missingInputs: Set<'contribution' | 'attendance'>;
    lessonIds: Set<number>;
  }>();

  forecast.lessons.forEach(lesson => {
    lesson.months.forEach(month => {
      if (month.status !== 'unknown') return;

      const missingMonth = missingByMonth.get(month.month) ?? {
        missingInputs: new Set<'contribution' | 'attendance'>(),
        lessonIds: new Set<number>(),
      };
      month.missingInputs.forEach(input => missingMonth.missingInputs.add(input));
      missingMonth.lessonIds.add(lesson.lessonId);
      missingByMonth.set(month.month, missingMonth);
    });
  });

  return forecast.months
    .flatMap(month => {
      const missingMonth = missingByMonth.get(month);
      return missingMonth
        ? [{
            month,
            missingInputs: Array.from(missingMonth.missingInputs),
            affectedLessonCount: missingMonth.lessonIds.size,
          }]
        : [];
    })
    .sort((left, right) =>
      right.affectedLessonCount - left.affectedLessonCount
      || left.month.localeCompare(right.month),
    );
}

export function LessonSeasonForecast({ 
  forecast,
  selectedMonth,
  lessons,
  onSelectMonth,
}: { 
  forecast: FinancialLessonSeasonForecast;
  selectedMonth: string;
  lessons: FinancialLessonInput[];
  onSelectMonth: (month: string) => void;
}) {
  const [viewMode, setViewMode] = useState<'season' | 'month'>('month');
  const [expandedLessonIds, setExpandedLessonIds] = useState<Set<number>>(new Set());
  const [selectedWeekday, setSelectedWeekday] = useState(readSelectedWeekday);

  const toggleExpand = (lessonId: number) => {
    const next = new Set(expandedLessonIds);
    if (next.has(lessonId)) next.delete(lessonId);
    else next.add(lessonId);
    setExpandedLessonIds(next);
  };

  const openMissingMonth = (month: string) => {
    onSelectMonth(month);
    setViewMode('month');
  };

  const visibleLessons = forecast.lessons
    .filter(lp => viewMode === 'season' || lp.months.some(m => m.month === selectedMonth));
  const weekdayGroups = groupLessonsByWeekday(visibleLessons, lessons);
  const effectiveWeekday = weekdayGroups.some(group => group.value === selectedWeekday)
    ? selectedWeekday
    : weekdayGroups[0]?.value;
  const selectedGroup = weekdayGroups.find(group => group.value === effectiveWeekday);
  const displayedLessons = selectedGroup?.lessons ?? [];
  const missingMonths = collectMissingMonths(forecast);

  return (
    <div className="rounded-2xl border bg-card p-6 shadow-sm">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-8 border-b border-border/60 pb-6">
        <div>
          <h3 className="serif text-3xl text-primary mb-2">Leswinstgevendheid</h3>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Analyseer de winstgevendheid per les, bekijk de seizoensprognose en ontdek welke lessen promotie nodig hebben. Berekende opbrengsten in definitieve maanden zijn gebaseerd op werkelijke contributies.
          </p>
        </div>
        
        <div className="flex bg-accent/10 p-1 rounded-lg border border-accent/20 shrink-0 self-start lg:self-auto">
          <button 
            onClick={() => setViewMode('month')}
            className={`px-4 py-2 text-xs font-semibold rounded-md transition-all capitalize ${viewMode === 'month' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-primary hover:bg-accent/20'}`}
            data-testid="toggle-view-month"
          >
            {fmtMonth(selectedMonth)}
          </button>
          <button 
            onClick={() => setViewMode('season')}
            className={`px-4 py-2 text-xs font-semibold rounded-md transition-all ${viewMode === 'season' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-primary hover:bg-accent/20'}`}
            data-testid="toggle-view-season"
          >
            Seizoen Totaal
          </button>
        </div>
      </div>

      {forecast.unallocatedLocations.length > 0 && (
        <div className="mb-6 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-primary" role="alert">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div>
              <p className="font-semibold">Zaalhuur kan niet over lessen worden verdeeld</p>
              <p className="mt-1 text-muted-foreground">
                {forecast.unallocatedLocations.map(location => `${location.locationName} (${fmtEuro(location.totalCost)})`).join(', ')}
                {' '}heeft wel maandhuur, maar geen geplande lesmomenten in dit seizoen. Koppel minimaal één les of pas de locatiehuur aan.
              </p>
            </div>
          </div>
        </div>
      )}

      {forecast.overallocatedLocations.length > 0 && (
        <div className="mb-6 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-primary" role="alert" data-testid="overallocated-rent-warning">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div>
              <p className="font-semibold">Opgeslagen zaalhuur is hoger dan het gewijzigde contract</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
                {forecast.overallocatedLocations.map(location => (
                  <li key={location.locationId}>
                    {location.locationName}: <strong className="text-primary">{fmtEuro(location.previouslyAllocatedCost)}</strong> opgeslagen,
                    terwijl het nieuwe contract <strong className="text-primary">{fmtEuro(location.contractTotal)}</strong> bedraagt.
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-muted-foreground">
                Opgeslagen maanden blijven ongewijzigd. Voor toekomstige lessen wordt geen negatieve zaalhuur verdeeld.
              </p>
            </div>
          </div>
        </div>
      )}

      {forecast.locationRentBreakdowns.length > 0 && (
        <section className="mb-6 rounded-xl border border-border/60 bg-secondary/5 p-4" aria-labelledby="location-rent-heading">
          <div className="mb-3 flex items-center gap-2">
            <Info className="size-4 text-primary" />
            <h4 id="location-rent-heading" className="text-sm font-semibold text-primary">Verdeling maandhuur per zaal</h4>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {forecast.locationRentBreakdowns.map(location => (
              <div key={location.locationId} className="rounded-lg border border-border/50 bg-background/70 p-3" data-testid={`location-rent-${location.locationId}`}>
                <p className="font-semibold text-primary">{location.locationName}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {fmtEuro(location.rentPerTerm)} × {location.rentTermCount} termijnen = <strong className="text-primary">{fmtEuro(location.contractTotal)}</strong>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Verdeeld over <strong className="text-primary">{location.scheduledLessonCount}</strong> geplande lesmomenten.
                </p>
                {location.previouslyAllocatedCost > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Reeds opgeslagen: <strong className="text-primary">{fmtEuro(location.previouslyAllocatedCost)}</strong>
                    {' · '}resterend: <strong className="text-primary">{fmtEuro(location.remainingAllocatedCost)}</strong>
                    {' '}over {location.remainingScheduledLessonCount} momenten.
                  </p>
                )}
                {location.unallocatedCost > 0 && (
                  <p className="mt-1 text-xs font-medium text-destructive">
                    Niet toegewezen: {fmtEuro(location.unallocatedCost)} — er zijn geen resterende lesmomenten om dit bedrag over te verdelen.
                  </p>
                )}
                <div className="mt-3 border-t border-border/40 pt-2">
                  {location.lessons.map(lesson => (
                    <div key={lesson.lessonId} className="flex items-start justify-between gap-3 py-1 text-xs">
                      <span className="text-muted-foreground">
                        {lesson.lessonName} <span className="whitespace-nowrap">({lesson.scheduledLessonCount}×)</span>
                      </span>
                      <strong className="whitespace-nowrap text-primary">{fmtEuro(lesson.allocatedCost)}</strong>
                    </div>
                  ))}
                  <div className="mt-1 flex justify-between gap-3 border-t border-border/30 pt-2 text-xs font-semibold text-primary">
                    <span>Toegewezen zaalhuur</span>
                    <span>{fmtEuro(location.allocatedCost)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {viewMode === 'season' && missingMonths.length > 0 && (
        <section
          className="mb-6 rounded-xl border border-destructive/30 bg-destructive/5 p-4"
          aria-labelledby="missing-months-heading"
          data-testid="summary-missing-months"
        >
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div>
              <h4 id="missing-months-heading" className="text-sm font-semibold text-primary">
                Ontbrekende invoer
              </h4>
              <p className="mt-1 text-xs text-muted-foreground">
                Open een maand om de ontbrekende gegevens aan te vullen.
              </p>
              <p className="mt-2 text-xs font-medium text-primary">
                Meeste geblokkeerde lessen eerst
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {missingMonths.map(({ month, missingInputs, affectedLessonCount }) => (
                  <button
                    key={month}
                    type="button"
                    onClick={() => openMissingMonth(month)}
                    className="rounded-lg border border-destructive/25 bg-background px-3 py-2 text-left text-xs transition-colors hover:border-destructive/50 hover:bg-destructive/5"
                    data-testid={`button-open-missing-month-${month}`}
                  >
                    <span className="block font-semibold capitalize text-primary">{fmtMonth(month)}</span>
                    <span className="text-muted-foreground">
                      {fmtMissingInputs(missingInputs)} {missingInputs.length <= 1 ? 'ontbreekt' : 'ontbreken'}
                    </span>
                    <span className="block text-muted-foreground">
                      {affectedLessonCount} {affectedLessonCount === 1 ? 'les geblokkeerd' : 'lessen geblokkeerd'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {weekdayGroups.length > 0 && (
        <div className="mb-5">
          <div className="flex gap-2 overflow-x-auto pb-2" role="tablist" aria-label="Lesdag">
            {weekdayGroups.map(group => (
              <button
                key={group.value}
                type="button"
                role="tab"
                aria-selected={effectiveWeekday === group.value}
                onClick={() => {
                  setSelectedWeekday(group.value);
                  rememberSelectedWeekday(group.value);
                }}
                className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-semibold transition-colors ${
                  effectiveWeekday === group.value
                    ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                    : 'border-border bg-background text-primary hover:border-accent hover:bg-accent/10'
                }`}
                data-testid={`tab-weekday-${group.value}`}
              >
                <span className="sm:hidden">{group.shortLabel}</span>
                <span className="hidden sm:inline">{group.label}</span>
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                  effectiveWeekday === group.value ? 'bg-primary-foreground/15' : 'bg-secondary'
                }`}>
                  {group.lessons.length}
                </span>
              </button>
            ))}
          </div>
          {selectedGroup && (
            <div className="mt-3 flex items-baseline justify-between gap-4">
              <h4 className="serif text-2xl text-primary" data-testid="text-selected-weekday">{selectedGroup.label}</h4>
              <p className="text-xs text-muted-foreground">
                {selectedGroup.lessons.length} {selectedGroup.lessons.length === 1 ? 'les' : 'lessen'}
              </p>
            </div>
          )}
        </div>
      )}

      <div className="overflow-x-auto" role="tabpanel">
        <table className="w-full text-sm text-left">
          <thead>
            <tr className="border-b border-border/60 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <th className="pb-3 px-2 font-semibold">{viewMode === 'season' ? 'Les' : 'Les'}</th>
              <th className="pb-3 px-2 font-semibold">{viewMode === 'season' ? 'Maanden' : 'Status'}</th>
              <th className="pb-3 px-2 font-semibold text-right whitespace-nowrap">Aantal Lessen</th>
              {viewMode === 'month' && <th className="pb-3 px-2 font-semibold text-right">Ingeschreven</th>}
              <th className="pb-3 px-2 font-semibold text-right">Kosten</th>
              <th className="pb-3 px-2 font-semibold text-right">Opbrengst</th>
              <th className="pb-3 px-2 font-semibold text-right">Winst</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {displayedLessons.length === 0 ? (
              <tr>
                <td colSpan={viewMode === 'month' ? 7 : 6} className="py-8 text-center text-muted-foreground italic">
                  Geen lesgegevens beschikbaar.
                </td>
              </tr>
            ) : displayedLessons.map((lp) => {
              if (viewMode === 'season') {
                const isLoss = lp.status === 'loss';
                const isExpanded = expandedLessonIds.has(lp.lessonId);
                
                return (
                  <Fragment key={lp.lessonId}>
                    <tr
                      className={`transition-colors ${isLoss ? 'bg-destructive/5' : ''} ${isExpanded ? 'bg-secondary/10' : 'hover:bg-secondary/5'}`}
                      data-testid={`row-season-${lp.lessonId}`}
                    >
                      <td className="py-3 font-medium text-primary px-2">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => toggleExpand(lp.lessonId)}
                            className="text-muted-foreground hover:text-primary transition-colors focus:outline-none"
                            aria-label={`${isExpanded ? 'Verberg' : 'Toon'} maanddetails voor ${lp.lessonName}`}
                            aria-expanded={isExpanded}
                            data-testid={`button-toggle-lesson-${lp.lessonId}`}
                          >
                            {isExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                          </button>
                          {isLoss ? <TrendingDown className="size-4 text-destructive shrink-0" /> : <TrendingUp className="size-4 text-[#557b5b] shrink-0" />}
                          <span>{lp.lessonName}</span>
                        </div>
                      </td>
                      <td className="py-3 text-xs text-muted-foreground px-2 min-w-[200px]">
                        <div className="flex flex-wrap gap-1.5">
                          {lp.actualMonthCount > 0 && <span title="Werkelijke maanden (opbrengst verdeeld uit contributie)" className="inline-flex items-center gap-1 rounded bg-primary/10 text-primary px-1.5 py-0.5 font-medium">{lp.actualMonthCount} werkelijk</span>}
                          {lp.forecastMonthCount > 0 && <span title="Prognose maanden (verwachting)" className="inline-flex items-center gap-1 rounded bg-accent/10 text-accent-foreground px-1.5 py-0.5">{lp.forecastMonthCount} prog</span>}
                          {lp.unknownMonthCount > 0 && <span title="Onbekende maanden (te weinig gegevens)" className="inline-flex items-center gap-1 rounded bg-muted/20 text-muted-foreground px-1.5 py-0.5">{lp.unknownMonthCount} onb</span>}
                        </div>
                        {lp.status === 'unknown' && (
                          <p className="mt-2 text-xs font-medium text-destructive" role="status" data-testid={`missing-inputs-${lp.lessonId}`}>
                            {lp.unknownMonthCount} {lp.unknownMonthCount === 1 ? 'maand mist' : 'maanden missen'} invoer
                          </p>
                        )}
                      </td>
                      <td className="py-3 text-muted-foreground px-2 text-right">{lp.totalLessonCount}</td>
                      <td className="py-3 text-muted-foreground px-2 text-right">
                        <div>{fmtEuro(lp.totalCost)}</div>
                        <div className="text-[10px] whitespace-nowrap">waarvan zaalhuur {fmtEuro(lp.totalLocationRentCost)}</div>
                        {lp.locationRentCalculation && <RentCalculation calculation={lp.locationRentCalculation} />}
                      </td>
                      <td className="py-3 text-muted-foreground px-2 text-right">{fmtEuro(lp.totalRevenue)}</td>
                      <td className={`py-3 font-semibold px-2 text-right ${isLoss ? 'text-destructive' : 'text-[#557b5b]'}`}>
                        <div className="flex flex-col items-end">
                          <span>{fmtEuro(lp.totalProfit)}</span>
                          {isLoss && lp.promotionGap != null && lp.promotionGap > 0 && (
                            <span className="text-[10px] uppercase tracking-wider flex items-center gap-1 mt-0.5 text-destructive/80 whitespace-nowrap">
                              <AlertCircle className="size-3" /> {lp.promotionGap} extra nodig
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-secondary/5 border-b-2 border-border/60">
                        <td colSpan={6} className="p-0">
                          <div className="bg-background/40 py-4 px-4 sm:px-8 border-l-2 border-primary/20 shadow-inner">
                            <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
                              <Calendar className="size-3.5" /> Maandelijkse Verdeling
                            </h4>
                            <table className="w-full text-xs text-left mb-2">
                              <thead>
                                <tr className="border-b border-border/40 text-muted-foreground">
                                  <th className="pb-2 font-medium">Maand</th>
                                  <th className="pb-2 font-medium">Status</th>
                                  <th className="pb-2 font-medium text-right">Aantal</th>
                                  <th className="pb-2 font-medium text-right">Ingeschreven</th>
                                  <th className="pb-2 font-medium text-right">Kosten</th>
                                  <th className="pb-2 font-medium text-right">Opbrengst</th>
                                  <th className="pb-2 font-medium text-right">Winst</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border/40">
                                {lp.months.map(m => (
                                  <tr key={m.month} className="hover:bg-secondary/10 transition-colors">
                                    <td className="py-2 font-medium text-primary capitalize">
                                      {m.status === 'unknown' ? (
                                        <button type="button" onClick={() => openMissingMonth(m.month)} className="text-left underline decoration-primary/30 underline-offset-2 hover:decoration-primary">
                                          {fmtMonth(m.month)}
                                        </button>
                                      ) : fmtMonth(m.month)}
                                    </td>
                                    <td className="py-2">
                                      {m.status === 'no_lessons' ? (
                                        <span className="text-muted-foreground font-medium">Geen lessen</span>
                                      ) : m.status === 'actual' ? (
                                        <span className="text-primary font-medium">Werkelijk</span>
                                      ) : m.status === 'forecast' ? (
                                        <span className="text-accent-foreground">Prognose</span>
                                      ) : (
                                        <span className="text-muted-foreground">
                                          Onbekend: {fmtMissingInputs(m.missingInputs)}
                                        </span>
                                      )}
                                    </td>
                                    <td className="py-2 text-muted-foreground text-right">{m.lessonCount}</td>
                                    <td className="py-2 text-muted-foreground text-right">{m.attendance ?? '—'}</td>
                                    <td className="py-2 text-muted-foreground text-right">
                                      <div>{fmtEuro(m.cost)}</div>
                                      <div className="text-[10px] whitespace-nowrap">zaalhuur {fmtEuro(m.locationRentCost)}</div>
                                      {m.locationRentCalculation && <RentCalculation calculation={m.locationRentCalculation} />}
                                    </td>
                                    <td className="py-2 text-muted-foreground text-right">{fmtEuro(m.revenue)}</td>
                                    <td className={`py-2 font-medium text-right ${m.profit != null ? (m.profit < 0 ? 'text-destructive' : 'text-[#557b5b]') : 'text-muted-foreground'}`}>
                                      {fmtEuro(m.profit)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              } else {
                const m = lp.months.find(x => x.month === selectedMonth);
                if (!m) return null;

                const isLoss = m.profit != null && m.profit < 0;

                return (
                  <tr 
                    key={lp.lessonId}
                    className={`transition-colors border-b border-border/60 hover:bg-secondary/5 ${isLoss ? 'bg-destructive/5' : ''}`}
                    data-testid={`row-month-${lp.lessonId}`}
                  >
                    <td className="py-3 font-medium text-primary px-2">
                      <div className="flex items-center gap-2">
                        {isLoss ? <TrendingDown className="size-4 text-destructive shrink-0" /> : (m.profit != null && m.profit >= 0) ? <TrendingUp className="size-4 text-[#557b5b] shrink-0" /> : <Info className="size-4 text-muted-foreground shrink-0" />}
                        <span>{lp.lessonName}</span>
                      </div>
                    </td>
                    <td className="py-3 px-2">
                      {m.status === 'no_lessons' ? (
                        <span className="inline-flex items-center gap-1 rounded bg-muted/20 text-muted-foreground px-1.5 py-0.5 text-[11px] font-medium" title="Geen effectieve lesmomenten in deze maand">Geen lessen</span>
                      ) : m.status === 'actual' ? (
                        <span className="inline-flex items-center gap-1 rounded bg-primary/10 text-primary px-1.5 py-0.5 text-[11px] font-medium" title="Ingevulde maand, opbrengst is verdeeld uit totale contributie">Werkelijk</span>
                      ) : m.status === 'forecast' ? (
                        <span className="inline-flex items-center gap-1 rounded bg-accent/10 text-accent-foreground px-1.5 py-0.5 text-[11px]" title="Berekend met de laatst bekende contributie en bezetting">Prognose</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded bg-muted/20 text-muted-foreground px-1.5 py-0.5 text-[11px]">Onbekend</span>
                      )}
                    </td>
                    <td className="py-3 text-muted-foreground px-2 text-right">
                      <span title="Automatisch berekend aantal lessen in deze maand">{m.lessonCount}</span>
                    </td>
                    <td className="py-3 text-muted-foreground px-2 text-right">{m.attendance ?? '—'}</td>
                    <td className="py-3 text-muted-foreground px-2 text-right">
                      <div>{fmtEuro(m.cost)}</div>
                      <div className="text-[10px] whitespace-nowrap">waarvan zaalhuur {fmtEuro(m.locationRentCost)}</div>
                      {m.locationRentCalculation && <RentCalculation calculation={m.locationRentCalculation} />}
                    </td>
                    <td className="py-3 text-muted-foreground px-2 text-right">
                      {m.status === 'actual' ? (
                        <span className="flex items-center justify-end gap-1" title="Verdeeld uit totale contributie">
                          <Info className="size-3 text-muted-foreground/60" /> {fmtEuro(m.revenue)}
                        </span>
                      ) : (
                        fmtEuro(m.revenue)
                      )}
                    </td>
                    <td className={`py-3 font-semibold px-2 text-right ${isLoss ? 'text-destructive' : (m.profit != null && m.profit >= 0) ? 'text-[#557b5b]' : 'text-muted-foreground'}`}>
                      <div className="flex flex-col items-end">
                        <span>{fmtEuro(m.profit)}</span>
                        {isLoss && m.promotionGap != null && m.promotionGap > 0 && (
                          <span className="text-[10px] uppercase tracking-wider flex items-center gap-1 mt-0.5 text-destructive/80 whitespace-nowrap">
                            <AlertCircle className="size-3" /> {m.promotionGap} extra nodig
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              }
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
