import { describe, expect, it } from "vitest";

import { extractQueryRangeRows } from "./client";

describe("extractQueryRangeRows", () => {
  it("reads legacy table rows", () => {
    const rows = extractQueryRangeRows({
      data: {
        result: [
          {
            table: {
              rows: [{ traceID: "abc", name: "GET /health" }],
            },
          },
        ],
      },
    });

    expect(rows).toEqual([{ traceID: "abc", name: "GET /health" }]);
  });

  it("reads nested v5 rows with data + timestamp", () => {
    const rows = extractQueryRangeRows({
      data: {
        data: {
          results: [
            {
              rows: [
                {
                  data: { name: "POST /checkout", service: { name: "payments-svc" } },
                  timestamp: "2026-07-24T03:54:30.804Z",
                },
              ],
            },
          ],
        },
      },
    });

    expect(rows[0]).toMatchObject({
      name: "POST /checkout",
      timestamp: "2026-07-24T03:54:30.804Z",
    });
  });
});
