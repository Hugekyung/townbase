# townbase RAG 완성 및 평가 작업 계획

## 1. 문서 목적

이 문서는 townbase를 2~3일 안에 지원서에 설명 가능한 MCP Retrieval-first RAG MVP 수준으로 개선하기 위한 실행 계획이다. 최우선은 질문이 검색된 근거 문서와 함께 MCP 응답으로 반환되는 P0 흐름이며, 별도 LLM API 호출은 기본 경로에 포함하지 않는다.

> Notion·로컬 Git 문서의 수집, Chunking, Embedding, Retrieval, Citation, Knowledge Gap 전환까지 동작하고, MCP Client Agent가 검색 근거를 이용해 최종 답변을 만들 수 있는 RAG Knowledge Agent

이번 작업은 기능 확장이 아니라 현재 구현의 핵심 공백을 메우고 성과를 수치로 증명하는 데 집중한다.

### 최종 목표

- 실제 질문 한 건이 MCP를 통해 들어와 Retrieval, 근거 문서 반환, Citation, Persistence까지 이어지는 흐름을 완성한다.
- 질문 목적에 맞는 Mode-aware Retrieval을 실제 Chat 검색 경로에 적용한다.
- 근거가 부족한 질문은 답변용 Source를 반환하지 않고 Knowledge Gap으로 전환한다.
- Vector Only와 Mode-aware의 차이를 동일 Dataset으로 비교한다.
- 다음 세 가지 결과물을 남긴다.
  1. 실행 가능한 End-to-End RAG 데모
  2. Source Grounding과 Citation 검증 결과
  3. Vector Only 대비 Mode-aware 평가 보고서

### 이번 범위에서 제외

- Slack·GitHub·Jira 등 신규 Connector
- Hybrid Search와 별도 Reranker
- LangChain·LangGraph 재작성
- Multi-Agent
- GitHub Issue·Notion Page 실제 생성
- townbase 내부 Chat Completion API와 별도 OpenAI Chat/Responses 호출
- Web UI
- `change_impact` Mode
- 멀티테넌시·권한 동기화
- Redis·BullMQ·별도 Worker

---

## 2. townbase의 질문 → 답변 전체 흐름

기본 P0 경로에서는 townbase가 별도 Chat Completion API를 호출하지 않는다. ChatGPT·Codex 같은 MCP Client Agent가 이미 사용 중인 모델로 최종 자연어 답변을 만들고, townbase는 검색·근거·Citation·Knowledge Gap 정보를 반환한다. Chat Completion Adapter는 townbase가 MCP 없이 자체 답변 API까지 제공하려는 경우에만 선택적으로 추가한다.

MCP에 연결된 외부 Agent와 townbase 내부의 역할은 다음처럼 나뉜다.

```text
[사용자]
   |
   | 질문
   v
[ChatGPT/Codex 등 MCP Client Agent]
   |
   | workspace_knowledge.question 호출
   v
[townbase MCP Server]
   |
   | 1. 입력 검증
   | 2. requestedMode 확인
   | 3. auto면 규칙 기반 resolvedMode 결정
   v
[ChatQuestionService]
   |
   | 4. 질문 Embedding 생성
   v
[Embedding Model]
   |  OpenAI Embedding API 또는 테스트용 Fake/Fixture Embedding
   v
[Retriever]
   |
   | 5. workspaceId로 범위 제한
   | 6. Vector Similarity 검색
   | 7. archived/deprecated 제외
   | 8. Mode별 Metadata Bonus 적용
   | 9. Top K Source 선택
   v
[Retrieved Source Chunks]
   |
   | 10. 제목·경로·Section·Source ID·점수로 Context 구성
   v
[Prompt Context + Grounding Rule]
   |
   | 11. Source 내용·경로·Section·점수로 MCP 응답 구성
   v
[MCP Retrieval Response]
   |
   | { question, resolvedMode, isAnswerable, sources, citations, knowledgeGap }
   v
[Persistence]
   |
   | 12. Question 저장
   | 13. QuestionSource와 점수·순위 저장
   | 14. Citation은 DB Source에서 복원
   | 15. 답변 불가면 KnowledgeGap·ActionDraft 저장
   v
[MCP 결과]
   |
   | answer, citations, mode, confidence, gap 상태
   v
[MCP Client Agent]
   |
   | 결과를 사용자에게 설명
   v
[사용자 응답]
```

정리하면 townbase는 문서 검색과 근거 패킷 생성을 담당하고, 외부 MCP Agent가 그 패킷을 바탕으로 최종 답변을 담당한다. 이 구조에서는 townbase가 별도 OpenAI Chat/Responses API를 호출하지 않으므로 중복 API 비용이 발생하지 않는다.

단, Embedding을 OpenAI API로 생성하면 Embedding 비용은 별도로 발생할 수 있다. 비용 없는 로컬 검증이 필요하면 Fixture Embedding 또는 로컬 Embedding Model을 사용하고, 실제 검색 품질 평가에서만 선택적으로 OpenAI Embedding을 사용한다.

Source가 없는 경우의 예외 흐름은 다음과 같다.

```text
Retriever 결과 0개 또는 Answerability 기준 미달
   → 답변 Source를 반환하지 않음
   → isAnswerable=false
   → Question 저장
   → Knowledge Gap 및 Draft 저장
   → MCP Client Agent가 "근거 부족"으로 사용자에게 응답
```

## 3. 전체 작업 순서

```text
사전 점검
→ P0: Mode-aware 검색 + Source Grounding 응답
→ P0: End-to-End Smoke Test
→ P1: Golden Dataset·Vector Baseline
→ P1: Mode-aware 재측정·평가 보고서
→ P2: 동기화·비용·운영 보강
```

| 우선순위 | 작업 | 예상 시간 | 핵심 산출물 |
|---:|---|---:|---|
| P0 | MCP Retrieval 응답과 Source Grounding | 3~5시간 | 결과물 1·2의 기반 |
| P0 | Chat 경로 Mode-aware Retrieval 연결 | 3~5시간 | 실제 검색 순위 개선 |
| P0 | MCP End-to-End Smoke Test와 대표 데모 | 2~3시간 | 결과물 1: 실행 가능한 RAG 데모 |
| P1 | Golden Dataset·Vector Baseline·평가 Runner | 4~6시간 | 비교 가능한 Baseline |
| P1 | Mode-aware 재측정과 평가 보고서 | 3~5시간 | 결과물 3: 평가 보고서 |
| P2 | 동기화·비용·운영 안정성 보강 | 남는 시간 | 운영 증거와 후속 개선 |

---

## 3. Phase 0 — 사전 점검과 Baseline 보존

### TASK-001. 현재 동작 경로 확인

- [ ] `apps/api/src/chat/chat.runtime.ts`에서 MCP Retrieval 응답 생성 위치를 확인한다.
- [ ] 현재 Completion Scaffold가 기본 경로에 연결되어 있지 않은지 확인한다.
- [ ] MCP 질문 Tool에서 다음 호출 흐름을 코드 기준으로 기록한다.
  - Mode 결정
  - 질문 Embedding
  - Vector Search
  - Prompt Context 생성
  - MCP Retrieval 응답 구성
  - Question·QuestionSource 저장
  - Knowledge Gap 판단
- [ ] 검색 Repository의 실제 SQL과 반환 필드를 확인한다.
- [ ] 현재 테스트 명령과 전체 검증 명령을 확인한다.

### TASK-002. 변경 전 상태 보존

- [ ] 기존 테스트를 실행하고 결과를 기록한다.
- [ ] 기존 Vector Search 동작을 변경하기 전에 별도 Strategy 또는 설정으로 유지할 수 있는지 확인한다.
- [ ] 비교 실험을 위해 `vector_only`와 `mode_aware` 전략을 전환할 수 있는 설정을 준비한다.

권장 환경 변수:

```bash
RAG_RETRIEVAL_STRATEGY=vector_only
```

완료 조건:

- 기존 검색 방식과 개선 검색 방식을 같은 Dataset에서 선택적으로 실행할 수 있다.
- 변경 전 전체 테스트 결과가 기록되어 있다.

---

## 4. P2 선택 Phase — Standalone OpenAI Completion Adapter

이 Phase는 기본 MCP Retrieval 경로에 포함하지 않는다. MCP Client Agent 없이도 townbase가 자체적으로 답변을 생성하는 standalone API가 필요할 때만 진행한다. 지원서용 최소 목표와 API 비용 절감 목표를 위해 P0·P1 완료 전에는 착수하지 않는다.

### TASK-101. Completion 계약 확정

기존 Interface를 우선 재사용하고, 없다면 다음 수준의 계약을 정의한다.

```ts
export interface CompletionClient {
  complete(input: CompletionInput): Promise<CompletionResult>;
}

export interface CompletionResult {
  answer: string;
  isAnswerable: boolean;
  confidence: number;
  usedSourceIds: string[];
  knowledgeGap: {
    title: string;
    description: string;
  } | null;
}
```

- [ ] `usedSourceIds`에는 Prompt Context로 제공한 Source ID만 허용한다.
- [ ] `confidence`는 `0~1` 범위로 검증한다.
- [ ] 답변 불가능할 때 `knowledgeGap`을 `null` 가능 구조로 명시한다.
- [ ] LLM 반환 타입과 도메인 타입이 분리되어 있다면 Mapper를 둔다.

### TASK-102. OpenAI Adapter 구현

신규 구현은 OpenAI Responses API를 기본으로 하고 Structured Outputs를 이용해 JSON Schema를 강제한다. TypeScript에서는 Zod Schema를 단일 기준으로 사용해 런타임 검증 타입과 정적 타입의 불일치를 줄인다.

예상 파일 위치:

```text
packages/agent-core/src/completion/completion-client.ts
packages/agent-core/src/completion/openai-completion.client.ts
packages/agent-core/src/completion/fake-completion.client.ts
packages/agent-core/src/completion/completion.schema.ts
```

- [ ] OpenAI SDK 의존성을 확인하거나 추가한다.
- [ ] Zod 기반 응답 Schema를 정의한다.
- [ ] Responses API 호출을 구현한다.
- [ ] `OPENAI_CHAT_MODEL`로 모델을 외부 설정한다.
- [ ] 출력 Token 제한과 Timeout을 설정한다.
- [ ] `store: false`를 적용해 요청 저장 여부를 명시적으로 통제한다.
- [ ] Refusal, incomplete response, Timeout, Rate Limit, 잘못된 응답을 구분해 처리한다.
- [ ] 실제 Adapter와 Fake Adapter 선택을 환경설정에서 분리한다.

권장 환경 변수:

```bash
OPENAI_API_KEY=
OPENAI_CHAT_MODEL=
OPENAI_COMPLETION_ENABLED=true
OPENAI_COMPLETION_TIMEOUT_MS=15000
```

### TASK-103. Source Grounding 검증

- [ ] 검색 Source가 0개면 LLM을 호출하지 않는다.
- [ ] Prompt에는 제공된 Source만 사용하도록 명시한다.
- [ ] `usedSourceIds`가 검색 결과에 없는 값을 포함하면 실패 또는 제거 처리한다.
- [ ] Citation은 LLM이 생성한 경로나 URL을 신뢰하지 않고 DB Source에서 복원한다.
- [ ] 답변과 사용 Source를 하나의 트랜잭션 단위로 저장할지 검토한다.

### TASK-104. Completion 테스트

- [ ] Fake Adapter 단위 테스트
- [ ] Structured Output Schema 검증 테스트
- [ ] 존재하지 않는 Source ID 반환 테스트
- [ ] Source가 없을 때 LLM 미호출 테스트
- [ ] `isAnswerable=false`일 때 Gap 생성 테스트
- [ ] API 오류 시 Question 상태 또는 오류 응답 테스트
- [ ] 실제 API 스모크 테스트 2~3개를 별도 명령으로 제공한다.

완료 조건(선택 기능):

- standalone 질문 API 한 번으로 실제 답변, Citation, QuestionSource 저장까지 완료된다.
- API Key가 없는 테스트 환경에서는 Fake Adapter로 전체 테스트가 통과한다.
- Source가 없거나 응답이 불완전한 경우 근거 없는 답변을 저장하지 않는다.

---

## 5. Phase 2 — 평가 Corpus와 Golden Dataset

### TASK-201. 평가 Corpus 구성

Townbase의 Mode를 비교할 수 있도록 서로 다른 문서 유형을 준비한다.

권장 구성:

- README 1개
- 온보딩 또는 Local Setup 문서 1개
- Architecture 문서 1개
- ADR 1~2개
- PRD 1~2개
- Schema 또는 Migration 1개
- 답변을 혼동시키기 위한 과거·폐기 문서 1개

Fixture 위치 예시:

```text
fixtures/evaluation/workspace/
├── README.md
├── docs/setup.md
├── docs/architecture.md
├── adr/ADR-001-payment-retry.md
├── prd/payment-policy.md
├── prisma/schema.prisma
└── docs/archived/payment-policy-v1.md
```

- [ ] 각 문서는 제목·Heading·고유명사·수치·예외 조건을 포함한다.
- [ ] ADR과 PRD에는 같은 주제를 다른 목적과 시점으로 작성한다.
- [ ] 폐기 문서는 최신 문서와 일부 상충하도록 구성한다.
- [ ] Corpus를 한 번의 명령으로 초기화·수집할 수 있도록 한다.

### TASK-202. Golden Question 20개 작성

권장 분포:

| 유형 | 수량 |
|---|---:|
| onboarding | 5 |
| product_history | 5 |
| 정확한 파일명·기술 용어 | 3 |
| 여러 문서가 필요한 질문 | 3 |
| 답변할 수 없는 질문 | 4 |

Dataset Schema 예시:

```json
{
  "id": "product-history-001",
  "question": "결제 실패 재시도 정책은 왜 현재 방식으로 변경됐나요?",
  "requestedMode": "auto",
  "expectedMode": "product_history",
  "relevantDocuments": [
    "adr/ADR-001-payment-retry.md",
    "prd/payment-policy.md"
  ],
  "relevantSections": [
    "결정 배경",
    "재시도 정책"
  ],
  "answerable": true,
  "expectedTerms": ["멱등성", "재시도", "중복 결제"]
}
```

- [ ] 정답은 Chunk ID에만 묶지 않고 파일 경로와 Section으로도 저장한다.
- [ ] Chunking 방식이 바뀌어도 Dataset을 재사용할 수 있게 한다.
- [ ] 답변 불가능 질문은 `relevantDocuments=[]`, `answerable=false`로 정의한다.
- [ ] Dataset 변경은 코드 변경과 동일하게 Git으로 관리한다.

---

## 6. Phase 3 — 평가 Runner와 Baseline

### TASK-301. Retrieval 평가 Runner 구현

예상 위치:

```text
packages/rag-core/src/evaluation/
├── evaluation.types.ts
├── retrieval-evaluator.ts
└── metrics.ts

scripts/evaluate-rag.ts
```

- [ ] Dataset의 각 질문을 순차 실행한다.
- [ ] 실제 질문 Embedding과 Retriever를 사용한다.
- [ ] Top 3·Top 5 결과와 Score를 저장한다.
- [ ] Question별 성공·실패 이유를 기록한다.
- [ ] 결과를 JSON과 Markdown으로 출력한다.
- [ ] 평가 실행이 운영 Question·Gap 통계를 오염시키지 않도록 별도 Workspace 또는 평가 Flag를 사용한다.

권장 명령:

```bash
pnpm eval:rag --strategy=vector_only
pnpm eval:rag --strategy=mode_aware
```

### TASK-302. 지표 구현

#### Hit@K

정답 문서 또는 Section이 Top K에 하나 이상 포함되면 성공이다.

```text
Hit@K = 성공 질문 수 / 전체 답변 가능 질문 수
```

#### MRR

첫 번째 정답이 등장한 순위의 역수를 평균한다.

```text
정답이 1위 → 1
정답이 2위 → 0.5
정답이 5위 → 0.2
정답 없음 → 0
```

#### Mode Accuracy

```text
Mode Accuracy = expectedMode와 resolvedMode가 같은 질문 수 / 전체 auto 질문 수
```

#### Answerability Accuracy

```text
Answerability Accuracy = expected answerable과 실제 isAnswerable이 같은 질문 수 / 전체 질문 수
```

#### Source Citation Precision

MCP Retrieval 응답의 Citation이 Golden Dataset의 관련 문서와 일치하는지 측정한다. 외부 Agent가 만든 자연어 답변 자체의 품질은 별도 수동 검토 대상으로 기록한다.

- [ ] `Hit@3`, `Hit@5`, `MRR` 구현
- [ ] Mode Accuracy 구현
- [ ] Answerability Accuracy 구현
- [ ] Source Citation Precision 구현
- [ ] 평균·P95 Retrieval Latency 구현
- [ ] 평균·P95 MCP Response Latency 구현
- [ ] 외부 Agent의 LLM 비용은 townbase 평가 비용과 분리해 기록한다.

### TASK-303. 기존 Vector Search Baseline 측정

- [ ] `RAG_RETRIEVAL_STRATEGY=vector_only`로 평가한다.
- [ ] 결과 파일에 실행 일시, Git Commit, Embedding 모델, Top K를 기록한다.
- [ ] 질문별 실패 원인을 다음 유형으로 분류한다.
  - 잘못된 Mode
  - 관련 Chunk 누락
  - 오래된·archived 문서 검색
  - Source Type 우선순위 실패
  - 답변 가능성 오판
  - Citation 불일치

결과 파일 예시:

```text
docs/evaluations/
├── baseline-vector-only.json
└── baseline-vector-only.md
```

완료 조건:

- 한 명령으로 동일 Dataset을 반복 평가할 수 있다.
- 전체 지표뿐 아니라 실패한 질문과 검색 결과를 확인할 수 있다.
- 개선 작업 이전 Baseline이 보존되어 있다.

---

## 7. Phase 4 — Mode-aware Metadata Retrieval

### TASK-401. 검색 조건 SQL 적용

필수 조건:

- [ ] 현재 `workspaceId`의 Chunk만 조회한다.
- [ ] `archived`, `deprecated` 문서를 제외한다.
- [ ] Mode Strategy의 `sourceType`을 SQL Filter 또는 Candidate 조건으로 반영한다.
- [ ] Mode Strategy의 `knowledgeTypes`를 반영한다.
- [ ] 필요한 경우 질문에서 찾은 `domainTags`를 Bonus로 사용한다.

주의사항:

- 너무 강한 Filter로 정답을 누락할 수 있으므로 필수 제외 조건과 Ranking Bonus를 구분한다.
- `archived/deprecated`는 필수 제외한다.
- Mode의 Source Type은 초기에는 Hard Filter보다 Ranking Bonus를 우선 검토한다.

### TASK-402. 최종 Ranking 구현

초기 공식은 단순하고 설명 가능하게 유지한다.

```text
finalScore
= vectorSimilarity
+ modeSourceBonus
+ knowledgeTypeBonus
+ normalizedSourcePriorityBonus
```

- [ ] 각 Bonus의 범위를 작게 제한해 Vector Similarity를 완전히 덮지 않도록 한다.
- [ ] 가중치를 코드 상수 또는 설정 객체에 모은다.
- [ ] 결과에 `vectorScore`, `metadataBonus`, `finalScore`를 함께 남긴다.
- [ ] 왜 해당 Chunk가 상위에 왔는지 평가 결과에서 확인할 수 있게 한다.
- [ ] Freshness는 최신 문서 우선이라는 명확한 요구가 있는 경우에만 작은 Bonus로 추가한다.

### TASK-403. 개선 후 재측정

- [ ] 동일 Corpus와 Golden Dataset을 사용한다.
- [ ] 동일 Embedding 모델과 Top K를 사용한다.
- [ ] `mode_aware` 전략으로 평가한다.
- [ ] Vector Baseline과 지표를 비교한다.
- [ ] 성능이 나빠진 질문도 숨기지 않고 원인을 기록한다.

비교표 Template:

| 전략 | Hit@3 | Hit@5 | MRR | Mode Accuracy | Answerability | Citation | Retrieval P95 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Vector Only |  |  |  |  |  |  |  |
| Mode-aware |  |  |  |  |  |  |  |

완료 조건:

- Metadata가 단순 저장 정보가 아니라 실제 검색 순위에 반영된다.
- Vector Score와 Metadata Bonus를 분리해 결과를 설명할 수 있다.
- 개선 전후의 정량 결과가 남아 있다.

---

## 8. Phase 5 — Answerability와 Knowledge Gap 검증

### TASK-501. Answerability 정책 명시

```text
Source 0개
→ 빈 Source packet
→ isAnswerable=false
→ Question·Knowledge Gap 저장

Source는 있으나 검색 점수가 낮음
→ Source packet 반환하지 않음
→ isAnswerable=false
→ Knowledge Gap 처리

Source 충분
→ Source packet 반환
→ Citation 저장
→ MCP Client Agent가 최종 답변 생성
```

- [ ] Source 0개 시 빈 Source packet과 Knowledge Gap을 반환한다.
- [ ] 최고 검색 Score와 Source 수를 기록한다.
- [ ] `confidence`가 Retrieval 근거 점수인지 명확히 한다.
- [ ] Threshold는 설정값으로 이동한다.
- [ ] 평가 결과를 근거로 Threshold를 한 번만 조정한다.

### TASK-502. Knowledge Gap 통합 테스트

- [ ] 답변 불가능 질문이 `isAnswerable=false`로 저장된다.
- [ ] 해당 Question과 KnowledgeGap이 연결된다.
- [ ] Gap에서 `markdown_doc` 또는 `github_issue` ActionDraft를 생성한다.
- [ ] Draft는 자동 게시되지 않고 저장 상태로 끝난다.
- [ ] 같은 평가 질문 재실행으로 중복 Gap이 무제한 생성되지 않는지 확인한다.

### TASK-503. 결과 측정

- [ ] 답변 가능 질문 정상 답변율
- [ ] 답변 불가능 질문 정상 거절율
- [ ] 근거 없는 답변율
- [ ] 불필요한 거절율
- [ ] Knowledge Gap 정상 생성율

완료 조건:

- 답변할 수 없는 Golden Question이 모두 정상 거절 또는 Gap으로 처리된다.
- 답변할 수 있는 질문의 과도한 거절 여부를 확인할 수 있다.
- Threshold 선택 근거가 평가 보고서에 기록된다.

---

## 9. Phase 6 — 증분 동기화 정합성 테스트

### TASK-601. 핵심 시나리오 테스트

- [ ] 같은 문서를 다시 수집하면 Chunking·Embedding을 건너뛴다.
- [ ] 한 문서만 변경하면 해당 문서 Chunk만 재생성한다.
- [ ] 삭제·접근 불가 문서는 archived 처리한다.
- [ ] archived 문서는 Retrieval에서 제외된다.
- [ ] 반복 동기화에도 Document·Chunk가 중복 생성되지 않는다.
- [ ] 동기화 중 실패했을 때 기존 정상 문서가 손상되지 않는다.

### TASK-602. 처리 결과 통계

Sync 결과에 다음 값을 노출하거나 로그로 기록한다.

```text
scannedDocuments
createdDocuments
updatedDocuments
skippedDocuments
archivedDocuments
generatedChunks
generatedEmbeddings
failedDocuments
durationMs
```

완료 조건:

- 증분 수집의 비용 절감 효과를 호출 횟수 또는 처리 문서 수로 설명할 수 있다.
- 대표 정합성 시나리오가 통합 테스트로 고정되어 있다.

---

## 9-1. 계획 확정 보완안 — Answerability·Mode 정책·평가 성공 기준

구현 전에 아래 세 가지 정책을 고정한다. 이 기준은 구현 설명과 평가 보고서에서 동일하게 사용한다.

### Answerability 판정 기준

- 검색 Source가 0개면 답변용 Source packet을 반환하지 않는다.
- 검색 Source가 1개 이상이면 다음 조건을 모두 만족할 때만 답변 가능으로 본다.

```text
isAnswerable
= selectedSourceCount >= 1
  AND topAdjustedScore >= 0.65
  AND averageTop3AdjustedScore >= 0.55
```

- `topAdjustedScore`와 `averageTop3AdjustedScore`는 Retrieval 결과의 `adjustedScore`를 사용한다.
- `confidence`는 Retrieval 근거를 나타내며 외부 Agent의 LLM confidence와 구분한다.
- 시스템은 Retrieval 근거를 기준으로 `isAnswerable`을 결정하고, 충분한 경우에만 Source packet을 반환한다.
- 조건을 만족하지 못하면 답변용 Source를 반환하지 않고 `isAnswerable=false`로 Question을 저장한 뒤 Knowledge Gap을 생성한다.
- Threshold는 코드 상수로 흩어놓지 않고 평가 설정 객체에 모은다. 최초 값은 `0.65`, `0.55`로 두고, Golden Dataset 평가 결과에 따라 한 번만 조정한다.

### Mode별 Source Type과 Ranking 정책

Mode별 Source Type은 초기부터 Hard Filter로 정답을 제거하지 않도록 Ranking Bonus를 우선 적용한다. 단, `archived`와 `deprecated`는 모든 Mode에서 제외한다.

| Mode | 우선 Source Type | 우선 Knowledge Type | 답변 전략 |
|---|---|---|---|
| `onboarding` | `repo_readme`, `repo_docs`, `notion_page` | `onboarding`, `deployment`, `operation`, `architecture` | 핵심 개념과 시작 순서, 먼저 볼 문서 제시 |
| `product_history` | `adr`, `prd`, `incident_review`, `repo_docs` | `product_history`, `architecture`, `domain_policy`, `incident` | 현재 상태와 변경 이유, 결정 근거 설명 |
| `documentation_gap` | `repo_readme`, `repo_docs`, `notion_page` | `documentation_gap`, `onboarding`, `operation` | 부족한 문서 영역과 작성 우선순위 제시 |

최종 점수는 다음 순서를 유지한다.

```text
finalScore
= vectorSimilarity
+ modeSourceBonus
+ knowledgeTypeBonus
+ normalizedSourcePriorityBonus
+ activeStatusBonus
```

- Metadata Bonus의 합계가 Vector Similarity를 압도하지 않도록 각 Bonus의 최대 범위를 작게 제한한다.
- 평가 결과에는 `vectorScore`, 각 Bonus, `finalScore`, 적용된 Mode를 함께 기록한다.
- `auto`는 규칙 기반으로 Mode를 결정하고, 결정된 Mode의 정책을 그대로 사용한다.

### 평가 성공 기준

절대 수치 하나만으로 성공을 선언하지 않고, Vector Only Baseline 대비 개선 여부와 실패 사례를 함께 본다.

- Mode-aware의 `Hit@5` 또는 `MRR` 중 하나가 Vector Only보다 개선되어야 한다.
- 개선되지 않은 주요 지표가 Baseline 대비 크게 악화되지 않아야 한다.
- Source Citation Precision은 최소 90%를 목표로 한다.
- 답변 불가능 질문은 정상 거절율과 불필요한 거절율을 함께 기록한다.
- 개선된 질문, 악화된 질문, 악화 원인, 다음 개선안을 질문별 결과에 남긴다.
- 위 수치는 20개 Golden Dataset 전체의 품질을 보장하는 절대 기준이 아니라 v0.1 비교 실험의 목표로 사용한다.

---

## 10. Phase 7 — 평가 보고서와 면접 문서 업데이트

### TASK-701. 평가 보고서 작성

파일:

```text
docs/evaluation-report.md
```

필수 내용:

1. 평가 목적
2. Corpus 구성
3. Golden Question 구성
4. 측정 지표 정의
5. Vector Only Baseline
6. Mode-aware 결과
7. 개선된 질문과 악화된 질문
8. Answerability·Source Citation Precision 결과
9. Retrieval Latency·MCP Response Latency 변화
10. 한계와 다음 개선 후보

성과 문장 Template:

```text
Golden Question 20개를 기준으로 Vector Only와 Mode-aware Retrieval을 비교했다.
Mode-aware Retrieval 적용 후 Hit@5는 [A]%에서 [B]%로, MRR은 [C]에서 [D]로 변했다.
답변 불가능 질문 [N]개 중 [M]개에 대해 정상적으로 근거 부족을 표시했으며, Source Citation Precision은 [E]%였다.
대신 Retrieval P95는 [F]ms에서 [G]ms로 증가해 정확도와 지연 시간의 trade-off가 발생했다.
```

측정하지 않은 수치는 작성하지 않는다.

### TASK-702. README 업데이트

- [ ] MCP Retrieval-first 구조를 README에 설명하고 Completion Scaffold는 기본 경로가 아님을 명시한다.
- [ ] 평가 결과 요약 표를 추가한다.
- [ ] `pnpm eval:rag` 실행 방법을 추가한다.
- [ ] 대표 질문·Source packet·외부 Agent 답변·Citation 예시를 2~3개 추가한다.
- [ ] 여전히 구현하지 않은 기능은 한계로 유지한다.

### TASK-703. `interview.md` 업데이트

- [ ] “설계되어 있다”와 “구현·검증했다”를 구분한다.
- [ ] Metadata-aware Retrieval의 실제 Ranking 공식을 설명한다.
- [ ] MCP Client Agent와 townbase Retrieval Server의 역할을 구분한다.
- [ ] Golden Dataset과 지표 선택 이유를 추가한다.
- [ ] 성능이 개선되지 않은 부분과 trade-off도 설명한다.
- [ ] 1분 답변에는 핵심 수치 1~2개만 포함한다.

최종 표현:

> Notion·로컬 Git 문서를 증분 수집하고 Heading-aware Chunking과 pgvector 검색을 적용한 MCP Retrieval-first RAG Knowledge Agent를 구현했습니다. MCP Client Agent가 사용할 수 있도록 Retrieval Mode별 Source packet과 Citation을 반환하고, Golden Dataset으로 Vector Only와 Mode-aware 검색 품질을 비교했습니다. 근거가 부족한 질문은 Knowledge Gap과 ActionDraft로 전환하는 Human-in-the-loop 문서화 Workflow로 연결했습니다.

---

## 11. 지원서용 최소 현실 범위

이 프로젝트의 가장 중요한 목표는 “RAG 기반 시스템을 실제로 만들어봤다”는 것을 코드와 실행 결과로 보여주는 것이다. 따라서 기능을 넓히기보다 아래 세 가지 결과물을 우선 확보한다.

### 결과물 1 — 실행 가능한 End-to-End RAG 데모

P0에서 반드시 완료한다.

```text
Fixture 또는 로컬 문서 수집
→ Chunking·Embedding 저장
→ 질문 Embedding
→ Vector/Mode-aware Retrieval
→ Source 내용·Citation 반환
→ Question·QuestionSource 저장
→ MCP Client Agent가 최종 답변 생성
```

완료 기준:

- MCP `workspace_knowledge.question` 호출 한 번으로 Source packet이 반환된다.
- 응답에는 문서 내용 또는 필요한 Snippet, 제목·경로·Section·Citation이 포함된다.
- MCP Client Agent가 반환된 Source만 사용해 최종 답변을 만들 수 있다.
- OpenAI Chat API Key 없이 Fixture 또는 로컬 Retrieval Smoke Test를 실행한다.

### 결과물 2 — Source Grounding과 Citation 검증 결과

P0에서 결과물 1과 함께 완료한다.

- Source가 0개면 답변용 Source packet을 반환하지 않는다.
- 반환된 Source ID와 Citation은 실제 DB 검색 결과에 존재해야 한다.
- Citation은 검색 결과의 DB Source에서 복원한다.
- 근거가 부족하면 `isAnswerable=false`와 Knowledge Gap을 저장한다.
- 답변 가능 질문, 답변 불가능 질문, Source ID·Citation 불일치 상황을 각각 테스트한다.

### 결과물 3 — Vector Only 대비 Mode-aware 평가 보고서

P1에서 완료한다. P0가 먼저 동작하지 않으면 평가를 시작하지 않는다.

- 동일 Corpus와 Golden Question 10~20개를 사용한다.
- 동일 Embedding 모델·Top K로 `vector_only`와 `mode_aware`를 비교한다.
- `Hit@5`, `MRR`, Mode Accuracy, Answerability Accuracy, Source Citation Precision을 기록한다.
- 개선된 질문과 악화된 질문을 모두 기록한다.
- `docs/evaluation-report.md`에 실제 측정 수치만 작성한다.

## 12. 권장 실행 순서와 축소 기준

### P0 — 최우선: 실제 RAG 동작 완성

- [ ] 현재 Chat/MCP 호출 경로 확인
- [ ] MCP Retrieval 응답 Schema와 응답 Parser 연결
- [ ] Source 0개 시 빈 Source packet과 Knowledge Gap 반환
- [ ] Source ID·Citation이 실제 검색 결과인지 검증
- [ ] Chat 경로에 Mode-aware Ranking 연결
- [ ] archived/deprecated 문서 제외
- [ ] Question·QuestionSource·KnowledgeGap 저장
- [ ] 대표 질문의 End-to-End Smoke Test

P0 종료 조건:

```text
MCP 질문
→ 검색
→ Source packet·Citation 반환
→ Question/Source 저장
→ MCP Client Agent가 최종 답변 생성
→ 근거 부족 시 Knowledge Gap
```

이 흐름이 관찰되면 “RAG 기반 시스템을 만들어봤다”는 핵심 목표를 달성한 것으로 본다.

### P1 — 차별화: 평가와 비교 증거

- [ ] 평가 Corpus 구성
- [ ] Golden Question 10~20개 작성
- [ ] `vector_only`와 `mode_aware` 전환 설정
- [ ] 평가 Runner 구현
- [ ] Hit@5·MRR·Answerability·Citation 측정
- [ ] Baseline과 개선 결과 비교
- [ ] 실패 질문과 원인 기록
- [ ] `docs/evaluation-report.md` 작성
- [ ] README와 `interview.md`에 실제 결과 반영

P1 종료 조건:

- 동일 Dataset으로 두 전략을 재실행할 수 있다.
- Mode-aware가 어떤 질문을 개선했고 어떤 질문을 악화했는지 설명할 수 있다.
- 측정하지 않은 수치를 문서에 쓰지 않는다.

### P2 — 시간이 남으면 보강

- [ ] Knowledge Gap 중복 방지
- [ ] 증분 동기화 상세 통계
- [ ] 변경 없는 문서의 Embedding 미호출 검증
- [ ] Token·비용·P95 Latency 기록
- [ ] PostgreSQL 기반 통합 테스트와 Docker 실행 검증
- [ ] 대표 사용 흐름의 README·interview 문장 정리

### 다음 단계로 미룬다

- [ ] Hybrid Search
- [ ] Reranker
- [ ] Feedback 기반 Ranking
- [ ] Multi-Agent
- [ ] Web UI
- [ ] 외부 GitHub Issue·Notion Page 실제 발행
- [ ] Redis·BullMQ·별도 Worker
- [ ] 멀티테넌시·권한 동기화
- [ ] `change_impact` Mode

---

## 13. 최종 검증 체크리스트

### P0 기능 검증


- [ ] Fixture 또는 로컬 문서가 수집된다.
- [ ] Heading-aware Chunk와 Embedding이 저장된다.
- [ ] MCP 질문 Tool이 호출된다.
- [ ] MCP Retrieval 응답에 검색 Source 내용이 포함된다.
- [ ] MCP Client Agent가 반환된 Source로 최종 답변을 만들 수 있다.
- [ ] Citation이 DB Source에서 복원된다.
- [ ] Source가 없으면 답변용 Source를 반환하지 않는다.
- [ ] 근거가 없으면 Knowledge Gap으로 전환된다.
- [ ] Question·QuestionSource·KnowledgeGap이 저장된다.

### P1 평가 검증

- [ ] Vector Only Baseline 결과가 보존되어 있다.
- [ ] Mode-aware 결과가 동일 Dataset으로 측정되어 있다.
- [ ] Hit@5·MRR이 계산된다.
- [ ] Answerability·Source Citation Precision 결과가 계산된다.
- [ ] 개선·악화 질문과 원인이 기록되어 있다.
- [ ] 평가 보고서에 실제 수치만 남아 있다.

### 최종 완료 정의

최소한 다음 세 가지를 실제 실행 결과로 보여줄 수 있으면 지원서용 목표를 달성한 것으로 본다.

1. **End-to-End RAG 데모**: 질문이 Retrieval → MCP Source packet → 외부 Agent 답변까지 흐른다.
2. **Grounding 검증**: 근거가 없는 질문은 Source를 반환하지 않고 Knowledge Gap으로 전환된다.
3. **평가 보고서**: Vector Only와 Mode-aware의 차이를 같은 Dataset의 수치와 실패 사례로 설명한다.

P2 항목은 위 세 결과물을 완성한 뒤에만 진행한다.

---

## 14. 참고 문서

- OpenAI Structured Outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- OpenAI Text Generation·Responses API: https://developers.openai.com/api/docs/guides/text
