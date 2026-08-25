# Retrieval evaluation fixtures

이 디렉터리는 TASK-107의 Vector Only baseline과 이후 Chunking·Embedding 비교에
공통으로 사용하는 평가 입력이다.

- Corpus manifest: `corpus.json`
- Golden questions: `golden-questions.json`
- Corpus 문서의 `contentHash`는 manifest 작성 시점의 SHA-256 값이다.
- 질문의 정답은 Chunk ID가 아니라 문서 경로와 Section 기준으로 기록해 Chunking 설정이
  바뀌어도 같은 Dataset을 재사용한다.

평가 실행 Runner는 TASK-301에서 구현한다. 그 전까지는 이 Dataset을 운영 질문과
섞지 않고 fixture 입력으로만 관리한다.
