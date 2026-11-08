# townbase 면접 준비 자료

이 문서는 townbase의 현재 구현을 기준으로 작성한 면접 준비용 요약이다. 단순 용어 암기보다 다음 세 가지를 설명하는 데 목적이 있다.

1. 어떤 문제를 해결하려고 했는가
2. 왜 이 구조와 기술을 선택했는가
3. 평가에서 어떤 한계를 발견했고 어떻게 개선할 것인가

---

## 1. 프로젝트 한 문장 설명

townbase는 Notion과 로컬 Git 저장소에 흩어진 개발 문서를 수집·색인하고, MCP Client Agent가 질문과 관련된 근거 문서를 검색할 수 있도록 만든 local-first RAG Knowledge Agent다.

OpenAI API는 Embedding 생성에만 사용한다. 최종 자연어 답변은 Codex 같은 MCP Client Agent가 townbase의 `sourcePacket`과 Citation을 바탕으로 생성한다.

### 30초 소개 예시

> Notion과 Git에 흩어진 README, ADR, PRD 같은 개발 문서를 대상으로 RAG Pipeline을 직접 구현했습니다. 문서를 Heading-aware 방식으로 Chunking하고 OpenAI Embedding을 생성해 PostgreSQL과 pgvector에 저장합니다. 질문이 들어오면 같은 모델로 질문을 Embedding한 뒤 Vector Search를 수행하고, 검색된 Chunk와 Citation을 MCP를 통해 Agent에 전달합니다. 근거가 부족하면 답을 만들어내지 않고 Knowledge Gap으로 저장합니다. Keeply 문서 21개와 질문 23개로 평가했고, 현재 RAG만으로 정답 근거를 찾은 비율은 73.9%였습니다.

---

## 2. 해결하려는 문제와 제품 범위

### 문제

개발 지식은 Notion, README, ADR, PRD, schema, migration 등에 분산된다. 시간이 지나면 문서 위치뿐 아니라 “왜 이렇게 결정했는가”를 찾기 어려워진다.

townbase는 다음 문제에 집중한다.

- 신규 개발자가 먼저 읽어야 할 문서를 찾기 어려운 문제
- 제품 정책과 기술 결정의 과거 배경을 다시 찾기 어려운 문제
- 답변에 사용한 출처를 확인하기 어려운 문제
- 답변하지 못한 질문이 문서화 작업으로 이어지지 않는 문제

### 현재 범위

- Notion Root Page와 하위 페이지 수집
- 로컬 Git 저장소의 문서성 파일 수집
- 문서 정규화, Chunking, Embedding, pgvector 저장
- Workspace 범위의 Vector Search
- MCP `workspace_knowledge.question` 도구 제공
- Source packet과 Citation 반환
- Answerability 판정
- Question, QuestionSource, KnowledgeGap, ActionDraft 저장

### 현재 비범위

- 웹 UI
- SaaS 및 멀티테넌시
- 사용자별 권한 동기화
- 전체 소스 코드 의미 검색
- Hybrid Search와 Reranker
- Slack, Jira, Google Drive 등의 추가 Connector
- GitHub Issue나 Notion Page의 자동 게시
- 별도 Worker와 외부 클라우드 배포

면접에서는 비범위를 “못 만든 기능”이 아니라 **PoC에서 핵심 RAG 흐름을 먼저 검증하기 위해 의도적으로 줄인 범위**라고 설명한다.

---

## 3. 전체 동작 흐름

```text
Notion / Local Git
        │
        ▼
Connector가 문서 수집
        │
        ▼
Document 정규화 + Metadata + Content Hash
        │
        ▼
Heading-aware Chunking + Token fallback + Overlap
        │
        ▼
OpenAI text-embedding-3-small / 1536차원
        │
        ▼
PostgreSQL Document·Chunk + pgvector Embedding 저장
        │
        ▼
MCP Client Agent가 질문 Tool 호출
        │
        ▼
질문 Embedding 생성
        │
        ▼
Workspace 범위 Cosine Similarity 검색 + Top K
        │
        ▼
Answerability 판정
   ┌────┴────┐
   ▼         ▼
근거 충분   근거 부족
   │         │
   ▼         ▼
sourcePacket Knowledge Gap
+ Citation   + Action Draft
   │
   ▼
MCP Client Agent가 최종 답변 생성
```

### townbase와 MCP Client Agent의 역할 구분

townbase가 담당하는 일:

- 문서 수집과 색인
- 질문에 관련된 Chunk 검색
- 답변 가능 여부 판단
- Source packet과 Citation 구성
- 질문과 검색 이력 저장
- Knowledge Gap 저장

MCP Client Agent가 담당하는 일:

- 사용자의 자연어 질문 이해
- townbase MCP Tool 호출
- 반환된 Source만 근거로 최종 자연어 답변 작성
- 근거가 없으면 답변 불가 안내

townbase 내부 Completion Adapter는 현재 네트워크 Chat API를 호출하는 구현이 아니라 계약을 유지하기 위한 Scaffold다. 별도 OpenAI Chat/Responses API를 호출하지 않으므로 townbase에서 발생하는 OpenAI 비용은 Embedding 사용량뿐이다.

---

## 4. 반드시 이해해야 할 RAG 핵심 개념

### 4.1 RAG

RAG는 Retrieval-Augmented Generation의 약자다. LLM이 학습할 때 기억한 정보만 사용하는 대신, 질문 시점에 외부 문서를 검색해 그 내용을 함께 제공하는 방식이다.

```text
질문 → 관련 문서 검색(Retrieval) → 검색 문서를 근거로 답변(Generation)
```

왜 필요한가:

- 모델이 학습하지 않은 사내·개인 문서를 사용할 수 있다.
- 최신 문서를 다시 모델 학습 없이 반영할 수 있다.
- 답변 출처를 제공할 수 있다.
- 환각을 줄일 수 있다.

RAG를 사용해도 검색 결과가 틀리면 답변도 틀릴 수 있다. 그래서 Retrieval 품질과 최종 답변 품질을 분리해서 평가해야 한다.

### 4.2 Ingestion

외부 문서를 RAG가 검색할 수 있는 형태로 가져오는 전체 과정이다.

townbase에서는 다음 순서다.

```text
수집 → 정규화 → 변경 감지 → Chunking → Embedding → 저장
```

Connector가 달라도 최종 `Document` 구조를 동일하게 만들기 때문에 이후 Pipeline은 Notion과 Git의 차이를 크게 의식하지 않아도 된다.

### 4.3 Document Normalization

서로 다른 원본 데이터를 공통 형태로 바꾸는 작업이다. Notion Page와 Markdown 파일의 원래 구조는 다르지만, townbase에서는 제목, 본문, 경로 또는 URL, Source Type, 상태, Metadata 같은 공통 필드로 저장한다.

핵심 이유는 Connector별 예외가 Chunking과 Retrieval까지 퍼지는 것을 막기 위해서다.

### 4.4 Chunking

긴 문서를 검색 가능한 작은 단위로 나누는 작업이다. 문서 전체를 하나의 Vector로 만들면 여러 주제가 섞여 질문과의 관련성이 흐려질 수 있다.

townbase의 기본값:

- `maxTokens = 600`
- `overlapTokens = 80`

처리 방식:

1. Markdown과 Notion 문서는 Heading 경계를 우선한다.
2. 한 Section이 너무 길면 Token 기준으로 다시 나눈다.
3. 구조가 없는 문서는 처음부터 Token 기준으로 나눈다.
4. 각 Chunk에 `headingPath`, `sectionTitle`, `chunkIndex`를 저장한다.

600 Token은 하나의 주제를 담을 만큼 충분한 문맥을 제공하면서 너무 많은 주제가 섞이는 것을 줄이기 위한 PoC 시작값이다. 최적값은 문서와 질문 데이터로 다시 평가해야 한다.

### 4.5 Overlap

앞 Chunk의 마지막 일부를 다음 Chunk에도 포함하는 것이다.

```text
Chunk 1: A B C D E
Chunk 2:       D E F G H
               └ overlap
```

문장이 Chunk 경계에서 끊겨 의미가 사라지는 것을 줄인다. 너무 크면 같은 내용이 중복 저장되고 검색 결과도 비슷한 Chunk로 채워질 수 있다.

### 4.6 Token

모델이 텍스트를 처리하는 작은 단위다. 글자 수나 단어 수와 완전히 같지 않다. Chunk 크기를 Token으로 관리하면 Embedding 모델의 입력 단위와 더 가깝게 제한할 수 있다.

### 4.7 Embedding

텍스트의 의미를 숫자 배열인 Vector로 바꾸는 작업이다. 의미가 비슷한 문장은 Vector 공간에서도 가까워지도록 학습되어 있다.

townbase 설정:

- 모델: `text-embedding-3-small`
- 차원: `1536`
- 문서 Chunk와 질문에 동일한 모델 사용

Embedding은 답변을 생성하지 않는다. 텍스트를 검색 가능한 숫자로 바꾸는 역할만 한다.

### 4.8 Vector Dimension

Vector를 구성하는 숫자의 개수다. 1536차원은 숫자 1536개로 텍스트 의미를 표현한다는 뜻이다.

차원이 크면 더 많은 특징을 표현할 여지가 있지만 저장 공간과 연산량도 늘어난다. PoC에서는 모델 기본값과 pgvector Schema의 `vector(1536)`을 일치시켜 복잡성을 줄였다.

문서와 질문 Vector의 차원이 다르면 거리 계산이 불가능하다. 그래서 townbase는 모델과 차원을 고정하고, 저장·검색 시 `embeddingModel`과 `vector_dims`를 검사한다.

### 4.9 Vector Database와 pgvector

Vector Database는 Vector 사이의 거리를 이용해 의미가 가까운 데이터를 찾는다. townbase는 별도 Vector 전용 DB 대신 PostgreSQL 확장인 pgvector를 사용한다.

장점:

- Document, Question, Knowledge Gap 같은 관계형 데이터와 Vector를 한 DB에서 관리할 수 있다.
- Transaction과 Join 등 PostgreSQL 기능을 그대로 사용할 수 있다.
- Local Docker 구성에 적합하다.

한계:

- 대규모 Vector 전용 서비스보다 확장 기능과 운영 도구가 제한될 수 있다.
- Prisma가 pgvector를 완전히 추상화하지 않아 Vector 저장과 검색에는 Raw SQL이 필요하다.

### 4.10 Cosine Similarity

두 Vector가 가리키는 방향이 얼마나 비슷한지 측정한다. 문장 길이보다 의미의 방향을 비교하는 데 적합하다.

townbase SQL의 핵심은 다음과 같은 의미다.

```text
similarity = 1 - cosine distance
```

Score가 높을수록 질문과 Chunk가 의미상 가깝다고 본다. 이 값은 절대적인 정답 확률이 아니다. 모델, 문서, Chunking에 따라 분포가 달라진다.

### 4.11 Top K

검색 결과 중 점수가 높은 상위 K개를 반환한다는 뜻이다. 특정 알고리즘 이름이 아니다.

townbase 기본값은 `topK=5`, 허용 범위는 1~50이다.

- K가 너무 작으면 필요한 문서를 놓칠 수 있다.
- K가 너무 크면 무관한 문서가 Context에 섞이고 비용과 노이즈가 늘어난다.

### 4.12 Metadata

본문 외에 검색과 출처 추적에 사용하는 정보다.

예시:

- `sourceType`
- `knowledgeTypes`
- `domainTags`
- `status`
- `filePath` 또는 `url`
- `headingPath`
- `sourcePriority`

현재 P0의 Vector Only 검색은 Metadata Bonus를 핵심 Ranking에 적용하지 않는다. 이후 Mode-aware Retrieval에서 문서 유형과 질문 목적에 따라 우선순위를 줄 수 있도록 구조는 보존한다.

### 4.13 Source Packet

MCP Client Agent가 답변을 만들 수 있도록 townbase가 반환하는 검색 근거 묶음이다.

주요 정보:

- Chunk 본문
- Document와 Chunk ID
- 문서 제목
- 파일 경로 또는 URL
- Section
- Score와 Rank

Source packet은 답변 자체가 아니라 **답변을 만들기 위한 근거 재료**다.

### 4.14 Citation

답변이 어떤 원본 문서와 Chunk를 사용했는지 보여주는 출처 정보다. Citation은 LLM이 임의로 생성하지 않고 DB 검색 결과에서 만든다.

이렇게 해야 존재하지 않는 URL이나 파일 경로를 출처처럼 만드는 문제를 줄일 수 있다.

### 4.15 Grounding

답변을 제공된 Source에 묶는 원칙이다. Source에 없는 내용을 모델의 기억이나 추측으로 채우지 않는 것이 핵심이다.

Grounding이 중요한 이유:

- 답변을 검증할 수 있다.
- 사용자마다 다른 Agent Memory에 의존하는 문제를 줄인다.
- 문서와 답변의 불일치를 찾을 수 있다.

### 4.16 Answerability

검색 결과가 “답변을 만들기에 충분한가”를 판단하는 정책이다.

townbase의 현재 조건:

```text
Source가 1개 이상 존재
AND Top-1 Score >= 0.45
AND 상위 3개 평균 Score >= 0.40
```

모두 만족하면 `isAnswerable=true`다. 만족하지 못하면 Source packet을 비우고 Knowledge Gap으로 처리한다.

Top-1만 보면 우연히 비슷한 Chunk 하나가 통과할 수 있다. 상위 3개 평균을 함께 보면 검색 결과 전체가 어느 정도 일관되게 관련 있는지 확인할 수 있다.

### 4.17 Threshold, False Positive, False Negative

Threshold는 답변 가능한 검색 점수의 최소 기준이다.

- Threshold를 낮추면 더 많은 질문에 답하지만 무관한 근거가 통과할 수 있다.
- Threshold를 높이면 안전하지만 정상 질문도 거절할 수 있다.

False Positive:

> 실제 근거가 부족한데 답변 가능하다고 판단한 경우

False Negative:

> 정답 문서가 있는데 답변 불가라고 판단한 경우

현재 Keeply 평가에서는 False Negative가 주요 문제였다. 따라서 초기 `0.65/0.55`에서 `0.45/0.40`으로 조정했다. 이 값은 보편적인 정답이 아니라 현재 Corpus에 맞춘 임시 Calibration 값이다.

### 4.18 Knowledge Gap

현재 문서로 안전하게 답할 수 없는 질문을 문서화 부족 항목으로 저장한 것이다.

단순히 “검색 실패”로 끝내지 않고 다음 문서 작성 작업으로 연결하는 것이 제품의 차별점이다.

```text
답변 불가 질문
  → Question 저장
  → KnowledgeGap 저장
  → Markdown 또는 GitHub Issue 형식 ActionDraft 생성
  → 사람이 검토 후 실제 문서화
```

### 4.19 Content Hash와 멱등성

Content Hash는 문서 내용으로 계산한 고정 길이 값이다. 내용이 같으면 Hash도 같고, 내용이 바뀌면 Hash가 달라진다.

townbase는 재수집 시 Hash가 같으면 Chunking과 Embedding을 건너뛴다. 이를 통해 다음 효과를 얻는다.

- 중복 Document와 Chunk 방지
- 불필요한 Embedding API 비용 감소
- 변경된 문서만 다시 색인

같은 작업을 여러 번 실행해도 결과가 중복되지 않는 성질을 멱등성이라고 한다.

### 4.20 Workspace

서로 다른 문서 집합이 검색 결과에 섞이지 않도록 나누는 논리적 경계다. 모든 Document, Chunk, Question, Gap은 `workspaceId`와 연결된다.

질문 검색 SQL도 `workspaceId`로 제한한다. PoC 사용 편의를 위해 환경 변수로 기본 Workspace를 지정할 수 있고, 요청에 명시적인 `workspaceId`가 있으면 그 값을 우선한다.

실무에서는 인증된 사용자 또는 조직 정보에서 Workspace를 자동 결정하는 방식이 일반적이다. 현재 환경 변수 방식은 단일 사용자 local-first PoC에 맞춘 선택이다.

### 4.21 MCP

MCP는 Model Context Protocol의 약자다. AI Agent가 외부 도구와 데이터를 정해진 계약으로 호출할 수 있게 하는 프로토콜이다.

townbase는 MCP Server이고 Codex 같은 도구가 MCP Client다.

```text
사용자 → Codex → townbase MCP Tool → RAG 검색 → Source 반환 → Codex 답변
```

MCP를 선택한 이유는 별도 Chat UI와 Chat Completion API를 만들지 않고도 여러 Agent가 같은 RAG 검색 기능을 사용할 수 있기 때문이다.

### 4.22 Vector Only와 Mode-aware Retrieval

Vector Only:

- 질문과 Chunk의 Vector 유사도만으로 순위를 정한다.
- 구조가 단순하고 Baseline을 측정하기 쉽다.
- 질문 목적이나 문서 유형을 충분히 반영하지 못할 수 있다.

Mode-aware:

- Vector Score에 질문 목적, Source Type, Metadata 우선순위를 함께 반영한다.
- 예를 들어 제품 결정 배경 질문에서는 ADR과 PRD를 우선할 수 있다.
- 규칙과 가중치가 늘어나 평가와 디버깅이 어려워진다.

townbase는 P0에서 Vector Only를 먼저 완성했다. 기본 검색 성능을 확인하기 전에 Mode 규칙까지 섞으면 실패 원인이 Vector 검색인지 Mode 가중치인지 구분하기 어렵기 때문이다.

---

## 5. 주요 ADR과 결정 근거

ADR은 Architecture Decision Record의 약자다. 중요한 기술 선택의 배경, 결정, 대안, 결과를 기록하는 문서다.

### ADR 1. Local-first와 Self-hosted

결정:

- 사용자가 직접 실행하는 Docker 기반 애플리케이션으로 구성
- SaaS와 외부 클라우드 배포는 v0.1에서 제외

근거:

- 개발 문서는 민감할 수 있어 외부 서비스 전송 범위를 줄여야 한다.
- 개인 PoC에서 인증, 과금, 멀티테넌시보다 RAG 핵심 기능이 우선이다.
- PostgreSQL과 API를 로컬에서 재현하기 쉽다.

Trade-off:

- 사용자가 직접 설치하고 운영해야 한다.
- 팀 단위 권한과 중앙 관리 기능이 없다.

### ADR 2. 전체 코드가 아닌 문서성 Source 우선

결정:

- README, docs, ADR, PRD, schema, migration을 우선 수집
- 전체 코드베이스 Indexing은 제외

근거:

- 프로젝트의 목표는 코드 자동 이해보다 온보딩과 의사결정 배경 검색이다.
- 코드 전체를 색인하면 데이터량, Chunking 정책, 언어별 Parsing 난도가 크게 증가한다.
- 먼저 작은 Corpus에서 검색과 Citation의 정확성을 검증할 수 있다.

Trade-off:

- 실제 구현 세부사항을 묻는 질문에는 답변 범위가 제한된다.

### ADR 3. PostgreSQL + pgvector

결정:

- 관계형 데이터와 Vector를 PostgreSQL 한 곳에 저장

근거:

- Document, Chunk, Question, Gap 사이 관계를 함께 관리해야 한다.
- PoC에서 별도 Vector DB 운영 부담을 피할 수 있다.
- Workspace 조건과 상태 조건을 SQL에서 함께 적용하기 쉽다.

Trade-off:

- Prisma의 Vector 지원이 제한돼 Raw SQL이 필요하다.
- 대규모 검색에서는 Index와 성능 튜닝이 추가로 필요하다.

### ADR 4. OpenAI Embedding만 사용하고 Chat API는 사용하지 않음

결정:

- `text-embedding-3-small`로 문서와 질문 Embedding 생성
- 최종 답변은 MCP Client Agent가 생성
- townbase 내부에서는 OpenAI Chat/Responses API를 호출하지 않음

근거:

- 사용자가 이미 사용하는 Agent 모델을 다시 호출하는 중복 비용을 피할 수 있다.
- townbase의 책임을 Retrieval과 Grounding에 집중할 수 있다.
- 특정 LLM Vendor의 답변 API에 덜 종속된다.

Trade-off:

- 최종 답변 품질과 형식은 MCP Client Agent의 영향을 받는다.
- Client가 Source Grounding 규칙을 지키는지 별도로 확인해야 한다.

### ADR 5. Embedding 모델과 차원을 고정

결정:

- 모델: `text-embedding-3-small`
- 차원: `1536`

근거:

- 문서와 질문은 같은 Vector 공간에 있어야 한다.
- 모델이 섞이면 같은 1536차원이어도 의미 공간이 달라 비교가 무의미할 수 있다.
- Schema `vector(1536)`과 모델 기본 차원을 맞춰 Migration과 재색인을 단순화한다.

Trade-off:

- 다른 모델을 실험하려면 전체 재Embedding과 Schema 검토가 필요하다.
- 모델 선택 유연성이 줄어든다.

### ADR 6. Heading-aware Chunking + Token fallback

결정:

- 문서의 Heading 구조를 먼저 보존
- 긴 Section이나 일반 Text는 Token 단위로 분할
- 기본값 `600/80`

근거:

- Heading은 사람이 작성한 의미 경계다.
- 고정 길이로만 자르면 제목과 본문 관계가 끊길 수 있다.
- Token fallback은 매우 긴 Section도 Embedding 입력 크기 안에서 처리한다.

Trade-off:

- 짧은 Section이 많이 생기면 Chunk 크기가 고르지 않다.
- 문서 종류에 따라 600/80이 최적이 아닐 수 있다.

### ADR 7. Content Hash 기반 증분 Sync

결정:

- 같은 Hash는 재처리하지 않고 변경된 문서만 재색인
- 사라진 문서는 즉시 삭제하지 않고 `archived` 처리

근거:

- Embedding API 비용과 Sync 시간을 줄인다.
- 중복 Chunk 생성을 막는다.
- Source가 사라진 이력을 보존할 수 있다.

Trade-off:

- Hash와 상태 전환 정책이 잘못되면 오래된 Chunk가 남을 수 있다.
- 변경·삭제·부분 실패 시나리오에 대한 검증이 필요하다.

### ADR 8. P0는 Vector Only 우선

결정:

- 기본 RAG 수직 흐름에서는 Metadata Bonus와 Mode Ranking을 제외
- Vector Only를 Baseline으로 먼저 평가

근거:

- 가장 기본적인 RAG 검색이 정상인지 먼저 확인할 수 있다.
- Mode-aware 규칙을 동시에 넣을 때 생기는 디버깅 복잡성을 피한다.
- 이후 개선 효과를 Baseline과 비교할 수 있다.

Trade-off:

- 짧은 질문이나 문서 표현과 다른 질문에서 검색 실패가 발생할 수 있다.

### ADR 9. Answerability를 이중 Score 조건으로 판정

결정:

- Top-1 `0.45` 이상
- 상위 3개 평균 `0.40` 이상
- Source가 1개 이상일 때만 답변 가능

근거:

- Top-1 하나만 우연히 높게 나온 경우를 줄인다.
- 초기 `0.65/0.55`는 관련 문서가 있는 정상 질문도 과도하게 거절했다.
- Keeply 질문의 실제 Score 분포를 바탕으로 현재 값을 정했다.

Trade-off:

- Threshold를 낮춘 만큼 관련성이 약한 Source가 통과할 위험이 있다.
- Corpus와 모델이 바뀌면 다시 Calibration해야 한다.

### ADR 10. 근거 부족 시 답변 대신 Knowledge Gap 저장

결정:

- `isAnswerable=false`면 답변 Source를 비움
- Knowledge Gap과 Action Draft를 저장

근거:

- 그럴듯한 오답보다 답변 불가가 안전하다.
- 반복되는 실패 질문을 문서화 Backlog로 전환할 수 있다.

Trade-off:

- Threshold가 부정확하면 실제 답이 있는 질문도 Gap으로 잘못 저장된다.

### ADR 11. 외부 변경은 Draft에서 중단

결정:

- GitHub Issue나 Notion Page를 자동 게시하지 않음
- 사람이 검토할 Markdown 또는 Issue Draft만 생성

근거:

- Agent가 잘못 판단해 외부 시스템을 변경하는 위험을 줄인다.
- PoC에서 승인, 권한, 복구 Workflow까지 구현하는 범위를 피한다.

Trade-off:

- 최종 게시에는 수동 작업이 필요하다.

### ADR 12. 환경 변수 기반 Default Workspace

결정:

- 요청에 `workspaceId`가 없으면 프로젝트 `.env`의 기본 Workspace를 사용
- 명시적인 `workspaceId`가 있으면 요청값을 우선

근거:

- 단일 사용자 PoC에서 매 질문마다 ID를 입력하는 불편을 줄인다.
- Codex 실행 위치와 관계없이 같은 프로젝트 설정을 사용하게 한다.

Trade-off:

- 실무 멀티사용자 환경에서는 안전한 Tenant 결정 방식이 아니다.
- 운영 환경에서는 인증 Context에서 Workspace를 결정해야 한다.

### ADR 13. 규칙 기반 Auto Mode

결정:

- `auto`는 키워드 규칙으로 `onboarding`, `product_history`, `documentation_gap` 중 하나를 선택

근거:

- 분류 결과를 설명하고 재현하기 쉽다.
- 추가 LLM 호출 비용이 없다.
- 작은 PoC에서 동작을 빠르게 검증할 수 있다.

Trade-off:

- 짧거나 애매한 질문을 잘못 분류할 수 있다.
- 현재 P0 Vector Only에서는 Mode가 실제 Ranking에 주는 효과가 제한적이다.

---

## 6. 데이터 모델 이해

### Workspace

문서와 질문이 섞이지 않게 분리하는 최상위 경계다.

### DataSource

Notion Root Page 또는 Local Git Repository 같은 수집 원본이다.

### Document

원본 문서 단위다. 제목, 본문, URL 또는 파일 경로, Content Hash, 상태, Metadata를 저장한다.

### DocumentChunk

검색 단위다. 분할된 본문, Embedding, 모델명, Heading, Token 수, Source Metadata를 저장한다.

### Question

사용자 질문, 요청 Mode, 결정된 Mode, Confidence, Answerability를 저장한다.

### QuestionSource

질문과 실제 검색된 Chunk 사이의 연결이다. Score와 Rank를 저장해 어떤 근거로 판정했는지 추적할 수 있다.

### KnowledgeGap

답변하지 못한 질문을 문서화 부족 항목으로 저장한다.

### ActionDraft

Knowledge Gap을 해결하기 위한 Markdown 또는 GitHub Issue 형태의 초안이다.

이 구조의 핵심은 **답변 결과만 저장하지 않고 질문 → 검색 Chunk → Score → Gap까지 추적 가능하게 만든 것**이다.

---

## 7. 패키지 구조와 책임 분리

```text
apps/api/              NestJS API, MCP Entry Point, 질문 실행 흐름
packages/connectors/   Notion과 Local Git 문서 수집 및 Sync
packages/rag-core/     Chunking, Embedding, Retrieval Mode 계약
packages/agent-core/   Prompt Context, Citation, Grounding 규칙
packages/database/     Prisma Schema, Migration, Vector Raw SQL
```

면접 설명 포인트:

- Connector와 RAG Core를 분리해 새로운 Source가 추가돼도 Chunking과 검색 로직을 재사용한다.
- Agent Core는 최종 LLM Provider보다 Source Context와 Citation 계약에 집중한다.
- Database Package가 pgvector Raw SQL을 소유해 Vector 구현 세부사항이 Service 전체로 퍼지지 않게 한다.

---

## 8. 평가 개념과 현재 결과

### Golden Question

평가에 사용할 질문과 기대 근거를 미리 정한 데이터다. 검색 결과를 객관적으로 비교하려면 “어떤 문서가 정답인가”가 필요하다.

### Hit@K

정답 문서가 상위 K개 검색 결과 안에 포함된 질문의 비율이다.

```text
Hit@K = 정답 문서가 Top K에 포함된 질문 수 / 전체 질문 수
```

현재 Keeply 평가에서는 RAG Hit@K가 `17/23`, 즉 `73.9%`다.

### MRR

Mean Reciprocal Rank의 약자다. 정답 문서가 몇 번째에 등장했는지를 평가한다.

```text
1위 정답 = 1
2위 정답 = 1/2
3위 정답 = 1/3
각 질문 값을 평균
```

Hit@K가 “K개 안에 들어왔는가”를 본다면 MRR은 “얼마나 앞에 나왔는가”를 본다.

### Precision과 Recall

Precision:

> 반환한 문서 중 실제 관련 문서의 비율

Recall:

> 찾아야 할 관련 문서 중 실제로 찾아낸 비율

Top K를 늘리면 Recall은 좋아질 수 있지만 무관 문서도 늘어 Precision이 낮아질 수 있다.

### 현재 공식 평가

- Corpus: Keeply Document 21개
- Golden Question: 23개
- Mode: `auto`
- RAG Source로 정답 근거 검색: `17/23 (73.9%)`
- Source packet 없음: `6/23 (26.1%)`
- 최종 기대 결론 도달: `23/23`
- 기대 결론 오답 및 비밀값 생성: `0건`

### 결과를 해석하는 방법

최종 답변 성공률 100%만 성과로 주장하면 안 된다. 6개 질문은 현재 호출의 RAG Source가 아니라 Agent의 이전 문맥으로 보정됐기 때문이다.

정확한 표현:

> 최종 답변은 23개 모두 기대 결론에 도달했지만, 현재 요청의 RAG 결과만으로 재현 가능한 답변은 17개였습니다. 이를 통해 최종 답변 품질과 Retrieval 품질을 분리해서 평가해야 한다는 점을 확인했습니다.

### 검색 실패 6개의 주요 원인

- 질문 표현과 문서 표현의 차이
- 짧은 질문에 검색 단서 부족
- 핵심 내용이 여러 Chunk에 분산
- “정책이 미확정”이라는 부정 답변을 검색기가 정답으로 이해하지 못함
- Vector Only가 문서 유형의 중요도를 반영하지 못함
- Answerability가 정답 Source를 과도하게 거절

### 다음 개선 우선순위

1. 질문 동의어와 표준 용어 정규화
2. ADR, UX 정책, QA 문서 등 Source Type 우선순위 반영
3. “미확정”, “문서에 없음” 자체가 답인 Negative Answer 검색 개선
4. Hybrid Search로 정확한 키워드와 의미 검색 결합
5. Reranker로 Top K 후보 재정렬
6. 현재 RAG Source와 Agent Memory의 엄격한 분리

---

## 9. 구현 중 해결한 주요 문제

### 문제 1. Embedding Column과 DB Migration 불일치

증상:

- 코드에는 `embeddingModel`이 있지만 실제 DB에는 Column이 없어 Raw Query 실패

배운 점:

- Prisma Schema 수정만으로 실제 DB가 바뀌지 않는다.
- Migration을 생성하고 적용해야 한다.
- Raw SQL이 참조하는 Column은 Schema와 실제 DB 양쪽에서 확인해야 한다.

### 문제 2. 다른 Embedding 모델 또는 차원이 섞일 위험

증상:

- 기존 Vector와 새 질문 Vector의 의미 공간 또는 차원이 다르면 검색 결과가 무의미하거나 Query가 실패할 수 있음

대응:

- 모델을 `text-embedding-3-small`로 고정
- 차원을 1536으로 고정
- `embeddingModel`과 `vector_dims`를 저장·검색 조건에 포함

### 문제 3. 실행 경로에 따라 `.env`를 찾지 못함

증상:

- Codex를 다른 디렉터리에서 실행하면 Default Workspace를 찾지 못하고 빈 Source 반환

대응:

- 현재 작업 디렉터리가 아니라 MCP Entry Point 기준으로 프로젝트 Root `.env` 경로를 계산
- 명시적인 요청값은 환경 변수보다 우선

배운 점:

- CLI와 MCP Server의 환경은 현재 Shell 위치에 암묵적으로 의존하면 안 된다.

### 문제 4. Workspace 불일치

증상:

- 문서는 특정 Workspace에 저장됐지만 질문은 다른 기본 Workspace를 검색해 Source가 비어 있음

대응:

- 모든 Vector Search를 `workspaceId`로 제한
- 환경 변수 기반 Default Workspace 도입
- 요청에 Workspace ID를 직접 넣을 수 있는 계약 유지

### 문제 5. 관련 문서가 있어도 Answerability가 거절

증상:

- Top Score가 0.48~0.56 수준인 정상 질문이 기존 0.65 기준을 넘지 못함

대응:

- 실제 질문 Score 분포를 확인
- 현재 PoC 기준을 `0.45/0.40`으로 조정
- ADR에 재조정 조건과 위험 기록

배운 점:

- Similarity Score는 정답 확률이 아니다.
- Threshold는 다른 프로젝트의 값을 복사하지 않고 Corpus와 질문으로 Calibration해야 한다.

### 문제 6. 최종 답변 성공과 RAG 성공의 혼동

증상:

- RAG Source가 비어도 Agent가 이전 대화 문맥으로 정답을 생성

대응:

- 최종 답변 성공률과 RAG Hit@K를 분리
- Source packet이 없는 답변은 RAG 성공으로 집계하지 않음

배운 점:

- Agent 전체 성능과 Retrieval Component 성능은 별도 지표가 필요하다.
- 사용자별 Memory가 다르면 같은 질문의 결과도 달라질 수 있다.

---

## 10. 자주 받을 수 있는 면접 질문과 답변 방향

### Q1. 왜 LangChain이나 LangGraph를 사용하지 않았나요?

핵심 RAG 흐름을 직접 이해하고 검증하는 것이 목표였기 때문이다. 수집, Chunking, Embedding, 검색, Citation, Persistence의 경계를 직접 구현해 실패 지점을 명확히 추적할 수 있었다. Workflow가 복잡해지고 Tool Orchestration이 필요해지면 도입을 검토할 수 있다.

### Q2. 왜 Vector DB 전용 제품이 아니라 pgvector인가요?

PoC 규모에서는 Document와 Question 같은 관계형 데이터와 Vector를 한 DB에서 관리하는 단순성이 더 중요했다. PostgreSQL Transaction과 Workspace 조건도 함께 사용할 수 있다. 데이터 규모와 검색 부하가 커지면 HNSW Index 튜닝이나 전용 Vector DB를 비교해야 한다.

### Q3. Chunk 크기 600과 Overlap 80은 어떻게 정했나요?

문맥 보존과 검색 정밀도의 균형을 위한 Baseline이다. 400/50, 600/80, 800/100 후보를 비교했지만 초기 작은 데이터에서는 차이가 충분히 드러나지 않았다. 따라서 보편적인 최적값이라고 주장하지 않고, 더 다양한 길이의 문서와 질문으로 다시 측정해야 한다.

### Q4. 왜 Embedding 차원을 1536으로 고정했나요?

`text-embedding-3-small` 기본 차원과 pgvector Schema를 맞춰 문서와 질문이 같은 Vector 공간을 사용하도록 보장하기 위해서다. 모델과 차원을 자유롭게 바꾸는 것보다 PoC의 재현성과 Migration 단순성을 우선했다.

### Q5. Threshold 0.45는 일반적으로 좋은 값인가요?

아니다. Similarity 분포는 모델, Corpus, Chunking, 질문 종류에 따라 달라진다. 0.45는 Keeply PoC에서 정상 질문이 과도하게 거절되는 문제를 줄이기 위해 실제 Score를 보고 정한 시작값이다. False Positive와 False Negative를 함께 측정해 계속 조정해야 한다.

### Q6. Top K를 크게 하면 검색이 무조건 좋아지나요?

정답을 포함할 가능성은 높아지지만 무관 문서와 중복 Chunk도 늘어난다. LLM Context가 오염되고 처리 비용도 증가한다. Recall과 Precision을 함께 보고 정해야 한다.

### Q7. RAG가 환각을 완전히 막을 수 있나요?

막을 수 없다. 검색이 틀리거나 Agent가 Source 밖의 내용을 사용하면 환각이 생길 수 있다. 그래서 Citation을 DB Source에서 만들고, Answerability가 낮으면 Source를 비우며, Source 기반 답변 규칙을 적용했다.

### Q8. 왜 최종 답변 API를 townbase 내부에 넣지 않았나요?

Codex 같은 MCP Client가 이미 LLM을 사용하므로 내부에서 다시 Chat API를 호출하면 비용과 책임이 중복된다. townbase는 검색과 근거 제공에 집중하고 Client Agent가 최종 답변을 생성하도록 분리했다.

### Q9. MCP를 사용한 장점은 무엇인가요?

별도 Chat UI 없이 여러 MCP Client가 동일한 RAG 기능을 Tool로 사용할 수 있다. 질문 입력과 Source 응답 계약도 명확해진다. 반면 Client별 답변 행동이 달라질 수 있어 Grounding 검증이 필요하다.

### Q10. Vector Only의 한계는 무엇인가요?

의미가 비슷한 표현에는 강하지만 정확한 용어, 부정 답변, 문서 유형의 중요도를 놓칠 수 있다. 현재 실패 질문에서도 UX 정책이나 QA 문서를 우선해야 하는 상황이 있었다. Hybrid Search, Metadata Ranking, Reranker가 다음 개선 후보다.

### Q11. BM25와 Vector Search의 차이는 무엇인가요?

BM25는 질문과 문서에 같은 단어가 얼마나 중요하게 등장하는지 보는 키워드 검색이다. Vector Search는 표현이 달라도 의미가 비슷한 문서를 찾는다. 정확한 정책명과 의미 검색을 함께 처리하려면 두 결과를 결합하는 Hybrid Search가 유리할 수 있다.

### Q12. Reranker는 왜 필요한가요?

초기 Retriever는 빠르게 후보를 찾는 데 집중한다. Reranker는 질문과 각 후보의 관계를 더 정밀하게 비교해 순서를 다시 정한다. 검색 정확도는 높일 수 있지만 Latency와 비용이 증가한다.

### Q13. 문서가 변경되면 어떻게 처리하나요?

Content Hash를 비교한다. 같으면 재처리를 건너뛰고, 다르면 Document를 갱신하고 기존 Chunk를 교체한 뒤 다시 Embedding한다. 사라진 문서는 `archived` 상태로 관리한다.

### Q14. 여러 사용자가 쓰면 현재 구조로 충분한가요?

아니다. 현재 Workspace는 데이터 검색 경계지만 인증과 권한 모델이 완성된 멀티테넌시 구조는 아니다. 실무에서는 인증 Context에서 Tenant를 결정하고, DB Row Level Security나 권한 필터를 적용해야 한다.

### Q15. 현재 가장 큰 기술적 한계는 무엇인가요?

21개 문서와 23개 질문으로 평가 범위가 작고, Vector Only 검색이 문서 유형과 정확한 키워드를 충분히 반영하지 못한다. 또한 Agent Memory가 일부 실패를 가릴 수 있다. 더 큰 Golden Dataset과 독립된 평가 Runner가 필요하다.

### Q16. 현재 결과를 성공이라고 볼 수 있나요?

End-to-End RAG와 MCP 연동을 구현하고 73.9%의 RAG Baseline을 측정했다는 점에서는 PoC 목표를 달성했다. 하지만 100% 최종 답변 성공을 RAG 성능으로 주장할 수는 없다. 6개는 Agent Memory 보정이므로 Retrieval 개선이 남아 있다.

### Q17. 운영 환경으로 확장한다면 무엇부터 추가하나요?

먼저 평가 Dataset을 늘리고 Retrieval 실패 원인을 정량화한다. 그다음 Hybrid Search, Metadata Ranking, Reranking을 비교한다. 운영 측면에서는 인증·권한, 관측성, 비동기 Sync, 실패 재처리, Secret 관리가 필요하다.

---

## 11. 면접에서 피해야 할 과장

다음 표현은 피한다.

- “RAG 정확도 100%를 달성했다.”
- “Threshold 0.45가 RAG 표준값이다.”
- “600/80이 가장 좋은 Chunk 설정이다.”
- “MCP를 사용하면 환각이 사라진다.”
- “멀티테넌시를 지원한다.”
- “전체 코드베이스를 이해한다.”
- “Agent가 자동으로 GitHub Issue와 Notion 문서를 게시한다.”

대신 다음처럼 말한다.

- “현재 RAG Hit@K Baseline은 73.9%이며 검색 실패 6건의 원인을 분석했다.”
- “현재 Threshold는 Keeply PoC Corpus에 맞춘 임시 Calibration 값이다.”
- “Chunk 설정은 Baseline이며 더 다양한 문서에서 재평가가 필요하다.”
- “MCP로 Retrieval과 답변 생성 책임을 분리했고 Grounding 검증이 필요하다.”
- “현재는 단일 사용자 local-first PoC이고 Workspace 기반 데이터 격리까지만 구현했다.”

---

## 12. 면접 직전 체크리스트

- [ ] RAG의 Retrieval과 Generation 역할을 구분해서 설명할 수 있다.
- [ ] Chunking과 Overlap이 필요한 이유를 예시로 설명할 수 있다.
- [ ] Embedding이 답변 생성 모델이 아니라는 점을 설명할 수 있다.
- [ ] Vector Dimension이 맞아야 하는 이유를 설명할 수 있다.
- [ ] Cosine Similarity와 Top K를 설명할 수 있다.
- [ ] pgvector를 선택한 이유와 단점을 설명할 수 있다.
- [ ] MCP Server와 MCP Client Agent의 역할을 설명할 수 있다.
- [ ] townbase가 Chat API를 호출하지 않는 이유를 설명할 수 있다.
- [ ] Content Hash 기반 증분 Sync를 설명할 수 있다.
- [ ] Answerability와 Threshold Trade-off를 설명할 수 있다.
- [ ] False Positive와 False Negative를 구분할 수 있다.
- [ ] Hit@K와 MRR의 차이를 설명할 수 있다.
- [ ] 최종 답변 성공률과 RAG 검색 성공률을 구분할 수 있다.
- [ ] 공식 평가의 21개 문서, 23개 질문, 17개 RAG 성공을 기억한다.
- [ ] 검색 실패 6개의 주요 원인과 개선 방향을 설명할 수 있다.
- [ ] 현재 프로젝트의 비범위와 운영 확장 과제를 설명할 수 있다.

---

## 13. 핵심 숫자 요약

| 항목 | 현재 값 |
| --- | --- |
| Chunk 크기 | 600 Token |
| Overlap | 80 Token |
| Embedding 모델 | `text-embedding-3-small` |
| Vector 차원 | 1536 |
| 기본 Top K | 5 |
| 최대 Top K | 50 |
| Answerability Top-1 기준 | 0.45 |
| Answerability 상위 3개 평균 기준 | 0.40 |
| 공식 평가 문서 | Keeply 21개 |
| 공식 평가 질문 | 23개 |
| RAG Source 성공 | 17/23, 73.9% |
| RAG Source 실패 | 6/23, 26.1% |
| 최종 기대 결론 도달 | 23/23 |
| 기대 결론 오답 및 비밀값 생성 | 0건 |

---

## 14. 마지막 한 문장

> townbase를 통해 문서 수집부터 Chunking, Embedding, pgvector 검색, Source Grounding, MCP 연동, Answerability 평가까지 기본 RAG Pipeline을 직접 구현했고, 실제 평가에서 검색 성공률과 최종 답변 성공률이 다르다는 점을 발견해 실패 원인과 다음 개선 방향까지 정리했습니다.
