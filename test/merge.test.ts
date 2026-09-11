import { describe, expect, it } from "vitest";
import { extractPlaceholders, mergeString } from "../src/index.js";

const recipient = { email: "alice@example.com", name: "Alice", fields: { invoice: "INV-1001", company: "Acme <Inc>" } };

describe("mergeString", () => {
  it("substitutes recipient fields, email and name", () => {
    expect(mergeString("Hi {{name}}, invoice {{invoice}} for {{email}}", { recipient })).toBe(
      "Hi Alice, invoice INV-1001 for alice@example.com",
    );
  });

  it("HTML-escapes merged values in html mode", () => {
    expect(mergeString("<p>{{company}}</p>", { recipient }, { html: true })).toBe("<p>Acme &lt;Inc&gt;</p>");
  });

  it("does not escape in text mode", () => {
    expect(mergeString("{{company}}", { recipient })).toBe("Acme <Inc>");
  });

  it("unknown placeholders become empty unless strict", () => {
    expect(mergeString("x{{nope}}y", { recipient })).toBe("xy");
    expect(() => mergeString("{{nope}}", { recipient }, { strict: true })).toThrow(/Unknown merge field/);
  });

  it("supports campaign globals", () => {
    expect(mergeString("{{year}}", { recipient, globals: { year: "2026" } })).toBe("2026");
  });

  it("extractPlaceholders lists unique fields", () => {
    expect(extractPlaceholders("{{a}} {{b}} {{a}}").sort()).toEqual(["a", "b"]);
  });
});
