/**
 * One list of question categories for the whole app. New questions use
 * POST_CATEGORIES; LEGACY ones still exist on the original 210 questions.
 * The feed filter is built from the categories live questions actually have.
 */
export const POST_CATEGORIES = [
  'Money & Salary', 'Family & Marriage', 'Gulf Work Life', 'Expat Life', 'Food Wars', 'Football',
  'Ramadan & Eid', 'Tech & AI', 'Dating & Friendship', 'City Rivalries', 'Guilty Confessions', 'Would You Rather',
];
export const LEGACY_CATEGORIES = [
  'Lifestyle & Daily Habits', 'Personality & Self-Reflection', 'Relationships & Social',
  'Controversial & Debate-Worthy', 'Fun & Pop Culture', 'Career & Ambition', 'Sports',
];
export const ALL_CATEGORIES = [...POST_CATEGORIES, ...LEGACY_CATEGORIES];

/** Categories ordered by how many questions they hold (busiest first), empty ones dropped. */
export function categoriesByCount(questions: Array<{ category?: string }>): string[] {
  const n = new Map<string, number>();
  for (const q of questions) if (q.category) n.set(q.category, (n.get(q.category) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}
