import { afterEach, describe, expect, it, vi } from "vitest";
import { LinearClient } from "../src/client.js";
import { issueCommand } from "../src/commands/issue.js";

afterEach(() => vi.unstubAllGlobals());

const issueNode = {
  id: "issue-1",
  identifier: "ENG-1",
  title: "Fix login",
  state: { id: "s1", name: "Todo", type: "unstarted" },
  assignee: { id: "human-1", name: "Ada", email: "ada@example.com" },
  delegate: { id: "app-user", name: "abra", email: null },
  team: { id: "t1", key: "ENG", name: "Engineering" },
  labels: { nodes: [] },
};

interface Call { query: string; variables: Record<string, unknown> }

function stubLinear(responses: Record<string, unknown>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Call;
    calls.push(body);
    const name = /(?:query|mutation)\s+(\w+)/.exec(body.query)?.[1] ?? "";
    if (!(name in responses)) throw new Error(`unexpected operation ${name}`);
    return new Response(JSON.stringify({ data: responses[name] }), { status: 200 });
  }));
  return calls;
}

const client = () => new LinearClient({ accessToken: "test-app-token" });
const users = { users: { nodes: [{ id: "app-user", name: "abra", displayName: "abra", email: null, active: true }, { id: "human-1", name: "Ada", displayName: "ada", email: "ada@example.com", active: true }], pageInfo: { hasNextPage: false, endCursor: null } } };
const page = (nodes: unknown[]) => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } });

describe("issue delegate", () => {
  it("filters list by delegate me through viewer, combined with other filters", async () => {
    const calls = stubLinear({
      ResolveViewer: { viewer: { id: "app-user", name: "abra", displayName: "abra", email: null } },
      IssueList: { issues: page([issueNode]) },
    });
    const output = await issueCommand(["list", "--delegate", "me", "--priority", "high"], client());
    const list = calls.find((call) => call.query.includes("IssueList"))!;
    expect(list.query).toContain("delegate { id name email }");
    expect(list.variables.filter).toEqual({ delegate: { id: { eq: "app-user" } }, priority: { eq: 2 } });
    expect(output).toMatchObject({ issues: [{ identifier: "ENG-1", assignee: "ada@example.com", delegate: "abra" }] });
  });

  it("filters search by delegate none and by user reference", async () => {
    let calls = stubLinear({ IssueList: { searchIssues: page([]) } });
    await issueCommand(["search", "login", "--delegate", "none"], client());
    expect(calls[0]!.variables).toMatchObject({ term: "login", filter: { delegate: { null: true } } });

    calls = stubLinear({ Resolve: users, IssueList: { searchIssues: page([]) } });
    await issueCommand(["search", "login", "--delegate", "abra", "--assignee", "ada@example.com"], client());
    expect(calls.at(-1)!.variables.filter).toEqual({ assignee: { id: { eq: "human-1" } }, delegate: { id: { eq: "app-user" } } });
  });

  it("rejects an unknown delegate reference before listing", async () => {
    const calls = stubLinear({ Resolve: users });
    await expect(issueCommand(["list", "--delegate", "ghost"], client())).rejects.toMatchObject({ code: "NOT_FOUND", message: "User not found: ghost" });
    expect(calls.some((call) => call.query.includes("IssueList"))).toBe(false);
  });

  it("sets and clears delegateId on update", async () => {
    const responses = {
      ResolveIssue: { issue: { id: "issue-1", identifier: "ENG-1", title: "Fix login", team: { id: "t1" } } },
      ResolveViewer: { viewer: { id: "app-user", name: "abra" } },
      Resolve: users,
      IssueUpdate: { issueUpdate: { success: true, issue: issueNode } },
    };
    let calls = stubLinear(responses);
    const output = await issueCommand(["update", "ENG-1", "--delegate", "me"], client());
    expect(calls.at(-1)!.variables).toEqual({ id: "issue-1", input: { delegateId: "app-user" } });
    expect(output).toMatchObject({ issue: { assignee: "ada@example.com", delegate: "abra" } });

    calls = stubLinear(responses);
    await issueCommand(["update", "ENG-1", "--delegate", "none"], client());
    expect(calls.at(-1)!.variables).toEqual({ id: "issue-1", input: { delegateId: null } });

    calls = stubLinear(responses);
    await issueCommand(["update", "ENG-1", "--delegate", "abra"], client());
    expect(calls.at(-1)!.variables).toEqual({ id: "issue-1", input: { delegateId: "app-user" } });
  });

  it("rejects an unknown delegate on update without mutating", async () => {
    const calls = stubLinear({ ResolveIssue: { issue: { id: "issue-1", team: { id: "t1" } } }, Resolve: users });
    await expect(issueCommand(["update", "ENG-1", "--delegate", "ghost"], client())).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(calls.some((call) => call.query.includes("IssueUpdate"))).toBe(false);
  });

  it("selects delegate as a field on get and reports none when unset", async () => {
    stubLinear({ IssueGet: { issue: { ...issueNode, delegate: null } } });
    expect(await issueCommand(["get", "ENG-1", "--fields", "identifier,delegate"], client())).toEqual({ issue: { identifier: "ENG-1", delegate: "none" } });
  });

  it("does not accept --delegate on create", async () => {
    await expect(issueCommand(["create", "--team", "ENG", "--title", "x", "--delegate", "me"], client())).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
