# ADR-002: Answerability threshold calibration

## Status

Accepted for the current PoC corpus

## Context

townbase는 벡터 검색 결과가 있어도 검색 점수가 기준보다 낮으면 `isAnswerable = false`로 판정하고, MCP 응답의 `sourcePacket`을 비운다. 초기 기준은 다음과 같았다.

```text
minimumTopScore = 0.65
minimumAverageTopThreeScore = 0.55
```

Keeply 문서를 `evaluation_2` workspace에 색인한 뒤 실제 질문을 실행한 결과, 질문과 직접 관련된 문서가 검색되었지만 초기 기준을 넘지 못해 정상 질문이 답변 불가로 처리되는 현상이 확인되었다.

## Decision

현재 PoC의 answerability 기준을 다음과 같이 적용한다.

```text
minimumTopScore = 0.45
minimumAverageTopThreeScore = 0.4
```

두 조건을 모두 만족하고 검색 source가 하나 이상일 때만 검색 결과를 답변 가능한 근거로 취급한다.

## Evidence

`text-embedding-3-small`, 1536차원, `evaluation_2` workspace에서 확인한 대표 score는 다음과 같다.

| 질문 유형 | 1위 문서 | Top-1 score | 상위 3개 평균 | 초기 기준 결과 | 변경 기준 결과 |
| --- | --- | ---: | ---: | --- | --- |
| 설정 화면의 OS 알림 권한 표시 | 알림 권한·문구·설정 화면 UX 정책 | 0.5657 | 0.5270 | 거절 | 허용 |
| 과거 수행 이력의 마지막 수행일 필드 | 최신 수행일과 예정일 계산 | 0.4828 | 약 0.455 | 거절 | 허용 |
| Reminder 대상 날짜 조건 | Reminder 대상 선정 정책과 제외 규칙 | 0.4877 | 약 0.452 | 거절 | 허용 |

초기 기준은 관련 문서가 존재하는 정상 질문을 과도하게 거절했다. 변경 기준은 현재 PoC 질문의 score 분포를 반영한 시작값이다.

## Rationale

answerability threshold에 모든 RAG 시스템에 공통으로 적용되는 고정값은 없다. 임베딩 모델, 문서 종류, chunk 크기, 질문 유형, corpus의 주제 집중도에 따라 cosine similarity score 분포가 달라진다.

따라서 threshold는 다음 평가 결과를 기준으로 조정한다.

1. 정상 질문의 관련 문서가 검색되는 비율(Recall 또는 Hit@K)
2. 근거 없는 질문이 답변 가능한 것으로 통과하는 비율(False Positive)
3. 정상 질문이 답변 불가로 거절되는 비율(False Negative)
4. 실제 source 내용이 질문에 답할 수 있는지에 대한 수동 검토

정상 질문이 자주 거절되면 threshold를 낮추고, 관련 없는 문서가 근거로 통과하면 threshold를 높인다. 단순히 답변 수만 늘리는 방향으로 조정하지 않고, 정상 질문과 근거 없는 질문의 score 분포가 겹치는지도 함께 확인한다.

## Consequences

- 현재 Keeply PoC 질문의 검색 근거가 MCP `sourcePacket`으로 전달될 가능성이 높아진다.
- threshold를 낮춘 만큼 관련성이 낮은 문서가 통과할 위험이 증가한다.
- 현재 값은 운영 환경의 최종 기준이 아니라 현재 corpus에 대한 provisional calibration 값이다.
- corpus, embedding model, dimensions, chunking 설정, topK가 바뀌면 threshold를 다시 평가해야 한다.

## Recalibration trigger

다음 상황에서는 threshold를 다시 측정한다.

- 정상 질문이 반복적으로 `isAnswerable = false`가 되는 경우
- 근거와 관계없는 source가 답변 근거로 자주 전달되는 경우
- 문서 수 또는 질문 세트가 크게 늘어난 경우
- embedding model, chunking 설정, topK를 변경한 경우
- Hit@5, MRR, False Positive, False Negative가 이전 측정과 크게 달라진 경우

