import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpException,
  Param,
  Post,
  Put,
  Req,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Logger } from "@nestjs/common";
import { AccessService, type AccessRequest } from "../access/access.service";
import { readSessionCookie } from "../auth/auth-transport";
import { fields } from "../auth/auth-policy";
import { ModelIntegrationService } from "./model-integration.service";
import {
  validApiKey,
  CredentialStorageError,
  type CredentialPurpose,
} from "./credential-vault";
export function integrationFailureCode(error: unknown): string {
  if (
    error instanceof CredentialStorageError &&
    ["master_key_unavailable", "credential_unavailable"].includes(error.code)
  )
    return error.code;
  const code =
    error != null && typeof error === "object"
      ? (("code" in error ? error.code : undefined) ??
        ("errorCode" in error ? error.errorCode : undefined))
      : undefined;
  if (["P1001", "P1002", "P1017"].some((allowed) => code === allowed))
    return "database_unavailable";
  if (["P1008", "P2024", "P2028"].some((allowed) => code === allowed))
    return "database_transaction_unavailable";
  return "storage_unavailable";
}
function purpose(value: string): CredentialPurpose {
  if (value !== "answer" && value !== "embedding")
    throw new HttpException({ code: "invalid_request" }, 400);
  return value;
}
function invalid(): never {
  throw new HttpException({ code: "invalid_request" }, 400);
}
@Controller("settings/model-integration")
export class ModelIntegrationController {
  constructor(
    private readonly settings: ModelIntegrationService,
    private readonly access: AccessService,
  ) {}
  private async read<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error: unknown) {
      const code = integrationFailureCode(error);
      Logger.error(`Model integration settings unavailable [${code}].`);
      throw new ServiceUnavailableException({
        code: "integration_unavailable",
        reason: code,
      });
    }
  }
  private async write<T extends { ok: boolean; code?: string }>(
    work: () => Promise<T>,
  ) {
    const result = await this.read(work);
    if (!result.ok)
      throw new HttpException(
        { code: result.code },
        result.code === "throttled"
          ? 429
          : result.code === "invalid_request"
            ? 400
            : 401,
      );
    return Object.fromEntries(
      Object.entries(result).filter(([field]) => field !== "ok"),
    );
  }
  @Get()
  @Header("Cache-Control", "no-store")
  snapshot(@Req() req: AccessRequest) {
    const context = this.access.requester(req);
    return this.read(() => this.settings.snapshot(context));
  }
  @Put("credentials/:purpose")
  @Header("Cache-Control", "no-store")
  replace(
    @Req() req: AccessRequest,
    @Param("purpose") name: string,
    @Body() body: unknown,
  ) {
    const target = purpose(name);
    if (
      !fields(body, ["currentPassword", "apiKey"]) ||
      !validApiKey(body.apiKey)
    )
      invalid();
    const value = body as { currentPassword: unknown; apiKey: string };
    return this.write(() =>
      this.settings.replace(
        readSessionCookie(req),
        value.currentPassword,
        this.access.requester(req),
        target,
        value.apiKey,
      ),
    );
  }
  @Post("credentials/:purpose/disable")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  disable(
    @Req() req: AccessRequest,
    @Param("purpose") name: string,
    @Body() body: unknown,
  ) {
    const target = purpose(name);
    if (!fields(body, ["currentPassword"])) invalid();
    return this.write(() =>
      this.settings.disable(
        readSessionCookie(req),
        body.currentPassword,
        this.access.requester(req),
        target,
      ),
    );
  }
  @Delete("credentials/:purpose")
  @Header("Cache-Control", "no-store")
  remove(
    @Req() req: AccessRequest,
    @Param("purpose") name: string,
    @Body() body: unknown,
  ) {
    const target = purpose(name);
    if (!fields(body, ["currentPassword"])) invalid();
    return this.write(() =>
      this.settings.remove(
        readSessionCookie(req),
        body.currentPassword,
        this.access.requester(req),
        target,
      ),
    );
  }
  @Put("transfers")
  @Header("Cache-Control", "no-store")
  transfers(@Req() req: AccessRequest, @Body() body: unknown) {
    if (
      !fields(body, [
        "currentPassword",
        "documentEmbedding",
        "rag",
        "attachment",
      ]) ||
      ["documentEmbedding", "rag", "attachment"].some(
        (key) => typeof body[key] !== "boolean",
      )
    )
      invalid();
    const flags = body as {
      currentPassword: unknown;
      documentEmbedding: boolean;
      rag: boolean;
      attachment: boolean;
    };
    return this.write(() =>
      this.settings.setTransfers(
        readSessionCookie(req),
        flags.currentPassword,
        this.access.requester(req),
        {
          documentEmbedding: flags.documentEmbedding,
          rag: flags.rag,
          attachment: flags.attachment,
        },
      ),
    );
  }
}
