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
- 기본 Compose는 API/웹·내부 DB·일회성 migration을 함께 실행한다. `node deployment/prepare.mjs`로 DB 소유자/API 전용 secret을 준비하며 설치별 고유 Compose 프로젝트 이름(`-p`)과 포트 설정 파일(`--env-file .townbase/compose.env`)을 유지한다. API는 `townbase_runtime` 제한 계정을 사용한다. 기존 상태/최초 등록 권한에 B04 AuthenticationState SELECT/UPDATE·AdministratorSession SELECT/INSERT·lastSeenAt/revokedAt 열 UPDATE·Administrator passwordHash/updatedAt 열 UPDATE만 추가하며 실제 목록은 배포 안내를 따른다. 사용자 schema·테이블/열/sequence·저장 루틴·기본 권한을 함께 검사하며 우회되면 migration을 거절한다. PUBLIC의 public schema CREATE와 DB CREATE/TEMPORARY는 성공 시 제거한다. 그 외 객체/기본 ACL의 보존·차단 및 vector extension 신뢰 경계는 배포 안내를 따른다. migration/API 모두 비특권·읽기 전용 root로 실행하며 호스트 API는 loopback에만 게시한다. 웹은 상태 확인·최초 관리자 등록·로그인·로그아웃·비밀번호 변경·로컬 토큰 복구를 제공한다. B05 기본 인증·설치/자료 범위 공통 검사가 적용된다. 문서 관리·실행 API는 아래 D02/D03/D04를 따르며 문서 웹/채팅 기능은 아직 없다. 실행/비밀/volume/TLS 계약은 `docs/self-hosted-deployment.md`를 따른다.
- B03 로컬 발급은 API 컨테이너의 `node deployment/bootstrap.mjs`다. 원문은 별도 bootstrap volume의 0600 파일에만 두며 웹/API/로그로 제공하지 않는다. 실 DB 등록 시험은 `TOWNBASE_SETUP_INTEGRATION=1`과 postgres 호스트의 `townbase_b03_test`에서만 실행한다. owner URL 및 runtime secret 파일이 필요하다. 일반 API 시험에서는 이 suite를 제외한다. [B03 기록](docs/implementation/v0.2-b03-administrator.md)을 따른다.
- B04 복구 발급은 API 컨테이너의 `node deployment/recovery.mjs`다. recovery 전용 volume의0700 디렉터리·0600 파일,60분·1회용·digest 저장을 적용한다. 변경·복구는 모든 세션을 폐기하고 복구 토큰도 무효화한다. 실 DB 인증 시험은 `TOWNBASE_AUTH_INTEGRATION=1`과 postgres 호스트의 `townbase_b04_test`에서만 실행한다. owner URL/runtime secret이 필요하며 일반 API 시험은 opt-in suite를 건너뛴다. [B04 기록](docs/implementation/v0.2-b04-authentication.md)을 따른다.
- B05는 AuthModule 전역 기본 인증과 메서드별 공개 예외를 사용한다. 신원은 세션/Installation.workspaceId에서만 만들며 DTO의 ID는 인증이 아니다. 자료 범위/소유 검사는 저장된 행을 입력으로 사용한다. 실제 자료/Key/작업 기능은 해당 단계에서 조회·저장·전송 경계에 검사를 연결한다. 새 테이블·범용 권한 엔진을 미리 추가하지 않는다. 실 DB 공통 검사 시험은 TOWNBASE_ACCESS_INTEGRATION=1과 postgres 호스트의 townbase_b05_test에서만 실행하며 owner URL/runtime secret이 필요하다. [B05 기록](docs/implementation/v0.2-b05-access.md)을 따른다.
- 프로필 판정은 database 패키지의 runtime-profile을 공유한다. self_hosted/production에서 기존 MCP·수집 runner/CLI·개발 seed·구 평가 진입점을 실행 전에 거절한다. 비production legacy fixture는 유지한다. 실제 평가 명령은 build 제외된 ts-node 소스 진입점이며 오래된 dist로 검증하지 않는다. 운영 runtime과 build/migration 이미지의 개발 도구 포함 여부도 구분한다.
- 기존 v0.1 DB 개발은 `compose.legacy.yml`을 명시한다. 새 운영 배포에서 이전 DB volume이나 `.env`를 자동 재사용하지 않는다. `self_hosted`와 `legacy_development`를 구분한다. 프로필 미설정은 모든 NODE_ENV에서 self_hosted이며, 기존 개발 실행은 비production에서 TOWNBASE_RUNTIME_PROFILE=legacy_development를 명시한다. production의 legacy 프로필은 시작을 거절한다. 아직 구현하지 않은 웹/E2E/복구 script를 실행 가능한 것으로 문서화하지 않는다.
- C02/C03 기반은 /settings/model-integration의 관리자 전용 API다. Key 저장은 연결 성공이 아니며 connection=not_checked, PR #38 당시 실제 호출/모델 선택은 비활성이었으며 후속 C01/C04는 아래 기록을 따른다. 변경은 같은 AuthState 잠금 경계에서 현재 비밀번호를 매번 확인하고 감사와 함께 저장한다. 추가 ModelCredential/ModelTransferPolicy 권한은 deployment/runtime-role.mjs의 명시 목록을 따른다. API만 별도 model_master_key secret을 마운트하고 원래 값은 DB 백업과 분리해 보관한다. 설정 웹·실모델·비용 예약은 이 기반의 완료로 간주하지 않는다.
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
- Key/정책 감사는 실제 저장·삭제·상태 전이와 함께 기록한다. count=0 및 이미 같은 상태인 요청을 변경 성공 감사로 남기지 않는다. 목적별 API 분기는 양쪽을 시험하고, 암호 변조 시험은 유효한 인코딩을 유지한 변조와 형식 오류를 분리한다.
- 입력 정규식은 최대 크기·긴 공백/줄바꿈의 처리 시간도 확인한다. 제한값 검사는 파일 전체 읽기 전에 수행하고 성공 사례만으로 형식/정규 인코딩 검증 완료를 표시하지 않는다.
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


## C01/C04 모델 실행 적용 상태 (2026-10-26)

- 사용자는 gpt-6-luna 기본·gpt-6.1-sol 선택을 승인했다. API는 고정 OpenAI Responses/Embeddings만 사용한다. 임베딩 small/1536은 변경하지 않는다. /settings/model-integration/execution·checks/:purpose·calls/:requestId는 관리자 보호 경로다. 설정 웹·문서/채팅/첨부 제품 흐름은 후속 단계다.
- ModelExecutionService만 후속 D/E/F 호출 서비스로 사용한다. 먼저 저장된 신원·전송·활성 Key·모델/가격·예산을 검사하고 DB에 호출 ID와 비용을 원자적으로 예약한다. 네트워크 I/O는 인증/예약 transaction 밖에서 실행한다. 기존 legacy adapter를 self_hosted에 직접 연결하지 않는다.
- 예산/가격 확인 기본 null은 유료 호출 차단이다. 가격표 버전·단가는 공식 문서를 대조해 제품 변경으로 관리한다. 임베딩/답변 합산·UTC 월·이전 월 미확인 예약 이월·nanoUSD 계산을 유지한다. 같은 요청 ID를 자동 유료 재호출하지 않는다. 전송 후 미확인 실패는 예약을 유지하며, 전송 전 deadline 만료인 not_sent만0원으로 확정한다.
- 입력은 UTF-8 bytes+256 framing의 보수적 상한으로 거절하며 정확한 tokenizer와 혼동하지 않는다. 응답의 캐시 읽기/30분·12시간 쓰기와 추론 포함 출력을 구분한다. 원문·답변·Key는 공용 비용 기록에 저장하지 않는다. D/E/F 결과 저장과 구분한다.
- 실제 DB 시험은 TOWNBASE_MODEL_EXECUTION_TEST=1과 postgres 호스트의 townbase_c01_test에서만 실행한다. owner URL/runtime secret이 필요하며 공급자는 합성 구현으로 교체한다. 권한 시험은 기존 townbase_pr34_*_test guard를 사용한다. 실계정 호출은 별도 Key·계정 권한·비용 상한 확인 후에만 실행한다. [구현 기록](docs/implementation/v0.2-c01-c04-model-execution.md)을 따른다.

- C01/C04 실계정 합성 연결 검증은 2026-10-26 사용자 명시 승인·총 US$0.10 상한으로 Luna/Sol/임베딩 각1회 성공했다. 예상 합계 US$0.000084180·실제 usage/readback은 [증거](docs/implementation/v0.2-c01-c04-live-verification.json)를 따른다. 품질 평가·최종 청구서 대조를 완료한 것으로 표시하지 않는다. 비용 기록이 있는 townbase_c01_live_test는 일반 합성 DB 시험의 reset 대상이 아니다.

- PR #39 보완: 설정 예산 monthlyBudgetUsd는 GET/변경 응답 소수2자리·PUT 정수/소수2자리까지로 왕복 가능하게 유지한다. 비용/usage 금액의9자리 표현과 구분한다. UUID v4는 대소문자 모두 같은 ID로 처리한다. 입력·출력 usage와 계산 비용을 입장 당시 한도/예약액에 대조하고 위반 시 unknown·예약 유지·결과 미반환을 검증한다.
- 호출 입장의 파일 I/O는 인증/설치 transaction 밖에서 수행한다. 준비한 master는 단일 작업만 사용하고 성공/실패와 무관하게 지운다. 입장 시 최신 세션·Key·정책/예산을 다시 검사한다. 지연 중 로그아웃·Key 교체·정책 변경과 기존 ID의 master 없는 재조회도 함께 시험한다.


## D01 파일 추출 기반 적용 상태 (2026-10-27)

- `apps/api/src/files/`는 내부 기반이며 아직 controller/업로드 웹/임베딩 경로가 없다. PDF.js 6.4.299·Mammoth 1.13.0·yauzl 3.4.0을 API production 의존성으로 고정한다. worker는 API build가 만든 JS로 실행하므로 파일 시험 전 `pnpm build`가 필요하다.
- 지속 파일 20 MiB·30만 Unicode code points·30초, DOCX 해제100 MiB·1,000 entries·100배를 적용한다. Linux 별도 로컬 프로세스의 DATA512 MiB/V8 heap128 MiB·RSS512 MiB 감시와 강제 종료를 사용한다. 이것을 cgroup의 순간 전체 RSS 보장과 혼동하지 않는다. 비Linux production은 거절한다.
- 원본/버전/완료된 추출 결과를 실제 저장·별도 인증 요청으로 재조회한다. 파서/파일 I/O는 인증 transaction 밖에서 하고 저장 직전 최신 신원을 재검사한다. `extracted`를 검색 가능으로 표시하지 않는다. D02/D03에서 공개 업로드 전 미완료 파일/재시작/orphan 정리와 제품 API를 연결한다.
- FileOriginal/FileVersion/FileExtractionRun에 SELECT/INSERT만 추가했다. 수정·삭제 권한은 아직 없으며 관련 기능 단계에서 열 단위로 확장한다. enum 추가와 사용 migration은 분리했다. 기존 metadata/벡터 보존과 신규/기존 SQL 적용을 검증했다.
- 실 DB suite는 `TOWNBASE_FILE_FOUNDATION_TEST=1`과 정확한 `postgres/townbase_d01_test`, owner URL/runtime secret 파일을 요구한다. 일반 API 시험은 건너뛴다. Connector의 DB 없는 회귀도 `--testPathIgnorePatterns=integration.spec.ts`로 분리한다. [D01 검증·제한](docs/implementation/v0.2-d01-file-extraction.md)을 따른다.


## PR #40 D01 보완 경계 (2026-10-28)

- 파일 I/O 오류는 storage_unavailable로 정규화하며 close 실패도 unlink 시도에 연결한다. unlink 실패를 삭제 완료로 취급하지 않는다. 자식 error 이벤트 뒤에는 아래 PR #41의 유한 종료·복구 경계를 적용하고, 종료 미확인 상태에서 새 추출을 허용하지 않는다.
- 20261028010000 후속 migration은 JSON envelope의 숫자/정수·비어 있지 않은 segments와 per-version 실행 인덱스를 추가한다. 저장 JSON을 결과/후속 처리에 사용하기 전 공통 assertExtraction의 본문·위치·글자 수 계약을 검사한다. 기존 D01 migrations를 재작성하지 않는다.
- D01 DB suite는 정확한 guard 뒤 알려진 fixture만 시험 전후 정리한다. ModelCall이나 다른 설치가 있으면 거절한다. 같은 DB 반복/중단 상태를 시험하며 실행마다 DB를 reset해 재실행 문제를 감추지 않는다.
- Node permission의 읽기 범위는 API node_modules/pnpm 트리를 포함하고 --allow-addons는 addon 전역 로딩 허용이다. 특정 addon만 선별하거나 OS sandbox를 보장한다고 기록하지 않는다. [PR #40 검증 범위](docs/implementation/v0.2-d01-review-response.md)를 따른다.


## PR #41 종료·업그레이드 경계 (2026-10-28)

- 파서 종료는 SIGKILL 최대3회·1초 정리 후 요청을 parser_unavailable로 반환할 수 있다. 반환이 OS 종료 성공을 뜻하지 않는다. 미종료 자식 참조를 유지해 같은 인스턴스의 새 추출을 차단하고 늦은 close/운영자 재시작으로 복구한다. 진단은 TOWNBASE_PARSER_TERMINATION_FAILED 코드만 사용한다.
- deployment/migrate.mjs는 advisory lock 뒤 별도 autocommit 검사 연결로 현재 파일 CHECK 호환성을 검사하고 연결을 닫은 후 db:deploy를 실행한다. lock transaction에 FileVersion 읽기 잠금을 보유한 채 다른 연결에서 ALTER TABLE을 실행하지 않는다. 조건은 실제 migration에서 재사용한다. 비호환 행은 개수/UUID 표본만 진단하고 데이터·이력을 자동 변경하지 않는다.
- 새 사전 검사 실 DB 시나리오는 TOWNBASE_FILE_PREFLIGHT_TEST=1과 정확한 postgres/townbase_d01_pr41_preflight_test의 빈 DB에서만 명시 실행한다. 일반 test:deployment에는 사전 검사·격리 DB guard 단위6개가 포함되며 이 실 DB 시나리오는 포함하지 않는다. [PR #41 기록](docs/implementation/v0.2-d01-pr41-review-response.md)을 따른다.


## D02 파일 관리 적용 상태 (2026-10-29, 사용자 승인 후 전달)

- self_hosted `/files` 등록/목록/교체/삭제/현재 원본 참조 API를 연결했다. 웹·비동기 실행 예약/요청 ID·재시도·임베딩은 D03/D04/G 후속이다. `extracted`와 searchable=false를 구분한다. API는 한 요청에1파일이며 일괄20개 UI는 후속이다.
- 입력은 인증 전 대용량 읽기를 금지하고 등록/교체 경로만 JSON28MiB·표준 base64·decode 전후20MiB를 허용한다. 다른 API는8KB 유지, 압축 입력 금지·큰 업로드 프로세스당1개·미완료 본문30초를 적용한다. 파싱 후에도 전역 guard로 최신 신원·범위를 재검사한다.
- 원본 저장은 TOWNBASE_DOCUMENTS_PATH/originals 전용0700·UUID 파일0600이다. 같은 DB의(741126,3) session advisory lock을 전용 pool1 연결로 유지해 쓰기와 정리를 직렬화한다. 인증 transaction 밖에서 파서/파일 I/O를 수행한다. 불확실 커밋은 DB 행 확인 전 파일을 무조건 지우지 않는다.
- 삭제는 deletedAt·추출문 제거로 먼저 차단하고 raw 정리는 시작/1분 주기로 재시도한다. 실패는 pending이며 unlink 성공/이미 없음 확인 뒤 rawDeletedAt을 기록한다. 현재 원본 참조는 I/O 후 최신 세션·현재 버전·삭제를 재검사하고 octet-stream attachment로만 제공한다. D05/I의 파생 참조·백업 삭제 반영 완료로 간주하지 않는다.
- runtime 추가 UPDATE 열은 FileOriginal.deletedAt, FileVersion.extraction/rawDeletedAt뿐이다. 기존 식별 열·테이블 DELETE·REFERENCES 등을 거절한다. file_registered/file_replaced/file_deleted 감사는 실제 변경 transaction과 함께 기록한다.
- 새 DB 통합 suite는 TOWNBASE_FILE_MANAGEMENT_TEST=1·정확한 postgres/townbase_d02_test의 새 합성 DB·owner URL/runtime secret을 요구한다. suite는 기존 DB를 자동 reset하지 않는다. API 전체·실제 parser를 compiled dist로 소비하므로 db:generate/build 후 실행한다. [D02 검증 기록](docs/implementation/v0.2-d02-file-management.md)을 따른다.


## PR #42 파일 관리 보완 (2026-10-31)

- 삭제의 missing-file 예외 처리는 unlink에만 적용한다. 디렉터리 생성/검사/realpath 실패를 정리 완료로 처리하지 않는다. 참조 I/O가 실패해도 최신 신원·현재 버전·삭제 상태를 재검사하며 실제 저장 장애503과 삭제404/인증401을 구분한다.
- 업로드 본문 판별은 실제 라우터의 대소문자/끝 슬래시 별칭과 맞춘다. DELETE는 빈 JSON 객체만 서비스에 전달한다. 공통 strict JSON parser의 거절은 유지한다.
- D02 실 DB fixture는 Installation/FileOriginal/ModelCall/Document/DocumentChunk가 모두 비었는지 쓰기 전에 확인한다. 기존 자료를 자동 정리하지 않는다. [리뷰 대응 기록](docs/implementation/v0.2-d02-review-response.md)을 따른다.


## D03 영속 실행 적용 상태 (2026-10-31, PR #43 전달)

- `/files` POST/PUT는 `X-Townbase-Request-Id` UUID v4와202 실행 ID 계약으로 전환했다. `/file-runs` 목록/상세/requests/:requestId·retry/stop 및 `/files/:id/reprocess`를 관리자 보호 경로로 제공한다. D02의 동기 응답 설명보다 이 현재 계약을 우선한다. 파일당1요청이며 등록/교체/재처리 성공은 로컬 추출/저장이다. 별도 index 작업과 검색 가능 표시는 D04를 따른다.
- FileRun/FileRunRequest에 신원·대상/설정 버전·시각·상태·카운트·재시도 부모·정확한 원본/버전/추출 이력 ID를 저장한다. 결과와 실행 완료를 같은 인증 transaction에서 확정한다. 요청 재전송·동일 active 대상/버전·같은 실패 등록의 반복 복구는 기존 실행으로 연결하고 원본을 중복 생성하지 않는다.
- 단일 API 소유권(741126,4)을 먼저 얻은 뒤 시작 정리/dispatch를 허용한다. 설치당 running1·queued+running20, 초과429다. 파일 잠금3을 얻기 전에는 running으로 선점하지 않고 idle 확인은 파일 잠금을 잡지 않는다. pending 입출력5·짧은 DB 전이6을 분리하며 인증 transaction에 파서/파일 I/O를 넣지 않는다. Redis/별도 worker/분산 lease/자동 재시도를 추가하지 않는다.
- raw 접수는 documents/pending 전용0700/0600이며 originals/첨부와 분리한다. 세션은 API 메모리에만 연결하고 재시작 뒤 queued/running은 interrupted다. 같은 API에서 수동 retry하며 늦은 완료는 running CAS로 차단한다. 파서 취소는 D01 bounded 종료 경계를 유지한다.
- 성공한 버전이 있으면 재시도는 정리 가능한 pending 복사본 대신 저장 원본을 사용한다. 비밀 패턴 실패는 raw 정리 후 동일 입력 재시도를 거절한다. 현재 FileRun/요청 별칭 terminal 이력은90일 후 정리하며, 기존 추출 이력/전체 자료·백업 보관 정책은 I 후속과 구분한다.
- runtime 추가 권한은 FileRun/FileRunRequest SELECT/INSERT/보관 정리 DELETE 및 FileRun의 상태·결과·inputKey 정리·시각/카운트 열 UPDATE다. 식별/소유·입력 metadata·별칭 fingerprint UPDATE는 거절한다. 실행 이력에 원문/세션/Key를 저장하지 않는다.
- D03 실제 DB 시험은 TOWNBASE_FILE_RUN_TEST=1·정확한 postgres/townbase_d03_test의 새 합성 DB·owner URL/runtime secret을 사용한다. 기존 D02 suite는202 계약 회귀를 포함한다. 두 suite 모두 build 산출물 전체를 소비하며 일반 API 시험은 건너뛴다. [D03 검증·한계](docs/implementation/v0.2-d03-file-runs.md)를 따른다.


## PR #43 D03 리뷰 보완 (2026-10-31, 로컬 검증)

- 종료는 접수와 같은 pending 잠금을 기다린 뒤 queued를 중단하고 owner를 해제한다. 접수는 잠금 안에서 종료/소유를 다시 검사한다. 종료 대기 잠금에는 readiness의 socket timeout을 적용하지 않는다.
- 취소는 claim부터 작업별 AbortSignal로 전달하며 파서 시작 전에 이미 취소된 작업은 spawn하지 않는다. 다음 작업으로 취소 상태를 전파하지 않는다. FileFoundation에서도 extraction_cancelled를 내용 실패/버전 생성으로 저장하지 않는다.
- 재처리 실패는 마지막 성공 extraction을 보존하되 실패 이력을 남긴다. inputKey/결과 ID가 없는 reprocess retry는 저장된 현재 원본/기준 버전을 검증해 사용한다.
- 20261031010000 후속 migration은 원본/버전/추출 이력의 복합 FK·작업/trigger 일치·미완료/중단 결과 NULL을 강제한다. 기존 D03 migration을 재작성하지 않는다. D02/D03 DB suite 제한은60초다. [14건 대응·572개 검증](docs/implementation/v0.2-d03-review-response.md)을 따른다.


## D04 지속 파일 색인 적용 상태 (2026-10-31, 로컬 구현)

- PR #43은 main dac7e8f로 동기화했다. 별도 codex/v02-d04-file-indexing 브랜치에서 POST /files/:id/index(새 요청 UUID·빈 JSON·202)를 D03 실행에 연결한다. 등록만으로 자동 임베딩하지 않으며 웹은 G 후속이다.
- FileIndex/FileIndexChunk는 저장된 FileVersion·소유·고정 small/1536과 실제 ModelCall을 연결한다. 전체 조각과 실행 완료를 같은 transaction/CAS로 게시한다. 부분 실패/취소/로그아웃 뒤 검색 가능으로 표시하지 않는다. 원문 위치·metadata를 유지하며 legacy Document/DocumentChunk와 첨부는 자동 편입하지 않는다.
- ModelExecutionService.execute의 내부 CallBoundary는 signal과 현재 source/run 검사를 받는다. master 준비 전/예약 transaction에서 재검사하며 network는 transaction 밖이다. 전송 전 취소 not_sent/0원과 전송 후 unknown/예약 유지, 같은 호출 ID 유료 재호출 금지를 유지한다. 새 수동 retry는 조각 비용이 다시 생길 수 있다.
- 분할은 최대4096 UTF-8 bytes(현재 입력 한도-256 이내)·위치 fragment128개, overlap 없음이며 실제 tokenizer가 아니다. 원본 크기/hash는 인증 transaction 밖에서 전송 전에 다시 확인한다. sourcePriority50·mode NULL에서 E의 질문별 mode 전략으로 연결한다. 같은 버전/추출/설정 및 같은 원본의 동일 bytes/hash 교체는 벡터를 재사용한다.
- API의 searchable/indexStatus/chunkCount와 내부 FileIndexService.search는 현재 최신 버전·성공 추출·동일 SHA-256·active/삭제/소유 조건을 SQL에서 검사한다. 질문/공개 검색·답변은 E, 과거 벡터 물리 정리/참조/전체 보관은 D05/I 후속이다.
- 후속 migration 20261101000000_file_indexes와 새 두 테이블의 SELECT/INSERT/DELETE 권한만 추가한다. 모든 UPDATE/REFERENCES/DDL·PUBLIC 우회를 거절한다. 현재 사용한 파일 작업 잠금3을 유지하므로 진행 중 삭제/교체409는 중단 후 재요청한다.
- 새 통합 suite는 TOWNBASE_FILE_INDEX_TEST=1·정확한 postgres/townbase_d04_test의 새 합성 DB·owner URL/runtime secret을 요구한다. 전체 compiled API·Linux 파서·제한 DB 계정을 사용하고 공급자만 합성으로 대체한다. 일반 API 시험은 opt-in을 건너뛰며 기존/live DB와 유료 모델 호출을 사용하지 않는다. [D04 검증·한계](docs/implementation/v0.2-d04-file-indexing.md)를 따른다.

- D04 최종 로컬 검증은681개(API435·배포24·DB 단위20·D04 DB31·D03 DB34·D02 DB26·C01 DB41·권한70)와 별도 production 미설정 차단/원본 재조회·D03 데이터 업그레이드 보존이다. 합성 공급자·linux/arm64 실행 증거이며 실계정 호출·x86_64 기준 성능/품질 수락과 구분한다. 사용자는 D04 커밋·푸시·main PR 생성을 승인했으며 전달 결과는 PR 기록을 따른다.


## PR #44 D04 리뷰 보완 (2026-11-01, 로컬 수정)

- 분할 v2는 segment 앞뒤 공백 제거·연속 공백/탭/줄바꿈 한 칸 정규화를 명시하고 위치는 정규화 전 code point 범위로 보존한다. 원본/추출 JSON은 변경하지 않는다. 기존 v1 색인은 보존·stale, 명시 index로만 갱신한다.
- FileIndex.chunkBytes는 현재 입력 한도-256과4096 중 작은 값이다. 동일 버전/동일 bytes 교체 재사용 모두 이를 대조한다. 한도 변경 자체로 기존 벡터를 숨기지 않으며 새 명시 색인에서 새 분할/비용을 적용한다.
- FileExtractionRun.ordinal은 버전별 저장 순서이며 공통 인증 잠금 아래 증가한다. API·기반 read·색인·검색 모두 ordinal DESC로 최신을 판정한다. 과거 동률은 후속 migration에서 실패 우선 차단 순서로 이관한다. runtime 추가 권한/DB sequence는 없다. 기존 migration은 수정하지 않는다.
- 전송 후 취소는 call_cancelled·unknown/예약 유지, 전송 전은 not_sent/0원이다. 공급자 시간 초과와 구분한다. 검증 증거·제한은 D04 기록의 PR #44 절을 따른다.
- 새 업그레이드 opt-in 시험은 TOWNBASE_FILE_INDEX_UPGRADE_TEST=1·정확한 postgres/townbase_d04_pr44_upgrade_test의 빈 DB에서만 실행한다. deployment/test/file-index-review.integration.mjs는 최소 구버전 테이블의 후속 SQL/이력 보존 시험이며 일반 test:deployment에는 포함되지 않는다.
- PR #44 로컬 수정 검증689개(API438·배포24·DB 단위20·D04 DB35·D03 DB34·D02 DB26·C01 DB41·권한70·업그레이드1) 통과. 이전 검증과 중복 합산하지 않는다. 사용자는 수정 요약 확인 후 커밋/푸시/PR 댓글 등록을 승인했다. 전달 결과는 PR 기록을 따른다.
