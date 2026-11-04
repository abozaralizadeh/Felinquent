import fs from "node:fs";
import path from "node:path";
import { InMemoryMemory, type MemoryEvent } from "../core/memory";

/**
 * Cat memory saved as a JSON file (no database dependency yet; SQLite is the proposed upgrade).
 * Local only. Holds app names and event kinds, never window titles.
 */
export class JsonFileMemory extends InMemoryMemory {
  constructor(private file: string) {
    super();
    try {
      this.loadJson(fs.readFileSync(file, "utf8"));
    } catch {
      this.list = [];
    }
  }

  override log(ev: MemoryEvent): void {
    super.log(ev);
    this.save();
  }

  override forgetAll(): void {
    super.forgetAll();
    this.save();
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, this.exportJson());
    fs.renameSync(tmp, this.file);
  }
}
