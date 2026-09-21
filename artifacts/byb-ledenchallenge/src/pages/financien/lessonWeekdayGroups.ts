export const WEEKDAYS = [
  { value: 1, label: 'Maandag', shortLabel: 'Ma' },
  { value: 2, label: 'Dinsdag', shortLabel: 'Di' },
  { value: 3, label: 'Woensdag', shortLabel: 'Wo' },
  { value: 4, label: 'Donderdag', shortLabel: 'Do' },
  { value: 5, label: 'Vrijdag', shortLabel: 'Vr' },
  { value: 6, label: 'Zaterdag', shortLabel: 'Za' },
  { value: 0, label: 'Zondag', shortLabel: 'Zo' },
] as const;

type ScheduledLesson = {
  id?: number;
  weekday: number;
  startTime: string;
};

export function groupLessonsByWeekday<T extends { lessonId: number; lessonName: string }>(
  lessons: T[],
  schedule: ScheduledLesson[],
) {
  const scheduleById = new Map(
    schedule
      .filter((lesson): lesson is ScheduledLesson & { id: number } => lesson.id != null)
      .map(lesson => [lesson.id, lesson]),
  );

  return WEEKDAYS.map(day => ({
    ...day,
    lessons: lessons
      .filter(lesson => scheduleById.get(lesson.lessonId)?.weekday === day.value)
      .sort((a, b) => {
        const timeComparison = (scheduleById.get(a.lessonId)?.startTime ?? '')
          .localeCompare(scheduleById.get(b.lessonId)?.startTime ?? '');
        return timeComparison || a.lessonName.localeCompare(b.lessonName, 'nl');
      }),
  })).filter(day => day.lessons.length > 0);
}