import { describe, expect, it, vi } from "vitest";
import { AiDrafter, extractJson } from "../src/index.js";

function fakeClient(text: string) {
  const create = vi.fn(async () => ({ content: [{ type: "text", text }] }));
  return { client: { messages: { create } }, create };
}

describe("extractJson", () => {
  it("parses plain JSON, fenced JSON, and JSON with surrounding prose", () => {
    expect(extractJson('{"subject":"A","body":"B"}')).toMatchObject({ subject: "A" });
    expect(extractJson('```json\n{"subject":"A"}\n```')).toMatchObject({ subject: "A" });
    expect(extractJson('Sure!\n{"subject":"A","body":"B"}\nHope that helps')).toMatchObject({ body: "B" });
    expect(() => extractJson("not json")).toThrow();
  });
});

describe("AiDrafter", () => {
  it("drafts a plain-text email", async () => {
    const { client, create } = fakeClient(JSON.stringify({ subject: "Invoice reminder", body: "Hi,\n\nYour invoice is due." }));
    const drafter = new AiDrafter({ client });
    const out = await drafter.draft({ prompt: "remind about invoice", format: "plain" });
    expect(out.subject).toBe("Invoice reminder");
    expect(out.text).toContain("Your invoice is due.");
    expect(out.html).toBeUndefined();
    // model defaults to opus 5, effort low
    const body = create.mock.calls[0]![0] as { model: string; output_config: { effort: string } };
    expect(body.model).toBe("claude-opus-5");
    expect(body.output_config.effort).toBe("low");
  });

  it("drafts an HTML email rendered as bulletproof HTML", async () => {
    const { client } = fakeClient(JSON.stringify({ subject: "Welcome", body: "# Welcome\n\nGlad you're here.\n\n[Get started](https://x.com/start)" }));
    const drafter = new AiDrafter({ client });
    const out = await drafter.draft({ prompt: "welcome email", format: "html", senderName: "Acme" });
    expect(out.html).toContain("<!DOCTYPE html PUBLIC");
    expect(out.html).toContain("Welcome");
    expect(out.html).toContain("v:roundrect"); // the CTA became a bulletproof button
    expect(out.html).toContain("https://x.com/start");
    expect(out.text).toContain("Get started");
  });

  it("passes guidance into the system prompt", async () => {
    const { client, create } = fakeClient(JSON.stringify({ subject: "s", body: "b" }));
    await new AiDrafter({ client }).draft({ prompt: "x", format: "plain", guidance: "Keep it under 50 words." });
    const body = create.mock.calls[0]![0] as { system: string };
    expect(body.system).toContain("Keep it under 50 words.");
  });

  it("requires a prompt", async () => {
    const { client } = fakeClient("{}");
    await expect(new AiDrafter({ client }).draft({ prompt: "  ", format: "plain" })).rejects.toThrow(/prompt is required/);
  });
});
