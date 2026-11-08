import { GROUNDED_FORMAT_INPUT } from "../model-integration/grounded-format";
import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import type { AdministratorContext } from "../auth/auth.service";
import { FileExtractor } from "../files/file-extractor";
import { FileIndexService } from "../files/file-index.service";
import {
  assertExtraction,
  FileError,
  type FileFormat,
} from "../files/file-contract";
import { ModelExecutionService } from "../model-integration/model-execution.service";
import {
  inspectTransfer,
  OPENAI_ENDPOINTS,
  DEFAULT_TRANSFERS,
} from "../model-integration/transfer-policy";
import { ModelCallError, inputBound } from "../model-integration/model-policy";
import {
  promptFor,
  selectSources,
  strategyFor,
  parseGroundedResult,
  type ResolvedMode,
} from "../rag/rag-policy";
import { ragFailure } from "../rag/rag.service";
import { AttachmentStore, type PrivateAdmission } from "./attachment-store";
import {
  ATTACHMENT_LIMITS,
  taskInput,
  attachmentCallId,
  attachmentEvidence,
  type AttachmentSource,
} from "./attachment-policy";
@Injectable()
export class AttachmentService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private closing = false;
  private timer?: ReturnType<typeof setInterval>;
  private active = new Map<
    string,
    { controller: AbortController; done: Promise<void> }
  >();
  constructor(
    private readonly store: AttachmentStore,
    private readonly extractor: FileExtractor,
    private readonly models: ModelExecutionService,
    private readonly index: FileIndexService,
  ) {}
  async onApplicationBootstrap() {
    await this.store.cleanup(true);
    this.timer = setInterval(() => {
      void this.store
        .cleanup()
        .catch(() => Logger.error("TOWNBASE_ATTACHMENT_CLEANUP_FAILED"));
    }, 60000);
    this.timer.unref();
  }
  async onModuleDestroy() {
    this.closing = true;
    clearInterval(this.timer);
    for (const job of this.active.values()) job.controller.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.allSettled([...this.active.values()].map((j) => j.done)),
        new Promise<void>((r) => {
          timer = setTimeout(r, 1000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async upload(
    token: string | undefined,
    c: AdministratorContext,
    name: string,
    bytes: Buffer,
  ) {
    if (this.closing) throw new ModelCallError("attachment_unavailable", 503);
    // Local-only scan before saving. The actual transfer policy is checked at dispatch.
    inspectTransfer(
      { documentEmbedding: false, rag: false, attachment: true },
      "attachment_answer",
      OPENAI_ENDPOINTS.answer,
      bytes.toString("utf8"),
      [name],
    );
    return this.store.upload(token, c, name, bytes);
  }
  async ask(token: string | undefined, c: AdministratorContext, body: unknown) {
    const input = taskInput(body);
    inspectTransfer(
      { documentEmbedding: false, rag: false, attachment: true },
      "attachment_answer",
      OPENAI_ENDPOINTS.answer,
      [input.question, input.ragQuestion ?? ""].join("\n"),
    );
    const admitted = await this.store.admit(
      token,
      c,
      input,
      () => this.closing,
    );
    if (admitted.admission) {
      const a = admitted.admission,
        controller = new AbortController();
      if (this.closing) controller.abort();
      const deadline = setTimeout(
        () => controller.abort(),
        Math.max(0, a.turn.deadlineAt.getTime() - Date.now()),
      );
      const done = this.execute(token, c, a, controller.signal).finally(() => {
        clearTimeout(deadline);
        this.active.delete(input.requestId);
      });
      this.active.set(input.requestId, { controller, done });
      let onAbort = () => {};
      try {
        await Promise.race([
          done,
          new Promise<void>((r) => {
            if (controller.signal.aborted) return r();
            onAbort = r;
            controller.signal.addEventListener("abort", onAbort, {
              once: true,
            });
          }),
        ]);
      } finally {
        controller.signal.removeEventListener("abort", onAbort);
      }
      if (controller.signal.aborted) {
        await this.store.fail(
          c,
          input.requestId,
          this.closing ? "api_stopped" : "question_timeout",
        );
        await this.store
          .cleanup()
          .catch(() => Logger.error("TOWNBASE_ATTACHMENT_CLEANUP_FAILED"));
      }
    }
    return this.store.read(token, c, input.requestId);
  }
  async stop(token: string | undefined, c: AdministratorContext, id: string) {
    await this.store.stop(token, c, id);
    this.active.get(id)?.controller.abort();
    await this.store
      .cleanup()
      .catch(() => Logger.error("TOWNBASE_ATTACHMENT_CLEANUP_FAILED"));
    return this.store.read(token, c, id);
  }
  private async execute(
    token: string | undefined,
    c: AdministratorContext,
    a: PrivateAdmission,
    signal: AbortSignal,
  ) {
    let sources = a.historySources;
    let attachments: AttachmentSource[] = [];
    const raw = () =>
      [
        a.turn.question,
        a.turn.ragQuestion ?? "",
        a.config.name,
        a.config.purpose,
        a.config.instructions,
        ...a.config.terminology.flatMap((t) => [t.term, t.meaning]),
        ...a.history.flatMap((h) => [h.question, h.answer]),
        ...attachments.flatMap((s) => [s.fileName, s.content]),
        ...sources.flatMap((s) => [s.title, s.content]),
      ].join("\n");
    const boundary = {
      signal,
      authorize: async (
        tx: Parameters<AttachmentStore["guard"]>[0],
        fresh: AdministratorContext,
      ) => {
        await this.store.guard(tx, fresh, a, sources);
        const policy = await tx.modelTransferPolicy.findUnique({
          where: { installationId: fresh.installationId },
        });
        inspectTransfer(
          policy ?? DEFAULT_TRANSFERS,
          "attachment_answer",
          OPENAI_ENDPOINTS.answer,
          raw(),
          a.files.map((f) => f.fileName),
        );
      },
    };
    const resultOf = (
      r: Awaited<ReturnType<ModelExecutionService["execute"]>>,
    ) => {
      if (r.call.status !== "succeeded" || !r.result)
        throw new ModelCallError(
          r.call.errorCode ?? "call_result_unavailable",
          502,
        );
      return r.result;
    };
    try {
      await this.store.scoped(token, c, async (tx, fresh, now) => {
        await this.store.guard(tx, fresh, a, sources, now);
        const policy = await tx.modelTransferPolicy.findUnique({
          where: { installationId: fresh.installationId },
        });
        inspectTransfer(
          policy ?? DEFAULT_TRANSFERS,
          "attachment_answer",
          OPENAI_ENDPOINTS.answer,
          raw(),
          a.files.map((f) => f.fileName),
        );
      });
      for (const file of a.files) {
        if (signal.aborted) throw new ModelCallError("question_timeout", 504);
        const bytes = await this.store.storage.read(file.storageKey);
        if (
          bytes.length !== file.byteSize ||
          createHash("sha256").update(bytes).digest("hex") !== file.contentHash
        )
          throw new FileError("storage_unavailable");
        const extraction = await this.extractor.extract(
          file.fileName,
          bytes,
          signal,
        );
        assertExtraction(extraction, file.format as FileFormat);
        attachments.push(...attachmentEvidence(file, extraction));
        if (
          attachments.length > 256 ||
          Buffer.byteLength(JSON.stringify(attachments)) >
            ATTACHMENT_LIMITS.contextBytes
        )
          throw new ModelCallError("attachment_context_limit", 413);
      }
      if (a.turn.ragQuestion != null) {
        const embedded = resultOf(
          await this.models.execute(
            token,
            c,
            {
              requestId: attachmentCallId(a.turn.requestId, "embedding"),
              purpose: "rag_question_embedding",
              input: a.turn.ragQuestion,
            },
            boundary,
          ),
        );
        const mode = a.turn.resolvedMode as ResolvedMode;
        const retrieved = await this.index.search(
          token,
          c,
          embedded.embedding,
          20,
          {
            ...(a.config.sourceSelection === "selected"
              ? { originalIds: a.config.sourceOriginalIds }
              : {}),
            knowledgeTypes: strategyFor(mode).knowledgeTypes,
          },
        );
        const selection = selectSources(mode, retrieved, a.turn.ragQuestion);
        const union = new Map(
          [...sources, ...selection.sources].map((s) => [s.id, s]),
        );
        sources = [...union.values()];
        if (sources.length > 20)
          throw new ModelCallError("history_limit_exceeded", 413);
      }
      sources = sources.map((s, i) => ({
        ...s,
        promptLabel: `S${attachments.length + i + 1}`,
      }));
      const metadata = attachments.map((s, i) => ({
        promptLabel: `S${i + 1}`,
        id: s.id,
        attachmentId: s.attachmentId,
        kind: "attachment",
        title: s.title,
        fileName: s.fileName,
        locations: s.locations,
        headingPath: s.headingPath,
        contentHash: s.contentHash,
      }));
      await this.store.record(token, c, a, sources, metadata);
      const prompt = promptFor(
        a.config,
        a.turn.question,
        a.turn.resolvedMode as ResolvedMode,
        [...attachments, ...sources],
        a.history,
        a.inputLimit,
      );
      prompt.instructions +=
        "\nThis is a private attachment task: " +
        a.turn.operation +
        ". For a draft, distinguish proposed wording from facts; factual claims still need exact source quotes. Attachment IDs identify temporary private files, not shared RAG documents. Explain insufficient evidence and never create shared gaps or drafts. Summarize all supplied files when asked, and never claim omitted content was read.";
      if (
        inputBound(prompt.instructions + prompt.input + GROUNDED_FORMAT_INPUT) >
        a.inputLimit
      )
        throw new ModelCallError("input_limit_exceeded", 413);
      const response = await this.models.execute(
        token,
        c,
        {
          requestId: attachmentCallId(a.turn.requestId, "answer"),
          purpose: "attachment_answer",
          ...prompt,
          fileNames: a.files.map((f) => f.fileName),
        },
        boundary,
      );
      const result = parseGroundedResult(
        resultOf(response).text,
        [...attachments, ...sources],
        "prompt",
      );
      if (signal.aborted) throw new ModelCallError("question_timeout", 504);
      if (response.call.model == null)
        throw new ModelCallError("invalid_provider_response", 502);
      await this.store.complete(
        token,
        c,
        a,
        sources,
        result,
        response.call.model,
      );
    } catch (error) {
      await this.store.fail(
        c,
        a.turn.requestId,
        signal.aborted
          ? "question_timeout"
          : error instanceof FileError
            ? error.code
            : ragFailure(error),
      );
    } finally {
      attachments = [];
      await this.store
        .cleanup()
        .catch(() => Logger.error("TOWNBASE_ATTACHMENT_CLEANUP_FAILED"));
    }
  }
}
