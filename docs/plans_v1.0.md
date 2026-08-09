# Townbase v1.0 권장 개발 계획

> 상태: 검토용 초안
>
> 목표: Notion·Slack·GitHub의 근거를 연결해 신뢰할 수 있는 답변을 제공하는 local-first, self-hosted 초기 서비스

## 1. v1.0 목표

Townbase v1.0의 목표는 기능 수를 늘리는 것이 아니다. 하나의 실제 질문을 수집부터 답변까지 끝까지 처리하고, 그 결과가 맞는지 다시 확인할 수 있게 만드는 것이다.

대표 검증 질문:

> 결제 중복 처리 정책이 왜 현재 구조로 결정됐고, 관련 구현과 최근 논의 내용은 무엇인가?

목표 처리 흐름:

```text
질문 수신
→ 의도와 필요한 근거 분류
→ Notion 설계 문서 검색
→ Slack 의사결정 대화 검색
→ GitHub PR·Issue 검색
→ 검색 결과 결합과 재정렬
→ 근거 충분성 검사
→ 답변 생성
→ 문장별 출처 링크 제공
→ 검색·답변·비용·시간 로그 저장
```

v1.0은 LangChain이나 LangGraph 도입 자체를 목표로 하지 않는다. 현재 TypeScript 구조를 유지하면서 검색 품질, 답변 신뢰성, 운영 가능성, 평가 가능성을 먼저 완성한다.

## 2. v1.0 서비스 범위

### 포함

- Notion 문서 수집과 증분 색인
- Slack 채널·스레드·답글 읽기 전용 수집
- GitHub Issue·PR·댓글·변경 파일 읽기 전용 수집
- 로컬 Git 문서 수집
- metadata 기반 retrieval mode
- Vector Search와 문자 검색을 결합한 Hybrid Search
- 근거 기반 답변과 출처 링크
- 근거 부족 시 부분 답변 또는 답변 보류
- Knowledge Gap과 Draft 저장
- 검색·답변·모델·비용·시간 추적
- workspace 데이터 경계 강제
- MCP 중심의 self-hosted 사용 방식

### v1.0에서 제외

- 멀티테넌트 SaaS
- Web UI
- 사용자별 Notion·Slack 권한의 완전한 복제
- 전체 소스 코드 색인
- 실제 GitHub Issue 또는 Notion 페이지 자동 생성
- 승인 없는 외부 쓰기 작업
- Redis/BullMQ 기반 분산 worker 시스템
- 자유형 범용 Agent

GitHub의 "관련 구현"은 v1.0에서 PR 본문, 댓글, 변경 파일 경로, 제한된 diff 근거까지로 본다. 전체 코드 의미 분석은 후속 범위로 둔다.

## 3. 개발 원칙

1. 평가 데이터를 먼저 만든다. 측정 없이 chunk, 검색기, reranker를 바꾸지 않는다.
2. 출처 없는 답변을 허용하지 않는다. 근거가 부족하면 답변을 보류한다.
3. retrieval mode는 실제 DB filter, source priority, prompt, 답변 형식에 모두 영향을 줘야 한다.
4. 외부 연동은 기본적으로 읽기 전용으로 시작한다.
5. sync와 질문 실행 결과는 DB에서 다시 확인할 수 있어야 한다.
6. 로컬 PostgreSQL 중심 구조를 유지하고 새 인프라는 꼭 필요할 때만 추가한다.
7. 각 Phase는 별도 계획과 Momus 검토를 통과한 뒤 구현한다.

## 4. Phase별 개발 계획

## Phase 0. 실행 기준선 복구와 v1.0 범위 확정

### 목표

현재 저장소를 실제로 실행·검증할 수 있는 상태로 복구하고, v1.0의 공식 범위를 확정한다.

### 핵심 작업

- production start 시 패키지 진입점이 컴파일 산출물을 사용하도록 수정
- 깨진 connector 테스트와 오래된 import 정리
- PostgreSQL을 격리해 실행하는 통합 테스트 환경 구성
- README와 AGENTS의 오래된 현재 상태 설명 갱신
- v1.0 PRD와 TASK 작성
- Slack·GitHub·Queue·workspace 보안 경계를 공식 범위에 반영
- 대표 질문 30~50개와 기대 근거 정의
- 현재 검색·답변 품질의 baseline 측정

### 완료 기준

- 새 환경에서 `install → build → migrate → start → health`가 성공한다.
- 전체 단위·통합 테스트가 통과한다.
- 대표 질문마다 기대 mode, 기대 문서, 기대 답변 가능 여부가 정의돼 있다.
- 이후 개선 결과를 baseline과 비교할 수 있다.

## Phase 1. 실제 Q&A 경로 완성

### 목표

현재 scaffold 상태인 질문 경로를 실제 근거 기반 답변 경로로 완성한다.

### 핵심 작업

- 실제 LLM completion adapter 구현
- LLM 응답을 검증할 구조화된 schema 정의
- 한국어 질문을 포함한 `auto` mode 규칙 보완
- `sourceType`, `knowledgeTypes`, `domainTags`, `status`, `sourcePriority` filter를 실제 검색 SQL에 연결
- mode별 topK와 score threshold 적용
- 질문, 검색 결과, 답변, Knowledge Gap을 하나의 trace로 저장
- 근거가 없거나 약할 때 답변을 보류하는 정책 구현
- prompt, model, embedding model, retrieval config version 저장

### 완료 기준

- Notion과 로컬 Git 자료만으로도 실제 출처 기반 답변을 생성한다.
- mode마다 검색 대상과 답변 형식이 실제로 달라진다.
- 근거가 부족하면 `isAnswerable=false` 또는 동등한 답변 보류 상태가 저장된다.
- 질문 당시의 검색 결과와 답변을 DB에서 다시 읽을 수 있다.

## Phase 2. Slack·GitHub 읽기 전용 수집

### 목표

대표 시나리오에 필요한 최근 논의와 구현 이력을 검색 가능한 문서로 만든다.

### 핵심 작업

- Slack channel allowlist와 GitHub repository allowlist 설정
- Slack 채널·스레드·답글 connector 구현
- GitHub Issue·PR·댓글·변경 파일 connector 구현
- source URL, 작성자 식별자, 생성·수정 시각, thread 관계 보존
- 원본 ID 기반 idempotent upsert
- cursor, updated timestamp, content hash 기반 증분 sync
- 삭제·archived·권한 상실 상태 처리
- 비밀 정보, 대용량 diff, 생성 파일 제외 정책 적용
- 외부 API rate limit과 retry 신호 기록

### 완료 기준

- 같은 sync를 두 번 실행해도 중복 row가 생기지 않는다.
- 변경된 항목만 다시 chunking·embedding 된다.
- 삭제되거나 접근할 수 없어진 원본은 명시적인 상태로 전환된다.
- 모든 Slack·GitHub 검색 결과가 원본 permalink를 가진다.
- connector 하나가 실패해도 실패 원인과 대상이 sync 결과에 남는다.

## Phase 3. 검색 품질 개선

### 목표

질문에 필요한 정답 문서와 근거를 안정적으로 찾는다.

### 핵심 작업

- 평가 harness 구현
- chunk 크기와 overlap 조합 비교
- pgvector 기반 semantic search 유지
- PostgreSQL Full Text Search 기반 문자 검색 추가
- Vector와 문자 검색 결과를 RRF로 결합
- metadata pre-filter 적용
- source별 후보 다양화와 중복 제거
- freshness, status, source priority 반영
- 넓은 후보군을 검색한 뒤 최종 topK로 축소
- reranker를 실험하고 평가 개선이 확인될 때만 기본 경로에 적용

### 측정 지표

- Document Recall@5, Recall@10
- Evidence Recall@K
- MRR 또는 첫 정답 문서 순위
- 필수 source coverage
- 검색 p50, p95
- 질문당 검색 비용

### 초기 완료 목표

- 전체 평가 세트의 Document Recall@10이 90% 이상이다.
- 대표 결제 정책 시나리오의 필수 source coverage가 100%다.
- deprecated 또는 archived 문서의 잘못된 우선 선택이 없다.
- 검색 품질 개선 전후 수치가 동일한 평가 데이터로 비교된다.

## Phase 4. 답변 신뢰성과 Agent Workflow 완성

### 목표

검색한 근거만 사용해 답변하고, 실패와 부분 성공을 숨기지 않는다.

### 권장 상태 전이

```text
RECEIVED
→ CLASSIFIED
→ PLANNED
→ RETRIEVING
→ RERANKED
→ GENERATED
→ VALIDATED
→ PERSISTED
```

실패·보류 상태:

```text
RETRY_WAIT / PARTIAL / ABSTAINED / FAILED
```

### 핵심 작업

- 질문에서 필요한 근거 종류와 조회 source 결정
- Notion·Slack·GitHub 조회의 병렬 실행
- connector별 timeout, 제한된 retry, partial failure 처리
- 핵심 문장마다 citation 번호 연결
- citation이 실제 검색 chunk를 가리키는지 검증
- 답변 상태를 `answered`, `partial`, `abstained` 수준으로 구분
- 충돌하는 문서와 오래된 문서를 답변에 명시
- 질문 당시 근거 제목, URL, 내용 또는 hash snapshot 보존
- 환각, 잘못된 출처, 오래된 출처, 근거 부족 회귀 테스트 작성

### 완료 기준

- 출처 없는 핵심 주장이 없다.
- 존재하지 않는 링크나 검색하지 않은 출처를 인용하지 않는다.
- 필수 근거가 빠지면 완전한 답변처럼 표시하지 않는다.
- 한 connector가 실패해도 전체 상태와 빠진 근거를 알 수 있다.
- 재색인 이후에도 과거 질문의 근거 trace가 사라지지 않는다.

## Phase 5. 운영 안정성과 보안 기반

### 목표

수집과 질문 실행을 반복적으로 운영하고 문제를 추적할 수 있게 만든다.

### 핵심 작업

- PostgreSQL 기반 sync job queue 도입
- Job 상태, 시도 횟수, 다음 실행 시각, 오류 저장
- exponential backoff와 jitter 적용
- 429, 일시적 5xx, network timeout만 재시도
- provider·workspace별 동시 실행 제한
- content hash가 같으면 재chunk·재embedding 생략
- `indexStatus=failed` 문서 재시도
- sync 중 프로세스가 종료돼도 작업 재개
- workspace를 요청 body가 아닌 인증·실행 context에서 결정
- workspace가 다른 데이터 접근 차단
- secret masking과 민감 로그 차단
- 단계별 latency, token usage, model, 비용 저장
- Job과 Question 실행 상태 조회 API 제공

### 완료 기준

- 프로세스 재시작 후 미완료 sync를 안전하게 재개한다.
- 같은 sync job의 중복 실행을 막는다.
- 다른 workspace 데이터에 접근할 수 없다.
- 질문 한 건의 검색 시간, 생성 시간, token, 비용을 확인할 수 있다.
- 실패한 작업의 원인과 마지막 성공 시각을 확인할 수 있다.

## Phase 6. 대표 시나리오 증명과 v1.0 릴리스

### 목표

실제 데이터와 실제 서비스 경로로 Townbase v1.0의 사용 가능성을 증명한다.

### 대표 시나리오 통과 조건

- 질문이 `product_history` 또는 동등한 복합 검색 계획으로 분류된다.
- Notion에서 정책·설계 근거를 찾는다.
- Slack에서 최근 논의와 결정 근거를 찾는다.
- GitHub에서 관련 PR·Issue와 변경 파일을 찾는다.
- 결과가 mode, source priority, freshness에 따라 재정렬된다.
- 답변의 핵심 주장마다 실제 원본 링크가 표시된다.
- 필수 근거가 없으면 부분 답변 또는 답변 보류로 처리된다.
- 검색 결과, 최종 답변, latency, token, 비용이 저장된다.
- 같은 평가 데이터와 설정으로 결과를 재현할 수 있다.

### 릴리스 문서

- 전체 아키텍처 다이어그램
- 데이터 수집 및 인덱싱 흐름
- 검색 전략 선택 이유와 비교 결과
- Agent 상태 전이
- 실패 및 재시도 정책
- 권한·보안 설계와 신뢰 경계
- 평가 데이터 구성과 개선 전후 수치
- 비용 및 응답속도
- 알려진 한계와 후속 개선점

## 5. 평가 데이터 구성

초기 평가 세트는 30~50개 질문으로 구성한다.

| 분류               | 권장 수량 | 목적                                 |
| ------------------ | --------: | ------------------------------------ |
| onboarding         |        10 | 환경 설정, 학습 순서, 운영 문서 검색 |
| product history    |        15 | 정책·설계 배경과 변경 이유 검색      |
| 구현·히스토리 복합 |        10 | Notion·Slack·GitHub 교차 검색        |
| documentation gap  |         5 | 문서 부족 감지와 Gap 저장            |
| 답변 불가          |      5~10 | 환각 방지와 답변 보류 검증           |

각 질문은 아래 정답 정보를 가진다.

- 기대 retrieval mode
- 반드시 포함할 문서와 source type
- 핵심 답변 요점
- 허용하지 않을 주장
- 기대 답변 가능 상태
- 평가용 근거 링크

## 6. v1.0 최종 완료 기준

Townbase v1.0은 아래 조건을 모두 만족할 때 완료로 본다.

1. 새 환경에서 설치, DB 준비, build, start, health check가 성공한다.
2. Notion·Slack·GitHub·로컬 Git sync가 실제로 동작한다.
3. 증분 sync와 실패 재시도가 실제 DB 상태로 검증된다.
4. 대표 질문이 세 source의 근거를 사용해 답변된다.
5. 핵심 주장마다 유효한 출처 링크가 있다.
6. 근거가 부족한 질문은 답변을 만들지 않거나 부분 답변으로 표시한다.
7. 질문과 검색 trace가 재색인 이후에도 유지된다.
8. 평가 전후 검색·답변 품질 수치가 저장된다.
9. p50·p95 응답 시간과 질문당 비용이 측정된다.
10. workspace 경계와 읽기 전용 권한 정책이 테스트로 검증된다.
11. 전체 자동 테스트와 대표 시나리오 수동 QA가 통과한다.
12. 아키텍처, 운영, 보안, 평가, 한계 문서가 실제 구현과 일치한다.

## 7. 구현 전 확정이 필요한 결정

각 Phase의 상세 계획을 작성하기 전에 다음 항목을 제품 결정으로 확정해야 한다.

- GitHub PR diff를 어느 크기와 파일 범위까지 수집할지
- Slack에서 수집을 허용할 채널과 보존 기간
- PostgreSQL 문자 검색으로 시작할지, 정확한 BM25 엔진을 추가할지
- reranker를 외부 API로 사용할지, 로컬 모델로 운영할지
- 한 설치를 하나의 신뢰 구역으로 볼지, 사용자별 권한까지 요구할지
- 외부 쓰기 기능을 v1.x 중 어느 시점에 추가할지

이 결정은 임의 기본값으로 구현하지 않는다. Phase별 `.omo` 계획에서 선택 사항과 영향을 정리하고, Momus 검토를 통과한 뒤 구현한다.
