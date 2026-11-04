import type { WorldSnapshot } from "./types";

/**
 * What the native shell has to provide on each platform. See docs/technical-design.md section 5.
 * The real macOS version needs a Rust or Swift shell and is NOT built yet (no Rust toolchain was available).
 * Everything else in src/core runs against this interface, so the shell can be added later.
 */
export interface Sensors {
  read(): WorldSnapshot | Promise<WorldSnapshot>;
}

/** Plays back a fixed list of frames. Used by tests and demos. */
export class ScriptedSensors implements Sensors {
  private i = 0;
  constructor(private frames: WorldSnapshot[]) {
    if (frames.length === 0) throw new Error("ScriptedSensors needs at least one frame");
  }
  read(): WorldSnapshot {
    const f = this.frames[Math.min(this.i, this.frames.length - 1)] as WorldSnapshot;
    this.i += 1;
    return f;
  }
}
