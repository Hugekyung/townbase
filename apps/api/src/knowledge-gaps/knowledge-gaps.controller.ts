import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";

import type { RetrievalMode } from "@townbase/database";

import {
  type DraftCreationResult,
  type DraftListResult,
  type DraftReadResult,
  type GapStatus,
  KnowledgeGapsService,
} from "./knowledge-gaps.service";
import type { DraftGenerationType } from "./draft-generator";

const GAP_STATUSES: readonly GapStatus[] = ["open", "drafted", "resolved", "ignored"] as const;
const RETRIEVAL_MODES: readonly RetrievalMode[] = [
  "auto",
  "onboarding",
  "product_history",
  "documentation_gap",
  "change_impact",
] as const;
const DRAFT_TYPES: readonly DraftGenerationType[] = [
  "github_issue",
  "markdown_doc",
  "notion_page_text",
] as const;

const readOptionalString = (value: unknown, field: string): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new BadRequestException(`${field} must be a non-empty string`);
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new BadRequestException(`${field} must be a non-empty string`);
  }

  return trimmed;
};

const readOptionalStatus = (value: unknown): GapStatus | undefined => {
  const status = readOptionalString(value, "status");

  if (status === undefined) {
    return undefined;
  }

  if (!GAP_STATUSES.includes(status as GapStatus)) {
    throw new BadRequestException("status must be one of the supported gap statuses");
  }

  return status as GapStatus;
};

const readOptionalMode = (value: unknown): RetrievalMode | undefined => {
  const mode = readOptionalString(value, "mode");

  if (mode === undefined) {
    return undefined;
  }

  if (!RETRIEVAL_MODES.includes(mode as RetrievalMode)) {
    throw new BadRequestException("mode must be one of the supported retrieval modes");
  }

  return mode as RetrievalMode;
};

const readDraftType = (value: unknown): DraftGenerationType => {
  const type = readOptionalString(value, "type");

  if (type === undefined) {
    throw new BadRequestException("type must be one of the supported draft types");
  }

  if (!DRAFT_TYPES.includes(type as DraftGenerationType)) {
    throw new BadRequestException("type must be one of the supported draft types");
  }

  return type as DraftGenerationType;
};

@Controller("knowledge-gaps")
export class KnowledgeGapsController {
  public constructor(private readonly knowledgeGapsService: KnowledgeGapsService) {}

  @Get()
  public list(@Query() query: Readonly<Record<string, unknown>>): Promise<readonly unknown[]> {
    const filter: {
      mode?: RetrievalMode;
      category?: string;
      status?: GapStatus;
    } = {};

    const mode = readOptionalMode(query.mode);
    const category = readOptionalString(query.category, "category");
    const status = readOptionalStatus(query.status);

    if (mode !== undefined) {
      filter.mode = mode;
    }

    if (category !== undefined) {
      filter.category = category;
    }

    if (status !== undefined) {
      filter.status = status;
    }

    return this.knowledgeGapsService.list(filter);
  }

  @Patch(":knowledgeGapId/status")
  public updateStatus(
    @Param("knowledgeGapId") knowledgeGapId: string,
    @Body() body: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const status = readOptionalStatus(body.status);

    if (status === undefined) {
      throw new BadRequestException("status must be a non-empty string");
    }

    return this.knowledgeGapsService.updateStatus(knowledgeGapId, status);
  }

  @Post(":knowledgeGapId/draft")
  public createDraft(
    @Param("knowledgeGapId") knowledgeGapId: string,
    @Body() body: Readonly<Record<string, unknown>>,
  ): Promise<DraftCreationResult> {
    const type = readDraftType(body.type);

    return this.knowledgeGapsService.createDraft(knowledgeGapId, type);
  }

  @Get(":knowledgeGapId/drafts")
  public listDrafts(
    @Param("knowledgeGapId") knowledgeGapId: string,
  ): Promise<DraftListResult> {
    return this.knowledgeGapsService.listDrafts(knowledgeGapId);
  }

  @Get(":knowledgeGapId/drafts/:draftId")
  public getDraft(
    @Param("knowledgeGapId") knowledgeGapId: string,
    @Param("draftId") draftId: string,
  ): Promise<DraftReadResult> {
    return this.knowledgeGapsService.getDraft(knowledgeGapId, draftId);
  }
}
