# @townbase/agent-core

기존 출처 기반 prompt/context/citation 계약과 self-hosted 기본 Agent 설정·질문·종료 결과 타입을 제공한다. 소비자는 빌드된 dist를 사용한다.

`parseBasicAgentQuestion`은 UUID v4·지원 mode·질문 4,000 Unicode code point 한도를 검사한다. 원문을 자르지 않으며 임의 첨부 입력은 받지 않는다. 이 parser와 결과 타입은 실제 모델 실행·결과/Gap 저장을 수행하지 않는다.
