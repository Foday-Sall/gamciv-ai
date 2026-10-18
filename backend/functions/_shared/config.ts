/** App configuration loading shared by the edge functions. Pure + testable. */

export interface EnvLike {
  get(key: string): string | undefined;
}

export interface AppConfig {
  postgrestUrl: string;
  serviceRoleKey: string;
}

export function loadAppConfig(env: EnvLike): AppConfig {
  const postgrestUrl = env.get("SUPABASE_URL");
  const serviceRoleKey = env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!postgrestUrl || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (stock edge-runtime provides them)",
    );
  }
  return { postgrestUrl: postgrestUrl.replace(/\/+$/, ""), serviceRoleKey };
}

export function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}
