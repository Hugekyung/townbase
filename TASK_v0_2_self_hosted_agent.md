# Workspace Knowledge Agent v0.2 — 기본 기능 TASK

> 작성일: 2026-10-21 / 재작성: 2026-10-22  
> 기준: [기본 PRD](PRD_v0_2_self_hosted_agent.md), [선택·승인 기록](DECISIONS_v0_2_basic.md), 루트 [AGENTS.md](AGENTS.md)  
> 상태: 기본 기능 작업 분해와 모델 외 기본 선택 확정 완료. S01·S03~S14는 사용자 위임에 따라 채택했다. S02는 도입자 Key·지원 답변 모델 선택·임베딩 small/1536 고정 정책을 반영했다. 최초 답변 모델 ID/API는 C에서 확인한다. A03 명세와 A04 실행 결과는 아래 증거를 따른다. B01은 main 커밋 `80cb3ab`로 전달했다. B02 배포·초기 웹은 로컬 구현·검증 후 [PR #34](https://github.com/Hugekyung/townbase/pull/34)로 전달했다. PR 리뷰21개 보완은 후속 커밋 `e311ecc`로 전달했다. 재리뷰 보완은 `4adfb14`로 전달했다. 추가 리뷰6개와 관련 경계를 함께 보완했으며 최신 검증은240개 통과다. 2026-10-23 사용자가 재리뷰 보완의 commit/push·PR 댓글 등록까지 승인했다. [대응 기록](docs/implementation/v0.2-b02-review-response.md)을 따른다. PR #34는 main `24ad492`로 병합·동기화했다. B03은 별도 브랜치에서 로컬 구현·검증을 마쳤으며 2026-10-24 사용자가 commit/push·main 대상 PR 생성을 승인했다. PR #35 리뷰18건의 보완은 [대응 기록](docs/implementation/v0.2-b03-review-response.md)을 따른다. PR #35는 main `092a4ed`로 병합·동기화했다. B04는 `codex/v02-b04-administrator-auth`에서 로컬 구현·검증을 마쳤으며 2026-10-24 사용자가 commit/push·main 대상 PR 생성을 승인했다. PR #36 리뷰17건 보완은 `bcba158`로 전달했고 main `3cc61de`로 병합·동기화했다. [대응 기록](docs/implementation/v0.2-b04-review-response.md)을 따른다. B05는 `c74d409`와 [PR #37](https://github.com/Hugekyung/townbase/pull/37)로 전달했다. 2026-10-25 리뷰5건을 보완하고263개 회귀 시험을 통과했다. [대응 기록](docs/implementation/v0.2-b05-review-response.md)을 따른다. PR #37은 main `bccefe0`에 병합했다. C02/C03 설정·보호 기반은 `codex/v02-c02-c03-integration-settings`에서 로컬 구현·417개 시험 검증을 마쳤으며 2026-10-25 사용자 승인 후 `53b95e7`과 [PR #38](https://github.com/Hugekyung/townbase/pull/38)로 전달했다. 리뷰14건의 후속 보완·290개 검증은 [대응 기록](docs/implementation/v0.2-c02-c03-review-response.md)을 따른다. PR #38은 실제 모델 호출이 없는 기반이다. 2026-10-26 승인 모델의 C01/C04 후속 로컬 구현은 아래 기록을 따르며 실계정 합성 호출3회는 성공했고 한국어 RAG 품질과 최종 청구서 대조는 별도다.

## 0. 사용법·범위

- 단일 관리자, 파일 등록·색인·수동 실행, 기본 Agent, 출처 답변·거절·Gap, 일회성 첨부, 기본 웹·보호·운영·복구만 구현한다.
- 회원가입·메일·예약·새 외부 문서 서비스·Slack·그룹 권한·범용 플러그인은 선행 조건도 완료 조건도 아니다. 후보는 [범위 검토안](PRD_v0_2_scope_review.md)에 보관하며 구현은 약속하지 않는다.
- 이전 계획은 [과거 TASK](TASK_v0_2_full_scope_reference.md)에 보관했다. 새 ID는 `V02B-A01` 형식이다. 과거 `V02-*` 작업 상태를 자동 승계하지 않는다.
- `완료`는 해당 작업의 실제 산출물과 검증 증거를 확인한 경우만 사용한다. 현재 문서 작성이 코드 구현·성능·API 연결 검증 완료를 뜻하지 않는다.
- 미정값은 [선택 기록](DECISIONS_v0_2_basic.md)의 S 항목으로 확인한다. 승인되지 않은 값에 의존하는 코드·migration은 중단하고 필요한 선택을 묶어 요청한다. 독립적인 문서·읽기 작업은 가능하다.
- 코드 변경은 별도 `codex/` 브랜치에서 한다. 구현·검증 요약을 먼저 제시하고 사용자 승인 후 commit → push → main PR을 진행한다. 기능 검증 상태와 저장소 전달 상태를 구분한다.

## 1. 재사용과 보완

| 기존 경로 | 재사용 | 기본 버전에 필요한 보완 |
| --- | --- | --- |
| `apps/api/src/chat/` | 질문·검색·trace·저장 계약 | 관리자 맥락·전송 검사·실제 근거 본문·독립 completion·첨부 경로 분리 |
| `packages/agent-core/src/` | prompt·context·출처 | 주장/근거 연결·실제 본문·RAG/첨부 구분·정책 우선순위 |
| `packages/rag-core/src/` | 분할·임베딩·mode | 운영 fake fallback 차단·설정 일치·차원/모델 호환성 |
| `packages/connectors/src/` | Notion·Git·원본/메타데이터·변경 감지 | 공통 파일 입력·결과 계약. 기존 운영 노출은 승인 범위만 |
| `apps/api/src/ingestion/` | 수동 실행 진입 | 인증·DB 실행 ID·문서별 이력·중복/중단·재시도 |
| `apps/api/src/knowledge-gaps/` | Gap·draft 저장/생성 | 접근·전송·삭제·첨부 유래 내용 차단 |
| `packages/database/prisma/` | Workspace·Document·Chunk·Question·Gap·Draft | 관리자·설정·작업·첨부 등 현재 단계에 필요한 migration·소유·출처·삭제 관계 |
| `docker-compose.yml` | PostgreSQL·pgvector | API·웹·migration·비밀·파일 volume·노출 제한·health |
| 웹 | 신규 | 확정한 React·TypeScript·Vite SPA를 `apps/web/`에 구성하고 API와 같은 origin으로 배포 |

기존 chunk 600/80 tokens·topK 5/최대 50·vector_only·판정 0.45/0.40·임베딩 1536차원은 비교용 관측값이다. 운영 기본값으로 승인한 것은 아니며 E/J에서 평가한다. 빌드가 있는 패키지의 `main`·`types`가 dist를 가리키는지도 확인한다.

## 2. 단계·선행 관계

| 단계 | 목적·완료 결과 | 선행 | 결정·승인 | 기본 요구 |
| --- | --- | --- | --- | --- |
| A | 기준·승인·평가 초안·현재 baseline | 없음 | 관련 S 항목 승인, 특히 S01~S04·S06~S08·S12~S14 | 전체 |
| B | 최소 배포·관리자·저장/접근 기반·초기 웹 | A | S01·S03·S04·S06·S07·S12·S14 | B01·B02·B03·B11·B12 |
| C | 모델·Key·전송·사용량/비용 | B | S02·S04·S08·S10·S11 | B04·B11·B13 |
| D | 파일·색인·수동 실행·영속 이력 | C | S05·S06·S07·S08·S09, 파서 결정 | B05·B06·B07 |
| E | 독립 RAG·기본 Agent·출처·Gap·대화 | D | S02·S08·S10·S11·S13 | B08·B09·B13 |
| F | 일회성 첨부·소유자 전용 결과 저장·격리 | E | S05·S06·S08·S10·S11 | B14·B11·B12 |
| G | 첫 설정부터 운영까지 웹 흐름 통합 | F | 응답/화면 계약, 기존 승인값 | B10 |
| H | 기존 경로 보호·비활성/활성 검증 | B·C·E | S12, 활성화 선택 시 별도 인증/최신성 결정 | 기존 유지·B03·B11 |
| I | 보관·삭제·비용/자원·백업/복구·배포 | G·H | S06·S07·S11·S14 | B01·B11·B12·B13 |
| J | 통합·품질·신규 설치·운영 인계 | I | S01·S02·S13·S14 합격 기준 | 전체 |

권장 실행 순서는 A → B → C → D → E → F → G → H → I → J다. H의 경로 목록과 기본 차단은 B부터 수행한다. UI는 B부터 기능과 함께 만들고 G는 통합 단계다. 데이터 수명·삭제 경계도 I까지 미루지 않고 B/D/F에서 구현한다. 추가 기능 없이 기본 종료 조건을 충족해야 한다.

## 3. A — 기준·선택·현재 baseline

| 상태 | TASK | 수행·산출물 | 검증 |
| --- | --- | --- | --- |
| 문서 완료 | V02B-A01 | 기본 TASK·선택안·AGENTS와 PRD 참조 정합성 정리 | 기본 B01~B14 추적, 과거 문서 별도 보관, 참조 재조회 |
| 모델 외 문서 완료 | V02B-A02 | S01·S03~S14의 적용값·이유·위임 날짜 기록. 파서·TLS 방향 채택, S02 답변 모델 전환 보류 | 선택 기록 2·5·6절 재조회. 실계정 가용성·파서 자원·TLS 준비·품질은 각 구현 단계에서 검증 |
| 명세 완료 | V02B-A03 | 문서 2개 corpus·질문 유형/정답/정답 문서/거절/충돌·첨부 격리·복구 시험 명세와 평가 분모 확정 | [평가 명세](docs/evaluation/v0.2/README.md): 12문서×2·60문항×2·정답 heading·지표 분모·AT12개/OP8개. 명세 재조회 완료, 제품 실측은 J |
| baseline 확인 완료 | V02B-A04 | 현행 build·lint·패키지 테스트·가용 API/DB 구조 baseline 확인 | [baseline](docs/evaluation/v0.2/baseline-2026-10-23.md): build/lint/schema 통과, 격리 DB migration/seed·통합 포함 중복 제외 59 suites/176 tests 통과. 포트 제한 실패는 별도 재시험 통과 |

종료: 문서 정리만으로 A 완료로 표시하지 않는다. B에 필요한 선택 승인·환경과 baseline 기록이 있어야 B를 시작한다. 단계별 세부값은 관련 작업 착수 전에 확정한다.

## 4. B — 최소 배포·관리자·저장 기반

| 상태 | TASK | 수행·산출물 | 검증 |
| --- | --- | --- | --- |
| main 전달 완료 (`80cb3ab`) | V02B-B01 | 필요한 관리자·설정·소유·중요 변경 기록의 최소 DB/migration, 비밀·파일 경계와 신규/기존 DB 적용 설계 | [설계·적용 절차](docs/implementation/v0.2-b01-storage.md)·[검증 기록](docs/implementation/v0.2-b01-verification.md). 새 DB/구버전8개 모델 보존·재실행·11개 테이블 복원/readback, 신규11개 포함149 tests. 운영 복구·로그인/파일 구현과 구분 |
| main 병합 완료 (`24ad492`, #34) | V02B-B02 | API·초기 웹·DB·migration 배포, health·volume·host 노출·TLS 계약. 빌드 산출물 소비 경로 정리 | [실행 안내](docs/self-hosted-deployment.md)·[검증 기록](docs/implementation/v0.2-b02-verification.md): Linux amd64 에뮬레이션에서 빈 volume 기동·중복/실패 차단·DB/파일 재시작 유지·실제 UI 오류/회복, 최초202개·1차 보완211개·2차 보완221개·3차 보완240개 tests 통과. [추가 검증](docs/implementation/v0.2-b02-review-response.md) 참고. 네이티브 장비/실제 조직 TLS는 별도 |
| main 병합 완료 (`092a4ed`, #35) | V02B-B03 | 최초 관리자 1회 생성·일회성 초기 토큰·동시 등록 제어 | [구현·검증 기록](docs/implementation/v0.2-b03-administrator.md): 로컬 발급·실 DB 저장/감사·Argon2id·시도 제한·Origin/전송 경계·초기 웹. 최초271개 자동 시험 후 리뷰18건 보완·289개 회귀 시험 및 Vite 등록/장애 UI 확인. 신규5건의 2차 보완은 로컬 검증 API129·배포5 통과, 2026-10-24 사용자 전달 승인. [리뷰 대응](docs/implementation/v0.2-b03-review-response.md). 2026-10-24 사용자 승인으로 보완 commit/push·PR 댓글 등록 경로를 따른다. main `092a4ed`로 병합·동기화 |
| main 병합 완료 (`3cc61de`, #36) | V02B-B04 | 로그인·logout·비밀번호 변경·세션·메일 없는 로컬 복구·중요 변경 기록 | [구현·검증](docs/implementation/v0.2-b04-authentication.md): 자동 시험208개(API/B03 DB139·배포5·B04 DB18·권한34·DB 단위12) 통과. 만료·무효화·동시 복구·시도 제한·감사 실패 롤백. 2026-10-24 사용자 commit/push·main PR 승인. PR #36 리뷰17건 보완은 [대응 기록](docs/implementation/v0.2-b04-review-response.md): 224개 회귀 통과, 2026-10-24 후속 commit/push 승인, `bcba158` 전달 후 main `3cc61de` 병합 |
| main 병합 완료 (`bccefe0`, #37) | V02B-B05 | 서버 공통 요청자/설치 접근 검사, 기존 API/MCP/CLI 노출 목록·배포 프로필 | [구현·검증](docs/implementation/v0.2-b05-access.md): 285개 자동 시험, 실제 DB scope·소유 검사, 비활성 HTTP404와 CLI 작업 전 차단. B05 당시 자료/대화/Key/실행 미구현과 구분하며 Key 보관·전송 설정은 이후 C02/C03의 별도 제공 범위다. 2026-10-24 사용자 commit/push·main PR 승인. `c74d409`/PR #37 전달 후 2026-10-25 1차 리뷰5건 보완·263개 회귀 통과(실 DB opt-in41개 제외, 최초285개는 실 DB 포함이며 서로 합산하지 않음). 2차 신규5건 보완은 관련 API161·배포12=173개 재검증(실 DB 제외). [대응 기록](docs/implementation/v0.2-b05-review-response.md) |

종료: 인증된 초기 관리자가 안전하게 설정을 시작할 수 있고, 미인증 우회와 두 번째 관리자 생성이 차단된다. 아직 파일·답변 미구현을 정상 준비 상태로 표시하지 않는다.

## 5. C — 모델·Key·외부 전송·사용량

| 상태 | TASK | 수행·산출물 | 검증 |
| --- | --- | --- | --- |
| main 병합 완료 (`2fa4e4b`, #39) | V02B-C01 | 지원 답변 모델 선택 adapter와 고정 임베딩 `text-embedding-3-small`/1536 adapter, 실제 모델/계정·API parameter·context·출력·reasoning 예산 확인 | 합성 입력으로 live 호출과 usage 확인. 잘못된 모델/차원·가용성 오류 표시 |
| 기반 main 병합, 후속 로컬 구현·실계정 검증 | V02B-C02 | Key 암호화·마스킹·교체·비활성화/삭제 저장 기반. 후속 C01/C04에서 답변 모델 설정·합성 연결 검사 로컬 구현·실계정 검증 | 별도 요청·서비스/컨테이너 재시작 재조회, 마스킹·교체된 Key 복호화, 고정 임베딩 변경 거절, master 누락/변조 차단 검증. 모델 변경/재조회·합성 연결 검사 저장은 후속 로컬 구현. 실제 계정의 두 답변 모델·임베딩 연결 검사와 usage 정산/재조회3회 성공 |
| 기반 main 병합, C 호출 경계 로컬 검증·D/E/F 후속 | V02B-C03 | 용도별 전송 허용 저장·기본 비밀값/endpoint의 로컬 사전 검사. C01/C04 네트워크 경계 로컬 통합. D/E/F 자료별 접근·전송·fake fallback 차단은 후속 검증 | 기본 거절·용도 독립성·패턴/endpoint 차단·긴 입력 처리 검증. C 호출 서비스의 전송 전 차단은 합성/loopback으로 검증. 실제 계정의 합성 입력3회 성공. D/E/F 자료 경계는 후속 검증 |
| main 병합 완료 (`2fa4e4b`, #39) | V02B-C04 | 호출 ID·모델·usage·시간·가격표/추정·비용 예약/정산·한도·timeout·오류 기록 | 임베딩+답변 합산, 미입력 예산·미확인 가격·timeout 청구 불명 처리, 중복 요청의 임의 재호출 금지 |

2026-10-25 PR #38을 main `d42a894`로 병합·로컬 동기화했다. 리뷰 2차3건 대응·247개 검증은 [대응 기록](docs/implementation/v0.2-c02-c03-review-response.md)을 따른다. C01/C04는 `codex/v02-c01-c04-model-execution`에서 [착수안](docs/implementation/v0.2-c01-c04-model-execution-plan.md)을 정리했으며 2026-10-26 Luna 기본·Sol 선택 승인을 받았다. C01/C04 코드는 로컬 구현·검증 단계이며 실제 OpenAI 합성 호출3회가 성공했고 usage/예상 비용·별도 DB 재조회까지 확인했다.

C02/C03 첫 PR은 Key 암호화/조회/교체/비활성화/삭제·중요 변경 재인증·감사·전송 정책 저장·로컬 사전 검사 기반이다. C01/C04 후속은 2026-10-26 승인 모델로 로컬 구현했다. 모델 설정·고정 합성 연결 검사·C 네트워크 경계·usage/예약/정산은 합성 응답·실제 제한 계정 DB·운영 이미지로 검증한다. 실제 계정의 합성 호출·usage/추정 정산은3회 성공했다. 품질 평가와 D/E/F 자료 경계 통합은 후속 범위다. [후속 기록](docs/implementation/v0.2-c01-c04-model-execution.md)을 따른다. [구현 기록](docs/implementation/v0.2-c02-c03-integration-settings.md)을 따른다.

종료: 사내 문서를 연결하기 전에 합성 입력에서 실제 모델·비밀 저장·전송 차단·비용 경로가 검증된다. 공급자 측 보관 옵션/요청 저장 여부도 확인·안내하며 내부 미색인과 혼동하지 않는다.

## 6. D — 파일·수동 실행·색인

| 상태 | TASK | 수행·산출물 | 검증 |
| --- | --- | --- | --- |
| main 병합 (`29eea00`, #40·#41) | V02B-D01 | S05의 PDF.js·Mammoth·기존 MD/UTF-8 TXT 파서와 제한된 로컬 처리 프로세스 적용, 지원 버전/라이선스 확인·고정 및 파일 원본/실행 migration 작성 | PDF 페이지·DOCX/MD heading·TXT 위치 계약, 외부 파일 접근·HTML 직접 렌더 금지, 메모리/압축/시간 제한·기존 메타데이터 유지 |
| main 병합 (`577aec3`, #42) | V02B-D02 | 보호된 등록/목록/교체/삭제·참조 API, 확장자+내용 검사·허용 형식·크기/추출/압축 한도 | 정상 4형식·스캔·암호화·손상·위장·과대·압축 폭탄·path traversal, 교체 원본 ID 유지 |
| main 병합 (`dac7e8f`, #43) | V02B-D03 | DB 실행 ID·문서별 결과·원자적 중복 제어·대기/실행/중단·수동 재시도 | 중복 요청·API 재시작·부분 실패·재시도 원 실행 연결. 로그 대신 DB 재조회 |
| main 병합 (`bb5dae6`, #44) | V02B-D04 | 공통 추출·분할·임베딩·저장·상태·변경 hash, metadata·원본 위치 전파 | 실제 검색 가능한 chunk/벡터 저장, 동일 문서 중복 방지, 전송 차단·차원 불일치 실패 |
| 로컬 구현·검증 완료, 전달 승인 | V02B-D05 | 교체/삭제/범위 제외 후 새 검색/전송 차단, 정리·보관 및 파생 참조 연결 | 구버전 새 답변 미사용, 실패한 교체의 상태·출처 일치, 삭제 후 재색인으로 복원되지 않음 |

종료: 4형식별 등록→실행→검색→교체→삭제와 재시작/재시도까지 관측 가능하다. 파일 등록이 원본 자동 갱신을 의미하지 않음을 화면·문서에 표시한다.

## 7. E — 독립 RAG·Agent·대화·Gap

| 상태 | TASK | 수행·산출물 | 검증 |
| --- | --- | --- | --- |
| 미착수 | V02B-E01 | 기본 Agent 한 개의 지침·용어·소스·모델 설정·입력/결과 계약, 웹과 공통 서비스 분리 | 설정 저장/재접속 조회, Agent 소스가 권한을 넓히지 않음 |
| 미착수 | V02B-E02 | 검색→접근/전송 검사→실제 근거 본문→completion·출처/충돌·거절 연결 | 실제 문서 내용이 모델 입력에 존재, 제목만으로 답하지 않음, 주장별 출처 위치·문서 충돌 안내 |
| 미착수 | V02B-E03 | 질문·답변·근거·요청자·모델·usage·실행 결과·대화 소유/보관 저장 | 요청 ID 결과와 별도 재조회 일치, 다른 설치/미인증 접근 거절, 미완료 응답 상태 구분 |
| 미착수 | V02B-E04 | RAG 부족의 `isAnswerable=false`, Gap 실제 저장·조회, 기술 오류와 분리 | 근거 없음·부분 근거·모델 장애·인증 오류·전송 불허를 구분. candidate 신호만으로 완료 금지 |
| 미착수 | V02B-E05 | 기존 mode·메타데이터·baseline 회귀 및 질문/context/출력·요청 제한 적용 | auto 규칙·출처 선택·prompt·형식 확인, 조용한 잘라내기/다른 모델 fallback 차단 |

종료: 외부 MCP Client나 과거 대화 문맥 없이 출처 기반 답변·거절·Gap 재조회가 가능하다. 답변 가능 판정 기준은 S13과 시험 세트로 조정하며 빈 근거를 통과시키기 위해 숫자만 낮추지 않는다.

## 8. F — 일회성 첨부·작업 결과·격리

| 상태 | TASK | 수행·산출물 | 검증 |
| --- | --- | --- | --- |
| 미착수 | V02B-F01 | 첨부 전용 업로드·소유자/작업/저장 위치·만료·삭제 상태, D 파서 재사용 | 지속 문서/첨부 입력 경로 분리, 4형식/한도·소유·임시 경로 검사 |
| 미착수 | V02B-F02 | 추출→허용 검사→모델 입력·요약/질문/초안·첨부 근거, RAG 혼합 시 별도 검색 질문 처리 | 첨부 유래 텍스트·질의·후속 대화가 임베딩에 미전달, RAG/첨부 출처 구분, 부족/초과 안내 |
| 미착수 | V02B-F03 | 요약·초안·답변을 소유자 전용 대화/작업 결과로 영속화·재조회, provenance 전파 차단 | 공용 Document/Chunk/vector/Gap/ActionDraft/평가 데이터 미생성, 외부 file-search/vector-store 미생성 |
| 미착수 | V02B-F04 | 작업 종료·실패·유휴·재시작의 임시 파일/추출 데이터 정리, 후속 재첨부 안내 | 접근 만료→물리 삭제 검증, 미공개 임시파일 URL 차단, 백업 제외, private 결과 보관과 원문 삭제 분리 |

종료: 합성 첨부로 실제 생성 결과 저장·재조회와 격리 side effect를 모두 검증한다. UI 문구·candidate·임베딩 호출 횟수 하나만으로 통과하지 않는다.

## 9. G — 기본 웹 통합

| 상태 | TASK | 수행·산출물 | 검증 |
| --- | --- | --- | --- |
| 미착수 | V02B-G01 | 첫 설정에서 관리자→모델/전송→파일→실행→첫 질문까지 연결 | 메일/직원 가입/Drive/예약 없이 신규 설치 완료, 실패 연결을 완료로 표시하지 않음 |
| 미착수 | V02B-G02 | 채팅·근거·대화 기록·첨부·결과 조회·한도/오류 표시 | 등록/첨부 구분, 공급자 안내, 새로고침/재로그인 후 결과 재조회 |
| 미착수 | V02B-G03 | 문서·Agent·Key/모델·전송·수동 이력·Gap·usage/오류 관리 | 실제 서버 결과·저장 확인, 미구현 메뉴 없음, 삭제/교체 영향·부분 실패 명시 |

종료: PRD 5.7의 모든 기본 화면이 실제 저장·조회 경로와 연결된다. 실제 브라우저 시나리오로 정상/실패·새로고침·재로그인을 확인하고 화면 증거를 남긴다.

## 10. H — 기존 경로 보존·노출 보호

| 상태 | TASK | 수행·산출물 | 검증 |
| --- | --- | --- | --- |
| 미착수 | V02B-H01 | Notion/Git/MCP/draft의 운영/개발 프로필·직접 호출·자격 증명 목록과 S12 적용 | 기본 비활성 경로 거절. 코드·원본/메타데이터·mode 계약 fixture 회귀 보존 |
| 미착수 | V02B-H02 | 활성 경로가 선택된 경우에만 관리자 인증·허용 소스·반출·수정/삭제/철회·보관 보호 | 활성화하지 않으면 비활성 차단 증거로 종료. 활성화하면 실제 연결 시험·최신성/오류 정책 별도 확정 |

종료: 기존 기능을 코드가 있다는 이유로 무인증 공개하지 않는다. 활성 기능의 보호 시험은 생략하지 않으며 비활성 프로필에서는 새 Connector 관리 UI를 요구하지 않는다.

## 11. I — 보관·삭제·운영·백업/복구

| 상태 | TASK | 수행·산출물 | 검증 |
| --- | --- | --- | --- |
| 미착수 | V02B-I01 | 데이터 종류별 보관·정리·삭제 tombstone·첨부 유래 과거 대화와 Gap/draft 참조 처리 | 문서 새 검색 차단과 과거 기록 처리 각각 확인, 만료·삭제·재시작·복원 후 재노출 차단 |
| 미착수 | V02B-I02 | 수동 암호화 백업·분리 master key 복구·배포 전 snapshot·보관 세대/만료 | 깨끗한 장비/DB 복원 후 login·Key 복호화·파일·검색·이력 재조회, 임시 첨부 백업 없음 |
| 미착수 | V02B-I03 | 배포 버전·migration·health·storage·오류/시간/usage·접근 보호·운영 한도 | 모델/DB 오류·disk full·timeout·키 분실·재시작 시 거짓 성공·유출 없음 |
| 미착수 | V02B-I04 | 설치·운영·삭제·지원 형식·모델 반출·비밀 교체·수동 백업·업그레이드/rollback 문서 | 배포 파일과 명령 일치, 실제 복구 소요·마지막 백업 시각·지원 범위 명시 |

종료: 단순 백업 파일 생성만으로 복구 완료라 하지 않는다. 실제 복원·readback과 데이터 생명주기 결과가 있어야 한다. 자동 Connector 동기화·worker·외부 알림을 이 단계에서 임의 추가하지 않는다.

## 12. J — 통합·품질·인계

| 상태 | TASK | 수행·산출물 | 검증 |
| --- | --- | --- | --- |
| 미착수 | V02B-J01 | 신규 환경 설치부터 문서/첨부·답변·재시작·삭제·복원까지 전체 시나리오 수행 | PRD 8절 각 항목을 실행 ID·파일/DB·스크린샷·명령 결과로 연결 |
| 미착수 | V02B-J02 | corpus 2개별 정답 검색·출처·가능/불가·충돌·오답·latency·비용/실패율 측정 | S13/S14 분모·장비·모델·문서량·context 고정, 이전 Agent 문맥 없는 평가. 합격 미달 시 조정/재시험 |
| 미착수 | V02B-J03 | 직접 API·비활성 기존 경로·비밀값·첨부 미색인·후속 오염·보관/복원 시험 | 필수 보호 시나리오 실패 미해결 0개. 시험 통과를 모든 공격/유출 방지 보장으로 표현하지 않음 |
| 미착수 | V02B-J04 | README·PRD·TASK·AGENTS를 실제 script·배포·지원 범위와 대조하고 구현 요약 | 기본 기능 수락표·남은 제한·변경 파일·승인값·시험 결과. 과거 계획 완료로 대체 금지 |
| 미착수 | V02B-J05 | 사용자 커밋/푸시 승인 후 commit→push→main PR, PR attachment | 원격 branch·commit·PR 확인. 승인 대기 중 기능 검증 완료와 전달 미완료 구분 |

종료: 기본 B01~B14 증거·미해결 필수 실패 없음·사용 설명과 실제 동작 일치, 요구된 저장소 전달 절차 완료. 추가 후보 기능의 미구현 때문에 종료를 막지 않는다.

## 13. 기본 요구 추적표

| 기본 ID | PRD | 담당 TASK |
| --- | --- | --- |
| B01 | 5.1 | V02B-B02·V02B-G01·V02B-I04·V02B-J01 |
| B02 | 5.3 | V02B-B03·V02B-B04 |
| B03 | 4·5.9 | V02B-B05·V02B-H01·V02B-J03 |
| B04 | 5.2 | V02B-C01·V02B-C02 |
| B05 | 5.4 | V02B-D01·V02B-D02·V02B-D05 |
| B06 | 5.4 | V02B-D04·V02B-D05 |
| B07 | 5.6 | V02B-D03 |
| B08 | 5.5 | V02B-E01·V02B-E02 |
| B09 | 5.5 | V02B-E02·V02B-E04 |
| B10 | 5.7 | V02B-G01·V02B-G02·V02B-G03 |
| B11 | 5.10 | V02B-B05·V02B-C03·V02B-F03·V02B-J03 |
| B12 | 6·5.10 | V02B-B01·V02B-I01·V02B-I02 |
| B13 | 5.10·8 | V02B-C04·V02B-I03·V02B-J02 |
| B14 | 5.5.1 | V02B-F01·V02B-F02·V02B-F03·V02B-F04 |

## 14. 실제로 존재하는 검증 명령과 사용 조건

package.json 정적 목록이다. 2026-10-23에 실제 실행한 범위·제외·실패/재시험은 [baseline 기록](docs/evaluation/v0.2/baseline-2026-10-23.md)을 따른다. 프로젝트 설치·격리 DB·생성물 등 선행 조건을 확인한 뒤 A/관련 단계에서 실행한다.

| 명령 | 확인 범위 |
| --- | --- |
| `pnpm build` | database→rag-core→agent-core→connectors→API→web 빌드. B02부터 전체 배포 산출물 생성 |
| `pnpm lint` | API lint |
| `pnpm test` | API Jest |
| `pnpm deploy:prepare` / `pnpm test:deployment` | 로컬 배포 secret 준비(덮어쓰기 없음) / secret·초기 설정 회귀 |
| `pnpm --filter @townbase/rag-core build` / `pnpm --filter @townbase/rag-core test` | rag-core 빌드·계약/단위 검사 |
| `pnpm --filter @townbase/agent-core build` / `pnpm --filter @townbase/agent-core test` | agent-core 빌드·prompt/context/citation 검사 |
| `pnpm connectors:build` / `pnpm connectors:test` | Connector 빌드·fixture/단위 검사 |
| `pnpm db:generate` / `pnpm db:validate` | Prisma 생성·schema 검증. 필요한 환경값 준비 |
| `pnpm db:test` | database 테스트. 테스트가 사용하는 DB/환경을 먼저 확인 |
| `pnpm db:deploy` | migration 실제 반영. 읽기 검사가 아님. 격리 DB 또는 승인된 배포 대상에만 사용 |

신규 웹 E2E·통합 평가·복구 명령 이름은 해당 단계에서 script를 실제 추가한 뒤 기록한다. 없는 `test:web:e2e`, `eval:v02` 등을 현재 실행 가능한 명령으로 안내하지 않는다. 각 변경에 필요한 검사부터 수행하고 새 변경·실패·미해결 위험 없이 반복 확대하지 않는다.

## 15. 단계 보고와 다음 착수

각 단계 종료 시 적용 S 값·관련 TASK 상태·변경 파일·실행 명령·DB/파일/실행 ID 재조회·정상/실패 증거·남은 제한·저장소 전달 상태를 기록한다. 비밀값·사내 원문은 증거에서 제외한다. 증거 저장 위치는 구현 시작 시 정하고 문서화한다.

A03/A04 준비와 B01 저장 기반을 main `80cb3ab`로 전달했다. B02는 `codex/v02-b02-deployment-foundation`에서 배포·초기 웹·산출물 소비 경로를 로컬 구현·검증했다. [B02 검증 기록](docs/implementation/v0.2-b02-verification.md)을 따르며 구현 커밋 `a6749a9`와 [PR #34](https://github.com/Hugekyung/townbase/pull/34)로 전달했다. PR #34는 main `24ad492`로 병합됐고 로컬 main 동기화를 마쳤다. B03 최초 관리자 등록을 `codex/v02-b03-initial-administrator`에서 로컬 구현·검증을 마쳤다. [B03 기록](docs/implementation/v0.2-b03-administrator.md)을 따른다. PR #35는 main `092a4ed`에 병합됐다. B04 로그인·세션·로컬 복구를 별도 브랜치에서 로컬 구현·검증했다. [B04 기록](docs/implementation/v0.2-b04-authentication.md)을 따르며 2026-10-24 사용자의 승인으로 commit/push·main PR 전달 경로를 따른다. PR #36은 main `3cc61de`로 병합됐다. B05 공통 접근 검사를 `codex/v02-b05-access-boundaries`에서 로컬 구현·검증했고 2026-10-24 사용자가 commit/push·main PR 생성을 승인했다. 다음 구현은 C 모델·Key·전송 설정이다. S02의 초기 답변 모델 ID/API 검증은 C에서 하며 B와 분리한다. 2026-10-23 사용자의 승인으로 작업 브랜치 commit/push와 main 대상 PR 생성을 수행했다. 이전 main 직접 푸시는 B01 기록이며 B02는 PR 검토 경로를 따른다.


2026-10-26 C01/C04 구현·자동 시험456개·실계정 합성 호출3회 검증 요약 후 사용자가 commit/push·main 대상 PR 생성을 승인했다. [구현 기록](docs/implementation/v0.2-c01-c04-model-execution.md)과 저장소 PR 기록을 따른다.

2026-10-26 PR #39 리뷰10건(타당8·부분 타당2)은 권장 방향으로 로컬 보완했다. 이번 재검증 범위와 전달 상태는 [리뷰 대응 기록](docs/implementation/v0.2-c01-c04-review-response.md)을 따른다.

PR #39 후속 자동 시험은 API288·C01 실제 DB41·C02 실제 DB31·배포18=378개 통과다. 최초456개 및 실계정3회와 범위가 다르므로 합산하지 않는다. 추가 유료 호출 없이 운영 이미지 재시작 검증까지 마쳤으며 2026-10-26 사용자가 후속 commit/push·PR 댓글 등록을 승인했다. 전달 결과는 PR #39 기록을 따른다.


2026-10-27 PR #39는 main `2fa4e4b`로 병합·동기화했다. C01/C04와 리뷰 보완은 main에 전달됐다. 다음 D01은 `codex/v02-d01-file-extraction`에서 4형식 로컬 추출·원본/버전/완료 추출 이력 저장 기반을 구현했다. 중복 제외 자동540개와 운영 이미지 4형식·기존 자료 보존을 검증했다. [D01 기록](docs/implementation/v0.2-d01-file-extraction.md)을 따른다. 공개 업로드/교체/삭제는 D02, DB 색인 실행은 D03, 실제 임베딩은 D04다. 2026-10-27 사용자가 이번 코드의 commit/push·main 대상 PR 생성을 승인했다. 전달 결과는 저장소 PR 기록을 따른다.


2026-10-28 PR #40 리뷰12건을 권장 방향으로 로컬 보완했다. 중복 제외550개, 같은 D01 DB의 초기화 없는2회 실행·중단 fixture 정리, 후속 migration·PUBLIC REFERENCES, 운영 이미지4형식을 검증했다. [대응 기록](docs/implementation/v0.2-d01-review-response.md)을 따른다. 사용자는 수정·PR 댓글 등록을 요청했으며 검증 요약 후 2026-10-28 후속 commit/push·PR 반영 상태 댓글 갱신을 승인했다. 전달 결과는 PR 기록을 따른다.


PR #40의 기존 HEAD184f2aa는 main `4f4b26b`에 이미 병합됐다. 2026-10-28 승인된 리뷰 보완은 최신 main에서 `codex/v02-d01-review-fixes`로 분리해 후속 PR로 전달한다. 기존 검증본과 실행 코드가 같음을 비교했으며 후속 전달 상태는 저장소 PR 기록을 따른다.


2026-10-28 PR #41의 추가3건은 제한된 파서 종료/복구·배포 전 실제 CHECK 호환성 검사·개별 재현 명령으로 보완했다. 이번 검증은 API352·배포22·기존 D01 DB17·신규 업그레이드 시나리오1=392개이며 이전550개와 합산하지 않는다. [대응 기록](docs/implementation/v0.2-d01-pr41-review-response.md)을 따른다. 사용자는 완료 후 commit/push·PR 댓글 등록까지 요청했다.


2026-10-29 PR #41 병합 후 main `29eea00`을 동기화하고 `codex/v02-d02-file-management`에서 D02 보호된 파일 등록/목록/교체/삭제·제품 내 참조 API를 구현했다. 시작/주기 정리·불확실 커밋 원본 보존·tombstone/열 권한도 연결했다. D03의 비동기 실행 예약·요청 ID·수동 재시도와 D04의 벡터/검색 가능 상태는 아직 미구현이다. 현재 API는 한 요청에1파일이며 일괄 UI는 D03/G에서 연결한다. [D02 기록](docs/implementation/v0.2-d02-file-management.md)을 따른다. 2026-10-29 사용자가 커밋·푸시·main 대상 PR 생성을 승인했다. 전달 결과는 저장소 PR 기록을 따른다.


2026-10-31 PR #42 리뷰5건은 fixture 전제 검사·원본 참조 경합·업로드 별칭·DELETE 본문·디렉터리 ENOENT 처리로 보완했다. 이번 자동 검증은 API410·배포24·D02 실제 DB26=460개이며 최초495개와 합산하지 않는다. [대응 기록](docs/implementation/v0.2-d02-review-response.md)을 따른다. 사용자는 수정 완료 후 commit/push·PR 댓글 등록을 승인했다.


2026-10-31 PR #42는 main `577aec3`으로 병합·동기화했다. `codex/v02-d03-ingestion-runs`에서 D03 실행 관리·DB 대기/중복/중단/재시도·재시작 중단 식별을 구현했다. 등록/교체는 요청 UUID와202 실행 ID로 접수하며 조회·재시도가 HTTP 연결 수명에 의존하지 않는다. 최종 자동557개(API419·배포24·D0320·D0226·권한68)와 별도 실제 runtime SIGKILL 재시작/명시 재시도·구버전 자료 업그레이드 보존을 확인했다. [D03 기록](docs/implementation/v0.2-d03-file-runs.md)을 따른다. D04 벡터/임베딩·G 웹·I 전체 보관/복구는 후속이다. 사용자 승인 후 `ac1535b`를 commit/push하고 main 대상 [PR #43](https://github.com/Hugekyung/townbase/pull/43)으로 전달했다.


2026-10-31 PR #43 리뷰14건은 종료 중 접수/준비 중 취소·재처리 재시도/성공 추출 보존·복합 FK/상태 CHECK·HTTP/시간 제한·문서 정합성으로 보완했다. 최종572개(API420·배포24·D03 DB34·D02 DB26·권한68)와 초기 D03 데이터의 후속 migration 보존을 확인했다. [대응 기록](docs/implementation/v0.2-d03-review-response.md)을 따른다. 사용자는 이번 후속 보완의 commit/push·PR 수정 내용 댓글 등록을 승인했다. 전달 결과는 PR #43 기록을 따른다.


2026-10-31 PR #43을 main dac7e8f로 병합·동기화했다. codex/v02-d04-file-indexing에서 D04의 명시 색인·위치 보존 분할·고정 임베딩 호출·FileIndex/Chunk 저장·최신 자료 내부 검색·중복 임베딩 방지·source/run/비용 경계를 연결했다. 질문/답변·웹은 E/G, 전체 벡터 물리 정리/파생 참조·복구는 D05/I 후속이다. 구현·검증·저장소 전달 상태는 [D04 기록](docs/implementation/v0.2-d04-file-indexing.md)을 따른다.

D04 최종 검증은 중복 제외681개(API435·배포24·DB 단위20·D04 DB31·D03 DB34·D02 DB26·C01 DB41·권한70)다. 별도 실제 production 이미지의 로그인/파일 재조회/미설정 색인 차단 및 D03 기존 데이터의 실제 migration 보존을 확인했다. 유료 호출/실검색 품질 수락은 수행하지 않았다. [환경·검증 한계](docs/implementation/v0.2-d04-file-indexing.md)를 따른다. 사용자는 이번 D04 commit/push·main PR 생성을 승인했다. 전달 결과는 저장소 PR 기록을 따른다.


## D05 파일 생명주기 진행 (2026-11-01)

PR #44를 main bb5dae6으로 동기화하고 codex/v02-d05-file-lifecycle에서 범위 제외/재포함·색인 순번 검증·삭제/교체 정리·버전 고정 참조·실행 이력 출처 상태를 구현한다. 기존 범위/기술 선택을 유지하며 백업/복구는 I, 실제 대화/Gap/첨부 결과의 저장·렌더 연결은 E/F에서 완료한다. [D05 기록](docs/implementation/v0.2-d05-file-lifecycle.md)을 따른다. 사용자는 로컬 구현·검증 요약 확인 후 커밋·푸시·main 대상 PR 생성을 승인했다. 전달 결과는 저장소 PR 기록을 따른다.

D05 로컬 검증은 자동673개(API453·배포24·DB 단위20·D04/D05 DB46·D03 DB34·D02 DB26·권한70) 통과다. 별도 실제 D04→D05 migration 자료 보존·운영 이미지 HTTP 생명주기/재시작 재조회를 확인했다. 첨부/대화/Gap의 실제 파생 저장·과거 결과 가림은 E/F, 백업/별도 삭제 기록·복구는 I 후속이다. 이전 검증을 합산하지 않으며 상세 환경/한계는 D05 기록을 따른다.


PR #45 리뷰 보완(2026-11-01)은 실행의 sourceScopeRevision 실제 저장·접수/완료 경합 검사·목록/상세/요청 UUID 조회의 과거 출처 비노출·불명확한 과거 행 NULL 이관과 문서 표현 정정이다. 중복 제외682개 및 실제 D05→후속 migration 데이터 보존을 확인했다. [PR #45 검증·한계](docs/implementation/v0.2-d05-file-lifecycle.md#pr-45-리뷰-대응-2026-11-01-로컬-수정)를 따르며 사용자는 이번 수정의 커밋/푸시/댓글 등록을 승인했으며 전달 결과는 PR #45 기록을 따른다.
