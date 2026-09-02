import { AxiError } from "axi-sdk-js";

const LINEAR_GRAPHQL_ENDPOINT = "https://api.linear.app/graphql";

interface GraphqlErrorShape {
  message?: string;
  extensions?: {
    code?: string;
    userPresentableMessage?: string;
  };
}

interface GraphqlResponse<T> {
  data?: T;
  errors?: GraphqlErrorShape[];
}

export class LinearClient {
  readonly #apiKey: string | undefined;

  constructor(apiKey = process.env.LINEAR_API_KEY) {
    this.#apiKey = apiKey?.trim() || undefined;
  }

  async request<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    if (!this.#apiKey) {
      throw new AxiError("LINEAR_API_KEY is not set", "AUTH_ERROR", [
        "Export a Linear personal API key: `export LINEAR_API_KEY=lin_api_...`",
      ]);
    }
    let response: Response;
    try {
      response = await fetch(LINEAR_GRAPHQL_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: this.#apiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "linear-axi/0.1",
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new AxiError("Linear API request timed out", "NETWORK_ERROR", ["Retry the command"]);
      }
      throw new AxiError("Could not reach the Linear API", "NETWORK_ERROR", [
        "Check network access and retry the command",
      ]);
    }

    let payload: GraphqlResponse<T>;
    try {
      payload = (await response.json()) as GraphqlResponse<T>;
    } catch {
      throw new AxiError(`Linear API returned an unreadable response (HTTP ${response.status})`, "API_ERROR");
    }

    if (!response.ok || payload.errors?.length) {
      const first = payload.errors?.[0];
      const message = first?.extensions?.userPresentableMessage ?? first?.message;
      const safeMessage = sanitizeApiMessage(message ?? `Request failed with HTTP ${response.status}`);
      const isAuth = response.status === 401 || response.status === 403 || /auth|api key|permission/i.test(safeMessage);
      throw new AxiError(
        isAuth ? `Linear authentication failed: ${safeMessage}` : `Linear API error: ${safeMessage}`,
        isAuth ? "AUTH_ERROR" : "API_ERROR",
        isAuth ? ["Check that LINEAR_API_KEY is valid and has access to this workspace"] : [],
      );
    }
    if (payload.data === undefined) {
      throw new AxiError("Linear API returned no data", "API_ERROR");
    }
    return payload.data;
  }
}

function sanitizeApiMessage(message: string): string {
  return message
    .replace(/lin_api_[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\s+/g, " ")
    .trim();
}

export interface PageInfo {
  hasNextPage: boolean;
  endCursor?: string | null;
}

export interface Connection<T> {
  nodes: T[];
  totalCount?: number;
  pageInfo: PageInfo;
}

export async function attachTotalCount<T>(
  connection: Connection<T>,
  fetchNext: (after: string) => Promise<Connection<{ id: string }>>,
  options: { startsAtBeginning: boolean },
): Promise<void> {
  if (!options.startsAtBeginning) return;
  let total = connection.nodes.length;
  let pageInfo = connection.pageInfo;
  const seen = new Set<string>();
  while (pageInfo.hasNextPage && pageInfo.endCursor) {
    if (seen.has(pageInfo.endCursor)) throw new AxiError("Linear pagination cursor repeated unexpectedly", "API_ERROR");
    seen.add(pageInfo.endCursor);
    const next = await fetchNext(pageInfo.endCursor);
    total += next.nodes.length;
    pageInfo = next.pageInfo;
  }
  connection.totalCount = total;
}

export function mutationEntity<T extends Record<string, unknown>>(
  payload: { success: boolean } & T,
  key: keyof T,
): T[keyof T] {
  if (!payload.success) throw new AxiError("Linear did not apply the requested change", "API_ERROR");
  return payload[key];
}
