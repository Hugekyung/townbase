# Local Dogfooding README

이 문서는 이 저장소를 로컬에서 직접 테스트할 때 쓰는 실행 절차를 한 곳에 모은 가이드다.
v0.1의 기본 사용 경로는 `MCP-first`이고, 웹 UI나 HTTP chat API는 아직 범위 밖이다.

## 1. 먼저 확인할 것

### 필수 환경

- `DATABASE_URL`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DB`
- `REPO_ROOT_PATH`
- `LOCAL_REPO_NAMES`

### 선택 환경

- `NOTION_API_KEY`
- `NOTION_ROOT_PAGE_ID`
- `NOTION_SYNC_FIXTURE_PATH`
- `OPENAI_API_KEY`
- `OPENAI_CHAT_MODEL`
- `OPENAI_EMBEDDING_MODEL`
- `OPENAI_EMBEDDING_BASE_URL`

### 실무 판단

- `REPO_ROOT_PATH`와 `LOCAL_REPO_NAMES`는 selected-repo sync에 필요하다.
- `NOTION_API_KEY`와 `NOTION_ROOT_PAGE_ID`가 없으면 개인 Notion dogfooding은 할 수 없다.
- `OPENAI_API_KEY`가 없으면 embedding/chat의 full path가 아니라 fallback 또는 gap-heavy path로 동작할 수 있다.
- `REPO_ROOT_PATH`는 `pnpm` 실행 시 package cwd가 달라질 수 있으므로, 상대경로보다 절대경로가 안전하다.

## 2. 로컬 실행 순서

### 2-1. 환경 변수 준비

`.env.example`를 복사해 `.env`를 만들고, 아래 값을 채운다.

```bash
cp .env.example .env
```

### 2-2. PostgreSQL 시작

```bash
docker compose up -d
```

### 2-3. 의존성 설치

```bash
pnpm install
```

### 2-4. 데이터베이스 마이그레이션

```bash
pnpm --filter @townbase/database prisma:migrate:deploy
```

### 2-5. local repo corpus 준비

`repos/` 아래에 직접 테스트할 저장소를 둔다.
예를 들어 이 저장소를 dogfooding 하려면 다음처럼 복사해 둘 수 있다.

```bash
git clone --local . /absolute/path/to/repos/workspace-knowledge-agent
```

### 2-6. selected-repo sync 실행

`pnpm`은 package cwd에서 명령을 실행하므로, `REPO_ROOT_PATH`는 절대경로를 권장한다.

```bash
REPO_ROOT_PATH=/absolute/path/to/repos \
LOCAL_REPO_NAMES=workspace-knowledge-agent \
pnpm --filter @townbase/connectors local-repo:sync
```

### 2-7. API 서버 시작

```bash
pnpm --filter @townbase/api dev
```

### 2-8. MCP 서버 시작

다른 터미널에서 stdio MCP surface를 연다.

```bash
pnpm --filter @townbase/api mcp:stdio
```

이 서버는 다음 도구를 노출한다.

- `workspace_knowledge.question`
- `workspace_knowledge.knowledge_gap`
- `workspace_knowledge.draft`

## 3. MCP로 직접 테스트하는 방법

MCP 클라이언트는 ChatGPT, Codex, 또는 로컬 stdio client를 사용할 수 있다.
핵심은 `workspace_knowledge.question` 도구로 실제 질문을 보내는 것이다.

### 3-1. onboarding 질문

예시:

- "How do I run the workspace locally?"
- "What do I need to configure before first launch?"
- "How do I bring up the local stack?"

확인할 것:

- `requestedMode`
- `resolvedMode`
- `sources`
- `confidence`
- `isAnswerable`
- `knowledgeGapCreated`

### 3-2. product_history 질문

예시:

- "Why was the local repository connector added?"
- "Why did Phase 14 become documentation-only?"
- "Why is Phase 17 reserved for API/Web expansion?"

확인할 것:

- 과거 결정 설명이 출처 기반으로 나오는지
- 없는 근거를 답변으로 지어내지 않는지
- 근거가 부족하면 gap으로 떨어지는지

### 3-3. documentation_gap 질문

예시:

- "What documentation is still missing for the local repo sync flow?"
- "What setup step is still unclear for first-time users?"
- "What is missing from the troubleshooting section?"

확인할 것:

- gap이 실제로 생성되는지
- gap의 제목/설명이 질문과 맞는지
- draft 생성 surface로 이어지는지

## 4. 출시 전 테스트 절차

이 절차는 코드 변경이 없어도 그대로 실행할 수 있는 pre-release checklist다.

1. `.env`를 채운다.
   - `DATABASE_URL`
   - `POSTGRES_*`
   - `REPO_ROOT_PATH`
   - `LOCAL_REPO_NAMES`
   - 필요하면 `NOTION_*`
   - 필요하면 `OPENAI_*`

2. Docker PostgreSQL을 시작한다.
   - `docker compose up -d`

3. 데이터베이스 마이그레이션을 적용한다.
   - `pnpm --filter @townbase/database prisma:migrate:deploy`

4. 로컬 저장소 corpus를 준비하고 sync를 돌린다.
   - `REPO_ROOT_PATH=/absolute/path/to/repos LOCAL_REPO_NAMES=workspace-knowledge-agent pnpm --filter @townbase/connectors local-repo:sync`

5. API와 MCP surface를 띄운다.
   - `pnpm --filter @townbase/api dev`
   - `pnpm --filter @townbase/api mcp:stdio`

6. 질문을 3종류로 나눠 확인한다.
   - onboarding
   - product_history
   - documentation_gap

7. 결과를 눈으로 확인한다.
   - mode가 맞는지
   - source가 실제로 붙는지
   - gap이 생성되는지
   - draft가 필요한 경우 draft surface가 반응하는지

8. Notion dogfooding이 가능하면 같은 절차를 Notion corpus로 반복한다.
   - `NOTION_API_KEY`
   - `NOTION_ROOT_PAGE_ID`

## 5. 무엇을 pre-release 성공으로 볼지

- 로컬 repo sync가 성공한다.
- MCP `workspace_knowledge.question`가 호출된다.
- `requestedMode`와 `resolvedMode`가 기대와 맞는다.
- 실제 source-backed answer가 나오거나, 근거 부족 시 gap으로 일관되게 떨어진다.
- `knowledge_gap`와 `draft` 도구가 필요한 경우 정상 동작한다.
- 개인 Notion credentials가 있으면 Notion dogfooding도 같은 방식으로 반복된다.

## 6. 자주 막히는 지점

- `local-repo:sync`가 `Missing selected repository directory`를 내면 `REPO_ROOT_PATH`를 다시 확인한다.
- `notion:sync`가 안 되면 `NOTION_API_KEY`와 `NOTION_ROOT_PAGE_ID`를 확인한다.
- 질문이 전부 gap으로만 떨어지면 `OPENAI_API_KEY` 유무와 corpus coverage를 같이 본다.
- `./repos` 같은 상대경로는 pnpm 실행 위치 때문에 어긋날 수 있으니 절대경로를 먼저 쓴다.

## 7. 참고

- 루트 실행 가이드: [docs/local-first-execution.md](../local-first-execution.md)
- Connector 실행 가이드: [packages/connectors/README.md](../../packages/connectors/README.md)
