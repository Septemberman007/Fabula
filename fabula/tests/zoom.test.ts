import { describe, expect, it } from 'vitest';
import { BOARD_COL, BOARD_ZOOM, TIMELINE_COL, TIMELINE_ZOOM, zoomPair } from '../src/zoom';

const beatWidth = (z: { zoom: number; tlZoom: number }) => [z.zoom * BOARD_COL, z.tlZoom * TIMELINE_COL];
const now = { zoom: 1, tlZoom: 1 };

describe('přiblížení tabule a osy', () => {
  it('nejvíc oddálená tabule ukáže stejně beatů jako nejvíc oddálená osa', () => {
    expect(BOARD_ZOOM.min * BOARD_COL).toBeCloseTo(TIMELINE_ZOOM.min * TIMELINE_COL);
  });

  it('bez propojení se mění jen zvolený pohled', () => {
    expect(zoomPair('board', 0.5, false, now)).toEqual({ zoom: 0.5, tlZoom: 1 });
    expect(zoomPair('timeline', 2, false, now)).toEqual({ zoom: 1, tlZoom: 2 });
  });

  it('při propojení má beat v obou pohledech stejnou šířku', () => {
    for (const [which, value] of [['board', 0.4], ['timeline', 1.3], ['board', 0.001], ['timeline', 99]] as const) {
      const [board, timeline] = beatWidth(zoomPair(which, value, true, now));
      expect(board).toBeCloseTo(timeline, 0);
    }
  });

  it('hodnoty zůstanou v povoleném rozsahu', () => {
    const low = zoomPair('board', 0, true, now);
    const high = zoomPair('timeline', 99, true, now);
    expect(low.zoom).toBeCloseTo(BOARD_ZOOM.min, 2);
    expect(low.tlZoom).toBeCloseTo(TIMELINE_ZOOM.min, 2);
    expect(high.tlZoom).toBeLessThanOrEqual(TIMELINE_ZOOM.max);
    expect(zoomPair('board', 99, false, now).zoom).toBe(BOARD_ZOOM.max);
  });
});
