import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { computeProfile } from "../../../src/services/profiler.js";
import { parseCsvBuffer } from "../../../src/services/csvParser.js";

function csv(lines) {
  return Buffer.from(lines.join("\n") + "\n", "utf8");
}

describe("computeProfile — happy path", () => {
  it("computes column list, row count, and date range from well-formed rows", async () => {
    const buffer = csv([
      "case_number,offence_type,fir_date",
      "FIR/001,Theft,2025-06-01",
      "FIR/002,Robbery,2025-08-15",
      "FIR/003,Theft,2025-01-20",
    ]);
    const parsed = await parseCsvBuffer(buffer);

    const profile = computeProfile(parsed);

    expect(profile.rowCount).toBe(3);
    expect(profile.columns.map((c) => c.name)).toEqual(["case_number", "offence_type", "fir_date"]);
    expect(profile.dateRangeMin).toBe("2025-01-20");
    expect(profile.dateRangeMax).toBe("2025-08-15");
    expect(profile.qualityFlags).toEqual([]);
    expect(profile.excludedRowCount).toBe(0);
  });
});

describe("computeProfile — edge case: excludeBadRows", () => {
  it("excludes flagged rows from the row count and date range only when excludeBadRows is true", async () => {
    const buffer = csv([
      "case_number,offence_type,fir_date",
      "FIR/001,Theft,2025-06-01",
      "FIR/002,Theft,2025-06-02",
      "FIR/003,Theft,2025-06-03",
      "FIR/004,Theft,2025-06-04",
      "FIR/005,Theft,2025-06-05",
      "FIR/006,Theft,2025-06-06",
      "FIR/007,Theft,2025-06-07",
      "FIR/008,Theft,2025-06-08",
      "FIR/009,Theft,not-a-date",
      "FIR/010,Theft,2025-12-25",
    ]);
    const parsed = await parseCsvBuffer(buffer);

    const kept = computeProfile(parsed, { excludeBadRows: false });
    expect(kept.rowCount).toBe(10);
    expect(kept.qualityFlags.find((f) => f.type === "unparseable_date").count).toBe(1);
    // Bad row's null date must not corrupt the range.
    expect(kept.dateRangeMax).toBe("2025-12-25");

    const excluded = computeProfile(parsed, { excludeBadRows: true });
    expect(excluded.rowCount).toBe(9);
    expect(excluded.excludedRowCount).toBe(1);
    // qualityFlags still reports what was found/excluded, for transparency.
    expect(excluded.qualityFlags.find((f) => f.type === "unparseable_date").count).toBe(1);
  });
});

describe("computeProfile — error path: no date column at all", () => {
  it("returns null date range instead of crashing when no column is date-typed", async () => {
    const buffer = csv(["name,city", "Rao,Lucknow", "Singh,Agra"]);
    const parsed = await parseCsvBuffer(buffer);

    const profile = computeProfile(parsed);

    expect(profile.dateRangeMin).toBeNull();
    expect(profile.dateRangeMax).toBeNull();
    expect(profile.rowCount).toBe(2);
  });
});

describe("computeProfile — full-file scan (not sampling)", () => {
  it("matches the real 500-row fixture's known malformed-row count", async () => {
    const filePath = path.join(process.cwd(), "tests", "fixtures", "sample_fir_500rows.csv");
    const buffer = fs.readFileSync(filePath);
    const parsed = await parseCsvBuffer(buffer);
    const profile = computeProfile(parsed);

    expect(profile.rowCount).toBe(500);
    const totalFlagged = profile.qualityFlags.reduce((sum, f) => sum + f.count, 0);
    expect(totalFlagged).toBeGreaterThanOrEqual(10);
    expect(totalFlagged).toBeLessThanOrEqual(20);
  });
});
