import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildJourneyGeo, travelled} from '../src/journey-geo.ts';

test('the trail follows the traveller between consecutive stops on the same date', () => {
  const geo = buildJourneyGeo({
    stops: [
      {place: 'Santorini', lon: 25.4, lat: 36.4},
      {place: 'Gibraltar', lon: -5.6, lat: 35.95},
      {place: 'Vigo Bay', lon: -8.8, lat: 42.25},
      {place: 'Next stop', lon: -12, lat: 42},
    ],
    t: [1868.12, 1868.13, 1868.13, 1868.13],
    informs: [],
  });
  for (const progress of [1, 1.5, 2, 2.5, 3, 2, 1]) {
    const {pos, trail} = travelled(geo, progress);
    assert.equal(trail.length, Math.ceil(progress));
    assert.deepEqual(trail.at(-1).at(-1), pos);
    if (Number.isInteger(progress)) assert.deepEqual(pos, geo.stops[progress].pos);
    else {
      assert.notDeepEqual(pos, geo.stops[Math.floor(progress)].pos);
      assert.notDeepEqual(pos, geo.stops[Math.ceil(progress)].pos);
    }
  }
});

test('a party that leaves an earlier stop travels concurrently on the shared clock', () => {
  const geo = buildJourneyGeo({
    stops: [
      {place: 'Fork', lon: 0, lat: 0},
      {place: 'Main party', lon: 4, lat: 0},
      {place: 'Second party', lon: 0, lat: 8, from: 'Fork'},
    ],
    t: [10, 12, 14],
    informs: [],
  });
  const {pos, trail, parties} = travelled(geo, 0.5);
  assert.deepEqual(pos, [2, 0]);
  assert.equal(parties.length, 2);
  assert.deepEqual(parties[0], pos);
  assert.ok(Math.abs(parties[1][1] - 2) < 1e-9);
  assert.equal(trail.length, 2);
  assert.ok(Math.abs(travelled(geo, 1.5).pos[1] - 6) < 1e-9);
});
