import { listActionDrafts, persistActionDraft, updateActionDraftStatus } from "../src/action-draft";
import type { ActionDraftListRow, ActionDraftQueryClient } from "../src/action-draft";

describe("action draft helpers", () => {
  it("lists persisted drafts with workspace and gap filters", async () => {
    const draftRow = {
      id: "draft-1",
      workspaceId: "workspace-1",
      knowledgeGapId: "gap-1",
      type: "github_issue",
      title: "Document the schema flow",
      body: "Draft body",
      status: "draft",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    } satisfies ActionDraftListRow;

    const findMany = jest.fn(async () => [draftRow]);
    const client: ActionDraftQueryClient = {
      actionDraft: {
        findMany,
        upsert: jest.fn(),
        updateMany: jest.fn(),
        findFirstOrThrow: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    await expect(
      listActionDrafts(client, {
        workspaceId: "workspace-1",
        knowledgeGapId: "gap-1",
        type: "github_issue",
        status: "draft",
      }),
    ).resolves.toEqual([draftRow]);

    expect(findMany).toHaveBeenCalledWith({
      where: {
        workspaceId: "workspace-1",
        knowledgeGapId: "gap-1",
        type: "github_issue",
        status: "draft",
      },
      orderBy: {
        updatedAt: "desc",
      },
    });
  });

  it("replaces the latest draft for the same gap and type", async () => {
    const draftRow = {
      id: "draft-2",
      workspaceId: "workspace-1",
      knowledgeGapId: "gap-1",
      type: "markdown_doc",
      title: "Document the schema flow",
      body: "Updated draft body",
      status: "draft",
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    } satisfies ActionDraftListRow;

    const upsert = jest.fn(async () => draftRow);

    const client: ActionDraftQueryClient = {
      actionDraft: {
        findMany: jest.fn(),
        upsert,
        updateMany: jest.fn(),
        findFirstOrThrow: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    await expect(
      persistActionDraft(client, {
        workspaceId: "workspace-1",
        knowledgeGapId: "gap-1",
        type: "markdown_doc",
        title: "Document the schema flow",
        body: "Updated draft body",
      }),
    ).resolves.toEqual(draftRow);

    expect(upsert).toHaveBeenCalledWith({
      where: {
        workspaceId_knowledgeGapId_type: {
          workspaceId: "workspace-1",
          knowledgeGapId: "gap-1",
          type: "markdown_doc",
        },
      },
      create: {
        workspaceId: "workspace-1",
        knowledgeGapId: "gap-1",
        type: "markdown_doc",
        title: "Document the schema flow",
        body: "Updated draft body",
        status: "draft",
      },
      update: {
        title: "Document the schema flow",
        body: "Updated draft body",
        status: "draft",
      },
    });
  });

  it("updates draft status within the workspace boundary", async () => {
    const draftRow = {
      id: "draft-1",
      workspaceId: "workspace-1",
      knowledgeGapId: "gap-1",
      type: "github_issue",
      title: "Document the schema flow",
      body: "Draft body",
      status: "copied",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-03T00:00:00.000Z"),
    } satisfies ActionDraftListRow;

    const update = jest.fn(async () => draftRow);
    const client: ActionDraftQueryClient = {
      actionDraft: {
        findMany: jest.fn(),
        upsert: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirstOrThrow: update,
      },
      $transaction: jest.fn(),
    };

    await expect(
      updateActionDraftStatus(client, {
        workspaceId: "workspace-1",
        actionDraftId: "draft-1",
        status: "copied",
      }),
    ).resolves.toEqual(draftRow);

    expect(update).toHaveBeenCalledWith({
      where: {
        workspaceId: "workspace-1",
        id: "draft-1",
      },
    });
  });
});
