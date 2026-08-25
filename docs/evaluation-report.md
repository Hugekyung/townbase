# Keeply RAG 평가 보고서

이 문서는 Keeply 문서와 MCP 질문을 기준으로 한 공식 RAG 평가의 요약본이다.

## 평가 범위

- 평가 문서: Keeply `Document` 21개
- 평가 질문: Golden Question 23개
- 평가 workspace: `evaluation_2`
- 질문 모드: `auto`

## 핵심 결과

- 최종 답변 성공: `23/23 (100%)`
- 현재 RAG source만으로 정답 문서를 찾은 비율: `17/23 (73.9%)`
- `sourcePacket` 반환: `17/23 (73.9%)`
- Agent 이전 문맥 보정이 필요했던 문항: `6/23 (26.1%)`
- 기대 결론 오답 및 비밀값 생성: `0건`

최종 답변 성공률과 RAG 검색 성공률은 분리해 해석해야 한다. sourcePacket이 없는
질문은 Agent의 이전 문맥에 따라 답변 가능 여부가 달라질 수 있으므로, RAG 자체의
재현 가능한 성능으로 집계하지 않는다.

## 상세 평가 기록

질문별 결과, 실패 원인, answerability 오판 분석은
[evaluation-20260825.md](../evaluation-20260825.md)에서 확인한다.

이 문서에는 공식 Keeply 평가만 기록하며, 개발 중 사용한 별도 테스트 데이터와
fixture 실행 결과는 공식 평가 수치에 포함하지 않는다.
