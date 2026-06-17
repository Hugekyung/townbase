# PRD.md — Workspace Knowledge Agent v0.1

> Version: v0.1 MVP  
> Product Type: Local-first Open Source RAG Agent  
> Positioning: Engineering Onboarding + Product/Engineering History Exploration Agent  
> Target: 개인 개발자 dogfooding → 팀 개발자가 자기 팀 문서/repo에 적용 가능한 오픈소스 보일러플레이트

---

## 1. 프로젝트 개요

### 1.1 프로젝트명

**Workspace Knowledge Agent**

### 1.2 한 줄 설명

Workspace Knowledge Agent는 Notion과 Git repository에 흩어진 제품 기획, 개발 문서, 코드베이스 문서, 의사결정 기록을 연결해 신규 개발자 온보딩과 프로덕트/개발 히스토리 탐색을 돕는 local-first 오픈소스 RAG Agent다.

### 1.3 핵심 포지셔닝

이 프로젝트는 범용 사내 검색 AI나 Notion AI 대체재가 아니다. 개발팀의 문서, 코드베이스 문서, 제품/기술 의사결정 기록을 연결해 다음 문제를 해결하는 데 집중한다.

- 신규 개발자가 팀의 코드베이스, 도메인 정책, 배포/운영 방식을 빠르게 이해하기 어렵다.
- 기존 개발자도 과거 제품/기술 의사결정의 배경을 다시 찾기 어렵다.
- Notion, README, ADR, PRD, schema, migration 등에 지식이 흩어져 있다.
- “왜 이렇게 구현했는지”, “이 정책은 언제/왜 바뀌었는지”, “이 기능을 수정하려면 무엇을 봐야 하는지”를 찾는 데 시간이 든다.
- 답변하지 못한 질문이 문서화 backlog로 관리되지 않는다.

### 1.4 제품의 성격

초기 MVP는 SaaS가 아니라 **로컬 Docker 기반 self-hosted 오픈소스 도구**다. 개인 개발자는 자기 Notion과 개인 repo에 연결해 dogfooding할 수 있고, 팀 개발자는 자기 팀의 Notion engineering wiki와 Git repo를 연결해 팀 맞춤형 개발 지식 Agent를 만들 수 있다.

---

## 2. 문제 정의

### 2.1 개인 개발자 관점

- 개인 프로젝트의 PRD, 설계 메모, README, TASK 문서가 흩어져 있어 다시 찾기 어렵다.
- 시간이 지나면 기술 선택 이유, 제품 방향 전환 이유, 설계 trade-off를 잊는다.
- 개인 프로젝트를 오픈소스로 공개할 때 신규 사용자가 이해할 수 있는 문서 구조인지 검증하기 어렵다.
- AI/RAG/Agent 기반 프로젝트를 end-to-end로 직접 구현해보고 싶다.

### 2.2 소규모 개발팀 관점

- 신규 개발자가 로컬 개발 환경, 도메인 구조, DB 설계, 배포 프로세스, 장애 대응 절차를 파악하는 데 시간이 오래 걸린다.
- 시니어 개발자가 같은 질문을 반복해서 답변한다.
- 제품 기획/정책 변경 배경이 PRD, Notion, Git repo docs, ADR, Issue/PR 등에 흩어져 있다.
- 코드 자체보다 “왜 이렇게 설계했는지”에 대한 히스토리가 부족하다.
- 문서화 부족 질문이 반복되지만, 이를 GitHub Issue나 문서화 TODO로 전환하지 못한다.

### 2.3 해결하고자 하는 핵심 문제

**개발팀의 온보딩 질문과 제품/기술 히스토리 질문에 출처 기반으로 답변하고, 답변하지 못한 질문을 Product & Engineering Knowledge Gap으로 전환한다.**

---

## 3. 제품 목표와 비목표

### 3.1 v0.1 목표

v0.1은 외부 서버 없이 로컬 Docker 환경에서 동작하는 최소 Agent를 목표로 한다.

- Notion root page 하위 개발/제품 문서를 수집한다.
- Local Git repository의 README, docs, ADR, schema, migration 등 문서성 파일을 수집한다.
- 수집한 문서를 chunk로 분할하고 embedding을 생성한다.
- PostgreSQL + pgvector에 문서, chunk, embedding, metadata를 저장한다.
- 사용자의 질문에 대해 관련 chunk를 검색하고 LLM에 context로 전달한다.
- 답변에는 반드시 출처를 포함한다.
- 질문 목적에 따라 retrieval mode/strategy를 적용할 수 있도록 metadata 구조를 설계한다.
- 초기 retrieval mode로 `auto`, `onboarding`, `product_history`, `documentation_gap`을 지원한다.
- 답변 근거가 부족하면 Knowledge Gap으로 저장한다.
- Gap 기반 GitHub Issue/Markdown 문서 초안을 생성한다.
- README만 보고 로컬에서 실행 가능한 오픈소스 MVP를 만든다.

### 3.2 v0.1 비목표

다음 기능은 v0.1 범위에서 제외한다.

- SaaS 과금
- 멀티테넌트
- 팀원 초대/조직 관리
- Slack Bot
- GitHub App/OAuth 기반 Issue/PR 전체 수집
- 실제 GitHub Issue 자동 생성
- 실제 Notion 페이지 자동 생성
- 사용자별 세부 권한 동기화
- Redis/BullMQ
- 별도 Worker 서버
- 외부 클라우드 배포
- 코드 전체 indexing 기반 코드 이해 Agent
- Jira/Linear/Google Drive/PDF 연동

---

## 4. 타깃 사용자

### 4.1 1차 사용자

- 개인 프로젝트에 AI/RAG Agent를 적용해보고 싶은 개발자
- Notion과 Git repo 문서를 기반으로 자기 프로젝트를 질문 가능한 지식베이스로 만들고 싶은 개발자
- AI 기반 개발자 도구를 오픈소스로 구현해 포트폴리오화하고 싶은 개발자

### 4.2 2차 사용자

- 소규모 개발팀의 시니어 개발자/테크 리드
- 신규 개발자 온보딩을 담당하는 개발자
- 팀의 Notion engineering wiki와 Git repo docs를 연결해 팀 전용 개발 지식 Agent를 만들고 싶은 개발자
- AX/자동화 포지션에서 내부 개발자 도구를 구축하는 담당자

---

## 5. 핵심 사용 시나리오

### 5.1 Onboarding Q&A

신규 개발자가 처음 팀에 합류했을 때 묻는 질문에 답한다.

예시 질문:

- 로컬 개발 환경은 어떻게 세팅하나요?
- 신규 백엔드 개발자가 첫 주에 봐야 할 문서는 무엇인가요?
- 주문 도메인을 이해하려면 어떤 순서로 보면 되나요?
- 배포는 어떤 방식으로 진행하나요?
- PR 리뷰 규칙은 무엇인가요?

### 5.2 Product / Engineering History Q&A

기존 기능이나 정책의 변경 배경, 설계 의도를 확인한다.

예시 질문:

- 쿠폰 만료 정책은 왜 지금 구조로 바뀌었나요?
- 정산 테이블은 왜 주문 테이블과 분리되어 있나요?
- 이 기능은 어떤 PRD를 기반으로 만들어졌나요?
- 결제 실패 재처리 정책은 언제/왜 변경됐나요?
- 상품 옵션 구조가 이렇게 복잡해진 이유가 있나요?

### 5.3 Documentation Gap Review

답변하지 못한 질문을 모아 문서화 backlog로 만든다.

예시 질문:

- 이번 주에 개발 문서화가 부족했던 질문들을 정리해줘.
- 신규 백엔드 개발자 온보딩 질문 중 답변하지 못한 항목은 뭐야?
- Product History 관련 문서화 Gap을 GitHub Issue 초안으로 만들어줘.

---

## 6. Retrieval Mode / Answer Strategy

### 6.1 설계 의도

모드는 단순한 UI 라벨이 아니라, 질문 목적에 따라 DB에서 조회할 source와 prompt/answer format을 다르게 적용하기 위한 retrieval strategy다.

```text
mode = retrieval filter + source priority + prompt template + answer format
```

### 6.2 지원 모드 v0.1

| Mode | 목적 | 주요 대상 |
|---|---|---|
| `auto` | 질문 의도 자동 분류 | 기본값 |
| `onboarding` | 신규 개발자 이해/학습 순서 안내 | README, onboarding docs, architecture docs, domain policy |
| `product_history` | 제품/기술 의사결정 배경 탐색 | PRD, ADR, domain policy, incident review, design docs |
| `documentation_gap` | 문서화 부족 질문/Gap 정리 | questions, question_sources, knowledge_gaps |

v0.1에서는 `change_impact`는 구조만 열어두고 optional로 둔다. v0.2 이후 실제 코드 경로/테스트/장애 회고까지 결합해 강화한다.

### 6.3 Onboarding Strategy

우선 검색 대상:

- Notion onboarding 문서
- repo README
- docs
- architecture 문서
- domain policy
- setup/deployment 문서

답변 형식:

- 핵심 요약
- 학습 순서
- 먼저 볼 문서
- 관련 repo/path
- 추가로 확인할 질문
- 문서화 부족 항목

### 6.4 Product History Strategy

우선 검색 대상:

- PRD
- ADR
- design decision 문서
- domain policy
- incident review
- 회의/정책 변경 문서
- 향후 GitHub Issue/PR

답변 형식:

- 현재 상태 요약
- 변경/설계 배경
- 관련 의사결정 기록
- 관련 문서/파일
- 아직 불명확한 부분

### 6.5 Documentation Gap Strategy

우선 조회 대상:

- question log
- low confidence answer
- retrieval score가 낮은 질문
- knowledge gaps
- repeated similar questions

답변 형식:

- 반복 질문 Top N
- 문서화 Gap Top N
- 카테고리별 Gap 수
- 우선 작성할 문서
- GitHub Issue/Markdown 초안 후보

### 6.6 Auto Mode

`auto`는 질문의 키워드와 문맥을 기반으로 retrieval mode를 추론한다. v0.1에서는 규칙 기반 classifier로 시작하고, v0.2 이후 LLM classifier로 확장한다.

규칙 예시:

```text
"처음", "신규", "온보딩", "순서", "학습"
→ onboarding

"왜", "배경", "히스토리", "변경", "결정", "언제"
→ product_history

"부족", "문서화", "gap", "반복 질문", "답변 못한"
→ documentation_gap
```

---

## 7. Data Source

### 7.1 Notion Connector

수집 대상:

- 개발 문서
- 제품 기획 문서
- PRD
- ADR
- 도메인 정책
- 배포/장애 대응 문서
- 온보딩 문서
- 회고/의사결정 문서

v0.1에서는 Notion internal integration token을 사용한다.

### 7.2 Local Repository Connector

수집 대상:

- `README.md`
- `docs/**/*.md`
- `adr/**/*.md`
- `architecture/**/*.md`
- `prd/**/*.md`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `.github/ISSUE_TEMPLATE/**/*.md`
- `schema.prisma`
- `migrations/**/*.sql`
- 선택적으로 `src/**/entity.ts`, `src/**/module.ts` 등 구조 파악에 유용한 파일

초기에는 코드 전체 indexing을 하지 않는다. 문서성 파일과 구조 이해에 도움이 되는 파일 위주로 수집한다.
v0.1에서는 사용자가 sync 대상으로 명시한 local repository만 수집한다. `./repos`는 그 선택된 repository들의 로컬 mount root다.

### 7.3 Exclude Rules

다음 파일/디렉터리는 기본 제외한다.

```text
.git/**
node_modules/**
dist/**
build/**
.env*
*.pem
*.key
*.crt
secrets/**
credentials/**
logs/**
tmp/**
coverage/**
```

---

## 8. Metadata 설계

### 8.1 Metadata가 필요한 이유

Retrieval mode를 제대로 동작시키려면 chunk마다 문서 출처, 문서 유형, 지식 유형, 도메인 태그, 최신성, 신뢰도 정보를 저장해야 한다. 단순히 `content + embedding`만 저장하면 모든 질문이 같은 방식으로 검색되어 온보딩/히스토리/문서화 Gap 질문을 최적화하기 어렵다.

### 8.2 주요 Enum

```text
SourceType
- notion_page
- repo_readme
- repo_docs
- adr
- prd
- schema
- migration
- issue_template
- pr_template
- incident_review
- github_issue     # future
- github_pr        # future
- slack_thread     # future

KnowledgeType
- onboarding
- product_history
- architecture
- domain_policy
- database
- deployment
- incident
- code_convention
- testing
- operation
- documentation_gap
- unknown

DocumentStatus
- active
- draft
- deprecated
- archived

RetrievalMode
- auto
- onboarding
- product_history
- documentation_gap
- change_impact    # future/optional
```

### 8.3 자동 분류 규칙 v0.1

Notion 문서는 제목/path/tag 기반으로 sourceType/knowledgeType을 추론한다.

예시:

```text
"온보딩", "Getting Started", "Setup"
→ knowledgeType: onboarding

"PRD", "기획", "요구사항"
→ knowledgeType: product_history

"ADR", "Decision", "설계 결정"
→ knowledgeType: architecture

"장애", "incident", "postmortem"
→ knowledgeType: incident

"배포", "rollback", "CI/CD"
→ knowledgeType: deployment
```

Repo 파일은 경로 기반으로 분류한다.

```text
README.md
→ sourceType: repo_readme

docs/**/*.md
→ sourceType: repo_docs

adr/**/*.md
→ sourceType: adr, knowledgeType: architecture

prd/**/*.md
→ sourceType: prd, knowledgeType: product_history

prisma/schema.prisma
→ sourceType: schema, knowledgeType: database

migrations/**/*.sql
→ sourceType: migration, knowledgeType: database

.github/PULL_REQUEST_TEMPLATE.md
→ sourceType: pr_template, knowledgeType: code_convention
```

---

## 9. 데이터 모델 초안

### 9.1 Workspace

```text
Workspace
- id
- name
- createdAt
- updatedAt
```

### 9.2 DataSource

```text
DataSource
- id
- workspaceId
- type: notion | local_repo
- name
- rootPath
- rootPageId
- config
- lastSyncedAt
- createdAt
- updatedAt
```

### 9.3 Document

```text
Document
- id
- workspaceId
- dataSourceId
- externalId
- sourceType
- title
- url
- filePath
- repoName
- content
- status: active | draft | deprecated | archived
- knowledgeTypes[]
- domainTags[]
- externalCreatedAt
- externalUpdatedAt
- metadata
- createdAt
- updatedAt
```

### 9.4 DocumentChunk

```text
DocumentChunk
- id
- workspaceId
- documentId
- content
- embedding
- sourceType
- chunkType
- knowledgeTypes[]
- domainTags[]
- sourcePriority
- tokenCount
- metadata
- createdAt
- updatedAt
```

### 9.5 Question

```text
Question
- id
- workspaceId
- question
- answer
- requestedMode
- resolvedMode
- confidence
- isAnswerable
- createdAt
```

### 9.6 QuestionSource

```text
QuestionSource
- id
- questionId
- chunkId
- score
- rank
- mode
- createdAt
```

### 9.7 KnowledgeGap

```text
KnowledgeGap
- id
- workspaceId
- questionId
- category
- title
- description
- suggestedDocumentTitle
- suggestedMarkdownPath
- suggestedGithubIssueTitle
- priority: low | medium | high
- status: open | drafted | resolved | ignored
- similarQuestionCount
- relatedMode
- createdAt
- updatedAt
```

### 9.8 ActionDraft

```text
ActionDraft
- id
- workspaceId
- knowledgeGapId
- type: github_issue | markdown_doc | notion_page
- title
- body
- status: draft | copied | discarded
- createdAt
- updatedAt
```

---

## 10. API 요구사항 v0.1

### 10.1 Sync

```http
POST /admin/sync/notion
POST /admin/sync/repos
GET /admin/sync/status
```

### 10.2 Chat

```http
POST /chat
```

Request:

```json
{
  "workspaceId": "default",
  "question": "쿠폰 만료 정책은 왜 지금 구조로 바뀌었어?",
  "mode": "auto"
}
```

Response:

```json
{
  "answer": "...",
  "requestedMode": "auto",
  "resolvedMode": "product_history",
  "confidence": "medium",
  "isAnswerable": true,
  "sources": [
    {
      "title": "쿠폰 정책 변경 PRD",
      "sourceType": "prd",
      "knowledgeTypes": ["product_history", "domain_policy"],
      "url": "https://notion.so/...",
      "filePath": null,
      "score": 0.82
    }
  ],
  "knowledgeGapCreated": false
}
```

### 10.3 Questions

```http
GET /questions
GET /questions/:id
```

### 10.4 Knowledge Gaps

```http
GET /knowledge-gaps
GET /knowledge-gaps?mode=product_history
GET /knowledge-gaps?category=database
PATCH /knowledge-gaps/:id/status
POST /knowledge-gaps/:id/draft
```

### 10.5 Documents

```http
GET /documents
GET /documents?sourceType=prd
GET /documents?knowledgeType=onboarding
GET /documents/:id
```

---

## 11. MVP 기능 요구사항

### 11.1 Local-first 실행

- Docker Compose로 PostgreSQL + pgvector 실행
- API/Web은 로컬에서 실행 또는 컨테이너 실행 가능
- 외부 서버 없이 동작
- LLM API와 Notion API는 외부 API 호출

### 11.2 Source-grounded Q&A

- 답변은 검색된 context 기반으로 생성
- 출처 목록 필수 제공
- 근거 부족 시 추측 금지
- requestedMode/resolvedMode 기록

### 11.3 Retrieval Strategy

- `auto` mode는 규칙 기반으로 mode 추론
- mode별 sourceType/knowledgeType filter 적용
- mode별 prompt template 분리
- QuestionSource에 mode와 score 저장

### 11.4 Knowledge Gap

- 낮은 retrieval score 또는 LLM의 근거 부족 판단 시 Gap 생성
- Gap category와 relatedMode 저장
- similar question count를 확장 가능하게 설계
- Gap 기반 draft 생성 지원

### 11.5 Draft Generator

- GitHub Issue 초안
- Markdown 문서 초안
- Notion page 초안은 v0.1에서 텍스트 생성만 지원, 실제 생성은 제외

---

## 12. Admin / Web UI 요구사항

v0.1은 디자인보다 기능 확인에 집중한다.

### 필수 화면

- Dashboard
  - 문서 수
  - chunk 수
  - 질문 수
  - Knowledge Gap 수
  - 마지막 sync 시간

- Ask
  - 질문 입력
  - mode 선택: Auto / Onboarding / Product History / Documentation Gap
  - 답변 확인
  - 출처 확인
  - resolvedMode 확인

- Documents
  - 문서 목록
  - sourceType filter
  - knowledgeType filter

- Questions
  - 질문 로그
  - requestedMode/resolvedMode
  - confidence

- Knowledge Gaps
  - Gap 목록
  - category/mode filter
  - 상태 변경
  - draft 생성

- Drafts
  - 생성된 GitHub Issue/Markdown 초안 확인
  - Copy 버튼

---

## 13. Open Source Adoption Flow

팀에 적용하려는 개발자는 아래 흐름으로 사용한다.

```text
1. repository clone
2. docker compose up -d
3. .env에 Notion token과 root page id 설정
4. ./repos 디렉터리에 sync할 팀의 Git repository를 clone
5. sync 실행
6. Notion 문서와 repo docs 색인
7. 신규 개발자 관점 질문 테스트
8. 제품/개발 히스토리 질문 테스트
9. 답변 가능한 질문은 Q&A로 활용
10. 답변하지 못한 질문은 Knowledge Gap으로 저장
11. Gap을 GitHub Issue 또는 Markdown 문서 초안으로 변환
12. 팀 문서화 개선에 반영
```

---

## 14. 성공 지표 v0.1

### 기능 성공 기준

- 로컬 Docker 환경에서 실행 가능
- Notion root page 하위 문서 수집 가능
- local repo 문서성 파일 수집 가능
- chunk/embedding 저장 가능
- mode 기반 retrieval 가능
- 질문에 출처 기반 답변 가능
- requestedMode/resolvedMode 저장 가능
- Knowledge Gap 생성 가능
- Gap 기반 draft 생성 가능

### 품질 성공 기준

- 온보딩 질문에 README/docs/onboarding 문서를 우선 활용
- 히스토리 질문에 PRD/ADR/정책/회고 문서를 우선 활용
- 근거 없는 답변을 억지로 생성하지 않음
- 출처가 질문과 관련 있음
- Gap이 실제 문서화 작업으로 전환 가능함

### 포트폴리오 성공 기준

- README만 보고 실행 가능
- 아키텍처와 trade-off가 명확함
- local-first / open-source / RAG / metadata-based retrieval 전략을 설명 가능
- SaaS가 아닌 오픈소스 개발자 도구로서 방향성이 분명함

---

## 15. 향후 확장 계획

### v0.2

- GitHub Issue/PR metadata 수집
- LLM 기반 intent classifier
- hybrid search
- reranking
- change_impact mode 강화
- 실제 GitHub Issue 생성

### v0.3

- Slack Bot
- Slack thread 선택적 수집
- 팀 내부 서버 배포 가이드
- Basic Auth/GitHub OAuth
- 질문/Gap 주간 리포트

### v1.0

- 팀 적용 가능한 self-hosted package
- Notion/GitHub/Slack 통합
- 역할별 onboarding template
- Product History 리포트
- 문서화 Gap 운영 대시보드
