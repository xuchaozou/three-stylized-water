/** Drawing buffer limit to avoid sustained high load. Approximately 2000x2000 px. */
export const MAX_RENDER_PIXELS = 4_000_000;

/** Preserves Retina resolution on small screens and caps only large screens to the pixel budget. */
export function selectPixelRatio(width: number, height: number, devicePixelRatio: number) {
  const deviceRatio = Math.min(devicePixelRatio, 2);
  const budgetRatio = Math.sqrt(MAX_RENDER_PIXELS / Math.max(1, width * height));
  return Math.min(deviceRatio, budgetRatio);
}
