import { answerOptions } from "../model-integration/model-policy";
import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  HttpException,
} from "@nestjs/common";
import type { AdministratorContext } from "../auth/auth.service";
import { FileIndexService } from "../files/file-index.service";
import { ModelExecutionService } from "../model-integration/model-execution.service";
import { ModelCallError } from "../model-integration/model-policy";
import {
  inspectTransfer,
  DEFAULT_TRANSFERS,
  OPENAI_ENDPOINTS,
  TransferDenied,
} from "../model-integration/transfer-policy";
import { RagStore, type Admission } from "./rag-store";
import {
  questionInput,
  strategyFor,
  ragEvidenceBudget,
  selectSources,
  promptFor,
  parseRagAnswer,
  ragRefusal,
  GroundingError,
  groundingDiagnostic,
  type ResolvedMode,
} from "./rag-policy";
import type { ProviderResult } from "../model-integration/openai-provider";

export function ragFailure(error: unknown): string {
  if (error instanceof ModelCallError || error instanceof TransferDenied)
    return error.code;
  if (error instanceof HttpException) {
    if (error.getStatus() === 401) return "unauthorized";
    const response = error.getResponse();
    if (
      response != null &&
      typeof response === "object" &&
      "code" in response &&
      ["agent_changed", "agent_source_unavailable"].includes(
        String(response.code),
      )
    )
      return String(response.code);
  }
  return "question_unavailable";
}
@Injectable()
export class RagService implements OnApplicationBootstrap, OnModuleDestroy {
  private closing = false;
  private timer?: ReturnType<typeof setInterval>;
  private readonly active = new Map<
    string,
    { controller: AbortController; done: Promise<void> }
  >();
  constructor(
    private readonly store: RagStore,
    private readonly models: ModelExecutionService,
    private readonly index: FileIndexService,
  ) {}
  async onApplicationBootstrap() {
    // FilesModule acquires the installation's single API owner during onModuleInit.
    await this.store.maintenance(true);
    this.timer = setInterval(() => {
      void this.store
        .maintenance()
        .catch(() => Logger.error("TOWNBASE_RAG_CLEANUP_FAILED"));
    }, 60_000);
    this.timer.unref();
  }
  async onModuleDestroy() {
    this.closing = true;
    clearInterval(this.timer);
    for (const job of this.active.values()) job.controller.abort();
    const jobs = Promise.allSettled(
      [...this.active.values()].map((job) => job.done),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        jobs,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 1000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async stop(token: string | undefined, c: AdministratorContext, id: string) {
    await this.store.stop(token, c, id);
    this.active.get(id.toLowerCase())?.controller.abort();
    return this.store.read(token, c, id);
  }
  async ask(token: string | undefined, c: AdministratorContext, body: unknown) {
    const input = questionInput(body);
    inspectTransfer(
      { documentEmbedding: false, rag: true, attachment: false },
      "rag_question_embedding",
      OPENAI_ENDPOINTS.embedding,
      input.question,
    );
    const admitted = await this.store.admit(
      token,
      c,
      input,
      () => this.closing,
    );
    if (admitted.admission) {
      const admission = admitted.admission;
      const controller = new AbortController();
      if (this.closing) controller.abort();
      const remaining = Math.max(
        0,
        admission.turn.deadlineAt.getTime() - Date.now(),
      );
      const deadline = setTimeout(() => controller.abort(), remaining);
      const done = this.execute(token, c, admission, controller.signal).finally(
        () => {
          clearTimeout(deadline);
          this.active.delete(input.requestId);
        },
      );
      this.active.set(input.requestId, { controller, done });
      let onAbort: () => void = () => {};
      try {
        await Promise.race([
          done,
          new Promise<void>((resolve) => {
            if (controller.signal.aborted) return resolve();
            onAbort = resolve;
            controller.signal.addEventListener("abort", onAbort, {
              once: true,
            });
          }),
        ]);
      } finally {
        controller.signal.removeEventListener("abort", onAbort);
      }
      if (controller.signal.aborted)
        await this.store.fail(
          c,
          admission.turn,
          this.closing ? "api_stopped" : "question_timeout",
        );
    }
    return this.store.read(token, c, input.requestId);
  }
  private async execute(
    token: string | undefined,
    c: AdministratorContext,
    a: Admission,
    signal: AbortSignal,
  ) {
    let protectedSources = a.historySources;
    const boundary = {
      signal,
      authorize: async (
        tx: Parameters<RagStore["guard"]>[0],
        fresh: AdministratorContext,
      ) => {
        await this.store.guard(tx, fresh, a.turn, protectedSources);
        const policy = await tx.modelTransferPolicy.findUnique({
          where: { installationId: fresh.installationId },
        });
        // Inspect raw fields before JSON escaping can hide line-oriented secrets.
        inspectTransfer(
          policy ?? DEFAULT_TRANSFERS,
          "rag_answer",
          OPENAI_ENDPOINTS.answer,
          [
            a.turn.question,
            a.config.name,
            a.config.purpose,
            a.config.instructions,
            ...a.config.terminology.flatMap((t) => [t.term, t.meaning]),
            ...a.history.flatMap((t) => [t.question, t.answer]),
            ...protectedSources.flatMap((s) => [s.title, s.content]),
          ].join("\n"),
          protectedSources.map((s) => s.fileName),
        );
      },
    };
    const callResult = (
      result: Awaited<ReturnType<ModelExecutionService["execute"]>>,
    ): ProviderResult => {
      if (!result.result || result.call.status !== "succeeded")
        throw new ModelCallError(
          result.call.errorCode ?? "call_result_unavailable",
          502,
        );
      return result.result;
    };
    try {
      const embedded = callResult(
        await this.models.execute(
          token,
          c,
          {
            requestId: a.turn.embeddingRequestId,
            purpose: "rag_question_embedding",
            input: a.turn.question,
          },
          boundary,
        ),
      );
      const mode = a.turn.resolvedMode as ResolvedMode;
      const profile = strategyFor(mode);
      const retrieved = await this.index.search(
        token,
        c,
        embedded.embedding,
        20,
        {
          ...(a.config.sourceSelection === "selected"
            ? { originalIds: a.config.sourceOriginalIds }
            : {}),
          knowledgeTypes: profile.knowledgeTypes,
          question: a.turn.question,
        },
      );
      const candidates = retrieved.map((s) => ({
        ...s,
        requestedMode: a.turn.requestedMode,
        resolvedMode: mode,
      }));
      const selection = selectSources(
        mode,
        candidates,
        a.turn.question,
        ragEvidenceBudget(
          a.config,
          a.turn.question,
          mode,
          a.history,
          a.inputLimit,
        ),
      );
      protectedSources = await this.store.recordSources(
        token,
        c,
        a,
        selection.sources,
      );
      if (!selection.answerable) {
        await this.store.complete(
          token,
          c,
          a,
          protectedSources,
          ragRefusal(),
          null,
        );
        return;
      }
      const prompt = promptFor(
        a.config,
        a.turn.question,
        mode,
        selection.sources,
        a.history,
        a.inputLimit,
        "rag_v2",
      );
      const response = await this.models.execute(
        token,
        c,
        {
          requestId: a.turn.answerRequestId,
          purpose: "rag_answer",
          ...(a.turn.modelOptions == null
            ? {}
            : { modelOptions: answerOptions(a.turn.modelOptions) }),
          ...prompt,
          fileNames: selection.sources.map((s) => s.fileName),
        },
        boundary,
      );
      const result = parseRagAnswer(
        callResult(response).text,
        selection.sources,
      );
      if (signal.aborted) throw new ModelCallError("question_timeout", 504);
      await this.store.complete(
        token,
        c,
        a,
        protectedSources,
        result,
        response.call.model,
      );
    } catch (error) {
      // First failure only: no paid retry or model switch. The fixed branch
      // code (never provider text) separates JSON/ID/quote/invariant causes.
      if (error instanceof GroundingError)
        Logger.warn(groundingDiagnostic(error.detail));
      const code = signal.aborted ? "question_timeout" : ragFailure(error);
      try {
        await this.store.fail(c, a.turn, code);
      } catch {
        Logger.error("TOWNBASE_RAG_RESULT_PERSIST_FAILED");
        throw new ModelCallError("question_unavailable", 503);
      }
    }
  }
}
