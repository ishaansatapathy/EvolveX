import { describe, expect, it } from "vitest";

import {
  parseRecipientAddress,
  sanitizeEmailHeader,
  singleRecipientSchema,
} from "./email";

describe("sanitizeEmailHeader", () => {
  it("removes CRLF injection from header values", () => {
    expect(sanitizeEmailHeader("foo\r\nBcc: evil@example.com")).toBe("fooBcc: evil@example.com");
  });
});

describe("singleRecipientSchema", () => {
  it("accepts plain and display-name addresses", () => {
    expect(singleRecipientSchema.parse("guest@company.com")).toBe("guest@company.com");
    expect(singleRecipientSchema.parse("Jane Doe <jane@company.com>")).toBe(
      "Jane Doe <jane@company.com>",
    );
  });

  it("rejects invalid addresses", () => {
    expect(singleRecipientSchema.safeParse("not-an-email").success).toBe(false);
  });
});

describe("parseRecipientAddress", () => {
  it("extracts the mailbox from display-name syntax", () => {
    expect(parseRecipientAddress("Jane <jane@company.com>")).toBe("jane@company.com");
  });
});
