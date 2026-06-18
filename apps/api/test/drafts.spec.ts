import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";

import { AppModule } from "../src/app.module";
import { KnowledgeGapsService } from "../src/knowledge-gaps/knowledge-gaps.service";
import type { KnowledgeGapsService as KnowledgeGapsServiceType } from "../src/knowledge-gaps/knowledge-gaps.service";

type MockKnowledgeGapsService = Pick<
  KnowledgeGapsServiceType,
  "list" | "updateStatus" | "createDraft" | "listDrafts" | "getDraft"
>;

const draftRow = {
  id: "draft-1",
  workspaceId: "workspace-1",
  knowledgeGapId: "gap-1",
  type: "notion_page",
  title: "Document How do I add the schema migration",
  body: "# Document How do I add the schema migration",
  status: "draft",
  createdAt: new Date("2026-01-02T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
} as const;

const serializedDraftRow = {
  ...draftRow,
  createdAt: draftRow.createdAt.toISOString(),
  updatedAt: draftRow.updatedAt.toISOString(),
};

const createApp = async (service?: MockKnowledgeGapsService): Promise<INestApplication> => {
  const builder = Test.createTestingModule({
    imports: [AppModule],
  });

  if (service !== undefined) {
    builder.overrideProvider(KnowledgeGapsService).useValue(service);
  }

  const moduleRef: TestingModule = await builder.compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
};

describe("draft endpoints", () => {
  let app: INestApplication;

  afterEach(async () => {
    await app.close();
  });

  it("creates a draft through POST /knowledge-gaps/:id/draft", async () => {
    const service: MockKnowledgeGapsService = {
      list: jest.fn(),
      updateStatus: jest.fn(),
      createDraft: jest.fn().mockResolvedValue({
        workspaceId: "workspace-1",
        knowledgeGapId: "gap-1",
        requestedType: "notion_page_text",
        persistedType: "notion_page",
        title: "Document How do I add the schema migration",
        body: "# Document How do I add the schema migration\n\n## Summary\nNo source explains the migration flow.",
        acceptanceCriteria: [
          "Describe the gap: Documentation gap: How do I add the schema migration.",
          "Include the related mode (documentation_gap) and priority (medium).",
          "Keep the output copy-friendly and ready to paste without reformatting.",
        ],
        requiredContent: [
          "Gap description: No source explains the migration flow.",
          "Suggested document title: Document How do I add the schema migration",
          "Suggested markdown path: docs/gaps/documentation-how-do-i-add-the-schema-migration.md",
          "Suggested issue title: Document How do I add the schema migration",
          "Draft type: notion_page_text",
        ],
        relatedSources: ["README.md (document-1)"],
        draft: draftRow,
      }),
      listDrafts: jest.fn(),
      getDraft: jest.fn(),
    };
    app = await createApp(service);

    await request(app.getHttpServer())
      .post("/knowledge-gaps/gap-1/draft")
      .send({ type: "notion_page_text" })
      .expect(201)
      .expect({
        workspaceId: "workspace-1",
        knowledgeGapId: "gap-1",
        requestedType: "notion_page_text",
        persistedType: "notion_page",
        title: "Document How do I add the schema migration",
        body: "# Document How do I add the schema migration\n\n## Summary\nNo source explains the migration flow.",
        acceptanceCriteria: [
          "Describe the gap: Documentation gap: How do I add the schema migration.",
          "Include the related mode (documentation_gap) and priority (medium).",
          "Keep the output copy-friendly and ready to paste without reformatting.",
        ],
        requiredContent: [
          "Gap description: No source explains the migration flow.",
          "Suggested document title: Document How do I add the schema migration",
          "Suggested markdown path: docs/gaps/documentation-how-do-i-add-the-schema-migration.md",
          "Suggested issue title: Document How do I add the schema migration",
          "Draft type: notion_page_text",
        ],
        relatedSources: ["README.md (document-1)"],
        draft: serializedDraftRow,
      });

    expect(service.createDraft).toHaveBeenCalledWith("gap-1", "notion_page_text");
  });

  it("lists drafts through GET /knowledge-gaps/:id/drafts", async () => {
    const service: MockKnowledgeGapsService = {
      list: jest.fn(),
      updateStatus: jest.fn(),
      createDraft: jest.fn(),
      listDrafts: jest.fn().mockResolvedValue({
        workspaceId: "workspace-1",
        knowledgeGapId: "gap-1",
        drafts: [draftRow],
      }),
      getDraft: jest.fn(),
    };
    app = await createApp(service);

    await request(app.getHttpServer())
      .get("/knowledge-gaps/gap-1/drafts")
      .expect(200)
      .expect({
        workspaceId: "workspace-1",
        knowledgeGapId: "gap-1",
        drafts: [serializedDraftRow],
      });

    expect(service.listDrafts).toHaveBeenCalledWith("gap-1");
  });

  it("gets a draft through GET /knowledge-gaps/:id/drafts/:draftId", async () => {
    const service: MockKnowledgeGapsService = {
      list: jest.fn(),
      updateStatus: jest.fn(),
      createDraft: jest.fn(),
      listDrafts: jest.fn(),
      getDraft: jest.fn().mockResolvedValue({
        workspaceId: "workspace-1",
        knowledgeGapId: "gap-1",
        draft: draftRow,
      }),
    };
    app = await createApp(service);

    await request(app.getHttpServer())
      .get("/knowledge-gaps/gap-1/drafts/draft-1")
      .expect(200)
      .expect({
        workspaceId: "workspace-1",
        knowledgeGapId: "gap-1",
        draft: serializedDraftRow,
      });

    expect(service.getDraft).toHaveBeenCalledWith("gap-1", "draft-1");
  });

  it("rejects an unsupported draft type", async () => {
    const service: MockKnowledgeGapsService = {
      list: jest.fn(),
      updateStatus: jest.fn(),
      createDraft: jest.fn(),
      listDrafts: jest.fn(),
      getDraft: jest.fn(),
    };
    app = await createApp(service);

    await request(app.getHttpServer())
      .post("/knowledge-gaps/gap-1/draft")
      .send({ type: "unsupported" })
      .expect(400)
      .expect({
        statusCode: 400,
        message: "type must be one of the supported draft types",
        error: "Bad Request",
      });

    expect(service.createDraft).not.toHaveBeenCalled();
  });
});
