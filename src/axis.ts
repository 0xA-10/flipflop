export interface Axis<L = string, R = string> {
  left: L;
  right: R;
  /** Optional transform that maps left concept to right (or vice‑versa). */
  map?: (x: string) => string;
}
