import { afterEach, describe, expect, it, vi } from "vitest";
import { LinearClient, attachTotalCount, type Connection } from "../src/client.js";

afterEach(() => vi.unstubAllGlobals());

describe("LinearClient", () => {
  it("sends GraphQL with the API key only in the authorization header", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Authorization: "secret-test-key" });
      expect(init?.body).not.toContain("secret-test-key");
      return new Response(JSON.stringify({ data: { viewer: { id: "u1" } } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(new LinearClient("secret-test-key").request("query { viewer { id } }")).resolves.toEqual({ viewer: { id: "u1" } });
  });

  it("redacts key-shaped values from API errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ errors: [{ message: "bad lin_api_should_not_escape" }] }), { status: 400 })));
    await expect(new LinearClient("secret").request("query { viewer { id } }")).rejects.not.toThrow("lin_api_should_not_escape");
  });
});

describe("attachTotalCount", () => {
  it("counts cursor pages without changing the displayed page", async () => {
    const first: Connection<{ id: string }> = { nodes: [{ id: "1" }, { id: "2" }], pageInfo: { hasNextPage: true, endCursor: "c1" } };
    await attachTotalCount(first, async () => ({ nodes: [{ id: "3" }], pageInfo: { hasNextPage: false, endCursor: null } }), { startsAtBeginning: true });
    expect(first.totalCount).toBe(3);
    expect(first.nodes).toHaveLength(2);
  });
});
