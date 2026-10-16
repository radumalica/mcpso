// Minimal GitHub REST client: pagination via Link headers, rate-limit aware,
// retry with exponential backoff + full jitter. No dependencies.
//
// Security notes:
//  - The token is only ever placed in the Authorization header of requests to
//    api.github.com. It is never logged. `redact()` scrubs token-shaped strings
//    from any text we log.
//  - Only https://api.github.com URLs are requested (see assertGithubApi).

import { execFileSync } from "node:child_process";

const API_HOST = "api.github.com";
const TOKEN_RE = /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g;

export function redact(text) {
  return String(text).replace(TOKEN_RE, "[REDACTED]");
}

/** Resolve a token from env (preferred) or, if requested, from the gh CLI. */
export function resolveToken({ env = process.env, useGh = false } = {}) {
  if (env.GITHUB_TOKEN) return env.GITHUB_TOKEN.trim();
  if (useGh) {
    try {
      return execFileSync("gh", ["auth", "token"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export class GitHubError extends Error {
  constructor(message, { status, url } = {}) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
    this.url = url;
  }
}

export function assertGithubApi(url) {
  const u = new URL(url);
  if (u.protocol !== "https:" || u.hostname !== API_HOST) {
    throw new GitHubError(`refusing non-GitHub-API url: ${u.origin}`);
  }
}

/** Parse an RFC 8288 Link header into { rel: url }. */
export function parseLinkHeader(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(",")) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="([^"]+)"/);
    if (m) out[m[2]] = m[1];
  }
  return out;
}

/** Full-jitter exponential backoff delay in ms. */
export function backoffDelay(attempt, { baseMs = 1000, maxMs = 60_000, rand = Math.random } = {}) {
  const cap = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.floor(rand() * cap);
}

export class GitHubClient {
  /**
   * @param {object} o
   * @param {string=} o.token
   * @param {(evt: object) => void} o.log structured logger
   * @param {typeof fetch} [o.fetchImpl]
   * @param {(ms:number)=>Promise<void>} [o.sleep]
   */
  constructor({
    token,
    log = () => {},
    fetchImpl = fetch,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    maxRetries = 7,
    baseDelayMs = 1000,
    maxDelayMs = 60_000,
    maxRateLimitWaitMs = 75 * 60_000,
    lowRemainingThreshold = 15,
    now = () => Date.now(),
  } = {}) {
    this.token = token;
    this.log = log;
    this.fetchImpl = fetchImpl;
    this.sleep = sleep;
    this.maxRetries = maxRetries;
    this.baseDelayMs = baseDelayMs;
    this.maxDelayMs = maxDelayMs;
    this.maxRateLimitWaitMs = maxRateLimitWaitMs;
    this.lowRemainingThreshold = lowRemainingThreshold;
    this.now = now;
    this.rate = { remaining: undefined, reset: undefined, limit: undefined };
    this.requests = 0;
    this.retries = 0; // attempts beyond the first, over the client lifetime
  }

  absolute(pathOrUrl) {
    const url = pathOrUrl.startsWith("http")
      ? pathOrUrl
      : `https://${API_HOST}/${pathOrUrl.replace(/^\//, "")}`;
    assertGithubApi(url);
    return url;
  }

  headers() {
    const h = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "mcp-registry-upstream-import/0.1 (audit tool)",
    };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  recordRate(res) {
    const rem = res.headers.get("x-ratelimit-remaining");
    const reset = res.headers.get("x-ratelimit-reset");
    const limit = res.headers.get("x-ratelimit-limit");
    if (rem !== null) this.rate.remaining = Number(rem);
    if (reset !== null) this.rate.reset = Number(reset);
    if (limit !== null) this.rate.limit = Number(limit);
  }

  async waitForRateLimitIfLow() {
    const { remaining, reset } = this.rate;
    if (remaining === undefined || reset === undefined) return;
    if (remaining > this.lowRemainingThreshold) return;
    const waitMs = Math.max(0, reset * 1000 - this.now()) + 1500;
    if (waitMs > this.maxRateLimitWaitMs) {
      throw new GitHubError(`rate limit reset too far away (${Math.round(waitMs / 1000)}s)`);
    }
    this.log({ level: "warn", event: "rate_limit_wait", wait_s: Math.round(waitMs / 1000), remaining });
    await this.sleep(waitMs);
    this.rate.remaining = undefined;
  }

  /**
   * GET a REST URL. Returns { status, ok, json, headers, url }.
   * 404/410/451 are returned (not thrown) with ok=false so callers can record them.
   * Other persistent failures throw GitHubError.
   */
  async get(pathOrUrl) {
    const url = this.absolute(pathOrUrl);
    let lastErr;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) this.retries++;
      await this.waitForRateLimitIfLow();
      let res;
      try {
        this.requests++;
        res = await this.fetchImpl(url, { headers: this.headers(), signal: AbortSignal.timeout(60_000) });
      } catch (e) {
        lastErr = e;
        const d = backoffDelay(attempt, { baseMs: this.baseDelayMs, maxMs: this.maxDelayMs });
        this.log({ level: "warn", event: "network_error", attempt, delay_ms: d, error: redact(e.message || e) });
        await this.sleep(d);
        continue;
      }
      this.recordRate(res);

      if (res.status === 200) {
        let body;
        try {
          body = await res.json();
        } catch (e) {
          throw new GitHubError(`malformed JSON in 200 response: ${redact(e.message || e)}`, { status: 200, url });
        }
        return { status: 200, ok: true, json: body, headers: res.headers, url };
      }
      if ([404, 410, 451].includes(res.status)) {
        return { status: res.status, ok: false, json: null, headers: res.headers, url };
      }

      const retryAfter = res.headers.get("retry-after");
      const exhausted = this.rate.remaining === 0;
      if (res.status === 429 || (res.status === 403 && (retryAfter || exhausted || (await res.clone().text()).toLowerCase().includes("rate limit")))) {
        let waitMs;
        if (retryAfter) waitMs = Number(retryAfter) * 1000 + 1000;
        else if (exhausted && this.rate.reset) waitMs = Math.max(0, this.rate.reset * 1000 - this.now()) + 1500;
        else waitMs = backoffDelay(attempt, { baseMs: 30_000, maxMs: 300_000 });
        if (waitMs > this.maxRateLimitWaitMs) throw new GitHubError("rate limit wait too long", { status: res.status, url });
        this.log({ level: "warn", event: "rate_limited", status: res.status, attempt, wait_s: Math.round(waitMs / 1000) });
        await this.sleep(waitMs);
        continue;
      }
      if (res.status >= 500) {
        const d = backoffDelay(attempt, { baseMs: this.baseDelayMs, maxMs: this.maxDelayMs });
        this.log({ level: "warn", event: "server_error", status: res.status, attempt, delay_ms: d });
        lastErr = new GitHubError(`HTTP ${res.status}`, { status: res.status, url });
        await this.sleep(d);
        continue;
      }
      const text = redact((await res.text()).slice(0, 300));
      throw new GitHubError(`HTTP ${res.status}: ${text}`, { status: res.status, url });
    }
    throw new GitHubError(`gave up after ${this.maxRetries + 1} attempts: ${redact(lastErr?.message || "unknown")}`, { url });
  }

  /** Async-iterate pages of a list endpoint following rel="next". */
  async *pages(pathOrUrl, { startUrl } = {}) {
    let url = startUrl || this.absolute(pathOrUrl);
    while (url) {
      const res = await this.get(url);
      if (!res.ok) throw new GitHubError(`list endpoint returned ${res.status}`, { status: res.status, url });
      const next = parseLinkHeader(res.headers.get("link")).next || null;
      yield { items: res.json, url, next };
      url = next;
    }
  }
}
