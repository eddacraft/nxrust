import { describe, expect, it } from 'vitest';
import { buildCacheInputs } from './cache-inputs';
import {
  buildTargetConfig,
  checkTargetConfig,
  clippyTargetConfig,
  fmtCheckTargetConfig,
  fmtTargetConfig,
  runTargetConfig,
  testTargetConfig,
} from './target-configs';

describe('target cache inputs', () => {
  it('attaches the cache input contract to every cacheable target', () => {
    const cache = { resolvedToolchain: 'stable' };
    const expectedInputs = buildCacheInputs(cache);

    expect(buildTargetConfig({}, cache).inputs).toEqual(expectedInputs);
    expect(checkTargetConfig({}, cache).inputs).toEqual(expectedInputs);
    expect(clippyTargetConfig({}, cache).inputs).toEqual(expectedInputs);
    expect(fmtCheckTargetConfig({}, cache).inputs).toEqual(expectedInputs);
    expect(testTargetConfig({}, cache).inputs).toEqual(expectedInputs);
  });

  it('does not attach cache inputs to mutating or uncached targets', () => {
    expect(fmtTargetConfig().inputs).toBeUndefined();
    expect(runTargetConfig().inputs).toBeUndefined();
  });
});
