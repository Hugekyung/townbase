import { HttpException } from "@nestjs/common";
import { AccessService, type AccessRequest } from "../access/access.service";
import { isFileUpload } from "../files/file-upload";
import path from "node:path";
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
  // Large JSON is confined to the two upload routes, authenticated before allocation.
  // The global guard repeats authentication after parsing, including body scope claims.
  let uploading = false;
  app.use(
    (
      req: AccessRequest & {
        originalUrl?: string;
        url?: string;
        destroyed?: boolean;
        destroy(): void;
        once(event: string, listener: () => void): void;
      },
      res: {
        destroyed?: boolean;
        once(event: string, listener: () => void): void;
        status(code: number): { json(body: unknown): void };
      },
      next: () => void,
    ) => {
      if (!isFileUpload(req)) return next();
      void app
        .get(AccessService)
        .authenticate(req)
        .then(() => {
          if (
            req.headers["content-encoding"] != null &&
            req.headers["content-encoding"] !== "identity"
          )
            res.status(415).json({ code: "unsupported_content_encoding" });
          else {
            if (req.destroyed || res.destroyed) return;
            if (uploading) {
              res.status(409).json({ code: "file_operation_busy" });
              return;
            }
            uploading = true;
            // At most one large upload body per API process. Stop incomplete bodies.
            const deadline = setTimeout(() => req.destroy(), 30_000);
            let released = false;
            const release = () => {
              if (released) return;
              released = true;
              uploading = false;
              clearTimeout(deadline);
            };
            res.once("finish", release);
            res.once("close", release);
            req.once("end", () => clearTimeout(deadline));
            next();
          }
        })
        .catch((error: unknown) => {
          if (error instanceof HttpException)
            res.status(error.getStatus()).json(error.getResponse());
          else res.status(503).json({ code: "auth_unavailable" });
        });
    },
  );
  app.useBodyParser("json", {
    limit: "28mb",
    strict: true,
    type: isFileUpload,
  });
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

// Override the safe API default only after serve-static has found a real build
// asset. Missing assets, parser failures, index.html and API responses stay private.
export function configureSelfHostedStaticAssets(
  app: NestExpressApplication,
  webRoot: string,
): void {
  const assetsRoot = path.resolve(webRoot, "assets");
  app.useStaticAssets(webRoot, {
    dotfiles: "deny",
    index: "index.html",
    setHeaders(
      response: { setHeader(name: string, value: string): void },
      filename: string,
    ) {
      const relative = path.relative(assetsRoot, filename);
      if (
        relative &&
        relative !== ".." &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative)
      )
        response.setHeader("Cache-Control", "public, max-age=0");
    },
  });
  // A file can be found and still fail later (Range/If-Match or stream errors).
  // Restore the private default before forwarding any unsent static error.
  app.use(
    (
      error: unknown,
      _request: unknown,
      response: {
        headersSent?: boolean;
        setHeader(name: string, value: string): void;
      },
      next: (error: unknown) => void,
    ) => {
      if (!response.headersSent)
        response.setHeader("Cache-Control", "no-store");
      next(error);
    },
  );
}
