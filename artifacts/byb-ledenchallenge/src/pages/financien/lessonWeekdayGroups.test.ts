import test from 'node:test';
import assert from 'node:assert/strict';
import { groupLessonsByWeekday } from './lessonWeekdayGroups.ts';

test('groups only scheduled weekdays from Monday through Sunday', () => {
  const groups = groupLessonsByWeekday(
    [
      { lessonId: 1, lessonName: 'Zondag laat' },
      { lessonId: 2, lessonName: 'Maandag vroeg' },
      { lessonId: 3, lessonName: 'Zondag vroeg' },
    ],
    [
      { id: 1, weekday: 0, startTime: '16:00' },
      { id: 2, weekday: 1, startTime: '09:00' },
      { id: 3, weekday: 0, startTime: '10:00' },
    ],
  );

  assert.deepEqual(groups.map(group => group.label), ['Maandag', 'Zondag']);
  assert.deepEqual(groups[1].lessons.map(lesson => lesson.lessonId), [3, 1]);
});

test('omits forecast rows that no longer have a scheduled lesson', () => {
  const groups = groupLessonsByWeekday(
    [{ lessonId: 99, lessonName: 'Oude les' }],
    [{ id: 1, weekday: 3, startTime: '18:00' }],
  );

  assert.deepEqual(groups, []);
});