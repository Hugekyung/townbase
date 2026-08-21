# townbase RAG 완성 및 평가 작업 계획

## 1. 문서 목적

이 문서는 townbase를 2~3일 안에 다음 수준으로 개선하기 위한 실행 계획이다.

> Notion·로컬 Git 문서의 수집, Chunking, Embedding, Retrieval뿐 아니라 실제 LLM 답변과 Citation, Knowledge Gap 전환까지 동작하고, Golden Dataset을 이용해 검색 품질을 측정·개선한 End-to-End RAG Knowledge Agent

이번 작업은 기능 확장이 아니라 현재 구현의 핵심 공백을 메우고 성과를 수치로 증명하는 데 집중한다.

### 최종 목표

- 실제 OpenAI Completion Adapter를 연결한다.
- 반복 실행 가능한 RAG 평가 체계를 만든다.
- 기본 Vector Search의 Baseline을 측정한다.
- Retrieval Mode별 Metadata Filter와 Ranking을 실제 검색에 적용한다.
- 개선 전후의 검색·Answerability·Citation 품질을 비교한다.
- 결과를 README와 `interview.md`에서 설명할 수 있는 형태로 남긴다.

### 이번 범위에서 제외

- Slack·GitHub·Jira 등 신규 Connector
- Hybrid Search와 별도 Reranker
- LangChain·LangGraph 재작성
- Multi-Agent
- GitHub Issue·Notion Page 실제 생성
- Web UI
- `change_impact` Mode
- 멀티테넌시·권한 동기화
- Redis·BullMQ·별도 Worker

---

## 2. 전체 작업 순서

```text
사전 점검
→ 실제 LLM Completion 연결
→ 평가 Corpus·Golden Dataset 구성
→ 기존 Vector Search Baseline 측정
→ Mode-aware Metadata Retrieval 적용
→ 동일 Dataset 재측정
→ Answerability·Knowledge Gap 검증
→ 결과 문서화
```

| 우선순위 | 작업 | 예상 시간 | 핵심 산출물 |
|---:|---|---:|---|
| P0 | 실제 LLM Completion Adapter | 4~6시간 | End-to-End RAG 답변 |
| P0 | Golden Dataset·평가 Runner | 5~7시간 | Baseline 결과 |
| P1 | Metadata Filter·Mode Ranking | 4~6시간 | 개선 후 측정 결과 |
| P1 | Answerability·Gap 검증 | 2~4시간 | 환각 방지 결과 |
| P2 | 동기화 정합성 테스트 | 2~3시간 | 운영 안정성 증거 |
| P0 | 결과 문서화 | 2~3시간 | 평가 보고서·면접 문장 |

---

## 3. Phase 0 — 사전 점검과 Baseline 보존

### TASK-001. 현재 동작 경로 확인

- [ ] `apps/api/src/chat/chat.runtime.ts`에서 Completion Client 생성 위치를 확인한다.
- [ ] Completion Interface와 테스트용 Scaffold 구현체를 확인한다.
- [ ] MCP 질문 Tool에서 다음 호출 흐름을 코드 기준으로 기록한다.
  - Mode 결정
  - 질문 Embedding
  - Vector Search
  - Prompt Context 생성
  - Completion 호출
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

## 4. Phase 1 — 실제 OpenAI Completion Adapter

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

완료 조건:

- MCP 질문 한 번으로 실제 답변, Citation, QuestionSource 저장까지 완료된다.
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

#### Citation Accuracy

최종 답변의 Citation이 Golden Dataset의 관련 문서에 포함되는지 측정한다.

- [ ] `Hit@3`, `Hit@5`, `MRR` 구현
- [ ] Mode Accuracy 구현
- [ ] Answerability Accuracy 구현
- [ ] Citation Accuracy 또는 Citation Precision 구현
- [ ] 평균·P95 Retrieval Latency 구현
- [ ] 평균·P95 End-to-End Latency 구현
- [ ] 가능하면 LLM 입력·출력 Token과 예상 비용을 기록한다.

### TASK-303. 기존 Vector Search Baseline 측정

- [ ] `RAG_RETRIEVAL_STRATEGY=vector_only`로 평가한다.
- [ ] 결과 파일에 실행 일시, Git Commit, Embedding 모델, Chat 모델, Top K를 기록한다.
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
- [ ] 동일 Embedding·Chat 모델과 Top K를 사용한다.
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
→ LLM 미호출
→ isAnswerable=false
→ Knowledge Gap

Source는 있으나 검색 점수가 낮음
→ 낮은 근거 상태로 Prompt에 전달하거나 Gap 처리

Source 충분
→ LLM 답변
→ usedSourceIds 검증
→ Citation 저장
```

- [ ] Source 0개 처리 규칙을 코드로 강제한다.
- [ ] 최고 검색 Score와 Source 수를 기록한다.
- [ ] 고정 `0.65`가 LLM Confidence인지 최종 Confidence인지 명확히 한다.
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

- 검색 Source가 0개면 LLM을 호출하지 않는다.
- 검색 Source가 1개 이상이면 다음 조건을 모두 만족할 때만 답변 가능으로 본다.

```text
isAnswerable
= selectedSourceCount >= 1
  AND topAdjustedScore >= 0.65
  AND averageTop3AdjustedScore >= 0.55
```

- `topAdjustedScore`와 `averageTop3AdjustedScore`는 Retrieval 결과의 `adjustedScore`를 사용한다.
- LLM이 반환한 `confidence`는 최종 답변 가능 여부를 결정하는 기준으로 사용하지 않는다.
- 시스템은 Retrieval 근거를 기준으로 `isAnswerable`을 먼저 결정하고, LLM은 답변과 근거 Source ID만 반환한다.
- 조건을 만족하지 못하면 답변을 저장하지 않고 `isAnswerable=false`로 Question을 저장한 뒤 Knowledge Gap을 생성한다.
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
- Citation Accuracy는 최소 90%를 목표로 한다.
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
8. Answerability·Citation 결과
9. Latency·Token·비용 변화
10. 한계와 다음 개선 후보

성과 문장 Template:

```text
Golden Question 20개를 기준으로 Vector Only와 Mode-aware Retrieval을 비교했다.
Mode-aware Retrieval 적용 후 Hit@5는 [A]%에서 [B]%로, MRR은 [C]에서 [D]로 변했다.
답변 불가능 질문 [N]개 중 [M]개를 정상적으로 거절했으며, Citation Accuracy는 [E]%였다.
대신 Retrieval P95는 [F]ms에서 [G]ms로 증가해 정확도와 지연 시간의 trade-off가 발생했다.
```

측정하지 않은 수치는 작성하지 않는다.

### TASK-702. README 업데이트

- [ ] 현재 구현 상태에서 Completion Scaffold 문구를 제거하거나 실제 상태로 수정한다.
- [ ] 평가 결과 요약 표를 추가한다.
- [ ] `pnpm eval:rag` 실행 방법을 추가한다.
- [ ] 대표 질문·답변·Citation 예시를 2~3개 추가한다.
- [ ] 여전히 구현하지 않은 기능은 한계로 유지한다.

### TASK-703. `interview.md` 업데이트

- [ ] “설계되어 있다”와 “구현·검증했다”를 구분한다.
- [ ] Metadata-aware Retrieval의 실제 Ranking 공식을 설명한다.
- [ ] Golden Dataset과 지표 선택 이유를 추가한다.
- [ ] 성능이 개선되지 않은 부분과 trade-off도 설명한다.
- [ ] 1분 답변에는 핵심 수치 1~2개만 포함한다.

최종 표현:

> Notion·로컬 Git 문서를 증분 수집하고 Heading-aware Chunking과 pgvector 검색을 적용한 End-to-End RAG Knowledge Agent를 구현했습니다. Golden Dataset으로 Retrieval Mode, Answerability, Citation 품질을 측정하고, Mode별 Metadata Ranking을 적용해 일반 Vector Search와 성능을 비교했습니다. 근거가 부족한 질문은 Knowledge Gap과 ActionDraft로 전환하는 Human-in-the-loop 문서화 Workflow로 연결했습니다.

---

## 11. 권장 3일 일정

### Day 1 — 실제 답변 파이프라인 완성

- [ ] TASK-001~002: 현재 코드 경로와 Baseline 보존
- [ ] TASK-101~104: OpenAI Completion Adapter 및 테스트
- [ ] TASK-201: 평가 Corpus 준비

Day 1 종료 조건:

- 실제 질문 한 건이 Retrieval → LLM → Citation → Persistence까지 성공한다.
- Fake Adapter 기반 전체 테스트가 통과한다.

### Day 2 — 평가와 Retrieval 개선

- [ ] TASK-202: Golden Question 20개 완성
- [ ] TASK-301~303: 평가 Runner와 Vector Baseline
- [ ] TASK-401~403: Metadata Filter·Ranking 적용 및 재측정

Day 2 종료 조건:

- 한 명령으로 두 Retrieval Strategy를 비교할 수 있다.
- 개선 전후 지표와 실패 질문 목록이 생성된다.

### Day 3 — 신뢰성 검증과 문서화

- [ ] TASK-501~503: Answerability·Knowledge Gap 검증
- [ ] TASK-601~602: 핵심 증분 동기화 테스트
- [ ] TASK-701~703: 평가 보고서·README·면접 문서 업데이트

Day 3 종료 조건:

- 평가 결과가 문서에 반영되어 있다.
- 구현 범위와 한계를 과장 없이 설명할 수 있다.
- 저장소의 전체 검증 명령이 통과한다.

---

## 12. 시간 부족 시 축소 기준

### 반드시 완료

- [ ] 실제 OpenAI Completion Adapter
- [ ] Golden Question 20개
- [ ] 평가 Runner와 Vector Baseline
- [ ] archived 제외 및 Mode별 Metadata Ranking
- [ ] 개선 전후 결과표
- [ ] 평가 보고서와 `interview.md` 반영

### 시간이 남으면 완료

- [ ] Answerability Threshold 조정
- [ ] Knowledge Gap 중복 방지
- [ ] 증분 동기화 상세 통계
- [ ] Token·비용 측정

### 다음 단계로 미룬다

- [ ] Hybrid Search
- [ ] Reranker
- [ ] Feedback 기반 Ranking
- [ ] 외부 Issue·Page Publish Adapter

---

## 13. 최종 검증 체크리스트

### 기능

- [ ] Notion 또는 Fixture 문서가 정상 수집된다.
- [ ] Heading-aware Chunk와 실제 Embedding이 저장된다.
- [ ] pgvector Retrieval이 동작한다.
- [ ] 실제 LLM이 Source 기반 답변을 생성한다.
- [ ] Citation이 DB Source에서 복원된다.
- [ ] 근거가 없으면 Knowledge Gap으로 전환된다.
- [ ] ActionDraft가 저장되고 외부에는 자동 게시되지 않는다.

### 품질

- [ ] Vector Baseline 결과가 보존되어 있다.
- [ ] Mode-aware 결과가 동일 Dataset으로 측정되어 있다.
- [ ] Hit@3·Hit@5·MRR이 계산된다.
- [ ] Answerability·Citation 결과가 계산된다.
- [ ] Latency가 기록된다.
- [ ] 실패 질문을 재현할 수 있다.

### 테스트와 문서

- [ ] Unit Test 통과
- [ ] Integration Test 통과
- [ ] Lint·Type Check 통과
- [ ] 실제 API Smoke Test 통과
- [ ] `docs/evaluation-report.md` 작성
- [ ] README 업데이트
- [ ] `interview.md` 업데이트

### 최종 완료 정의

다음 질문에 실제 코드와 측정 수치로 답할 수 있으면 작업을 완료한 것으로 본다.

1. 기존 Vector Search의 품질은 어느 정도였는가?
2. Retrieval Mode와 Metadata Ranking이 어떤 질문을 개선했는가?
3. 어떤 질문에서는 성능이 나빠졌으며 그 이유는 무엇인가?
4. 답할 수 없는 질문을 어떻게 판단하고 처리했는가?
5. Citation이 실제 답변 근거임을 어떻게 검증했는가?
6. 증분 수집이 불필요한 Embedding 호출을 얼마나 줄였는가?
7. 정확도, 지연 시간, 비용 사이에서 어떤 선택을 했는가?

---

## 14. 참고 문서

- OpenAI Structured Outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- OpenAI Text Generation·Responses API: https://developers.openai.com/api/docs/guides/text
