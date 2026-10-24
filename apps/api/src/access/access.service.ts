import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { AuthService, type AdministratorContext } from "../auth/auth.service";
import {
  authTransportAllowed,
  isJsonRequest,
  readSessionCookie,
  type AuthRequest,
} from "../auth/auth-transport";
import { logAuthFailure } from "../auth/auth-diagnostics";
export type AccessRequest = AuthRequest & {
  method: string;
  params?: unknown;
  query?: unknown;
  body?: unknown;
};
function validRequester(value: unknown): value is AdministratorContext {
  if (value == null || typeof value !== "object" || Array.isArray(value))
    return false;
  return [
    "administratorId",
    "installationId",
    "workspaceId",
    "username",
    "expiresAt",
  ].every(
    (field) =>
      typeof (value as Record<string, unknown>)[field] === "string" &&
      ((value as Record<string, unknown>)[field] as string).length > 0,
  );
}
@Injectable()
export class AccessService {
  private readonly requesters = new WeakMap<
    object,
    Readonly<AdministratorContext>
  >();
  constructor(private readonly auth: AuthService) {}
  async authenticate(request: AccessRequest): Promise<void> {
    this.requesters.delete(request);
    if (
      !authTransportAllowed(request, ["GET", "HEAD"].includes(request.method))
    )
      throw new ForbiddenException({ code: "auth_transport_denied" });
    if (!["GET", "HEAD"].includes(request.method) && !isJsonRequest(request))
      throw new UnsupportedMediaTypeException({ code: "json_required" });
    let result: Awaited<ReturnType<AuthService["requester"]>>;
    try {
      result = await this.auth.requester(readSessionCookie(request));
      if (
        result == null ||
        typeof result.ok !== "boolean" ||
        (result.ok && !validRequester(result.requester))
      )
        throw new Error("Stored administrator context unavailable");
    } catch (error) {
      logAuthFailure("access", error);
      throw new ServiceUnavailableException({ code: "auth_unavailable" });
    }
    if (!result.ok) throw new UnauthorizedException({ code: "unauthorized" });
    const context = Object.freeze({ ...result.requester });
    // Claims are constraints only. Identity always comes from the stored session.
    for (const input of [request.params, request.query, request.body]) {
      if (input == null || typeof input !== "object") continue;
      for (const field of [
        "installationId",
        "workspaceId",
        "administratorId",
      ] as const) {
        if (
          Object.hasOwn(input, field) &&
          (input as Record<string, unknown>)[field] !== context[field]
        )
          this.denied();
      }
    }
    for (const [header, field] of [
      ["x-installation-id", "installationId"],
      ["x-workspace-id", "workspaceId"],
      ["x-administrator-id", "administratorId"],
    ] as const) {
      const value = request.headers[header];
      if (value != null && value !== context[field]) this.denied();
    }
    this.requesters.set(request, context);
  }
  requester(request: object): Readonly<AdministratorContext> {
    const value = this.requesters.get(request);
    if (!value) throw new UnauthorizedException({ code: "unauthorized" });
    return value;
  }
  assertInstallation(request: object, installationId: unknown): void {
    if (installationId !== this.requester(request).installationId)
      this.denied();
  }
  // Resource fields must come from a stored row, never a request DTO.
  assertWorkspaceResource(
    request: object,
    resource: { workspaceId: unknown },
  ): void {
    if (resource?.workspaceId !== this.requester(request).workspaceId)
      this.denied();
  }
  assertOwnedResource(
    request: object,
    resource: { workspaceId: unknown; ownerAdministratorId: unknown },
  ): void {
    this.assertWorkspaceResource(request, resource);
    if (
      resource.ownerAdministratorId !== this.requester(request).administratorId
    )
      this.denied();
  }
  private denied(): never {
    throw new ForbiddenException({ code: "access_denied" });
  }
}
