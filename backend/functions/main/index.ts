import * as jose from "jsr:@panva/jose@6";

// `EdgeRuntime` is a global provided only inside the Supabase edge-runtime
// container (the dispatcher spawns user workers); declare it so `deno check`
// passes outside that container.
declare const EdgeRuntime: {
  userWorkers: {
    create(opts: {
      servicePath: string;
      memoryLimitMb: number;
      workerTimeoutMs: number;
      noModuleCache: boolean;
      importMapPath: string | null;
      envVars: [string, string][];
    }): Promise<{ fetch(req: Request): Promise<Response> }>;
  };
};

console.log("main function started");

const JWT_SECRET = Deno.env.get("JWT_SECRET");
const SUPABASE_JWKS = parseJwks(Deno.env.get("SUPABASE_JWKS"));
const VERIFY_JWT = Deno.env.get("VERIFY_JWT") === "true";

// NOTE:(kallebysantos) We don't check for valid keys but just the bare array parsing,
// let this for 'jose' lib verification
export function parseJwks(raw: string | undefined): jose.JSONWebKeySet | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.keys && Array.isArray(parsed.keys)) {
      return parsed as jose.JSONWebKeySet;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extract JWT token from Authorization header
 *
 * Parses the Authorization header to extract the Bearer token.
 * Expects format: "Bearer <token>"
 *
 * @param req - The HTTP request object
 * @returns The JWT token string
 * @throws Error if Authorization header is missing or malformed
 */
function getAuthToken(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    throw new Error("Missing authorization header");
  }
  const [bearer, token] = authHeader.split(" ");
  if (bearer !== "Bearer") {
    throw new Error(`Auth header is not 'Bearer {token}'`);
  }
  return token;
}

async function isValidLegacyJWT(jwt: string): Promise<boolean> {
  if (!JWT_SECRET) {
    console.error("JWT_SECRET not available for HS256 token verification");
    return false;
  }

  const encoder = new TextEncoder();
  const secretKey = encoder.encode(JWT_SECRET);

  try {
    await jose.jwtVerify(jwt, secretKey);
  } catch (e) {
    console.error("Symmetric Legacy JWT verification error", e);
    return false;
  }
  return true;
}

async function isValidJWT(jwt: string): Promise<boolean> {
  if (!SUPABASE_JWKS) {
    console.error("JWKS not available for ES256/RS256 token verification");
    return false;
  }

  try {
    const localJwks = jose.createLocalJWKSet(SUPABASE_JWKS);
    await jose.jwtVerify(jwt, localJwks);
  } catch (e) {
    console.error("Asymmetric JWT verification error", e);
    return false;
  }

  return true;
}

/**
 * Verify JWT token, handling both legacy (HS256) and newer (ES256/RS256) algorithms
 *
 * This function automatically detects the algorithm used in the token and applies
 * the appropriate verification method:
 * - HS256: Uses JWT_SECRET (symmetric key)
 * - ES256/RS256: Uses JWKS endpoint (asymmetric public keys)
 *
 * This fix ensures compatibility with both legacy tokens and newer asymmetric tokens,
 * resolving the "Key for the ES256 algorithm must be of type CryptoKey" error.
 *
 * @param jwt - The JWT token string to verify
 * @returns Promise resolving to true if verification succeeds, false otherwise
 */
async function isValidHybridJWT(jwt: string): Promise<boolean> {
  const { alg: jwtAlgorithm } = jose.decodeProtectedHeader(jwt);

  if (jwtAlgorithm === "HS256") {
    console.log(`Legacy token type detected, attempting ${jwtAlgorithm} verification.`);

    return await isValidLegacyJWT(jwt);
  }

  if (jwtAlgorithm === "ES256" || jwtAlgorithm === "RS256") {
    return await isValidJWT(jwt);
  }

  return false;
}

/**
 * Dispatcher request handler. Wrapped in a catch-all at the bottom of the file
 * so runtime failures (worker spawn errors, unexpected exceptions) never leak
 * stack traces or error text to clients — they return a generic JSON body and
 * log the details server-side instead.
 */
async function handle(req: Request): Promise<Response> {
  if (req.method !== "OPTIONS" && VERIFY_JWT) {
    try {
      const token = getAuthToken(req);
      const isValidJWT = await isValidHybridJWT(token);

      if (!isValidJWT) {
        return new Response(JSON.stringify({ msg: "Invalid JWT" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
    } catch (e) {
      // Missing/malformed Authorization header. Details stay in the server log;
      // the client gets a generic message.
      console.error("auth header validation failed:", e);
      return new Response(JSON.stringify({ msg: "Invalid JWT" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  const url = new URL(req.url);
  const { pathname } = url;
  const path_parts = pathname.split("/");
  const service_name = path_parts[1];

  if (!service_name || service_name === "") {
    const error = { msg: "missing function name in request" };
    return new Response(JSON.stringify(error), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const servicePath = `/home/deno/functions/${service_name}`;
  console.error(`serving the request with ${servicePath}`);

  const memoryLimitMb = 150;
  const workerTimeoutMs = 1 * 60 * 1000;
  const noModuleCache = false;
  const importMapPath = null;
  const envVarsObj = Deno.env.toObject();
  const envVars = Object.entries(envVarsObj) as [string, string][];

  try {
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath,
      memoryLimitMb,
      workerTimeoutMs,
      noModuleCache,
      importMapPath,
      envVars,
    });
    return await worker.fetch(req);
  } catch (e) {
    // Worker spawn/boot failure: log the real error server-side, return a
    // generic body so clients never see stack traces or error text.
    console.error(`worker dispatch failed for ${service_name}:`, e);
    return new Response(JSON.stringify({ msg: "internal error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

Deno.serve((req: Request) => handle(req).catch((e) => {
  // Catch-all: anything that escapes the handler returns a generic response.
  console.error("unhandled dispatcher error:", e);
  return new Response(JSON.stringify({ msg: "internal error" }), {
    status: 500,
    headers: { "Content-Type": "application/json" },
  });
}));
