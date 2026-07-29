import { describe, it, expect } from "vitest";
import { parseCsvBuffer, isValidIsoDate, isNumeric, inferColumnType } from "../../../src/services/csvParser.js";

function csv(lines) {
  return Buffer.from(lines.join("\n") + "\n", "utf8");
}

describe("isValidIsoDate", () => {
  it("accepts a well-formed ISO date", () => {
    expect(isValidIsoDate("2025-06-15")).toBe(true);
  });

  it("rejects a calendar-invalid date (Feb 30)", () => {
    expect(isValidIsoDate("2025-02-30")).toBe(false);
  });

  it("rejects a non-ISO format (DD-MM-YYYY)", () => {
    expect(isValidIsoDate("15-06-2025")).toBe(false);
  });
});

describe("isNumeric", () => {
  it("accepts integers and decimals", () => {
    expect(isNumeric("42")).toBe(true);
    expect(isNumeric("3.14")).toBe(true);
  });

  it("rejects non-numeric strings", () => {
    expect(isNumeric("abc")).toBe(false);
    expect(isNumeric("")).toBe(false);
  });
});

describe("inferColumnType", () => {
  it("infers number when every non-empty value is numeric", () => {
    expect(inferColumnType(["1", "2", "3"])).toBe("number");
  });

  it("infers date when the large majority of values are ISO dates", () => {
    const mostlyDates = [
      "2025-01-01",
      "2025-02-01",
      "2025-03-01",
      "2025-04-01",
      "2025-05-01",
      "2025-06-01",
      "2025-07-01",
      "2025-08-01",
      "2025-09-01",
      "not-a-date",
    ];
    expect(inferColumnType(mostlyDates)).toBe("date");
  });

  it("infers string when values are mixed/non-date/non-number", () => {
    expect(inferColumnType(["Lucknow", "Agra", "Kanpur"])).toBe("string");
  });

  it("treats an all-empty column as string (no crash on empty input)", () => {
    expect(inferColumnType(["", "", ""])).toBe("string");
  });
});

describe("parseCsvBuffer — happy path", () => {
  it("parses a well-formed CSV into typed rows with correct inferred column types", async () => {
    const buffer = csv([
      "case_number,offence_type,fir_date,victim_count",
      "FIR/001,Theft,2025-06-01,2",
      "FIR/002,Robbery,2025-06-15,1",
      "FIR/003,Theft,2025-07-01,3",
    ]);

    const result = await parseCsvBuffer(buffer);

    expect(result.headers).toEqual(["case_number", "offence_type", "fir_date", "victim_count"]);
    expect(result.rows).toHaveLength(3);

    const typeByName = Object.fromEntries(result.columns.map((c) => [c.name, c.inferredType]));
    expect(typeByName.case_number).toBe("string");
    expect(typeByName.offence_type).toBe("string");
    expect(typeByName.fir_date).toBe("date");
    expect(typeByName.victim_count).toBe("number");

    expect(result.rows[0].victim_count).toBe(2);
    expect(result.rows[0].fir_date).toBe("2025-06-01");
    expect(result.rows[0].__issues).toEqual([]);
    expect(result.qualityIssues).toEqual([]);
  });
});

describe("parseCsvBuffer — malformed-row detection (edge case)", () => {
  it("flags unparseable dates and missing required-looking values without dropping the rows", async () => {
    const buffer = csv([
      "case_number,offence_type,fir_date,police_station",
      "FIR/001,Theft,2025-06-01,Kotwali PS",
      "FIR/002,Robbery,2025-06-15,Kotwali PS",
      "FIR/003,Theft,2025-07-01,Kotwali PS",
      "FIR/006,Theft,2025-06-05,Kotwali PS",
      "FIR/007,Theft,2025-06-06,Kotwali PS",
      "FIR/008,Theft,2025-06-07,Kotwali PS",
      "FIR/009,Theft,2025-06-08,Kotwali PS",
      "FIR/010,Theft,2025-06-09,Kotwali PS",
      "FIR/004,Theft,not-a-date,Kotwali PS", // bad date format
      "FIR/005,Theft,2025-02-30,Kotwali PS", // calendar-invalid date
      ",Burglary,2025-06-20,Kotwali PS", // missing case_number
    ]);

    const result = await parseCsvBuffer(buffer);

    // Never silently dropped — all 11 data rows are present.
    expect(result.rows).toHaveLength(11);

    const dateIssueRows = result.rows.filter((r) => r.__issues.some((i) => i.type === "unparseable_date"));
    expect(dateIssueRows).toHaveLength(2);
    expect(dateIssueRows.map((r) => r.case_number)).toEqual(["FIR/004", "FIR/005"]);

    const missingValueRows = result.rows.filter((r) => r.__issues.some((i) => i.type === "missing_value"));
    expect(missingValueRows).toHaveLength(1);
    expect(missingValueRows[0].offence_type).toBe("Burglary");

    const flagTypes = result.qualityIssues.map((f) => f.type).sort();
    expect(flagTypes).toEqual(["missing_value", "unparseable_date"]);

    const dateFlag = result.qualityIssues.find((f) => f.type === "unparseable_date");
    expect(dateFlag.count).toBe(2);
    expect(dateFlag.sampleRowRefs.length).toBeGreaterThan(0);
  });

  it("flags a row with the wrong number of columns instead of throwing", async () => {
    const buffer = csv([
      "case_number,offence_type,fir_date",
      "FIR/001,Theft,2025-06-01",
      "FIR/002,Robbery", // missing a trailing column
    ]);

    const result = await parseCsvBuffer(buffer);

    expect(result.rows).toHaveLength(2);
    const wrongCountRow = result.rows.find((r) => r.__issues.some((i) => i.type === "wrong_column_count"));
    expect(wrongCountRow).toBeDefined();
    expect(wrongCountRow.case_number).toBe("FIR/002");
  });
});

describe("parseCsvBuffer — error path", () => {
  it("rejects a buffer with no header row / unparseable structure", async () => {
    const buffer = Buffer.from("", "utf8");
    await expect(parseCsvBuffer(buffer)).rejects.toThrow();
  });
});
