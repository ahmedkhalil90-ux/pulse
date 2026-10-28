import { describe, expect, it } from 'vitest';
import { findSimilar, similarity } from '../src/lib/similar';

const index = [
  { id: 'karak', t: 'Karak or flat white?', o: ['Karak', 'Flat white'] as [string, string] },
  { id: 'salary', t: 'Do your parents know your exact monthly salary?', o: ['Yes, exact', 'No or estimate'] as [string, string] },
  { id: 'weekend', t: 'Abu Dhabi or Dubai for the weekend?', o: ['Abu Dhabi', 'Dubai'] as [string, string] },
];

describe('duplicate detection', () => {
  it('catches a reordered question with the same options', () => {
    expect(findSimilar('Flat white or karak?', ['Flat white', 'Karak'], index)?.id).toBe('karak');
  });
  it('catches a reworded question', () => {
    expect(findSimilar('Do your parents know your exact salary each month?', ['Yes', 'No'], index)?.id).toBe('salary');
  });
  it('ignores filler words like "would you rather"', () => {
    expect(findSimilar('Would you rather spend the weekend in Dubai or Abu Dhabi?', ['Dubai', 'Abu Dhabi'], index)?.id).toBe('weekend');
  });
  it('does not flag an unrelated question on a shared topic word', () => {
    expect(findSimilar('Is karak overrated?', ['Yes', 'No'], index)).toBeNull();
    expect(findSimilar('Would you move to Dubai for a 20% raise?', ['Move', 'Stay'], index)).toBeNull();
  });
  it('works on Arabic text', () => {
    expect(similarity('كرك ولا فلات وايت؟', ['كرك', 'فلات وايت'], 'فلات وايت ولا كرك؟', ['فلات وايت', 'كرك'])).toBeGreaterThanOrEqual(0.5);
  });
});
