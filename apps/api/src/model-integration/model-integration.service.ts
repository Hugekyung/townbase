import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  AuthService,
  type AdministratorContext,
  type AuthTransaction,
} from "../auth/auth.service";
import { DeploymentDatabase } from "../deployment/deployment-database";
import { CredentialVault, type CredentialPurpose } from "./credential-vault";
import {
  DEFAULT_TRANSFERS,
  FIXED_EMBEDDING,
  inspectTransfer,
  type TransferFlags,
  type TransferPurpose,
} from "./transfer-policy";

type Action = Parameters<
  AuthTransaction["installationAuditEvent"]["create"]
>[0]["data"]["action"];
@Injectable()
export class ModelIntegrationService {
  constructor(
    private readonly database: DeploymentDatabase,
    private readonly auth: AuthService,
    private readonly vault: CredentialVault,
  ) {}
  async snapshot(context: AdministratorContext) {
    const rows = await this.database.prisma.modelCredential.findMany({
      where: { installationId: context.installationId },
    });
    const keys: Record<
      CredentialPurpose,
      {
        configured: boolean;
        enabled: boolean;
        masked: string | null;
        connection: "not_checked";
      }
    > = {
      answer: {
        configured: false,
        enabled: false,
        masked: null,
        connection: "not_checked",
      },
      embedding: {
        configured: false,
        enabled: false,
        masked: null,
        connection: "not_checked",
      },
    };
    for (const row of rows) {
      // Detect a lost/replaced master key or damaged/swapped ciphertext on read.
      await this.vault.reveal(context.installationId, row.purpose, row);
      keys[row.purpose] = {
        configured: true,
        enabled: row.enabled,
        masked: "********",
        connection: "not_checked",
      };
    }
    return {
      provider: "openai",
      credentials: keys,
      embedding: FIXED_EMBEDDING,
      answerModel: null,
      supportedAnswerModels: [],
      capabilities: {
        providerCalls: false,
        answerModelSelection: false,
        connectionCheck: false,
      },
      transfers: await this.transfers(context.installationId),
    };
  }
  private async audit(
    tx: AuthTransaction,
    context: AdministratorContext,
    action: Action,
  ) {
    await tx.installationAuditEvent.create({
      data: {
        installationId: context.installationId,
        actorType: "administrator",
        actorAdministratorId: context.administratorId,
        action,
        outcome: "succeeded",
        requestId: randomUUID(),
      },
    });
  }
  private change<T extends object>(
    token: string | undefined,
    password: unknown,
    context: AdministratorContext,
    work: (tx: AuthTransaction, fresh: AdministratorContext) => Promise<T>,
  ) {
    return this.auth.sensitiveOperation(token, password, context, work);
  }
  replace(
    token: string | undefined,
    password: unknown,
    context: AdministratorContext,
    purpose: CredentialPurpose,
    apiKey: string,
  ) {
    return this.change(token, password, context, async (tx, fresh) => {
      const sealed = await this.vault.seal(
        fresh.installationId,
        purpose,
        apiKey,
      );
      await tx.modelCredential.upsert({
        where: {
          installationId_purpose: {
            installationId: fresh.installationId,
            purpose,
          },
        },
        create: {
          installationId: fresh.installationId,
          purpose,
          ...sealed,
          enabled: true,
        },
        update: { ...sealed, enabled: true },
      });
      await this.audit(
        tx,
        fresh,
        purpose === "answer" ? "answer_key_updated" : "embedding_key_updated",
      );
      return {
        configured: true,
        enabled: true,
        connection: "not_checked" as const,
      };
    });
  }
  disable(
    token: string | undefined,
    password: unknown,
    context: AdministratorContext,
    purpose: CredentialPurpose,
  ) {
    return this.change(token, password, context, async (tx, fresh) => {
      const changed = await tx.modelCredential.updateMany({
        where: { installationId: fresh.installationId, purpose, enabled: true },
        data: { enabled: false },
      });
      if (changed.count > 0)
        await this.audit(
          tx,
          fresh,
          purpose === "answer"
            ? "answer_key_disabled"
            : "embedding_key_disabled",
        );
      return { enabled: false };
    });
  }
  remove(
    token: string | undefined,
    password: unknown,
    context: AdministratorContext,
    purpose: CredentialPurpose,
  ) {
    return this.change(token, password, context, async (tx, fresh) => {
      const removed = await tx.modelCredential.deleteMany({
        where: { installationId: fresh.installationId, purpose },
      });
      if (removed.count > 0)
        await this.audit(
          tx,
          fresh,
          purpose === "answer" ? "answer_key_deleted" : "embedding_key_deleted",
        );
      return { configured: false, enabled: false };
    });
  }
  setTransfers(
    token: string | undefined,
    password: unknown,
    context: AdministratorContext,
    transfers: TransferFlags,
  ) {
    return this.change(token, password, context, async (tx, fresh) => {
      const existing = await tx.modelTransferPolicy.findUnique({
        where: { installationId: fresh.installationId },
      });
      if (
        existing != null &&
        existing.documentEmbedding === transfers.documentEmbedding &&
        existing.rag === transfers.rag &&
        existing.attachment === transfers.attachment
      )
        return {
          transfers: {
            documentEmbedding: existing.documentEmbedding,
            rag: existing.rag,
            attachment: existing.attachment,
          },
        };
      const value = await tx.modelTransferPolicy.upsert({
        where: { installationId: fresh.installationId },
        create: { installationId: fresh.installationId, ...transfers },
        update: { ...transfers },
      });
      await this.audit(tx, fresh, "model_transfer_policy_changed");
      return {
        transfers: {
          documentEmbedding: value.documentEmbedding,
          rag: value.rag,
          attachment: value.attachment,
        },
      };
    });
  }
  private async transfers(installationId: string): Promise<TransferFlags> {
    const value = await this.database.prisma.modelTransferPolicy.findUnique({
      where: { installationId },
    });
    return value == null
      ? DEFAULT_TRANSFERS
      : {
          documentEmbedding: value.documentEmbedding,
          rag: value.rag,
          attachment: value.attachment,
        };
  }
  // Internal preflight only. C01/C04 must connect this to the actual network
  // boundary, scoped credentials and cost reservation before enabling calls.
  async assertTransfer(
    context: AdministratorContext,
    purpose: TransferPurpose,
    endpoint: string,
    text: string,
    fileNames: readonly string[] = [],
  ): Promise<void> {
    inspectTransfer(
      await this.transfers(context.installationId),
      purpose,
      endpoint,
      text,
      fileNames,
    );
  }
}
