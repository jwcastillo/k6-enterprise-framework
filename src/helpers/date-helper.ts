/** T-012: DateHelper — Utilidades de fecha y hora */

export type DateFormat = "ISO" | "YYYY-MM-DD" | "DD/MM/YYYY" | "MM/DD/YYYY" | "timestamp";

export interface DateRange {
  start: Date;
  end: Date;
}

export class DateHelper {
  /** Format a date to the requested format */
  static format(date: Date, fmt: DateFormat = "ISO"): string {
    switch (fmt) {
      case "ISO":
        return date.toISOString();
      case "YYYY-MM-DD":
        return date.toISOString().slice(0, 10);
      case "DD/MM/YYYY": {
        const d = date.getUTCDate().toString().padStart(2, "0");
        const m = (date.getUTCMonth() + 1).toString().padStart(2, "0");
        const y = date.getUTCFullYear();
        return `${d}/${m}/${y}`;
      }
      case "MM/DD/YYYY": {
        const d = date.getUTCDate().toString().padStart(2, "0");
        const m = (date.getUTCMonth() + 1).toString().padStart(2, "0");
        const y = date.getUTCFullYear();
        return `${m}/${d}/${y}`;
      }
      case "timestamp":
        return date.getTime().toString();
      default:
        throw new Error(`DateHelper: unknown format '${fmt as string}'`);
    }
  }

  /** Generate a date range relative to now */
  static range(offsetDays: number, durationDays: number): DateRange {
    if (durationDays < 0) {
      throw new Error("DateHelper: durationDays must be non-negative");
    }
    const start = new Date(Date.now() + offsetDays * 86_400_000);
    const end = new Date(start.getTime() + durationDays * 86_400_000);
    if (end < start) {
      throw new Error("DateHelper: end date is before start date");
    }
    return { start, end };
  }

  /** Add days (positive or negative) to a date */
  static addDays(date: Date, days: number): Date {
    return new Date(date.getTime() + days * 86_400_000);
  }

  /** Add hours to a date */
  static addHours(date: Date, hours: number): Date {
    return new Date(date.getTime() + hours * 3_600_000);
  }

  /** Add minutes to a date */
  static addMinutes(date: Date, minutes: number): Date {
    return new Date(date.getTime() + minutes * 60_000);
  }

  /** Convert to Unix timestamp (seconds) */
  static toUnixTimestamp(date: Date): number {
    return Math.floor(date.getTime() / 1000);
  }

  /** Parse ISO string to Date, with clear error on failure */
  static fromISO(iso: string): Date {
    const d = new Date(iso);
    if (isNaN(d.getTime())) {
      throw new Error(`DateHelper: invalid ISO string '${iso}'`);
    }
    return d;
  }

  /** Check if a date is in the past */
  static isPast(date: Date): boolean {
    return date.getTime() < Date.now();
  }

  /** Generate a random date within a range */
  static random(start: Date, end: Date): Date {
    if (end < start) {
      throw new Error("DateHelper: end must be after start for random date generation");
    }
    const delta = end.getTime() - start.getTime();
    return new Date(start.getTime() + Math.random() * delta);
  }

  /** Current timestamp as ISO string */
  static now(): string {
    return new Date().toISOString();
  }
}
