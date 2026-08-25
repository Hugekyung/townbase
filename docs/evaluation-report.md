# TASK-107 평가 보고서

- 작성 시각: 2026-08-24T09:55:43.464Z
- Corpus: 6개 문서, Embedding=text-embedding-3-small, 1536차원
- Embedding 모델 비교: 제외 (고정 정책)
- 기준 Chunking: 600/80

## 평가 지표

- Citation Precision: 33.3% (정상 질문의 topK 결과 기준)
- Answerability Accuracy: 20.0% (현재 threshold 0.65/0.55 기준)
- 평가 전용 provisional threshold 0.35/0.3 Accuracy: 100.0%
- provisional Accuracy는 기대 문서의 topK 검색 여부를 검증하지 않고 threshold 판정만 측정한다.
- 기대 문서가 topK에 포함되지 않은 정상 질문: 3/10개

## 실패 질문 및 원인

| ID | 기대 Answerable | 원인 |
| --- | --- | --- |
| onboarding-001 | true | threshold 판정과 기대 Answerable 불일치 |
| onboarding-002 | true | threshold 판정과 기대 Answerable 불일치 |
| onboarding-003 | true | threshold 판정과 기대 Answerable 불일치 |
| product-history-001 | true | threshold 판정과 기대 Answerable 불일치 |
| implementation-001 | true | 기대 문서가 topK 검색 결과에 없음 |
| implementation-002 | true | 기대 문서가 topK 검색 결과에 없음 |
| multi-document-001 | true | 기대 문서가 topK 검색 결과에 없음 |
| multi-document-002 | true | threshold 판정과 기대 Answerable 불일치 |

## 결론 및 보류 사항

| 구분 | Chunking | Embedding | Hit@5 | MRR |
| --- | --- | --- | ---: | ---: |
| Vector Only baseline | 600/80 | text-embedding-3-small / 1536차원 | 60.0% | 0.3667 |
| Chunking 비교 | 400/50, 600/80, 800/100 | text-embedding-3-small / 1536차원 | 모두 60.0% | 모두 0.3667 |

- 현재 Corpus와 Golden Question 규모가 작아 threshold 최종값은 확정하지 않았다.
- 기존 threshold는 정상 질문을 과도하게 거절하므로 추가 평가 데이터로 재검토해야 한다.
- provisional threshold는 평가용 참고값일 뿐 운영 코드에는 적용하지 않았다.
- Chunking 비교는 세 설정 모두 53개 Chunk, Hit@5 60.0%, MRR 0.3667로 차이가 없었다.
- 상세 질문별 score와 설정별 원자료는 `docs/evaluation/task-107-vector-only-baseline.md`에 기록했다.
