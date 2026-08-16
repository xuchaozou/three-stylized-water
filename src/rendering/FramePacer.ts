export interface FramePacerOptions {
  /** Limit while the camera is idle. 0 means unlimited. */
  idleFps: number;
  /** Limit during camera interaction. 0 means unlimited. */
  activeFps: number;
  /** How long to maintain activeFps after the last interaction. */
  activeHoldMs: number;
}

/**
 * Keeps the display's requestAnimationFrame cadence while throttling only expensive rendering.
 * The 1 ms tolerance prevents 16.6/16.7 ms display-period jitter from unintentionally halving the frame rate.
 */
export class FramePacer {
  private lastRenderAt: number | null = null;
  private lastTickAt: number | null = null;
  private displayInterval: number | null = null;
  private repeatedLongTickGaps = 0;
  private nextRenderAt: number | null = null;
  private scheduledFps: number | null = null;
  private activeUntil = 0;
  private readonly options: FramePacerOptions;

  constructor(options: FramePacerOptions) {
    this.options = options;
  }

  noteActivity(now: number) {
    this.activeUntil = Math.max(this.activeUntil, now + this.options.activeHoldMs);
  }

  forceNextFrame() {
    this.lastRenderAt = null;
    this.lastTickAt = null;
    this.displayInterval = null;
    this.repeatedLongTickGaps = 0;
    this.nextRenderAt = null;
    this.scheduledFps = null;
  }

  shouldRender(now: number) {
    const tickGap = this.lastTickAt === null ? null : now - this.lastTickAt;
    this.lastTickAt = now;
    if (tickGap !== null && tickGap > 0) {
      const longGap = this.displayInterval !== null && tickGap > this.displayInterval * 1.5;
      this.repeatedLongTickGaps = longGap ? this.repeatedLongTickGaps + 1 : 0;
      if (!longGap || this.repeatedLongTickGaps >= 3) {
        this.displayInterval = this.displayInterval === null || this.repeatedLongTickGaps >= 3
          ? tickGap
          : this.displayInterval * 0.8 + tickGap * 0.2;
        this.repeatedLongTickGaps = 0;
      }
    }

    const fps = now < this.activeUntil ? this.options.activeFps : this.options.idleFps;
    if (this.nextRenderAt === null) {
      this.lastRenderAt = now;
      this.scheduledFps = fps;
      this.nextRenderAt = fps > 0 ? now + 1000 / fps : now;
      return true;
    }

    if (fps <= 0) {
      this.lastRenderAt = now;
      this.nextRenderAt = now;
      this.scheduledFps = fps;
      return true;
    }

    const interval = 1000 / fps;
    if (fps !== this.scheduledFps) {
      this.nextRenderAt = (this.lastRenderAt ?? now) + interval;
      this.scheduledFps = fps;
    }

    const tolerance = Math.min(1, interval * 0.1);
    if (now < this.nextRenderAt - tolerance) return false;

    this.lastRenderAt = now;
    const missedDisplayTick = tickGap !== null && this.displayInterval !== null
      && this.repeatedLongTickGaps < 2
      && tickGap > this.displayInterval * 1.5;
    const lateBy = now - this.nextRenderAt;
    const carry = missedDisplayTick ? 0 : lateBy;
    // On high-refresh displays, carry over only small phase errors. Discard long-frame delays because
    // recovering them would cause a catch-up burst that renders after 16 ms immediately following a 50 ms frame.
    this.nextRenderAt = now + interval - carry;
    return true;
  }
}
