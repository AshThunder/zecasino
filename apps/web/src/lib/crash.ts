/** Shared crash curve: multiplier after t ms (same constant as the game server). */
export const RATE = 0.00006;
export const multAt = (ms: number) => Math.floor(100 * Math.exp(RATE * ms)) / 100;
export const curve = (ms: number) => Math.exp(RATE * ms);
export const msFor = (mult: number) => Math.log(mult) / RATE;
