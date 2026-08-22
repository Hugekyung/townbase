# Workspace Knowledge Agent

Notion과 로컬 Git 저장소에 흩어진 제품·개발 문서를 한곳에 모아, **출처가 있는 답변**을 만드는 local-first 오픈소스 지식 Agent다. 신규 개발자 온보딩, 제품·기술 의사결정의 배경 탐색, 문서화가 부족한 지식 Gap 추적을 목표로 한다.

> 현재 프로젝트 이름과 패키지 이름은 `townbase`를 사용한다. 제품 방향은 `Workspace Knowledge Agent`로 정의되어 있다.

## 프로젝트 개요

이 프로젝트는 범용 사내 검색 AI나 Notion AI 대체재가 아니다. 개발팀이 실제로 자주 묻는 다음 질문에 집중한다.

- 로컬 개발 환경과 코드베이스를 어떤 순서로 이해해야 하는가?
- 이 제품 정책이나 기술 구조는 왜 이렇게 결정되었는가?
- 답변에 필요한 문서는 어디에 있는가?
- 아직 문서화되지 않아 답할 수 없는 질문은 무엇인가?

v0.1은 외부 SaaS가 아니라 Docker로 실행하는 self-hosted 애플리케이션이다. 사용자가 직접 연결한 Notion root page와 선택한 로컬 저장소만 수집한다.

## 만들게 된 배경

개발 지식은 보통 Notion, README, ADR, PRD, schema, migration 같은 여러 장소에 흩어진다. 시간이 지나면 신규 개발자는 어디서부터 읽어야 할지 모르고, 기존 개발자도 과거 결정의 이유를 다시 찾는 데 시간을 쓴다. 코드보다 중요한 정책과 설계 배경이 문서에 남지 않는 문제도 있다.

그래서 이 프로젝트는 단순히 문서를 검색하는 데서 멈추지 않는다. 질문의 목적에 맞는 문서를 우선 찾고, 답변마다 출처를 붙이며, 근거가 부족하면 Knowledge Gap으로 남긴다.

## 메인 아이디어: 질문 목적에 맞는 retrieval mode

핵심은 **retrieval mode를 검색 필터가 아니라 답변 전략으로 취급하는 것**이다.

```text
질문
  -> retrieval mode 결정
  -> mode별 출처 우선순위와 후보 검색
  -> 관련 chunk를 context로 구성
  -> 출처가 포함된 답변 또는 Knowledge Gap 저장
```

| 모드                | 질문 목적           | 답변의 중심                         |
| ------------------- | ------------------- | ----------------------------------- |
| `auto`              | 질문 의도 자동 판단 | 규칙 기반으로 아래 모드 선택        |
| `onboarding`        | 처음 배우기         | 핵심 개념, 학습 순서, 먼저 볼 문서  |
| `product_history`   | 결정의 배경 이해    | 현재 상태, 변경 이유, 관련 ADR/PRD  |
| `documentation_gap` | 부족한 문서 찾기    | 반복 질문, 낮은 근거, 작성 우선순위 |

`change_impact`는 향후 확장을 위한 예약 모드이며 v0.1에서 활성 기능으로 취급하지 않는다.

## 동작 방식과 구조

1. **수집**: Notion root page와 사용자가 명시한 로컬 Git 저장소에서 문서성 콘텐츠를 읽는다. README, `docs`, ADR, PRD, architecture 문서, `schema.prisma`, migration 등을 우선 대상으로 삼고 secret, dependency, build artifact는 제외한다.
2. **분류와 저장**: `sourceType`, `knowledgeTypes`, `domainTags`, `status`, `repoName`, `filePath`, `contentHash`를 붙여 PostgreSQL에 저장한다. chunk embedding은 pgvector에 저장한다.
3. **변경 감지**: `contentHash`가 같은 문서는 재처리하지 않는다. 변경 문서는 갱신하고 삭제되거나 접근할 수 없는 문서는 archived 상태로 처리한다.
4. **Chunking과 검색**: Markdown과 Notion 문서는 heading hierarchy를 보존해 section 단위로 나눈다. 구조가 약한 문서는 token 기반 fallback을 사용한다. chunk에는 원본 메타데이터와 `headingPath`, `chunkIndex`, `sourcePriority`를 전파한다.
5. **답변과 후속 작업**: mode별 context와 prompt로 MCP 답변을 만들고 원본 URL 또는 파일 경로 citation을 붙인다. 근거가 부족하면 추측하지 않고 `isAnswerable = false`로 기록하거나 Knowledge Gap과 draft를 저장한다.

### 간략한 아키텍처

```text
Notion API                 Local Git repositories
     |                              |
     +---------- connectors --------+
                    |
          classification + sync
                    |
       PostgreSQL + Prisma + pgvector
          |        |          |
       documents  chunks   questions/gaps/drafts
                    |
              rag-core
       chunking + embedding + mode
                    |
              agent-core
        context + prompt + citation
                    |
              apps/api (NestJS)
                    |
                 MCP client
```

```text
apps/api/              NestJS API와 MCP entrypoint
packages/connectors/   Notion 및 선택된 로컬 저장소 수집
packages/rag-core/     chunking, token, embedding, retrieval mode
packages/agent-core/   prompt context와 citation 구성
packages/database/     Prisma schema, migration, 영속화
docs/                  local-first 실행 및 설계 문서
```

## 기술 선택 이유

- **TypeScript + pnpm workspace**: API와 도메인 패키지의 계약을 타입으로 공유하고 작은 모듈로 분리하기 좋다.
- **NestJS**: ingestion, chat, Knowledge Gap의 경계를 module/controller/service로 분명하게 나눌 수 있다.
- **PostgreSQL + pgvector**: 관계형 상태와 벡터 검색을 한 데이터베이스에서 관리해 local-first 운영을 단순하게 만든다.
- **Prisma**: 스키마와 migration을 코드로 관리하고 영속 상태를 명확히 다룬다.
- **MCP**: 특정 웹 UI에 묶이지 않고 ChatGPT, Codex 등 MCP client에서 사용할 수 있다.
- **규칙 기반 mode 분류**: v0.1에서 동작을 설명하고 재현하기 쉽다.
- **content hash 기반 sync**: 변경 없는 문서의 chunking과 embedding 비용을 줄인다.

## 주요 사용 기술

Node.js, TypeScript, pnpm, NestJS, Jest, ESLint, PostgreSQL, pgvector, Prisma, Notion API, optional OpenAI Embeddings API, Model Context Protocol, Docker Compose

## 주요 ADR

1. **Local-first와 self-hosted를 기본으로 한다.** SaaS, 멀티테넌시, 외부 클라우드 배포는 v0.1 범위 밖이다.
2. **문서성 소스부터 수집한다.** 코드 전체를 색인하지 않고 README, docs, ADR, PRD, schema, migration을 우선한다.
3. **메타데이터를 ingestion부터 답변까지 전달한다.** 메타데이터는 mode별 출처 선택과 ranking에 사용한다.
4. **근거가 없으면 답하지 않는다.** 낮은 confidence 답변은 Knowledge Gap으로 전환한다.
5. **`auto`는 규칙 기반으로 시작한다.** 향후 LLM classifier로 확장할 수 있다.
6. **외부 변경은 draft로 멈춘다.** GitHub Issue나 Notion page를 자동 생성하지 않고 사람이 검토할 초안을 저장한다.
7. **초기 Embedding 차원은 1536으로 고정한다.** `text-embedding-3-small`의 기본 차원과 현재 pgvector schema `vector(1536)`을 맞춰 migration과 전체 재embedding 없이 PoC를 완성한다.
8. **초기 평가는 로컬 문서 5~10개와 Golden Question 10~20개로 제한한다.** 질문별 기대 Document/Chunk ID와 답변 가능 여부를 정답 기준으로 저장해 Hit@5와 MRR을 재현하고, 대규모 Corpus 품질을 주장하지 않는다.

상세 기준은 [PRD_v0_1_retrieval_modes.md](PRD_v0_1_retrieval_modes.md)와 [TASK_v0_1_retrieval_modes.md](TASK_v0_1_retrieval_modes.md)에서 확인할 수 있다.

## 로컬 실행

필수 도구는 Node.js, pnpm, Docker다.

```bash
cp .env.example .env
pnpm install
docker compose up -d
pnpm db:deploy
pnpm dev
```

선택한 저장소를 `repos/` 아래에 두고 환경 변수로 지정한다.

```bash
pnpm --filter @townbase/connectors notion:sync
pnpm --filter @townbase/connectors local-repo:sync
curl http://localhost:3000/health
```

Notion에는 `NOTION_API_KEY`, `NOTION_ROOT_PAGE_ID`, 로컬 저장소에는 `REPO_ROOT_PATH`, `LOCAL_REPO_NAMES`가 필요하다. OpenAI 관련 환경 변수는 선택적 Embedding 사용 시에만 필요하다. 최종 답변은 MCP Client Agent가 생성한다. 전체 설정과 fixture 실행은 [docs/local-first-execution.md](docs/local-first-execution.md)를 참고한다.

## 현 프로젝트의 한계 및 향후 개선사항

현재 v0.1은 의도적으로 작게 유지한다.

- 웹 UI 없이 MCP-first로 사용한다.
- GitHub Issue/PR, Slack, Jira, Linear, Google Drive, PDF connector는 없다.
- GitHub App/OAuth 기반 자동화와 실제 Issue 생성은 지원하지 않는다.
- 권한 동기화와 멀티테넌시는 없다.
- 코드 전체 indexing과 코드 변경 영향 분석은 범위 밖이다.
- 별도 worker, Redis/BullMQ, 외부 클라우드 배포를 사용하지 않는다.
- `change_impact`는 설계상 확장 지점만 있고 v0.1 전략은 없다.

향후에는 실제 팀 문서 dogfooding과 citation 품질 평가를 먼저 진행한 뒤, Knowledge Gap workflow, hybrid search/reranking, `change_impact`, 승인 기반 GitHub/Notion publish workflow를 검토한다. 웹 UI와 권한 모델, 비동기 worker는 필요성이 확인된 뒤 도입한다.

## 라이선스

이 프로젝트는 [MIT License](LICENSE)로 배포한다.
