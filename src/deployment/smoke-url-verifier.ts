import type { SmokeCheckResult } from '../domain/index.js';

export interface SmokeUrlVerificationInput {
  readonly serviceUrl: string;
  readonly urls: readonly string[];
}

export interface SmokeUrlVerifier {
  verify(input: SmokeUrlVerificationInput): Promise<readonly SmokeCheckResult[]>;
}

export interface MockSmokeUrlVerifierOptions {
  readonly failedUrls?: readonly string[];
  readonly skippedUrls?: readonly string[];
  readonly statusCodeByUrl?: Readonly<Record<string, number>>;
  readonly summaryByUrl?: Readonly<Record<string, string>>;
}

export class MockSmokeUrlVerifier implements SmokeUrlVerifier {
  private readonly failedUrls: ReadonlySet<string>;
  private readonly skippedUrls: ReadonlySet<string>;

  constructor(private readonly options: MockSmokeUrlVerifierOptions = {}) {
    this.failedUrls = new Set(options.failedUrls ?? []);
    this.skippedUrls = new Set(options.skippedUrls ?? []);
  }

  async verify(input: SmokeUrlVerificationInput): Promise<readonly SmokeCheckResult[]> {
    return input.urls.map((url) => this.verifyUrl(input.serviceUrl, url));
  }

  private verifyUrl(serviceUrl: string, url: string): SmokeCheckResult {
    const absoluteUrl = toAbsoluteSmokeUrl(serviceUrl, url);

    if (this.skippedUrls.has(url)) {
      return {
        url: absoluteUrl,
        status: 'skipped',
        summary: this.options.summaryByUrl?.[url] ?? `Mock smoke check skipped for ${url}.`
      };
    }

    if (this.failedUrls.has(url)) {
      return {
        url: absoluteUrl,
        status: 'failed',
        statusCode: this.options.statusCodeByUrl?.[url] ?? 500,
        summary: this.options.summaryByUrl?.[url] ?? `Mock smoke check failed for ${url}.`
      };
    }

    return {
      url: absoluteUrl,
      status: 'passed',
      statusCode: this.options.statusCodeByUrl?.[url] ?? 200,
      summary: this.options.summaryByUrl?.[url] ?? `Mock smoke check passed for ${url}.`
    };
  }
}

export interface HttpSmokeUrlVerifierOptions {
  readonly timeoutMs?: number | undefined;
  readonly fetch?: typeof fetch | undefined;
}

export class HttpSmokeUrlVerifier implements SmokeUrlVerifier {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: HttpSmokeUrlVerifierOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15000;
  }

  async verify(input: SmokeUrlVerificationInput): Promise<readonly SmokeCheckResult[]> {
    const urls = input.urls.length === 0 ? ['/'] : input.urls;
    const results: SmokeCheckResult[] = [];

    for (const url of urls) {
      results.push(await this.verifyUrl(input.serviceUrl, url));
    }

    return results;
  }

  private async verifyUrl(serviceUrl: string, url: string): Promise<SmokeCheckResult> {
    const absoluteUrl = toAbsoluteSmokeUrl(serviceUrl, url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(absoluteUrl, { method: 'GET', signal: controller.signal });
      const status = response.ok ? 'passed' : 'failed';

      return {
        url: absoluteUrl,
        status,
        statusCode: response.status,
        summary: status === 'passed'
          ? `HTTP smoke check passed with status ${response.status}.`
          : `HTTP smoke check failed with status ${response.status}.`
      };
    } catch (error) {
      return {
        url: absoluteUrl,
        status: 'failed',
        summary: `HTTP smoke check failed: ${error instanceof Error ? error.message : String(error)}`
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function toAbsoluteSmokeUrl(serviceUrl: string, url: string): string {
  if (/^https?:\/\//u.test(url)) {
    return url;
  }

  const base = serviceUrl.endsWith('/') ? serviceUrl.slice(0, -1) : serviceUrl;
  const path = url.startsWith('/') ? url : `/${url}`;
  return `${base}${path}`;
}
