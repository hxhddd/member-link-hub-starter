import test from 'node:test';
import assert from 'node:assert/strict';
import { bangkokUsageDate } from '../src/lib/activity.js';

test('daily quota uses Asia/Bangkok reset boundary', () => {
  assert.equal(bangkokUsageDate(new Date('2026-11-01T20:00:00.000Z'),'05:00'),'2026-11-01'); // 03:00 Bangkok: previous quota day
  assert.equal(bangkokUsageDate(new Date('2026-11-01T22:30:00.000Z'),'05:00'),'2026-11-02'); // 05:30 Bangkok: new quota day
  assert.equal(bangkokUsageDate(new Date('2026-11-01T21:59:00.000Z'),'05:00'),'2026-11-01'); // 04:59 Bangkok: previous quota day
});
