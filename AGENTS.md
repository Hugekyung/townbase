# Workspace Knowledge Agent 저장소 가이드

## 적용 범위

이 파일은 더 깊은 경로에 별도의 `AGENTS.md`가 추가되기 전까지, `workspace-knowledge-agent` 전체 트리에 적용된다.

## 기준 문서

- v0.2 신규 개발은 `PRD_v0_2_self_hosted_agent.md`와 `TASK_v0_2_self_hosted_agent.md`를 1차 기준으로 본다. 구체적인 선택·수치·승인 상태는 `DECISIONS_v0_2_basic.md`를 확인한다.
- `PRD_v0_1_retrieval_modes.md`와 `TASK_v0.1_updated.md`는 기존 구현·retrieval mode·평가의 회귀 기준으로 유지한다. 신규 출시 범위는 현재 기본 v0.2 PRD를 우선한다.
- `PRD_v0_2_full_scope_reference.md`와 `TASK_v0_2_full_scope_reference.md`는 과거 범위 보관용이다. `PRD_v0_2_scope_review.md`의 추가 기능도 구현 여부가 미정인 후보이며 실행 요구로 취급하지 않는다.
- 문서에 근거하지 않은 제품 동작은 임의로 추가하지 않는다.

## 제품 범위

- local-first 및 self-hosted 방향을 유지한다. 한 설치를 한 조직 또는 개인이 관리한다.
- 오픈소스 도구라는 성격을 유지한다.
- v0.2 기본은 단일 관리자 인증·파일 등록/색인/삭제·수동 실행/이력·기본 Agent 한 개·독립 출처 답변/거절/Gap·일회성 첨부·웹·기본 보안/운영/복구다. 세부 범위는 B01~B14를 따른다.
- 회원가입·메일 인증·예약 동기화·새 문서 서비스·Slack·다중 Agent·그룹/문서별 권한은 기본 기능의 선행 조건이나 완료 조건이 아니다.
- 기존 Notion·로컬 Git·MCP·draft 계약은 보존한다. 기본 운영 배포의 노출 여부는 선택 기록의 승인값을 따른다. 노출 경로는 인증·접근·전송·삭제/보관 보호가 필요하며 보호하지 못하면 비활성화한다.
- SaaS·멀티테넌시·전체 코드 색인·무제한 자율 실행·임의 플러그인 실행은 비범위다. Redis/BullMQ·별도 worker·외부 클라우드 배포를 기본 구현에 자동 추가하지 않는다.

## Retrieval Mode 규칙

- 기존 mode 계약을 유지한다: `auto`, `onboarding`, `product_history`, `documentation_gap`. 별도 새 모드나 고도화를 기본 기능에 임의 추가하지 않는다.
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

## 일회성 첨부와 접근 보호

- 관리자 문서 등록과 채팅 첨부는 별도 경로다. 첨부 원문·추출문·요약·초안·답변·파생 질의·후속 대화를 공용 RAG·임베딩·벡터·Gap·draft·평가 데이터로 자동 전파하지 않는다. 외부 file-search/vector-store도 자동 생성하지 않는다.
- 생성한 첨부 요약·초안·답변은 소유자 전용 대화/작업 결과로 실제 저장·재조회한다. 공용 ActionDraft 저장과 구분하고 보관·삭제 승인값을 적용한다.
- 임시 파일·추출 데이터는 지속 자료와 분리하고 만료·물리 삭제·백업 제외를 검증한다. RAG와 함께 쓰면 사용자가 별도로 입력한 검색 질문만 임베딩에 전달한다.
- 서버는 요청자·설치·자료/작업 범위를 검사한다. `workspaceId`는 인증 수단이 아니며 단일 관리자라도 접근 검사를 생략하지 않는다.
- 외부 전송은 임베딩·답변·첨부·노출된 MCP/draft를 포함해 호출 전에 검사한다. self-hosted를 외부 미전송으로 설명하지 않는다.

## 개발 제한

- retrieval pipeline을 이해 가능하게 유지하는 작은 단위의 변경을 우선한다.
- PRD/TASK에 없는 인프라는 추가하지 않는다.
- 출처 기반 원칙을 약화시켜 답변이 더 그럴듯해 보이게 만들지 않는다.
- 근거 부족을 숨기는 조용한 대체 동작을 추가하지 않는다.
- 향후 코드도 로컬 Docker 우선 실행과 충돌하지 않게 유지한다.
- 현재 필요한 책임·입력/결과·접근/전송·소유/보관 경계만 나눈다. 미래 기능용 테이블·범용 플러그인·분산 큐를 선개발하지 않는다. 실제 요구에 따라 작은 리팩터링과 migration으로 확장한다.
- 도입자 Key로 검증된 지원 답변 모델을 선택하게 한다. 임베딩은 `text-embedding-3-small`·1536차원 고정이며 관리자 화면/API에서 변경하지 못한다. Key 교체와 모델 변경을 구분한다. 임베딩 모델 변경은 제품 업그레이드·재색인·품질/복구 시험으로만 다룬다.
- 운영에서 hash/fake embedding·다른 모델·인증 생략으로 조용히 대체하지 않는다. 모델 장애·전송 불허·문서 부족을 구분한다.

## 실제 실행 명령과 적용 상태

- 현재 루트 script는 `pnpm build`(공유 패키지→API→웹), `pnpm lint`(API), `pnpm test`(API), `pnpm connectors:build`, `pnpm connectors:test`, `pnpm db:generate`, `pnpm db:validate`, `pnpm db:test`, `pnpm db:deploy`, `pnpm deploy:prepare`, `pnpm test:deployment`다. 패키지별 build/test는 해당 package.json을 확인한다.
- 배포 권한 DB 통합 시험은 `deployment/test/runtime-role.integration.mjs`다. 일반 `pnpm test:deployment`에는 포함하지 않으며 `postgres` 호스트의 `townbase_pr34_*_test` 격리 DB에서 명시 실행한다.
- DB 변경·테스트는 대상 환경을 먼저 확인한다. `db:deploy`는 읽기 검사가 아니라 migration 실행이다. 운영 DB에 무단 적용하지 않는다.
- `pnpm test:deployment`는 실제 Vite proxy의 Host/Origin·전달 경로도 시험한다. pnpm build 이후 API/Connector/database 산출물·web 의존성·ts-node와 프로젝트 Node24 실행 환경이 필요하며, 시험 서버/캐시는 loopback 임시 포트와 /tmp에 한정한다.
- B01 설치/관리자/감사 저장 기반은 `docs/implementation/v0.2-b01-storage.md`를 따른다. custom SQL CHECK를 포함하므로 Prisma schema만으로 DB를 만드는 `db push`로 migration을 대체하지 않는다. 현재 로그인/API 보호 구현 완료와 구분한다.
- database 패키지의 DB 없는 단위 시험은 `--testPathIgnorePatterns=integration.spec.ts`로 전체 DB 통합 suite를 제외한다. 특정 옛 파일 하나만 제외하면 새 통합 시험이 남는다.
- 기본 Compose는 API/웹·내부 DB·일회성 migration을 함께 실행한다. `node deployment/prepare.mjs`로 DB 소유자/API 전용 secret을 준비하며 설치별 고유 Compose 프로젝트 이름(`-p`)과 포트 설정 파일(`--env-file .townbase/compose.env`)을 유지한다. API는 `townbase_runtime` 제한 계정을 사용한다. 기존 상태/최초 등록 권한에 B04 AuthenticationState SELECT/UPDATE·AdministratorSession SELECT/INSERT·lastSeenAt/revokedAt 열 UPDATE·Administrator passwordHash/updatedAt 열 UPDATE만 추가하며 실제 목록은 배포 안내를 따른다. 사용자 schema·테이블/열/sequence·저장 루틴·기본 권한을 함께 검사하며 우회되면 migration을 거절한다. PUBLIC의 public schema CREATE와 DB CREATE/TEMPORARY는 성공 시 제거한다. 그 외 객체/기본 ACL의 보존·차단 및 vector extension 신뢰 경계는 배포 안내를 따른다. migration/API 모두 비특권·읽기 전용 root로 실행하며 호스트 API는 loopback에만 게시한다. 웹은 상태 확인·최초 관리자 등록·로그인·로그아웃·비밀번호 변경·로컬 토큰 복구를 제공한다. B05 기본 인증·설치/자료 범위 공통 검사가 적용된다. 문서/채팅 기능은 아직 없다. 실행/비밀/volume/TLS 계약은 `docs/self-hosted-deployment.md`를 따른다.
- B03 로컬 발급은 API 컨테이너의 `node deployment/bootstrap.mjs`다. 원문은 별도 bootstrap volume의 0600 파일에만 두며 웹/API/로그로 제공하지 않는다. 실 DB 등록 시험은 `TOWNBASE_SETUP_INTEGRATION=1`과 postgres 호스트의 `townbase_b03_test`에서만 실행한다. owner URL 및 runtime secret 파일이 필요하다. 일반 API 시험에서는 이 suite를 제외한다. [B03 기록](docs/implementation/v0.2-b03-administrator.md)을 따른다.
- B04 복구 발급은 API 컨테이너의 `node deployment/recovery.mjs`다. recovery 전용 volume의0700 디렉터리·0600 파일,60분·1회용·digest 저장을 적용한다. 변경·복구는 모든 세션을 폐기하고 복구 토큰도 무효화한다. 실 DB 인증 시험은 `TOWNBASE_AUTH_INTEGRATION=1`과 postgres 호스트의 `townbase_b04_test`에서만 실행한다. owner URL/runtime secret이 필요하며 일반 API 시험은 opt-in suite를 건너뛴다. [B04 기록](docs/implementation/v0.2-b04-authentication.md)을 따른다.
- B05는 AuthModule 전역 기본 인증과 메서드별 공개 예외를 사용한다. 신원은 세션/Installation.workspaceId에서만 만들며 DTO의 ID는 인증이 아니다. 자료 범위/소유 검사는 저장된 행을 입력으로 사용한다. 실제 자료/Key/작업 기능은 해당 단계에서 조회·저장·전송 경계에 검사를 연결한다. 새 테이블·범용 권한 엔진을 미리 추가하지 않는다. 실 DB 공통 검사 시험은 TOWNBASE_ACCESS_INTEGRATION=1과 postgres 호스트의 townbase_b05_test에서만 실행하며 owner URL/runtime secret이 필요하다. [B05 기록](docs/implementation/v0.2-b05-access.md)을 따른다.
- 프로필 판정은 database 패키지의 runtime-profile을 공유한다. self_hosted/production에서 기존 MCP·수집 runner/CLI·개발 seed·구 평가 진입점을 실행 전에 거절한다. 비production legacy fixture는 유지한다. 실제 평가 명령은 build 제외된 ts-node 소스 진입점이며 오래된 dist로 검증하지 않는다. 운영 runtime과 build/migration 이미지의 개발 도구 포함 여부도 구분한다.
- 기존 v0.1 DB 개발은 `compose.legacy.yml`을 명시한다. 새 운영 배포에서 이전 DB volume이나 `.env`를 자동 재사용하지 않는다. `self_hosted`와 `legacy_development`를 구분한다. 프로필 미설정은 모든 NODE_ENV에서 self_hosted이며, 기존 개발 실행은 비production에서 TOWNBASE_RUNTIME_PROFILE=legacy_development를 명시한다. production의 legacy 프로필은 시작을 거절한다. 아직 구현하지 않은 웹/E2E/복구 script를 실행 가능한 것으로 문서화하지 않는다.
- C02/C03 기반은 /settings/model-integration의 관리자 전용 API다. Key 저장은 연결 성공이 아니며 connection=not_checked, 실제 호출/모델 선택은 비활성이다. 변경은 같은 AuthState 잠금 경계에서 현재 비밀번호를 매번 확인하고 감사와 함께 저장한다. 추가 ModelCredential/ModelTransferPolicy 권한은 deployment/runtime-role.mjs의 명시 목록을 따른다. API만 별도 model_master_key secret을 마운트하고 원래 값은 DB 백업과 분리해 보관한다. 설정 웹·실모델·비용 예약은 이 기반의 완료로 간주하지 않는다.
- C02 실제 DB 시험은 TOWNBASE_INTEGRATION_SETTINGS_TEST=1과 postgres 호스트의 townbase_c02_test에서만 실행한다. owner URL/runtime secret이 필요하며 일반 API 시험에서는 건너뛴다. 신규 권한은 townbase_pr34_*_test의 runtime-role.integration.mjs로 검증한다. [C02/C03 기록](docs/implementation/v0.2-c02-c03-integration-settings.md)을 따른다.
- v0.2 평가 명세/합성 문서·120문항은 `docs/evaluation/v0.2/README.md`를 따른다. A04 실행/미실행 결과는 같은 경로의 `baseline-2026-10-23.md`를 확인한다.
- 기본 TASK의 문서 완료와 코드/실모델/품질 검증 완료를 구분한다. 추천 S 값은 승인 전 기본값이 아니며 해당 작업 착수 전에 결정한다.
- 2026-10-22 사용자는 모델 외 기본 기술·수치 선택을 판단해 확정하도록 위임했다. `DECISIONS_v0_2_basic.md`의 S01·S03~S14를 적용하고 동일 항목의 승인을 반복 요청하지 않는다. 파서 버전·TLS 구성 등 범위 내 구현 세부는 공식 지원·현재 코드와 맞춰 기록한다. S02 답변 모델 전환·제품 범위 확대·보호 약화·외부 공개·커밋/푸시 승인은 이 위임과 구분한다.

## 반복 리뷰 주의

- JSON, DB row, optional API payload처럼 `undefined`가 섞일 수 있는 값은 `=== null` / `!== null`만으로 분기하지 말고 nullish 기준(`== null`, `??`)으로 다룬다.
- package.json의 `main`과 `types`는 런타임/소비 경로를 기준으로 둔다. 빌드가 존재하는 패키지는 TypeScript 원본(`./index.ts`)이 아니라 컴파일 산출물(`dist/...`)을 가리키는지 먼저 확인한다.
- `switch`로 모드나 템플릿을 분기할 때는 미래 확장에 대비한 fallback을 둔다. 예약 모드는 명시적으로 fallback 처리하거나 exhaustiveness를 보장한다.

- 인증 화면은 세션과 폼 모드의 상태 전이를 함께 확인한다. 변경 중 만료는 로그인 복귀, 비로그인 복구는 모드 유지가 기준이다. 권한 시험은 허용 열과 허용 목록 외 모든 식별 열을 함께 검사한다. 운영 오류는 원문 대신 허용 코드로 진단하며 초기 등록·인증의 공통 규칙과 문서 상단 상태도 대조한다.
- 반복 리뷰에서 시험 누락이 집중된 입력 본문/Content-Type·실패/대체 분기·열 단위 권한을 함께 확인한다. 독립 차단 조건은 다른 조건을 제거한 fixture로 검증하며 실제 서버 설정과 시험 구성을 공유한다.
- 보안 설정을 바꿀 때 정상 정적 파일·HTML·API·오류 응답에 미치는 영향을 같이 확인한다. 배포/개발 proxy 시험은 실제 요청 경로·헤더·본문을 관측하고 보호를 약화시켜 통과시키지 않는다. 현재 정상 assets 빌드 파일만 캐시 재검증을 허용하며 HTML·API·오류는 no-store를 유지한다.
- 시작 실패 처리는 예외 반환뿐 아니라 열린 핸들이 있는 실제 프로세스의 종료도 확인한다. exitCode만 설정하면 종료를 보장하지 않는다.
- 실행 안내는 다른 터미널에서 복사한 개별 명령 블록에도 필요한 프로필을 명시하고, 선행 빌드·정확한 환경 변수·포트·설치/프로젝트 범위를 명시한다. 검증 기록은 소스/개발 환경·migration/build 이미지·runtime 이미지를 구분하고 실제 실행 증거보다 넓게 완료를 주장하지 않는다.

## 작업 완료 규칙

- 코드 생성 또는 코드 수정 작업은 반드시 별도 작업 브랜치에서 진행한다. 단, 단순 코드 확인이나, 문서 작업일 때에는 진행하지 않고 코드 구현이 진행될 때만 별도 브랜치를 분리 생성한다.
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
