import { afterEach, describe, expect, it, vi } from "vitest";
import { LinearClient, attachTotalCount, type Connection } from "../src/client.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

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

  it("sends an oauth access token as a bearer authorization header", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Authorization: "Bearer secret-oauth-token" });
      expect(init?.body).not.toContain("secret-oauth-token");
      return new Response(JSON.stringify({ data: { viewer: { id: "app-user" } } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(new LinearClient({ accessToken: "secret-oauth-token" }).request("query { viewer { id } }")).resolves.toEqual({ viewer: { id: "app-user" } });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("keeps the api key as a raw authorization header when passed as credentials", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).Authorization).toBe("lin_api_test");
      return new Response(JSON.stringify({ data: { viewer: { id: "u1" } } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await new LinearClient({ apiKey: "lin_api_test" }).request("query { viewer { id } }");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects both credentials before any request without echoing either", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const error = await new LinearClient({ apiKey: "lin_api_secret", accessToken: "secret-oauth-token" }).request("query { viewer { id } }").catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "AUTH_ERROR", message: "Both LINEAR_API_KEY and LINEAR_ACCESS_TOKEN are set" });
    expect(JSON.stringify(error)).not.toMatch(/lin_api_secret|secret-oauth-token/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("names both options when no credential is set", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const error = await new LinearClient({ apiKey: " ", accessToken: "" }).request("query { viewer { id } }").catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "AUTH_ERROR", message: "LINEAR_API_KEY or LINEAR_ACCESS_TOKEN is not set" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads the access token from the environment", async () => {
    vi.stubEnv("LINEAR_API_KEY", "");
    vi.stubEnv("LINEAR_ACCESS_TOKEN", "env-oauth-token");
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Authorization: "Bearer env-oauth-token" });
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await new LinearClient().request("query { viewer { id } }");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("redacts the access token from API errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ errors: [{ message: "token secret-oauth-token rejected lin_oauth_abc123" }] }), { status: 401 })));
    const error = await new LinearClient({ accessToken: "secret-oauth-token" }).request("query { viewer { id } }").catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "AUTH_ERROR" });
    expect(JSON.stringify(error) + String(error)).not.toMatch(/secret-oauth-token|lin_oauth_abc123/);
    expect(String((error as Error).message)).toContain("[redacted]");
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
