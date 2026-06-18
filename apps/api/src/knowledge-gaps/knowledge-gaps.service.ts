import { Injectable } from "@nestjs/common";

import {
  createPrismaClient,
  DEFAULT_WORKSPACE_NAME,
  type KnowledgeGapListFilter,
  type KnowledgeGapListRow,
  listKnowledgeGaps,
  type PrismaClient,
  updateKnowledgeGapStatus,
} from "@townbase/database";

export type GapStatus = "open" | "drafted" | "resolved" | "ignored";

@Injectable()
export class KnowledgeGapsService {
  public constructor(
    private readonly prisma: PrismaClient = createPrismaClient(),
  ) {}

  private async getWorkspaceId(): Promise<string> {
    const workspace = await this.prisma.workspace.findUniqueOrThrow({
      where: {
        name: DEFAULT_WORKSPACE_NAME,
      },
      select: {
        id: true,
      },
    });

    return workspace.id;
  }

  public async list(
    filter: Omit<KnowledgeGapListFilter, "workspaceId">,
    workspaceId?: string,
  ): Promise<readonly KnowledgeGapListRow[]> {
    const resolvedWorkspaceId = workspaceId ?? (await this.getWorkspaceId());

    return listKnowledgeGaps(this.prisma, {
      workspaceId: resolvedWorkspaceId,
      ...filter,
    });
  }

  public async updateStatus(
    knowledgeGapId: string,
    status: GapStatus,
    workspaceId?: string,
  ): Promise<KnowledgeGapListRow> {
    const resolvedWorkspaceId = workspaceId ?? (await this.getWorkspaceId());

    return updateKnowledgeGapStatus(this.prisma, {
      workspaceId: resolvedWorkspaceId,
      knowledgeGapId,
      status,
    });
  }
}
