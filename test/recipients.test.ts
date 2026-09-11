import { describe, expect, it } from "vitest";
import { parseRecipients, parseCsvRows } from "../src/index.js";

describe("parseRecipients — TXT", () => {
  it("parses plain, comma, and angle-bracket forms; skips comments and junk", () => {
    const txt = [
      "# my list",
      "alice@example.com",
      "bob@example.com, Bob Jones",
      "Carol Smith <carol@example.com>",
      "not-an-email",
      "",
    ].join("\n");
    const { recipients, skipped } = parseRecipients(txt, "txt");
    expect(recipients.map((r) => r.email)).toEqual(["alice@example.com", "bob@example.com", "carol@example.com"]);
    expect(recipients[1]).toMatchObject({ name: "Bob Jones" });
    expect(recipients[2]).toMatchObject({ name: "Carol Smith" });
    expect(skipped.find((s) => s.value === "not-an-email")).toBeTruthy();
  });

  it("dedupes case-insensitively", () => {
    const { recipients, skipped } = parseRecipients("a@x.com\nA@X.com\n", "txt");
    expect(recipients).toHaveLength(1);
    expect(skipped[0]?.reason).toBe("duplicate");
  });

  it("honours a limit", () => {
    const { recipients, skipped } = parseRecipients("a@x.com\nb@x.com\nc@x.com", "txt", { limit: 2 });
    expect(recipients).toHaveLength(2);
    expect(skipped[0]?.reason).toBe("over limit");
  });
});

describe("parseRecipients — CSV", () => {
  it("reads headers, email, name, and extra merge fields", () => {
    const csv = "email,name,invoice,amount\nalice@example.com,Alice,INV-1001,\"$1,200\"\nbob@example.com,Bob,INV-1002,$300\n";
    const { recipients, headers } = parseRecipients(csv, "csv");
    expect(headers).toEqual(["email", "name", "invoice", "amount"]);
    expect(recipients[0]).toMatchObject({ email: "alice@example.com", name: "Alice", fields: { invoice: "INV-1001", amount: "$1,200" } });
    expect(recipients[1]?.fields).toMatchObject({ invoice: "INV-1002", amount: "$300" });
  });

  it("skips rows with invalid emails and reports them", () => {
    const csv = "email,name\nok@example.com,OK\nbad,Nope\n";
    const { recipients, skipped } = parseRecipients(csv, "csv");
    expect(recipients).toHaveLength(1);
    expect(skipped[0]).toMatchObject({ reason: "invalid or missing email" });
  });

  it("auto-detects format", () => {
    expect(parseRecipients("email,name\na@x.com,A").recipients).toHaveLength(1);
    expect(parseRecipients("a@x.com\nb@x.com").recipients).toHaveLength(2);
  });

  it("parseCsvRows handles quotes, escaped quotes, and CRLF", () => {
    const rows = parseCsvRows('a,"b,c","he said ""hi"""\r\n1,2,3\r\n');
    expect(rows[0]).toEqual(["a", "b,c", 'he said "hi"']);
    expect(rows[1]).toEqual(["1", "2", "3"]);
  });
});
