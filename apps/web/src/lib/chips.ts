export type Denom = { value: number; label: string; base: string; edge: string; ink: string };
/** Chip denominations in TAZ (testnet ZEC). Colours follow casino convention. */
export const DENOMS: Denom[] = [
  { value: 0.001, label: ".001", base: "#F1ECE1", edge: "#2B5FA8", ink: "#1D2B44" },
  { value: 0.005, label: ".005", base: "#B3262E", edge: "#F1ECE1", ink: "#FFF7EA" },
  { value: 0.01,  label: ".01",  base: "#1F7A4D", edge: "#F1ECE1", ink: "#FFF7EA" },
  { value: 0.05,  label: ".05",  base: "#17171A", edge: "#F4B728", ink: "#F4B728" },
  { value: 0.1,   label: ".10",  base: "#5B2D86", edge: "#F1ECE1", ink: "#FFF7EA" },
  { value: 0.5,   label: ".50",  base: "#F4B728", edge: "#17171A", ink: "#17171A" },
];
export const denomFor = (v: number) => DENOMS.find(d => d.value === v) ?? DENOMS[0];
