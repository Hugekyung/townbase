import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";

import { AppModule } from "../src/app.module";
import { type GapStatus, KnowledgeGapsService } from "../src/knowledge-gaps/knowledge-gaps.service";

type MockKnowledgeGapsService = Pick<KnowledgeGapsService, "list" | "updateStatus">;

const gapRow = {
  id: "gap-1",
  workspaceId: "workspace-1",
  questionId: "question-1",
  category: "database",
  title: "Documentation gap: How do I add the schema migration",
  description: "No source explains the migration flow.",
  suggestedDocumentTitle: "Document How do I add the schema migration",
  suggestedMarkdownPath: "docs/gaps/database-how-do-i-add-the-schema-migration.md",
  suggestedGithubIssueTitle: "Document How do I add the schema migration",
  priority: "medium",
  status: "open",
  similarQuestionCount: 0,
  relatedMode: "documentation_gap",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
} as const;

const draftedGapRow = {
  ...gapRow,
  status: "drafted",
} as const;

const serializedGapRow = {
  ...gapRow,
  createdAt: gapRow.createdAt.toISOString(),
  updatedAt: gapRow.updatedAt.toISOString(),
};

const serializedDraftedGapRow = {
  ...draftedGapRow,
  createdAt: draftedGapRow.createdAt.toISOString(),
  updatedAt: draftedGapRow.updatedAt.toISOString(),
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

describe("knowledge gap endpoints", () => {
  let app: INestApplication;

  afterEach(async () => {
    await app.close();
  });

  it("lists gaps through GET /knowledge-gaps", async () => {
    const service: MockKnowledgeGapsService = {
      list: jest
        .fn<Promise<readonly typeof gapRow[]>, [Readonly<{ mode?: string; category?: string; status?: GapStatus }>]>()
        .mockResolvedValue([gapRow]),
      updateStatus: jest.fn<Promise<typeof draftedGapRow>, [string, GapStatus]>(),
    };
    app = await createApp(service);

    await request(app.getHttpServer())
      .get("/knowledge-gaps")
      .query({ mode: "documentation_gap", category: "database", status: "open" })
      .expect(200)
      .expect([serializedGapRow]);

    expect(service.list).toHaveBeenCalledWith({
      mode: "documentation_gap",
      category: "database",
      status: "open",
    });
  });

  it("updates status through PATCH /knowledge-gaps/:id/status", async () => {
    const service: MockKnowledgeGapsService = {
      list: jest.fn(),
      updateStatus: jest.fn<Promise<typeof draftedGapRow>, [string, GapStatus]>().mockResolvedValue(draftedGapRow),
    };
    app = await createApp(service);

    await request(app.getHttpServer())
      .patch("/knowledge-gaps/gap-1/status")
      .send({ status: "drafted" })
      .expect(200)
      .expect(serializedDraftedGapRow);

    expect(service.updateStatus).toHaveBeenCalledWith("gap-1", "drafted");
  });

  it("rejects an unsupported status filter", async () => {
    const service: MockKnowledgeGapsService = {
      list: jest.fn(),
      updateStatus: jest.fn(),
    };
    app = await createApp(service);

    await request(app.getHttpServer())
      .get("/knowledge-gaps")
      .query({ status: "unsupported" })
      .expect(400)
      .expect({
        statusCode: 400,
        message: "status must be one of the supported gap statuses",
        error: "Bad Request",
      });

    expect(service.list).not.toHaveBeenCalled();
  });
});
