import type { NestExpressApplication } from "@nestjs/platform-express";

// Shared by the real entrypoint and HTTP regression tests. Headers must precede
// parsing so even rejected credential payloads receive the same protections.
export function configureSelfHostedHttp(app: NestExpressApplication): void {
  app.use(
    (
      _request: unknown,
      response: { setHeader(name: string, value: string): void },
      next: () => void,
    ) => {
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Referrer-Policy", "no-referrer");
      response.setHeader("Cache-Control", "no-store");
      response.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      );
      next();
    },
  );
  app.useBodyParser("json", { limit: "8kb", strict: true });
  app.use(
    (
      error: unknown,
      _request: unknown,
      response: { status(code: number): { json(body: unknown): void } },
      next: (error: unknown) => void,
    ) => {
      const type =
        error != null && typeof error === "object" && "type" in error
          ? error.type
          : undefined;
      const statuses: Record<string, number> = {
        "entity.parse.failed": 400,
        "entity.too.large": 413,
        "charset.unsupported": 415,
        "encoding.unsupported": 415,
      };
      if (typeof type === "string" && Object.hasOwn(statuses, type))
        response.status(statuses[type]!).json({ code: "invalid_json" });
      else next(error);
    },
  );
}
