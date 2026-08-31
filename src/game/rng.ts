const DEFAULT_NON_ZERO_SEED = 0x6d2b79f5;

export function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) {
    return DEFAULT_NON_ZERO_SEED;
  }

  const normalized = Math.trunc(seed) >>> 0;
  return normalized === 0 ? DEFAULT_NON_ZERO_SEED : normalized;
}

export function nextRandom(rngState: number): {
  state: number;
  value: number;
} {
  let next = normalizeSeed(rngState);
  next ^= next << 13;
  next ^= next >>> 17;
  next ^= next << 5;
  next >>>= 0;

  return {
    state: next,
    value: next / 0x1_0000_0000,
  };
}

export function shuffleWithSeed<T>(
  values: readonly T[],
  rngState: number,
): {
  values: T[];
  state: number;
} {
  const shuffled = [...values];
  let state = normalizeSeed(rngState);

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const random = nextRandom(state);
    state = random.state;
    const swapIndex = Math.floor(random.value * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }

  return { values: shuffled, state };
}
