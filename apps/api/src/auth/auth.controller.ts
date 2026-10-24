import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpException,
  Logger,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
} from "@nestjs/common";
import { AuthService } from "./auth.service";
import {
  authTransportAllowed,
  readSessionCookie,
  sessionCookie,
  type AuthRequest,
} from "./auth-transport";
import { RecoveryIssueError } from "./recovery-error";
type AuthOperation = "login" | "session" | "logout" | "password" | "recovery";
function diagnosticCode(error: unknown): string {
  if (error instanceof RecoveryIssueError) return error.code;
  const code =
    error != null && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
  if (typeof code === "string" && ["P1001", "P1002", "P1017"].includes(code))
    return "database_unavailable";
  if (typeof code === "string" && ["P1008", "P2024", "P2028"].includes(code))
    return "database_transaction_unavailable";
  return "unavailable";
}
type Response = { setHeader(name: string, value: string): void };
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  private boundary(req: AuthRequest, readOnly = false) {
    if (!authTransportAllowed(req, readOnly))
      throw new HttpException({ code: "auth_transport_denied" }, 403);
    if (
      !readOnly &&
      (typeof req.headers["content-type"] !== "string" ||
        !/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"]))
    )
      throw new HttpException({ code: "json_required" }, 415);
  }
  private async run<T extends { ok: boolean; code?: string }>(
    operation: AuthOperation,
    fn: () => Promise<T>,
  ): Promise<T> {
    let result: T;
    try {
      result = await fn();
    } catch (error: unknown) {
      Logger.error(
        `Authentication operation failed [${operation}:${diagnosticCode(error)}].`,
      );
      throw new ServiceUnavailableException({ code: "auth_unavailable" });
    }
    if (!result.ok)
      throw new HttpException(
        { code: result.code },
        result.code === "throttled"
          ? 429
          : result.code === "invalid_request"
            ? 400
            : 401,
      );
    return result;
  }
  @Post("login")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async login(
    @Req() req: AuthRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.boundary(req);
    const result = await this.run("login", () =>
      this.auth.login(body, readSessionCookie(req)),
    );
    if (result.ok) {
      response.setHeader("Set-Cookie", sessionCookie(result.token));
      return { authenticated: true, username: result.username };
    }
  }
  @Get("session")
  @Header("Cache-Control", "no-store")
  async current(@Req() req: AuthRequest) {
    this.boundary(req, true);
    const result = await this.run("session", () =>
      this.auth.current(readSessionCookie(req)),
    );
    if (result.ok)
      return {
        authenticated: true,
        username: result.username,
        expiresAt: result.expiresAt,
      };
  }
  @Post("logout")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async logout(
    @Req() req: AuthRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.boundary(req);
    if (
      body == null ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).length
    )
      throw new HttpException({ code: "invalid_request" }, 400);
    await this.run("logout", async () => {
      const result = await this.auth.logout(readSessionCookie(req));
      // Expired/missing credentials already satisfy logout. A storage outage
      // must still return 503 and preserve the cookie for a confirmed retry.
      return !result.ok && result.code === "unauthorized"
        ? { ok: true as const }
        : result;
    });
    response.setHeader("Set-Cookie", sessionCookie(undefined));
    return { authenticated: false };
  }
  @Post("password")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async password(
    @Req() req: AuthRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.boundary(req);
    await this.run("password", () =>
      this.auth.changePassword(readSessionCookie(req), body),
    );
    response.setHeader("Set-Cookie", sessionCookie(undefined));
    return { authenticated: false, passwordChanged: true };
  }
  @Post("recover")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async recover(
    @Req() req: AuthRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.boundary(req);
    await this.run("recovery", () => this.auth.recover(body));
    response.setHeader("Set-Cookie", sessionCookie(undefined));
    return { authenticated: false, passwordChanged: true };
  }
}
