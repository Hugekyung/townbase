# Workspace Knowledge Agent 저장소 가이드

## 적용 범위

이 파일은 더 깊은 경로에 별도의 `AGENTS.md`가 추가되기 전까지, `workspace-knowledge-agent` 전체 트리에 적용된다.

## 기준 문서

- `PRD_v0_1_retrieval_modes.md`와 `TASK_v0.1_updated.md`를 제품 및 구현의 1차 기준으로 본다.
- 이 저장소의 다른 구버전 계획 문서와 충돌하면 updated 버전을 우선한다.
- 문서에 근거하지 않은 제품 동작은 임의로 추가하지 않는다.

## 제품 범위

- v0.1에서는 local-first 및 self-hosted 방향을 유지한다.
- 오픈소스 도구라는 성격을 유지한다.
- 범위는 Notion + 로컬 Git 저장소 수집, 메타데이터 기반 retrieval mode, 출처 기반 Q&A, Knowledge Gap 추적, draft 생성에 한정한다.
- SaaS, 멀티테넌시, Slack bot, GitHub App/OAuth 기반 issue 자동화, Redis/BullMQ, worker 분리, 외부 클라우드 배포는 문서가 명시적으로 갱신되기 전까지 비범위로 둔다.

## Retrieval Mode 규칙(P0 구현 단계에서는 제외)

- v0.1 모드는 문서에 정의된 것만 지원한다: `auto`, `onboarding`, `product_history`, `documentation_gap`.
- `change_impact`는 향후 확장 옵션으로만 둔다.
- retrieval mode는 단순 UI 라벨이 아니라 출처 선택, prompt 전략, 답변 형식에 모두 영향을 주어야 한다.
- `auto`는 우선 규칙 기반이어야 하며, 애매한 기본값처럼 동작하면 안 된다.
- 질문과 답변은 반드시 출처 기반이어야 한다. 근거가 약하면 추측 대신 `isAnswerable = false` 또는 Knowledge Gap을 우선한다.

## 수집 및 메타데이터 규칙

- 우선 수집 대상은 문서성 소스다: Notion page, README, docs, ADR, PRD, schema, migration, 유사한 구조 문서.
- 제품 문서가 범위를 명시적으로 넓히기 전까지는 전체 코드베이스 indexing으로 확장하지 않는다.
- 구현 또는 리팩터링 시 `sourceType`, `knowledgeTypes`, `domainTags`, `status`, `requestedMode`, `resolvedMode`, `sourcePriority` 같은 메타데이터를 유지하고 전파한다.
- 생성 파일, 비밀 정보, dependency, build artifact는 수집 및 색인에서 제외한다.
- 요구사항에 `create`, `save`, `store`, `persist`, `write`, `generate`가 포함되면 계산/판정 신호만으로 끝내지 말고 실제 저장 경로와 readback 검증까지 포함한다.
- `signal`, `candidate`, `shouldCreate*` 계열은 중간 산출물로만 취급하고, 완료 기준은 persisted row 또는 관측 가능한 side effect여야 한다.

## 개발 제한

- retrieval pipeline을 이해 가능하게 유지하는 작은 단위의 변경을 우선한다.
- PRD/TASK에 없는 인프라는 추가하지 않는다.
- 출처 기반 원칙을 약화시켜 답변이 더 그럴듯해 보이게 만들지 않는다.
- 근거 부족을 숨기는 조용한 대체 동작을 추가하지 않는다.
- 향후 코드도 로컬 Docker 우선 실행과 충돌하지 않게 유지한다.

## 반복 리뷰 주의

- JSON, DB row, optional API payload처럼 `undefined`가 섞일 수 있는 값은 `=== null` / `!== null`만으로 분기하지 말고 nullish 기준(`== null`, `??`)으로 다룬다.
- package.json의 `main`과 `types`는 런타임/소비 경로를 기준으로 둔다. 빌드가 존재하는 패키지는 TypeScript 원본(`./index.ts`)이 아니라 컴파일 산출물(`dist/...`)을 가리키는지 먼저 확인한다.
- `switch`로 모드나 템플릿을 분기할 때는 미래 확장에 대비한 fallback을 둔다. 예약 모드는 명시적으로 fallback 처리하거나 exhaustiveness를 보장한다.

## 작업 완료 규칙

- 코드 생성 또는 코드 수정 작업은 반드시 별도 작업 브랜치에서 진행한다.
- 작업이 끝나면 `commit -> push -> main 브랜치 대상 PR 생성`까지 완료해야 작업이 끝난 것으로 본다. 단, 커밋과 푸시, PR 생성은 임의로 진행하지 않는다. 구현이 완료되면 커밋 전 이번 작업에 대한 진행 내용을 요약 정리하여 출력한다. 이후 사용자의 승인이 있을 때에만 커밋 및 푸시를 진행한다.
- 로컬 변경만 남아 있고 브랜치 생성/커밋/푸시/PR이 끝나지 않았으면 완료로 간주하지 않는다.
- PR 대상은 기본적으로 `main` 브랜치로 둔다.

## 수동 결정 중단 규칙

- 작업 진행 중에 임의 판단이 필요한 영역, 개발자 결정이 필요한 영역, 또는 수동 작업이 필요한 영역을 만나면 즉시 중단한다.
- 중단 시에는 필요한 요구사항을 한 번에 짧고 구체적으로 요청한다.
- 추측으로 넘기거나 임의 기본값을 적용하지 않는다.

## 파일 및 저장소 규칙

- 저장소에 노출되는 문서와 코드는 계획 문서에서 쓰는 네이밍과 맞춘다.
- 새 디렉터리가 생기면, 그 하위 트리에만 특별 규칙이 필요할 때 더 깊은 `AGENTS.md`를 추가한다.
- 저장소에 실제 명령어, 패키지 구조, 런타임 제약이 생기면 이 루트 가이드를 갱신한다.
