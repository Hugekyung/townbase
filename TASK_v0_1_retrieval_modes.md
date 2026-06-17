# TASK.md — Workspace Knowledge Agent v0.1 Implementation Plan

> Version: v0.1 MVP  
> Goal: Local-first Open Source Product & Engineering Knowledge Agent  
> Scope: Notion + Local Git Repository + Metadata-based Retrieval Mode + RAG Q&A + Knowledge Gap + Draft Generator

---

## Phase 0. 프로젝트 초기화

### 목표

로컬 Docker 기반 오픈소스 프로젝트 구조를 만든다.

### Tasks

- [ ] GitHub repository 생성
- [ ] README.md 초안 작성
- [ ] LICENSE 선택 및 추가
- [ ] pnpm workspace 또는 단일 NestJS 구조 결정
- [ ] `apps/api` 생성
- [ ] `apps/web` 생성 여부 결정
- [ ] `packages/connectors` 생성
- [ ] `packages/rag-core` 생성
- [ ] `packages/agent-core` 생성
- [ ] `packages/database` 생성
- [ ] TypeScript 설정
- [ ] ESLint/Prettier 설정
- [ ] `.env.example` 작성
- [ ] `docker-compose.yml` 작성
- [ ] PostgreSQL + pgvector 컨테이너 구성
- [ ] `/repos` mount 디렉터리 구조 정의

### 완료 기준

- `docker compose up -d`로 PostgreSQL + pgvector가 실행된다.
- API 서버가 health check를 반환한다.
- README에 프로젝트 목적과 실행 개요가 설명되어 있다.

---

## Phase 1. Database Schema 설계

### 목표

metadata-based retrieval mode를 지원할 수 있는 DB schema를 만든다.

### Tasks

- [ ] Prisma 설치 및 설정
- [ ] PostgreSQL 연결
- [ ] pgvector extension 활성화
- [ ] Workspace 모델 작성
- [ ] DataSource 모델 작성
- [ ] Document 모델 작성
- [ ] DocumentChunk 모델 작성
- [ ] Question 모델 작성
- [ ] QuestionSource 모델 작성
- [ ] KnowledgeGap 모델 작성
- [ ] ActionDraft 모델 작성
- [ ] SourceType enum 정의
- [ ] KnowledgeType enum 정의
- [ ] DocumentStatus enum 정의
- [ ] RetrievalMode enum 정의
- [ ] GapPriority enum 정의
- [ ] GapStatus enum 정의
- [ ] Document에 `sourceType`, `knowledgeTypes`, `domainTags`, `status`, `repoName`, `filePath` 추가
- [ ] Document에 `contentHash`, `indexStatus` 추가
- [ ] DocumentChunk에 `sourceType`, `knowledgeTypes`, `domainTags`, `sourcePriority` 추가
- [ ] DocumentChunk에 `sectionTitle`, `headingPath`, `chunkIndex`, `contentHash` 추가
- [ ] Question에 `requestedMode`, `resolvedMode`, `isAnswerable` 추가
- [ ] QuestionSource에 `mode`, `rank`, `score` 추가
- [ ] KnowledgeGap에 `category`, `relatedMode`, `similarQuestionCount`, `suggestedMarkdownPath`, `suggestedGithubIssueTitle` 추가
- [ ] migration 생성
- [ ] seed script 작성

### 완료 기준

- migration이 정상 실행된다.
- 기본 workspace가 생성된다.
- metadata를 포함한 Document/Chunk 저장이 가능하다.

---

## Phase 2. Metadata Classification 설계

### 목표

Notion 문서와 repo 파일을 sourceType/knowledgeType/domainTag로 자동 분류하는 규칙 기반 classifier를 만든다.

### Tasks

- [ ] `SourceType` mapping rule 정의
- [ ] `KnowledgeType` mapping rule 정의
- [ ] Notion title/path/tag 기반 classifier 구현
- [ ] repo file path 기반 classifier 구현
- [ ] deprecated/archive 문서 감지 rule 작성
- [ ] domainTag 추출 규칙 작성
  - [ ] payment
  - [ ] order
  - [ ] coupon
  - [ ] settlement
  - [ ] deployment
  - [ ] auth
  - [ ] onboarding
- [ ] classifier unit test 작성
- [ ] classification 결과를 Document metadata에 저장
- [ ] classification 결과를 Chunk metadata에 전파

### 완료 기준

- `README.md`는 `repo_readme`로 분류된다.
- `adr/**/*.md`는 `adr` + `architecture`로 분류된다.
- `prd/**/*.md`는 `prd` + `product_history`로 분류된다.
- `schema.prisma`는 `schema` + `database`로 분류된다.
- “온보딩”, “Getting Started”, “Setup” 문서는 onboarding으로 분류된다.

---

## Phase 3. Notion Connector 구현

### 목표

Notion root page 하위 문서를 수집하고 metadata를 포함해 Document로 변환한다.

### Tasks

- [ ] Notion integration 생성 가이드 작성
- [ ] `NOTION_API_KEY` 설정
- [ ] `NOTION_ROOT_PAGE_ID` 설정
- [ ] Notion client 구현
- [ ] root page 조회
- [ ] child page 조회
- [ ] block children pagination 처리
- [ ] paragraph/heading/bullet/numbered/code block parser 구현
- [ ] Notion page title 추출
- [ ] Notion page url 추출
- [ ] lastEditedTime 추출
- [ ] Notion page → Document mapper 구현
- [ ] metadata classifier 적용
- [ ] 변경분 sync를 위한 `externalUpdatedAt` 비교 구현
- [ ] 수집 실패 로그 처리

### 완료 기준

- root page 하위 문서가 DB에 저장된다.
- 각 문서에 sourceType/knowledgeTypes/status가 저장된다.
- 변경되지 않은 문서는 재색인되지 않는다.

---

## Phase 4. Local Repository Connector 구현

### 목표

사용자가 sync 대상으로 선택한 로컬 Git repository에서 문서성 파일을 수집한다.

### Tasks

- [ ] `REPO_ROOT_PATH=./repos` 설정
- [ ] repository directory scanner 구현
- [ ] selected repository scope 적용
- [ ] include glob rule 정의
  - [ ] `README.md`
  - [ ] `docs/**/*.md`
  - [ ] `adr/**/*.md`
  - [ ] `architecture/**/*.md`
  - [ ] `prd/**/*.md`
  - [ ] `.github/PULL_REQUEST_TEMPLATE.md`
  - [ ] `.github/ISSUE_TEMPLATE/**/*.md`
  - [ ] `schema.prisma`
  - [ ] `migrations/**/*.sql`
- [ ] exclude glob rule 정의
  - [ ] `.git/**`
  - [ ] `node_modules/**`
  - [ ] `dist/**`
  - [ ] `build/**`
  - [ ] `.env*`
  - [ ] `*.pem`
  - [ ] `*.key`
  - [ ] `secrets/**`
  - [ ] `logs/**`
- [ ] file content reader 구현
- [ ] repoName 추출
- [ ] filePath 저장
- [ ] file modified time 추출
- [ ] file → Document mapper 구현
- [ ] metadata classifier 적용
- [ ] 변경분 sync 구현

### 완료 기준

- `/repos` 하위의 선택된 repo 문서성 파일이 DB에 저장된다.
- 파일별 sourceType/knowledgeTypes/domainTags가 저장된다.
- 민감 파일과 build artifact는 제외된다.

---

## Phase 5. Ingestion Pipeline 구현

### 목표

Notion과 Local Repo connector 결과를 공통 Document pipeline으로 처리한다.

### Tasks

- [ ] DataSource 생성/조회 API 구현
- [ ] `POST /admin/sync/notion` 구현
- [ ] `POST /admin/sync/repos` 구현
  - [ ] selected repo(s)만 대상이 되도록 요청 스코프 정의
- [ ] sync status 저장
- [ ] Document upsert 로직 구현
- [ ] 삭제/archived 문서 처리 정책 정의
- [ ] Document 변경 감지
- [ ] contentHash 기반 재색인 스킵 정책 정의
- [ ] Document 저장 후 chunking 실행
- [ ] index 실패 상태를 sync status에 반영
- [ ] sync 결과 summary 반환
  - [ ] created
  - [ ] updated
  - [ ] skipped
  - [ ] failed

### 완료 기준

- Notion과 selected local repo sync를 각각 실행할 수 있다.
- sync 결과를 API로 확인할 수 있다.
- 중복 문서가 생성되지 않는다.

---

## Phase 6. Chunking 구현

### 목표

문서를 검색 가능한 chunk 단위로 분할하고 metadata를 chunk에 전파한다.

### Tasks

- [ ] Chunker interface 정의
- [ ] Markdown-aware chunker 구현
- [ ] plain text chunker 구현
- [ ] heading 기준 분할 구현
- [ ] token 기준 fallback 분할 구현
- [ ] chunk size 기본값 500~800 tokens 설정
- [ ] overlap 50~100 tokens 설정
- [ ] Document metadata를 Chunk metadata로 전파
- [ ] sectionTitle / headingPath / chunkIndex / contentHash를 chunk에 저장
- [ ] chunkType 설정
- [ ] sourcePriority 계산
- [ ] 기존 chunk inactive 처리 또는 삭제 후 재생성 정책 정의
- [ ] token count 계산

### 완료 기준

- Document가 여러 chunk로 분할된다.
- chunk에 sourceType/knowledgeTypes/domainTags/sourcePriority가 저장된다.

---

## Phase 7. Embedding & Vector Search 구현

### 목표

chunk embedding을 생성하고 pgvector 기반 similarity search를 구현한다.

### Tasks

- [ ] Embedder interface 정의
- [ ] OpenAI embedder 구현
- [ ] embedding model config 추가
- [ ] DocumentChunk embedding column 생성
- [ ] embedding 생성 service 구현
- [ ] chunk embedding 저장
- [ ] embedding 실패 시 indexStatus를 failed로 저장
- [ ] question embedding 생성
- [ ] pgvector cosine similarity search 구현
- [ ] topK 검색 구현
- [ ] score threshold config 추가
- [ ] workspaceId filter 적용

### 완료 기준

- chunk embedding이 DB에 저장된다.
- 질문 embedding으로 관련 chunk topK를 검색할 수 있다.

---

## Phase 8. Retrieval Mode / Strategy 구현

### 목표

질문 목적에 따라 다른 source/knowledgeType을 우선 검색하는 retrieval strategy를 구현한다.

### Tasks

- [ ] RetrievalMode enum 정의
  - [ ] auto
  - [ ] onboarding
  - [ ] product_history
  - [ ] documentation_gap
  - [ ] change_impact optional
- [ ] RetrievalStrategy interface 정의
- [ ] AutoModeClassifier 구현
- [ ] OnboardingRetrievalStrategy 구현
- [ ] ProductHistoryRetrievalStrategy 구현
- [ ] DocumentationGapStrategy 구현
- [ ] strategy별 sourceType filter 정의
- [ ] strategy별 knowledgeType filter 정의
- [ ] strategy별 topK 설정
- [ ] strategy별 prompt template key 정의
- [ ] deprecated 문서 제외 옵션 구현
- [ ] official/sourcePriority weighting 구현 v0.1 단순 가중치
- [ ] `requestedMode`와 `resolvedMode` 결정 로직 구현
- [ ] QuestionSource에 mode/rank/score 저장

### Strategy 기본값

#### Onboarding

- sourceTypes: `notion_page`, `repo_readme`, `repo_docs`, `adr`, `schema`
- knowledgeTypes: `onboarding`, `domain_policy`, `architecture`, `deployment`, `operation`, `code_convention`
- exclude deprecated: true
- topK: 8

#### Product History

- sourceTypes: `prd`, `adr`, `notion_page`, `incident_review`, `repo_docs`
- knowledgeTypes: `product_history`, `architecture`, `domain_policy`, `incident`
- exclude deprecated: false
- topK: 10

#### Documentation Gap

- primary: `questions`, `knowledge_gaps`
- secondary: low confidence questions
- topK: SQL aggregation + optional vector search

### 완료 기준

- mode를 지정해 질문하면 다른 filter와 prompt가 적용된다.
- auto mode가 질문을 onboarding/product_history/documentation_gap 중 하나로 분류한다.
- Question에 requestedMode/resolvedMode가 저장된다.

---

## Phase 9. Prompt Template 구현

### 목표

mode별 답변 형식을 분리한다.

### Tasks

- [ ] 공통 system prompt 작성
- [ ] source-grounded answer rule 작성
- [ ] onboarding prompt 작성
- [ ] product_history prompt 작성
- [ ] documentation_gap prompt 작성
- [ ] fallback prompt 작성
- [ ] LLM response schema 정의
  - [ ] answer
  - [ ] isAnswerable
  - [ ] confidence
  - [ ] knowledgeGap
  - [ ] suggestedFollowups
- [ ] context builder 구현
- [ ] citation builder 구현

### 완료 기준

- onboarding 질문은 학습 순서/먼저 볼 문서 중심으로 답변한다.
- product_history 질문은 변경 배경/의사결정 기록 중심으로 답변한다.
- documentation_gap 질문은 반복 질문/Gap 목록 중심으로 답변한다.
- 모든 답변은 출처를 포함한다.

---

## Phase 10. Chat API 구현

### 목표

사용자 질문을 받아 mode 기반 RAG 답변을 생성한다.

### Tasks

- [ ] `POST /chat` API 구현
- [ ] request schema 작성
  - [ ] workspaceId
  - [ ] question
  - [ ] mode
- [ ] requestedMode validation
- [ ] auto mode classifier 호출
- [ ] retrieval strategy 선택
- [ ] question embedding 생성
- [ ] retrieval 실행
- [ ] context 구성
- [ ] LLM API 호출
- [ ] response parsing
- [ ] confidence 계산
- [ ] model / latencyMs / token usage 저장
- [ ] Question 저장
- [ ] QuestionSource 저장
- [ ] source list 반환
- [ ] Knowledge Gap 생성 조건 연결

### 완료 기준

- 사용자가 질문하면 mode 기반 답변이 반환된다.
- response에 requestedMode/resolvedMode/sources/confidence가 포함된다.

---

## Phase 11. Knowledge Gap 구현

### 목표

답변하지 못한 질문을 Product & Engineering Knowledge Gap으로 저장한다.

### Tasks

- [ ] gap 생성 조건 정의
  - [ ] retrieval score threshold 미달
  - [ ] LLM isAnswerable=false
  - [ ] context는 있으나 핵심 정보 부족
- [ ] gap category 추론 구현
- [ ] gap title 생성 구현
- [ ] suggestedDocumentTitle 생성 구현
- [ ] suggestedMarkdownPath 생성 구현
- [ ] suggestedGithubIssueTitle 생성 구현
- [ ] priority 계산 rule 구현
- [ ] relatedMode 저장
- [ ] similarQuestionCount 초기 구조 설계
- [ ] 반복 bad feedback을 KnowledgeGap 후보로 연결
- [ ] `GET /knowledge-gaps` API 구현
- [ ] mode/category/status filter 구현
- [ ] `PATCH /knowledge-gaps/:id/status` 구현

### 완료 기준

- 답변 근거가 부족하면 Knowledge Gap이 생성된다.
- Gap에 category, relatedMode, priority, suggested title/path가 저장된다.
- Gap 목록을 mode/category별로 필터링할 수 있다.

---

## Phase 12. Draft Generator 구현

### 목표

Knowledge Gap을 GitHub Issue 또는 Markdown 문서 초안으로 전환한다.

### Tasks

- [ ] ActionDraft 모델 연동
- [ ] `POST /knowledge-gaps/:id/draft` API 구현
- [ ] draft type 선택
  - [ ] github_issue
  - [ ] markdown_doc
  - [ ] notion_page_text
- [ ] GitHub Issue prompt 작성
- [ ] Markdown document prompt 작성
- [ ] Notion page text prompt 작성
- [ ] Acceptance Criteria 생성
- [ ] Required Content 생성
- [ ] 관련 source 포함
- [ ] draft 저장
- [ ] draft 조회 API 구현
- [ ] copy-friendly format 반환

### 완료 기준

- Gap을 기반으로 GitHub Issue 초안이 생성된다.
- Gap을 기반으로 Markdown 문서 초안이 생성된다.
- 실제 외부 서비스 생성 없이 복사 가능한 텍스트로 제공된다.

---

## Phase 13. Admin/Web UI 구현

### 목표

로컬에서 실제 제품처럼 사용할 수 있는 최소 UI를 만든다.

### Tasks

- [ ] Next.js app 생성 또는 NestJS static UI 결정
- [ ] Dashboard 화면 구현
- [ ] Sync 화면 구현
- [ ] Ask 화면 구현
- [ ] mode 선택 UI 구현
  - [ ] Auto
  - [ ] Onboarding
  - [ ] Product History
  - [ ] Documentation Gap
- [ ] 답변 표시
- [ ] 출처 표시
- [ ] requestedMode/resolvedMode 표시
- [ ] Documents 목록 구현
- [ ] sourceType filter 구현
- [ ] knowledgeType filter 구현
- [ ] Questions 목록 구현
- [ ] Knowledge Gap 목록 구현
- [ ] mode/category/status filter 구현
- [ ] Draft 생성 버튼 구현
- [ ] Drafts 화면 구현
- [ ] Copy 버튼 구현

### 완료 기준

- 브라우저에서 질문하고 mode별 답변을 확인할 수 있다.
- 문서/질문/Gap/Draft를 확인할 수 있다.

---

## Phase 14. Local-first 실행 경험 정리

### 목표

오픈소스 사용자가 README만 보고 실행할 수 있게 한다.

### Tasks

- [ ] README 설치 가이드 작성
- [ ] Docker Compose 실행 가이드 작성
- [ ] Notion Integration 설정 가이드 작성
- [ ] Local repo 연결 가이드 작성
- [ ] `.env.example` 보강
- [ ] sample repo structure 작성
- [ ] sample Notion page structure 작성
- [ ] sample questions 작성
  - [ ] onboarding 질문
  - [ ] product_history 질문
  - [ ] documentation_gap 질문
- [ ] troubleshooting 문서 작성
- [ ] 보안 주의사항 작성
- [ ] exclude rule 설명 작성

### 완료 기준

- 새로운 사용자가 README만 보고 로컬 실행할 수 있다.
- 자기 Notion/repo를 연결해 질문 테스트가 가능하다.

---

## Phase 15. QA & Dogfooding

### 목표

개인 Notion/Git repo에 직접 적용해 end-to-end 품질을 확인한다.

### Tasks

- [ ] 개인 Notion root page 연결
- [ ] `workspace-knowledge-agent` repo를 `/repos`에 연결
- [ ] sync 실행
- [ ] onboarding 질문 10개 테스트
- [ ] product_history 질문 10개 테스트
- [ ] documentation_gap 질문 5개 테스트
- [ ] 출처 정확도 평가
- [ ] mode 분류 정확도 평가
- [ ] retrieval 품질 평가
- [ ] hallucination 여부 기록
- [ ] Knowledge Gap 유용성 평가
- [ ] Draft 품질 평가
- [ ] good/bad feedback reason과 query traceability 점검
- [ ] v0.2 backlog 작성

### 완료 기준

- 온보딩/히스토리/문서화 Gap 질문이 각각 의도한 전략으로 처리된다.
- 실제로 쓸 만한 답변과 Gap이 생성된다.
- v0.2 개선 항목이 정리된다.

---

## Phase 16. v0.1 Release

### 목표

오픈소스 MVP로 공개 가능한 상태를 만든다.

### Tasks

- [ ] README 최종 정리
- [ ] PRD/TASK 문서 repo 포함
- [ ] Architecture 문서 작성
- [ ] Example screenshots 추가
- [ ] Demo question examples 추가
- [ ] Known limitations 작성
- [ ] Roadmap 작성
- [ ] License 확인
- [ ] v0.1 tag 생성

### 완료 기준

- GitHub에 공개 가능한 형태다.
- local-first open source Product & Engineering Knowledge Agent로 포지션이 명확하다.
- mode 기반 retrieval 확장 구조가 코드와 문서에 반영되어 있다.

---

## v0.1 완료 기준 요약

```text
1. 로컬 Docker 기반 실행
2. Notion 문서 수집
3. Local Git repo 문서 수집
4. metadata classification
5. chunking + embedding + pgvector search
6. retrieval mode strategy
7. source-grounded answer
8. question/source logging
9. Knowledge Gap 생성
10. GitHub Issue/Markdown draft 생성
11. 최소 UI
12. README 기반 오픈소스 실행 가능
```
