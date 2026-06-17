import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";

import { AppModule } from "../src/app.module";
import { IngestionService } from "../src/ingestion/ingestion.service";
import type { SyncResponse } from "../src/ingestion/ingestion.types";

type MockIngestionService = Pick<IngestionService, "syncNotion" | "syncRepos">;

const repoSyncResponse: SyncResponse = {
  source: "local_repo",
  scope: {
    repoNames: ["townbase-docs"],
  },
  summary: {
    created: 1,
    updated: 2,
    skipped: 3,
    failed: 0,
    archived: 1,
  },
  observability: {
    archived: {
      documents: 1,
    },
    index: {
      status: "deferred_phase6",
      failed: 0,
    },
    chunking: {
      status: "deferred_phase6",
    },
  },
};

const notionSyncResponse: SyncResponse = {
  source: "notion",
  scope: {},
  summary: {
    created: 2,
    updated: 1,
    skipped: 4,
    failed: 0,
    archived: 0,
  },
  observability: {
    archived: {
      documents: 0,
    },
    index: {
      status: "deferred_phase6",
      failed: 0,
    },
    chunking: {
      status: "deferred_phase6",
    },
  },
};

const createApp = async (
  service?: MockIngestionService,
): Promise<INestApplication> => {
  const builder = Test.createTestingModule({
    imports: [AppModule],
  });

  if (service !== undefined) {
    builder.overrideProvider(IngestionService).useValue(service);
  }

  const moduleRef: TestingModule = await builder.compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
};

describe("Health endpoint", () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await createApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns ok on GET /health", async () => {
    await request(app.getHttpServer())
      .get("/health")
      .expect(200)
      .expect({ status: "ok" });
  });
});

describe("Admin sync endpoints", () => {
  let app: INestApplication;

  afterEach(async () => {
    await app.close();
  });

  it("rejects missing repoNames on POST /admin/sync/repos", async () => {
    const service: MockIngestionService = {
      syncRepos: jest.fn<Promise<SyncResponse>, [readonly string[]]>(),
      syncNotion: jest.fn<Promise<SyncResponse>, []>(),
    };
    app = await createApp(service);

    await request(app.getHttpServer())
      .post("/admin/sync/repos")
      .send({})
      .expect(400)
      .expect({
        statusCode: 400,
        message: "repoNames must contain at least one repo name",
        error: "Bad Request",
      });

    expect(service.syncRepos).not.toHaveBeenCalled();
  });

  it("syncs explicit repoNames and returns a normalized summary", async () => {
    const service: MockIngestionService = {
      syncRepos: jest
        .fn<Promise<SyncResponse>, [readonly string[]]>()
        .mockResolvedValue(repoSyncResponse),
      syncNotion: jest.fn<Promise<SyncResponse>, []>(),
    };
    app = await createApp(service);

    await request(app.getHttpServer())
      .post("/admin/sync/repos")
      .send({ repoNames: ["townbase-docs"] })
      .expect(201)
      .expect(repoSyncResponse);

    expect(service.syncRepos).toHaveBeenCalledWith(["townbase-docs"]);
  });

  it("syncs Notion and returns a normalized summary", async () => {
    const service: MockIngestionService = {
      syncRepos: jest.fn<Promise<SyncResponse>, [readonly string[]]>(),
      syncNotion: jest.fn<Promise<SyncResponse>, []>().mockResolvedValue(notionSyncResponse),
    };
    app = await createApp(service);

    await request(app.getHttpServer())
      .post("/admin/sync/notion")
      .send({ fixturePath: "fixtures/notion.json" })
      .expect(201)
      .expect(notionSyncResponse);

    expect(service.syncNotion).toHaveBeenCalledWith();
  });
});
