/**
 * Minimal typed PostgREST RPC client (plain fetch, service_role by default).
 * Edge functions make exactly one RPC call each; all business logic is SQL.
 */
export class RpcError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Abstract interface so tests can stub RPC calls. */
export interface RpcClient {
  call<TArgs, TResult>(fnName: string, args: TArgs): Promise<TResult>;
}

export interface RpcClientConfig {
  postgrestUrl: string;
  serviceRoleKey: string;
}

export class PostgrestRpcClient implements RpcClient {
  private readonly baseUrl: string;
  private readonly serviceRoleKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: RpcClientConfig, fetchImpl: typeof fetch = fetch) {
    this.baseUrl = config.postgrestUrl.replace(/\/+$/, "");
    this.serviceRoleKey = config.serviceRoleKey;
    this.fetchImpl = fetchImpl;
  }

  async call<TArgs, TResult>(fnName: string, args: TArgs): Promise<TResult> {
    const url = `${this.baseUrl}/rest/v1/rpc/${fnName}`;
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.serviceRoleKey}`,
        apikey: this.serviceRoleKey,
      },
      body: JSON.stringify(args ?? {}),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      let message = `rpc ${fnName} HTTP ${res.status}`;
      try {
        const err = JSON.parse(detail) as { message?: string };
        if (err.message) message += `: ${err.message}`;
      } catch {
        if (detail) message += `: ${detail.slice(0, 200)}`;
      }
      throw new RpcError(res.status, message);
    }
    const text = await res.text();
    if (!text || text === "null") return null as TResult;
    try {
      return JSON.parse(text) as TResult;
    } catch {
      throw new RpcError(res.status, `rpc ${fnName} returned invalid JSON`);
    }
  }
}
