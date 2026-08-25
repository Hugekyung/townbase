# TASK-107 Vector Only baseline 테스트 기록

> 이 문서는 개발용 평가 Runner의 내부 기록이다. 공식 Keeply 평가 범위와 결과는
> [evaluation-20260825.md](../../evaluation-20260825.md)와 [evaluation-report.md](../evaluation-report.md)를 기준으로 한다.

## 테스트 목적

현재 기본 설정을 고정한 상태에서 평가 Corpus 6개를 색인하고 Golden Question 10개를
Vector Only 검색해 baseline을 만든다.

## 공통 조건

- Corpus: `fixtures/evaluation/corpus.json`
- 질문: `fixtures/evaluation/golden-questions.json`
- Chunking: `maxTokens=600`, `overlapTokens=80`
- Embedding: `text-embedding-3-small`, 1536차원
- 검색 방식: 질문 Embedding 생성 후 pgvector cosine similarity 검색
- 검색 범위: `topK=5`
- 기록 지표: Hit@5, MRR, Chunk 수, 질문별 latency, 검색 결과 문서 경로·score
- 평가 전용 Workspace: `evaluation-workspace`

## 테스트 001. Vector Only baseline 실행

### 진행 내용

- 평가 전용 Runner 추가: `apps/api/src/evaluation/task-107-vector-only-baseline.ts`
- 실행 명령 추가: `pnpm --filter @townbase/api evaluation:task-107`
- Runner가 수행하는 작업:
  1. 평가 전용 Workspace와 DataSource를 준비한다.
  2. Corpus 문서를 DB에 upsert한다.
  3. 기존 평가 문서 Chunk를 교체한다.
  4. 현재 Chunking 설정으로 재생성한다.
  5. OpenAI Embedding을 생성해 Vector DB에 저장한다.
  6. Golden Question 10개를 각각 topK=5로 검색한다.
  7. Hit@5, MRR, latency, 질문별 검색 결과를 이 파일에 기록할 수 있는 보고서로 생성한다.
- TypeScript build 검증 완료:
  - `pnpm --filter @townbase/connectors build`
  - `pnpm --filter @townbase/api build`

### 실행 상태

- 상태: **완료**
- 최초 실행에서는 Chunk row를 생성하지 않고 Embedding UPDATE를 수행해 `affectedRows=0` 오류가 발생했다.
- Runner가 Chunk를 DB에 먼저 생성하도록 수정한 뒤 동일 조건으로 재실행했고, 실제 결과를 아래에 기록했다.

### 재개 조건

1. OpenAI에서 기존 키를 폐기한다.
2. 새 키를 발급해 로컬 `.env`의 `OPENAI_API_KEY`만 교체한다.
3. 키를 채팅이나 터미널 출력에 노출하지 않는다.
4. 아래 명령을 실행한다.

```bash
pnpm --filter @townbase/api evaluation:task-107
```

실행이 끝나면 Runner가 이 파일에 실행 결과 섹션을 추가한다.

## 실행 결과 2026-08-24T08:42:11.312Z

- 실행 시각: 2026-08-24T08:42:11.313Z
- Corpus: 6개 문서, 53개 Chunk
- Chunking: maxTokens=600, overlapTokens=80
- Embedding: text-embedding-3-small, 1536차원
- 질문 수: 10개
- Hit@5: 6/10 (60.0%)
- MRR: 0.3667
- 평균 검색 latency: 167.4ms
- Answerable 질문 평균 latency: 162.6ms

## 질문별 결과

| ID | Answerable | 첫 관련 결과 순위 | Latency | Top 결과 문서 |
| --- | --- | ---: | ---: | --- |
| onboarding-001 | true | 2 | 183.8ms | docs/local-dogfooding/README.md |
| onboarding-002 | true | 3 | 138.1ms | docs/local-dogfooding/README.md |
| onboarding-003 | true | 3 | 141.1ms | README.md |
| product-history-001 | true | 1 | 127.3ms | README.md |
| implementation-001 | true | - | 151.1ms | docs/local-dogfooding/README.md |
| implementation-002 | true | - | 221.4ms | README.md |
| implementation-003 | true | 2 | 159.3ms | README.md |
| multi-document-001 | true | - | 171.0ms | README.md |
| multi-document-002 | true | 1 | 170.1ms | README.md |
| unanswerable-001 | false | - | 210.7ms | README.md |

## 전체 검색 결과(JSON)

```json
[
  {
    "id": "onboarding-001",
    "question": "로컬에서 townbase를 실행하려면 어떤 순서로 준비해야 하나요?",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-first-execution.md"
    ],
    "answerable": true,
    "latencyMs": 183.84179200000017,
    "results": [
      {
        "rank": 1,
        "score": 0.41700794062094126,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 2,
        "score": 0.38640734297687307,
        "documentPath": "docs/local-first-execution.md",
        "chunkId": "2244053df357b222498c284dfd4ae33a7b54f420c243340ce5f80cc9cf55cdd1"
      },
      {
        "rank": 3,
        "score": 0.3807850886479405,
        "documentPath": "packages/database/README.md",
        "chunkId": "909171c02dddd8db19ce5bf4fb2628ce398f8d702c80219ef46ab807a915b973"
      },
      {
        "rank": 4,
        "score": 0.37141188521997437,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      },
      {
        "rank": 5,
        "score": 0.3632654308107075,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d62134e4da55d93e80ae6d8b5da3fddd6e31b5f6df73c7fb7d5afc4bd6f73aad"
      }
    ],
    "firstRelevantRank": 2
  },
  {
    "id": "onboarding-002",
    "question": "개발 환경에서 테스트를 실행하는 기본 명령은 무엇인가요?",
    "expectedDocumentPaths": [
      "README.md",
      "packages/rag-core/README.md"
    ],
    "answerable": true,
    "latencyMs": 138.1055839999999,
    "results": [
      {
        "rank": 1,
        "score": 0.4352625710572875,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 2,
        "score": 0.389697404249173,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d62134e4da55d93e80ae6d8b5da3fddd6e31b5f6df73c7fb7d5afc4bd6f73aad"
      },
      {
        "rank": 3,
        "score": 0.3699207936296709,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      },
      {
        "rank": 4,
        "score": 0.3603543383944824,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "4b052954d15aa028e360cb69e541194e1cd3642721001fd031fc6d25b2a17709"
      },
      {
        "rank": 5,
        "score": 0.3212415526783955,
        "documentPath": "packages/database/README.md",
        "chunkId": "629ccd1a5de960328cde841d34782ad8d182e3e24ecd88738e01d5da86efd445"
      }
    ],
    "firstRelevantRank": 3
  },
  {
    "id": "onboarding-003",
    "question": "local-first 실행 방식은 외부 SaaS 배포와 어떻게 다른가요?",
    "expectedDocumentPaths": [
      "docs/local-first-execution.md"
    ],
    "answerable": true,
    "latencyMs": 141.0957500000004,
    "results": [
      {
        "rank": 1,
        "score": 0.3932821207309567,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 2,
        "score": 0.35470968341529474,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 3,
        "score": 0.3490562890106679,
        "documentPath": "docs/local-first-execution.md",
        "chunkId": "54f4d7504e9a7c78471e29e3717c32f33b7ef489e7e8c52c3cdb577e041d7261"
      },
      {
        "rank": 4,
        "score": 0.34238831082661636,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d025dc0cd41d5e5f7c1ec3fb8d51527ef4840bed83aa9a17b663a051b07d83f9"
      },
      {
        "rank": 5,
        "score": 0.33941599543640266,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      }
    ],
    "firstRelevantRank": 3
  },
  {
    "id": "product-history-001",
    "question": "이 프로젝트가 Retrieval-first 구조를 선택한 이유는 무엇인가요?",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-dogfooding/README.md"
    ],
    "answerable": true,
    "latencyMs": 127.29020799999944,
    "results": [
      {
        "rank": 1,
        "score": 0.45756688509900645,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 2,
        "score": 0.4465787652390143,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 3,
        "score": 0.3986841184254969,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 4,
        "score": 0.36794528954508676,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 5,
        "score": 0.3462661369077249,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "927b01006922d2837fc65136536d69fa10b1cd91dc483949ca7f5442b0b21a53"
      }
    ],
    "firstRelevantRank": 1
  },
  {
    "id": "implementation-001",
    "question": "rag-core 패키지는 어떤 역할을 담당하나요?",
    "expectedDocumentPaths": [
      "packages/rag-core/README.md"
    ],
    "answerable": true,
    "latencyMs": 151.0572089999996,
    "results": [
      {
        "rank": 1,
        "score": 0.3573692981072014,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "fac1a2cfab7833303afcc52d8c0accf93df9cf584d4d2051eed16c1cc928cd16"
      },
      {
        "rank": 2,
        "score": 0.35231494709472233,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 3,
        "score": 0.3339288165731047,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 4,
        "score": 0.3176235466441295,
        "documentPath": "README.md",
        "chunkId": "8a1d468c7e90f119f78c3e2eb1fd097ba21c1b68540442b72a06357d876763d5"
      },
      {
        "rank": 5,
        "score": 0.3175516900111466,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "implementation-002",
    "question": "database 패키지는 RAG 흐름에서 어떤 데이터를 저장하나요?",
    "expectedDocumentPaths": [
      "packages/database/README.md"
    ],
    "answerable": true,
    "latencyMs": 221.43870799999968,
    "results": [
      {
        "rank": 1,
        "score": 0.35933954055293804,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 2,
        "score": 0.3385366144190398,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 3,
        "score": 0.30986383419346986,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "6a7029da48e799670f20654c593668919a21dd3ea61bc56f4e156db37637a3e8"
      },
      {
        "rank": 4,
        "score": 0.3063538887649886,
        "documentPath": "packages/connectors/README.md",
        "chunkId": "37b7bb8198c7b2d3daee73803b8dfe073f5da9f3485498012b4a3d09a27772dc"
      },
      {
        "rank": 5,
        "score": 0.30539487133692067,
        "documentPath": "README.md",
        "chunkId": "8a1d468c7e90f119f78c3e2eb1fd097ba21c1b68540442b72a06357d876763d5"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "implementation-003",
    "question": "Notion과 로컬 Git 문서 수집은 어느 패키지에서 담당하나요?",
    "expectedDocumentPaths": [
      "packages/connectors/README.md"
    ],
    "answerable": true,
    "latencyMs": 159.34637500000008,
    "results": [
      {
        "rank": 1,
        "score": 0.6606616369100483,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 2,
        "score": 0.573302749531472,
        "documentPath": "packages/connectors/README.md",
        "chunkId": "37b7bb8198c7b2d3daee73803b8dfe073f5da9f3485498012b4a3d09a27772dc"
      },
      {
        "rank": 3,
        "score": 0.5478371766308667,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 4,
        "score": 0.5228159863890417,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 5,
        "score": 0.5189755276423685,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      }
    ],
    "firstRelevantRank": 2
  },
  {
    "id": "multi-document-001",
    "question": "문서 수집부터 검색까지의 전체 데이터 흐름을 설명해 주세요.",
    "expectedDocumentPaths": [
      "packages/connectors/README.md",
      "packages/rag-core/README.md",
      "packages/database/README.md"
    ],
    "answerable": true,
    "latencyMs": 170.9802920000002,
    "results": [
      {
        "rank": 1,
        "score": 0.3936435667278859,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 2,
        "score": 0.35356952538115816,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 3,
        "score": 0.3422053668404075,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 4,
        "score": 0.33701196761096264,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 5,
        "score": 0.3267104532337024,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "multi-document-002",
    "question": "검색 결과가 외부 Agent의 답변 근거로 전달되는 과정을 설명해 주세요.",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-dogfooding/README.md"
    ],
    "answerable": true,
    "latencyMs": 170.0751249999994,
    "results": [
      {
        "rank": 1,
        "score": 0.4192477140137998,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 2,
        "score": 0.3739228829999348,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 3,
        "score": 0.34214710547990335,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "927b01006922d2837fc65136536d69fa10b1cd91dc483949ca7f5442b0b21a53"
      },
      {
        "rank": 4,
        "score": 0.3303798767678845,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 5,
        "score": 0.32531299808306646,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      }
    ],
    "firstRelevantRank": 1
  },
  {
    "id": "unanswerable-001",
    "question": "townbase의 2027년 매출 목표와 영업이익률은 얼마인가요?",
    "expectedDocumentPaths": [],
    "answerable": false,
    "latencyMs": 210.68358399999943,
    "results": [
      {
        "rank": 1,
        "score": 0.27737338703944836,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 2,
        "score": 0.26934862999495246,
        "documentPath": "packages/database/README.md",
        "chunkId": "909171c02dddd8db19ce5bf4fb2628ce398f8d702c80219ef46ab807a915b973"
      },
      {
        "rank": 3,
        "score": 0.26232529228322,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d0ec3166a5a595dee3b8c1f5356e2386cf304b15efc49ff3aaf8b940dbfcf88b"
      },
      {
        "rank": 4,
        "score": 0.2352212224051855,
        "documentPath": "packages/database/README.md",
        "chunkId": "fa115ff6ed6cea9aeff7c219415ea0294de49f4a534afadc4819332663ced902"
      },
      {
        "rank": 5,
        "score": 0.2275037985904842,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2cf4b4e8f68c403682648509aa0f73fc7abb4bcc48e8b8e8bb6823f449c6c78d"
      }
    ],
    "firstRelevantRank": null
  }
]
```

## 테스트 002. Chunking 설정 비교

### 조건

- 동일 Corpus 6개, Golden Question 10개, Embedding 모델 `text-embedding-3-small`, 1536차원, `topK=5`를 고정했다.
- 비교 설정은 `400/50`, `600/80` baseline, `800/100`이다.

### 결과

| 설정 | Chunk 수 | Hit@5 | MRR | 평균 검색 latency |
| --- | ---: | ---: | ---: | ---: |
| 400/50 | 53 | 60.0% | 0.3667 | 164.5ms |
| 600/80 | 53 | 60.0% | 0.3667 | 185.4ms |
| 800/100 | 53 | 60.0% | 0.3667 | 173.3ms |

### 해석

- 세 설정의 Chunk 수와 Hit@5·MRR은 동일했다.
- 현재 평가 문서의 Section 대부분이 세 설정의 최대 크기보다 짧아, 설정 변경에 따른 실질적인 분할 차이가 제한됐다.
- 따라서 이번 결과만으로 `400/50`, `600/80`, `800/100` 중 품질 우위를 판단할 수 없다.
- 더 긴 문서를 Corpus에 추가하는 것은 이번 최소 범위를 벗어나므로, 다음 단계에서 필요할 때 별도 평가 조건으로 결정한다.

## 실행 결과 2026-08-24T08:53:58.878Z

- 실행 시각: 2026-08-24T08:53:58.880Z
- Corpus: 6개 문서, 53개 Chunk
- Chunking: maxTokens=600, overlapTokens=80
- Embedding: text-embedding-3-small, 1536차원
- 질문 수: 10개
- Hit@5: 6/10 (60.0%)
- MRR: 0.3667
- 평균 검색 latency: 169.6ms
- Answerable 질문 평균 latency: 169.4ms

## 질문별 결과

| ID | Answerable | 첫 관련 결과 순위 | Latency | Top 결과 문서 |
| --- | --- | ---: | ---: | --- |
| onboarding-001 | true | 2 | 187.7ms | docs/local-dogfooding/README.md |
| onboarding-002 | true | 3 | 134.8ms | docs/local-dogfooding/README.md |
| onboarding-003 | true | 3 | 190.4ms | README.md |
| product-history-001 | true | 1 | 130.3ms | README.md |
| implementation-001 | true | - | 130.2ms | docs/local-dogfooding/README.md |
| implementation-002 | true | - | 180.2ms | README.md |
| implementation-003 | true | 2 | 211.6ms | README.md |
| multi-document-001 | true | - | 158.3ms | README.md |
| multi-document-002 | true | 1 | 200.8ms | README.md |
| unanswerable-001 | false | - | 171.6ms | README.md |

## 전체 검색 결과(JSON)

```json
[
  {
    "id": "onboarding-001",
    "question": "로컬에서 townbase를 실행하려면 어떤 순서로 준비해야 하나요?",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-first-execution.md"
    ],
    "answerable": true,
    "latencyMs": 187.74004100000002,
    "results": [
      {
        "rank": 1,
        "score": 0.417490124960352,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 2,
        "score": 0.38640734297687307,
        "documentPath": "docs/local-first-execution.md",
        "chunkId": "2244053df357b222498c284dfd4ae33a7b54f420c243340ce5f80cc9cf55cdd1"
      },
      {
        "rank": 3,
        "score": 0.38076023928334546,
        "documentPath": "packages/database/README.md",
        "chunkId": "909171c02dddd8db19ce5bf4fb2628ce398f8d702c80219ef46ab807a915b973"
      },
      {
        "rank": 4,
        "score": 0.37127014910815836,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      },
      {
        "rank": 5,
        "score": 0.3633214658089059,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d62134e4da55d93e80ae6d8b5da3fddd6e31b5f6df73c7fb7d5afc4bd6f73aad"
      }
    ],
    "firstRelevantRank": 2
  },
  {
    "id": "onboarding-002",
    "question": "개발 환경에서 테스트를 실행하는 기본 명령은 무엇인가요?",
    "expectedDocumentPaths": [
      "README.md",
      "packages/rag-core/README.md"
    ],
    "answerable": true,
    "latencyMs": 134.7768329999999,
    "results": [
      {
        "rank": 1,
        "score": 0.43434956085517373,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 2,
        "score": 0.38973257766472424,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d62134e4da55d93e80ae6d8b5da3fddd6e31b5f6df73c7fb7d5afc4bd6f73aad"
      },
      {
        "rank": 3,
        "score": 0.37002146263580826,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      },
      {
        "rank": 4,
        "score": 0.3603543383944824,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "4b052954d15aa028e360cb69e541194e1cd3642721001fd031fc6d25b2a17709"
      },
      {
        "rank": 5,
        "score": 0.32121769391143085,
        "documentPath": "packages/database/README.md",
        "chunkId": "629ccd1a5de960328cde841d34782ad8d182e3e24ecd88738e01d5da86efd445"
      }
    ],
    "firstRelevantRank": 3
  },
  {
    "id": "onboarding-003",
    "question": "local-first 실행 방식은 외부 SaaS 배포와 어떻게 다른가요?",
    "expectedDocumentPaths": [
      "docs/local-first-execution.md"
    ],
    "answerable": true,
    "latencyMs": 190.37270799999988,
    "results": [
      {
        "rank": 1,
        "score": 0.3929263348776071,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 2,
        "score": 0.3545678738125255,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 3,
        "score": 0.3490562890106679,
        "documentPath": "docs/local-first-execution.md",
        "chunkId": "54f4d7504e9a7c78471e29e3717c32f33b7ef489e7e8c52c3cdb577e041d7261"
      },
      {
        "rank": 4,
        "score": 0.3423744198882511,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d025dc0cd41d5e5f7c1ec3fb8d51527ef4840bed83aa9a17b663a051b07d83f9"
      },
      {
        "rank": 5,
        "score": 0.33959558297110826,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      }
    ],
    "firstRelevantRank": 3
  },
  {
    "id": "product-history-001",
    "question": "이 프로젝트가 Retrieval-first 구조를 선택한 이유는 무엇인가요?",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-dogfooding/README.md"
    ],
    "answerable": true,
    "latencyMs": 130.32933300000013,
    "results": [
      {
        "rank": 1,
        "score": 0.45756688509900645,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 2,
        "score": 0.44591400701077843,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 3,
        "score": 0.3980326203400939,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 4,
        "score": 0.36794528954508676,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 5,
        "score": 0.3462661369077249,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "927b01006922d2837fc65136536d69fa10b1cd91dc483949ca7f5442b0b21a53"
      }
    ],
    "firstRelevantRank": 1
  },
  {
    "id": "implementation-001",
    "question": "rag-core 패키지는 어떤 역할을 담당하나요?",
    "expectedDocumentPaths": [
      "packages/rag-core/README.md"
    ],
    "answerable": true,
    "latencyMs": 130.24466699999994,
    "results": [
      {
        "rank": 1,
        "score": 0.3573692981072014,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "fac1a2cfab7833303afcc52d8c0accf93df9cf584d4d2051eed16c1cc928cd16"
      },
      {
        "rank": 2,
        "score": 0.35231494709472233,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 3,
        "score": 0.33368583249548567,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 4,
        "score": 0.3176235466441295,
        "documentPath": "README.md",
        "chunkId": "8a1d468c7e90f119f78c3e2eb1fd097ba21c1b68540442b72a06357d876763d5"
      },
      {
        "rank": 5,
        "score": 0.3175327224843715,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "implementation-002",
    "question": "database 패키지는 RAG 흐름에서 어떤 데이터를 저장하나요?",
    "expectedDocumentPaths": [
      "packages/database/README.md"
    ],
    "answerable": true,
    "latencyMs": 180.16612499999974,
    "results": [
      {
        "rank": 1,
        "score": 0.35933954055293804,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 2,
        "score": 0.3385366144190398,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 3,
        "score": 0.30986383419346986,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "6a7029da48e799670f20654c593668919a21dd3ea61bc56f4e156db37637a3e8"
      },
      {
        "rank": 4,
        "score": 0.30642231358520045,
        "documentPath": "packages/connectors/README.md",
        "chunkId": "37b7bb8198c7b2d3daee73803b8dfe073f5da9f3485498012b4a3d09a27772dc"
      },
      {
        "rank": 5,
        "score": 0.30539487133692067,
        "documentPath": "README.md",
        "chunkId": "8a1d468c7e90f119f78c3e2eb1fd097ba21c1b68540442b72a06357d876763d5"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "implementation-003",
    "question": "Notion과 로컬 Git 문서 수집은 어느 패키지에서 담당하나요?",
    "expectedDocumentPaths": [
      "packages/connectors/README.md"
    ],
    "answerable": true,
    "latencyMs": 211.62175000000025,
    "results": [
      {
        "rank": 1,
        "score": 0.6604293238478122,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 2,
        "score": 0.5733273290580242,
        "documentPath": "packages/connectors/README.md",
        "chunkId": "37b7bb8198c7b2d3daee73803b8dfe073f5da9f3485498012b4a3d09a27772dc"
      },
      {
        "rank": 3,
        "score": 0.5478371766308667,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 4,
        "score": 0.5229897700392427,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 5,
        "score": 0.5189755276423685,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      }
    ],
    "firstRelevantRank": 2
  },
  {
    "id": "multi-document-001",
    "question": "문서 수집부터 검색까지의 전체 데이터 흐름을 설명해 주세요.",
    "expectedDocumentPaths": [
      "packages/connectors/README.md",
      "packages/rag-core/README.md",
      "packages/database/README.md"
    ],
    "answerable": true,
    "latencyMs": 158.31804099999954,
    "results": [
      {
        "rank": 1,
        "score": 0.3936435667278859,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 2,
        "score": 0.35356952538115816,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 3,
        "score": 0.34259498818765977,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 4,
        "score": 0.3370461345439094,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 5,
        "score": 0.32339359786254196,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "multi-document-002",
    "question": "검색 결과가 외부 Agent의 답변 근거로 전달되는 과정을 설명해 주세요.",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-dogfooding/README.md"
    ],
    "answerable": true,
    "latencyMs": 200.7756249999993,
    "results": [
      {
        "rank": 1,
        "score": 0.4192477140137998,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 2,
        "score": 0.37163703480123766,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 3,
        "score": 0.34214710547990335,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "927b01006922d2837fc65136536d69fa10b1cd91dc483949ca7f5442b0b21a53"
      },
      {
        "rank": 4,
        "score": 0.33070956101533633,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 5,
        "score": 0.3256967238162167,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      }
    ],
    "firstRelevantRank": 1
  },
  {
    "id": "unanswerable-001",
    "question": "townbase의 2027년 매출 목표와 영업이익률은 얼마인가요?",
    "expectedDocumentPaths": [],
    "answerable": false,
    "latencyMs": 171.61745799999971,
    "results": [
      {
        "rank": 1,
        "score": 0.27710844668149737,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 2,
        "score": 0.26937141993417013,
        "documentPath": "packages/database/README.md",
        "chunkId": "909171c02dddd8db19ce5bf4fb2628ce398f8d702c80219ef46ab807a915b973"
      },
      {
        "rank": 3,
        "score": 0.26232529228322,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d0ec3166a5a595dee3b8c1f5356e2386cf304b15efc49ff3aaf8b940dbfcf88b"
      },
      {
        "rank": 4,
        "score": 0.23527389538209897,
        "documentPath": "packages/database/README.md",
        "chunkId": "fa115ff6ed6cea9aeff7c219415ea0294de49f4a534afadc4819332663ced902"
      },
      {
        "rank": 5,
        "score": 0.2275037985904842,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2cf4b4e8f68c403682648509aa0f73fc7abb4bcc48e8b8e8bb6823f449c6c78d"
      }
    ],
    "firstRelevantRank": null
  }
]
```

## Chunking 400/50 실행 결과 2026-08-24T09:02:10.129Z

- 실행 시각: 2026-08-24T09:02:10.131Z
- Corpus: 6개 문서, 53개 Chunk
- Chunking: maxTokens=400, overlapTokens=50
- Embedding: text-embedding-3-small, 1536차원
- 질문 수: 10개
- Hit@5: 6/10 (60.0%)
- MRR: 0.3667
- 평균 검색 latency: 164.5ms
- Answerable 질문 평균 latency: 160.5ms

## 질문별 결과

| ID | Answerable | 첫 관련 결과 순위 | Latency | Top 결과 문서 |
| --- | --- | ---: | ---: | --- |
| onboarding-001 | true | 2 | 184.9ms | docs/local-dogfooding/README.md |
| onboarding-002 | true | 3 | 168.2ms | docs/local-dogfooding/README.md |
| onboarding-003 | true | 3 | 174.7ms | README.md |
| product-history-001 | true | 1 | 147.1ms | README.md |
| implementation-001 | true | - | 140.6ms | docs/local-dogfooding/README.md |
| implementation-002 | true | - | 151.3ms | README.md |
| implementation-003 | true | 2 | 169.6ms | README.md |
| multi-document-001 | true | - | 156.5ms | README.md |
| multi-document-002 | true | 1 | 151.3ms | README.md |
| unanswerable-001 | false | - | 200.5ms | README.md |

## 전체 검색 결과(JSON)

```json
[
  {
    "id": "onboarding-001",
    "question": "로컬에서 townbase를 실행하려면 어떤 순서로 준비해야 하나요?",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-first-execution.md"
    ],
    "answerable": true,
    "latencyMs": 184.87070799999992,
    "results": [
      {
        "rank": 1,
        "score": 0.41700794062094126,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 2,
        "score": 0.38640047467331406,
        "documentPath": "docs/local-first-execution.md",
        "chunkId": "2244053df357b222498c284dfd4ae33a7b54f420c243340ce5f80cc9cf55cdd1"
      },
      {
        "rank": 3,
        "score": 0.38076023928334546,
        "documentPath": "packages/database/README.md",
        "chunkId": "909171c02dddd8db19ce5bf4fb2628ce398f8d702c80219ef46ab807a915b973"
      },
      {
        "rank": 4,
        "score": 0.37127014910815836,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      },
      {
        "rank": 5,
        "score": 0.36338595999307544,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d62134e4da55d93e80ae6d8b5da3fddd6e31b5f6df73c7fb7d5afc4bd6f73aad"
      }
    ],
    "firstRelevantRank": 2
  },
  {
    "id": "onboarding-002",
    "question": "개발 환경에서 테스트를 실행하는 기본 명령은 무엇인가요?",
    "expectedDocumentPaths": [
      "README.md",
      "packages/rag-core/README.md"
    ],
    "answerable": true,
    "latencyMs": 168.19420900000023,
    "results": [
      {
        "rank": 1,
        "score": 0.4352625710572875,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 2,
        "score": 0.3897191016213639,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d62134e4da55d93e80ae6d8b5da3fddd6e31b5f6df73c7fb7d5afc4bd6f73aad"
      },
      {
        "rank": 3,
        "score": 0.37002146263580826,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      },
      {
        "rank": 4,
        "score": 0.3603965078589939,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "4b052954d15aa028e360cb69e541194e1cd3642721001fd031fc6d25b2a17709"
      },
      {
        "rank": 5,
        "score": 0.32121769391143085,
        "documentPath": "packages/database/README.md",
        "chunkId": "629ccd1a5de960328cde841d34782ad8d182e3e24ecd88738e01d5da86efd445"
      }
    ],
    "firstRelevantRank": 3
  },
  {
    "id": "onboarding-003",
    "question": "local-first 실행 방식은 외부 SaaS 배포와 어떻게 다른가요?",
    "expectedDocumentPaths": [
      "docs/local-first-execution.md"
    ],
    "answerable": true,
    "latencyMs": 174.69024999999965,
    "results": [
      {
        "rank": 1,
        "score": 0.3929263348776071,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 2,
        "score": 0.3545678738125255,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 3,
        "score": 0.3490160264256237,
        "documentPath": "docs/local-first-execution.md",
        "chunkId": "54f4d7504e9a7c78471e29e3717c32f33b7ef489e7e8c52c3cdb577e041d7261"
      },
      {
        "rank": 4,
        "score": 0.34238831082661636,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d025dc0cd41d5e5f7c1ec3fb8d51527ef4840bed83aa9a17b663a051b07d83f9"
      },
      {
        "rank": 5,
        "score": 0.33959558297110826,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      }
    ],
    "firstRelevantRank": 3
  },
  {
    "id": "product-history-001",
    "question": "이 프로젝트가 Retrieval-first 구조를 선택한 이유는 무엇인가요?",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-dogfooding/README.md"
    ],
    "answerable": true,
    "latencyMs": 147.11450000000013,
    "results": [
      {
        "rank": 1,
        "score": 0.45756688509900645,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 2,
        "score": 0.44591400701077843,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 3,
        "score": 0.3980326203400939,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 4,
        "score": 0.36794528954508676,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 5,
        "score": 0.3462865426000197,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "927b01006922d2837fc65136536d69fa10b1cd91dc483949ca7f5442b0b21a53"
      }
    ],
    "firstRelevantRank": 1
  },
  {
    "id": "implementation-001",
    "question": "rag-core 패키지는 어떤 역할을 담당하나요?",
    "expectedDocumentPaths": [
      "packages/rag-core/README.md"
    ],
    "answerable": true,
    "latencyMs": 140.57708300000013,
    "results": [
      {
        "rank": 1,
        "score": 0.3573258250957687,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "fac1a2cfab7833303afcc52d8c0accf93df9cf584d4d2051eed16c1cc928cd16"
      },
      {
        "rank": 2,
        "score": 0.35231494709472233,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 3,
        "score": 0.33368583249548567,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 4,
        "score": 0.3176235466441295,
        "documentPath": "README.md",
        "chunkId": "8a1d468c7e90f119f78c3e2eb1fd097ba21c1b68540442b72a06357d876763d5"
      },
      {
        "rank": 5,
        "score": 0.3175327224843715,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "implementation-002",
    "question": "database 패키지는 RAG 흐름에서 어떤 데이터를 저장하나요?",
    "expectedDocumentPaths": [
      "packages/database/README.md"
    ],
    "answerable": true,
    "latencyMs": 151.27666600000066,
    "results": [
      {
        "rank": 1,
        "score": 0.35933954055293804,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 2,
        "score": 0.3385366144190398,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 3,
        "score": 0.30984944808248827,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "6a7029da48e799670f20654c593668919a21dd3ea61bc56f4e156db37637a3e8"
      },
      {
        "rank": 4,
        "score": 0.30642231358520045,
        "documentPath": "packages/connectors/README.md",
        "chunkId": "37b7bb8198c7b2d3daee73803b8dfe073f5da9f3485498012b4a3d09a27772dc"
      },
      {
        "rank": 5,
        "score": 0.30539487133692067,
        "documentPath": "README.md",
        "chunkId": "8a1d468c7e90f119f78c3e2eb1fd097ba21c1b68540442b72a06357d876763d5"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "implementation-003",
    "question": "Notion과 로컬 Git 문서 수집은 어느 패키지에서 담당하나요?",
    "expectedDocumentPaths": [
      "packages/connectors/README.md"
    ],
    "answerable": true,
    "latencyMs": 169.57300000000032,
    "results": [
      {
        "rank": 1,
        "score": 0.6604293238478122,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 2,
        "score": 0.5733273290580242,
        "documentPath": "packages/connectors/README.md",
        "chunkId": "37b7bb8198c7b2d3daee73803b8dfe073f5da9f3485498012b4a3d09a27772dc"
      },
      {
        "rank": 3,
        "score": 0.5478371766308667,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 4,
        "score": 0.5229897700392427,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 5,
        "score": 0.5189755276423685,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      }
    ],
    "firstRelevantRank": 2
  },
  {
    "id": "multi-document-001",
    "question": "문서 수집부터 검색까지의 전체 데이터 흐름을 설명해 주세요.",
    "expectedDocumentPaths": [
      "packages/connectors/README.md",
      "packages/rag-core/README.md",
      "packages/database/README.md"
    ],
    "answerable": true,
    "latencyMs": 156.50029199999972,
    "results": [
      {
        "rank": 1,
        "score": 0.3936435667278859,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 2,
        "score": 0.35356952538115816,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 3,
        "score": 0.34259498818765977,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 4,
        "score": 0.33701196761096264,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 5,
        "score": 0.32339359786254196,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "multi-document-002",
    "question": "검색 결과가 외부 Agent의 답변 근거로 전달되는 과정을 설명해 주세요.",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-dogfooding/README.md"
    ],
    "answerable": true,
    "latencyMs": 151.26120900000024,
    "results": [
      {
        "rank": 1,
        "score": 0.4192477140137998,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 2,
        "score": 0.37163703480123766,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 3,
        "score": 0.34214112568043165,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "927b01006922d2837fc65136536d69fa10b1cd91dc483949ca7f5442b0b21a53"
      },
      {
        "rank": 4,
        "score": 0.33070956101533633,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 5,
        "score": 0.3256967238162167,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      }
    ],
    "firstRelevantRank": 1
  },
  {
    "id": "unanswerable-001",
    "question": "townbase의 2027년 매출 목표와 영업이익률은 얼마인가요?",
    "expectedDocumentPaths": [],
    "answerable": false,
    "latencyMs": 200.4819580000003,
    "results": [
      {
        "rank": 1,
        "score": 0.27710844668149737,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 2,
        "score": 0.26937141993417013,
        "documentPath": "packages/database/README.md",
        "chunkId": "909171c02dddd8db19ce5bf4fb2628ce398f8d702c80219ef46ab807a915b973"
      },
      {
        "rank": 3,
        "score": 0.2623242736697715,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d0ec3166a5a595dee3b8c1f5356e2386cf304b15efc49ff3aaf8b940dbfcf88b"
      },
      {
        "rank": 4,
        "score": 0.23527389538209897,
        "documentPath": "packages/database/README.md",
        "chunkId": "fa115ff6ed6cea9aeff7c219415ea0294de49f4a534afadc4819332663ced902"
      },
      {
        "rank": 5,
        "score": 0.22743632034316852,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2cf4b4e8f68c403682648509aa0f73fc7abb4bcc48e8b8e8bb6823f449c6c78d"
      }
    ],
    "firstRelevantRank": null
  }
]
```

## Chunking 600/80 baseline 실행 결과 2026-08-24T09:02:13.499Z

- 실행 시각: 2026-08-24T09:02:13.499Z
- Corpus: 6개 문서, 53개 Chunk
- Chunking: maxTokens=600, overlapTokens=80
- Embedding: text-embedding-3-small, 1536차원
- 질문 수: 10개
- Hit@5: 6/10 (60.0%)
- MRR: 0.3667
- 평균 검색 latency: 185.4ms
- Answerable 질문 평균 latency: 188.2ms

## 질문별 결과

| ID | Answerable | 첫 관련 결과 순위 | Latency | Top 결과 문서 |
| --- | --- | ---: | ---: | --- |
| onboarding-001 | true | 2 | 166.1ms | docs/local-dogfooding/README.md |
| onboarding-002 | true | 3 | 167.7ms | docs/local-dogfooding/README.md |
| onboarding-003 | true | 3 | 171.6ms | README.md |
| product-history-001 | true | 1 | 209.2ms | README.md |
| implementation-001 | true | - | 209.1ms | docs/local-dogfooding/README.md |
| implementation-002 | true | - | 210.0ms | README.md |
| implementation-003 | true | 2 | 149.6ms | README.md |
| multi-document-001 | true | - | 257.6ms | README.md |
| multi-document-002 | true | 1 | 153.1ms | README.md |
| unanswerable-001 | false | - | 159.9ms | README.md |

## 전체 검색 결과(JSON)

```json
[
  {
    "id": "onboarding-001",
    "question": "로컬에서 townbase를 실행하려면 어떤 순서로 준비해야 하나요?",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-first-execution.md"
    ],
    "answerable": true,
    "latencyMs": 166.0927500000007,
    "results": [
      {
        "rank": 1,
        "score": 0.41755413202179725,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 2,
        "score": 0.38640734297687307,
        "documentPath": "docs/local-first-execution.md",
        "chunkId": "2244053df357b222498c284dfd4ae33a7b54f420c243340ce5f80cc9cf55cdd1"
      },
      {
        "rank": 3,
        "score": 0.3807850886479405,
        "documentPath": "packages/database/README.md",
        "chunkId": "909171c02dddd8db19ce5bf4fb2628ce398f8d702c80219ef46ab807a915b973"
      },
      {
        "rank": 4,
        "score": 0.37125601692697696,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      },
      {
        "rank": 5,
        "score": 0.3633214658089059,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d62134e4da55d93e80ae6d8b5da3fddd6e31b5f6df73c7fb7d5afc4bd6f73aad"
      }
    ],
    "firstRelevantRank": 2
  },
  {
    "id": "onboarding-002",
    "question": "개발 환경에서 테스트를 실행하는 기본 명령은 무엇인가요?",
    "expectedDocumentPaths": [
      "README.md",
      "packages/rag-core/README.md"
    ],
    "answerable": true,
    "latencyMs": 167.70924999999988,
    "results": [
      {
        "rank": 1,
        "score": 0.43443732994053097,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 2,
        "score": 0.38973257766472424,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d62134e4da55d93e80ae6d8b5da3fddd6e31b5f6df73c7fb7d5afc4bd6f73aad"
      },
      {
        "rank": 3,
        "score": 0.37005230971855907,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      },
      {
        "rank": 4,
        "score": 0.3603543383944824,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "4b052954d15aa028e360cb69e541194e1cd3642721001fd031fc6d25b2a17709"
      },
      {
        "rank": 5,
        "score": 0.3212415526783955,
        "documentPath": "packages/database/README.md",
        "chunkId": "629ccd1a5de960328cde841d34782ad8d182e3e24ecd88738e01d5da86efd445"
      }
    ],
    "firstRelevantRank": 3
  },
  {
    "id": "onboarding-003",
    "question": "local-first 실행 방식은 외부 SaaS 배포와 어떻게 다른가요?",
    "expectedDocumentPaths": [
      "docs/local-first-execution.md"
    ],
    "answerable": true,
    "latencyMs": 171.61495900000045,
    "results": [
      {
        "rank": 1,
        "score": 0.3929263348776071,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 2,
        "score": 0.35448105991802326,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 3,
        "score": 0.3490562890106679,
        "documentPath": "docs/local-first-execution.md",
        "chunkId": "54f4d7504e9a7c78471e29e3717c32f33b7ef489e7e8c52c3cdb577e041d7261"
      },
      {
        "rank": 4,
        "score": 0.3423207602517544,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d025dc0cd41d5e5f7c1ec3fb8d51527ef4840bed83aa9a17b663a051b07d83f9"
      },
      {
        "rank": 5,
        "score": 0.33920291463385954,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      }
    ],
    "firstRelevantRank": 3
  },
  {
    "id": "product-history-001",
    "question": "이 프로젝트가 Retrieval-first 구조를 선택한 이유는 무엇인가요?",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-dogfooding/README.md"
    ],
    "answerable": true,
    "latencyMs": 209.19987500000025,
    "results": [
      {
        "rank": 1,
        "score": 0.4575374083250767,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 2,
        "score": 0.44591400701077843,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 3,
        "score": 0.3983291658898632,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 4,
        "score": 0.36794528954508676,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 5,
        "score": 0.3462661369077249,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "927b01006922d2837fc65136536d69fa10b1cd91dc483949ca7f5442b0b21a53"
      }
    ],
    "firstRelevantRank": 1
  },
  {
    "id": "implementation-001",
    "question": "rag-core 패키지는 어떤 역할을 담당하나요?",
    "expectedDocumentPaths": [
      "packages/rag-core/README.md"
    ],
    "answerable": true,
    "latencyMs": 209.1472079999994,
    "results": [
      {
        "rank": 1,
        "score": 0.3573692981072014,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "fac1a2cfab7833303afcc52d8c0accf93df9cf584d4d2051eed16c1cc928cd16"
      },
      {
        "rank": 2,
        "score": 0.35231494709472233,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 3,
        "score": 0.33976899437889463,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 4,
        "score": 0.3176235466441295,
        "documentPath": "README.md",
        "chunkId": "8a1d468c7e90f119f78c3e2eb1fd097ba21c1b68540442b72a06357d876763d5"
      },
      {
        "rank": 5,
        "score": 0.31752696896071886,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "implementation-002",
    "question": "database 패키지는 RAG 흐름에서 어떤 데이터를 저장하나요?",
    "expectedDocumentPaths": [
      "packages/database/README.md"
    ],
    "answerable": true,
    "latencyMs": 209.96179100000063,
    "results": [
      {
        "rank": 1,
        "score": 0.35933954055293804,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 2,
        "score": 0.3385366144190398,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 3,
        "score": 0.30986383419346986,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "6a7029da48e799670f20654c593668919a21dd3ea61bc56f4e156db37637a3e8"
      },
      {
        "rank": 4,
        "score": 0.30642231358520045,
        "documentPath": "packages/connectors/README.md",
        "chunkId": "37b7bb8198c7b2d3daee73803b8dfe073f5da9f3485498012b4a3d09a27772dc"
      },
      {
        "rank": 5,
        "score": 0.30539487133692067,
        "documentPath": "README.md",
        "chunkId": "8a1d468c7e90f119f78c3e2eb1fd097ba21c1b68540442b72a06357d876763d5"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "implementation-003",
    "question": "Notion과 로컬 Git 문서 수집은 어느 패키지에서 담당하나요?",
    "expectedDocumentPaths": [
      "packages/connectors/README.md"
    ],
    "answerable": true,
    "latencyMs": 149.6473329999999,
    "results": [
      {
        "rank": 1,
        "score": 0.6569686104707272,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 2,
        "score": 0.5733273290580242,
        "documentPath": "packages/connectors/README.md",
        "chunkId": "37b7bb8198c7b2d3daee73803b8dfe073f5da9f3485498012b4a3d09a27772dc"
      },
      {
        "rank": 3,
        "score": 0.5478371766308667,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 4,
        "score": 0.5231672471541422,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 5,
        "score": 0.5189755276423685,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      }
    ],
    "firstRelevantRank": 2
  },
  {
    "id": "multi-document-001",
    "question": "문서 수집부터 검색까지의 전체 데이터 흐름을 설명해 주세요.",
    "expectedDocumentPaths": [
      "packages/connectors/README.md",
      "packages/rag-core/README.md",
      "packages/database/README.md"
    ],
    "answerable": true,
    "latencyMs": 257.577542,
    "results": [
      {
        "rank": 1,
        "score": 0.3936435667278859,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 2,
        "score": 0.35348315935960384,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 3,
        "score": 0.34259498818765977,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 4,
        "score": 0.3369852551812432,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 5,
        "score": 0.32647559145175875,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "multi-document-002",
    "question": "검색 결과가 외부 Agent의 답변 근거로 전달되는 과정을 설명해 주세요.",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-dogfooding/README.md"
    ],
    "answerable": true,
    "latencyMs": 153.12504200000058,
    "results": [
      {
        "rank": 1,
        "score": 0.41910665689666415,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 2,
        "score": 0.3737314736527382,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 3,
        "score": 0.34214710547990335,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "927b01006922d2837fc65136536d69fa10b1cd91dc483949ca7f5442b0b21a53"
      },
      {
        "rank": 4,
        "score": 0.3329805108617999,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 5,
        "score": 0.3256967238162167,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      }
    ],
    "firstRelevantRank": 1
  },
  {
    "id": "unanswerable-001",
    "question": "townbase의 2027년 매출 목표와 영업이익률은 얼마인가요?",
    "expectedDocumentPaths": [],
    "answerable": false,
    "latencyMs": 159.8732080000009,
    "results": [
      {
        "rank": 1,
        "score": 0.27526991052814687,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 2,
        "score": 0.26934862999495246,
        "documentPath": "packages/database/README.md",
        "chunkId": "909171c02dddd8db19ce5bf4fb2628ce398f8d702c80219ef46ab807a915b973"
      },
      {
        "rank": 3,
        "score": 0.26232529228322,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d0ec3166a5a595dee3b8c1f5356e2386cf304b15efc49ff3aaf8b940dbfcf88b"
      },
      {
        "rank": 4,
        "score": 0.2352212224051855,
        "documentPath": "packages/database/README.md",
        "chunkId": "fa115ff6ed6cea9aeff7c219415ea0294de49f4a534afadc4819332663ced902"
      },
      {
        "rank": 5,
        "score": 0.2275037985904842,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2cf4b4e8f68c403682648509aa0f73fc7abb4bcc48e8b8e8bb6823f449c6c78d"
      }
    ],
    "firstRelevantRank": null
  }
]
```

## Chunking 800/100 실행 결과 2026-08-24T09:02:16.866Z

- 실행 시각: 2026-08-24T09:02:16.866Z
- Corpus: 6개 문서, 53개 Chunk
- Chunking: maxTokens=800, overlapTokens=100
- Embedding: text-embedding-3-small, 1536차원
- 질문 수: 10개
- Hit@5: 6/10 (60.0%)
- MRR: 0.3667
- 평균 검색 latency: 173.3ms
- Answerable 질문 평균 latency: 175.2ms

## 질문별 결과

| ID | Answerable | 첫 관련 결과 순위 | Latency | Top 결과 문서 |
| --- | --- | ---: | ---: | --- |
| onboarding-001 | true | 2 | 196.1ms | docs/local-dogfooding/README.md |
| onboarding-002 | true | 3 | 174.8ms | docs/local-dogfooding/README.md |
| onboarding-003 | true | 3 | 159.4ms | README.md |
| product-history-001 | true | 1 | 139.8ms | README.md |
| implementation-001 | true | - | 185.1ms | docs/local-dogfooding/README.md |
| implementation-002 | true | - | 171.3ms | README.md |
| implementation-003 | true | 2 | 177.9ms | README.md |
| multi-document-001 | true | - | 204.4ms | README.md |
| multi-document-002 | true | 1 | 167.5ms | README.md |
| unanswerable-001 | false | - | 156.4ms | README.md |

## 전체 검색 결과(JSON)

```json
[
  {
    "id": "onboarding-001",
    "question": "로컬에서 townbase를 실행하려면 어떤 순서로 준비해야 하나요?",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-first-execution.md"
    ],
    "answerable": true,
    "latencyMs": 196.0974589999987,
    "results": [
      {
        "rank": 1,
        "score": 0.417490124960352,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 2,
        "score": 0.3864372200171371,
        "documentPath": "docs/local-first-execution.md",
        "chunkId": "2244053df357b222498c284dfd4ae33a7b54f420c243340ce5f80cc9cf55cdd1"
      },
      {
        "rank": 3,
        "score": 0.3807850886479405,
        "documentPath": "packages/database/README.md",
        "chunkId": "909171c02dddd8db19ce5bf4fb2628ce398f8d702c80219ef46ab807a915b973"
      },
      {
        "rank": 4,
        "score": 0.37125601692697696,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      },
      {
        "rank": 5,
        "score": 0.3634005338701609,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d62134e4da55d93e80ae6d8b5da3fddd6e31b5f6df73c7fb7d5afc4bd6f73aad"
      }
    ],
    "firstRelevantRank": 2
  },
  {
    "id": "onboarding-002",
    "question": "개발 환경에서 테스트를 실행하는 기본 명령은 무엇인가요?",
    "expectedDocumentPaths": [
      "README.md",
      "packages/rag-core/README.md"
    ],
    "answerable": true,
    "latencyMs": 174.81762499999968,
    "results": [
      {
        "rank": 1,
        "score": 0.43434956085517373,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 2,
        "score": 0.38975992420864336,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d62134e4da55d93e80ae6d8b5da3fddd6e31b5f6df73c7fb7d5afc4bd6f73aad"
      },
      {
        "rank": 3,
        "score": 0.37005230971855907,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      },
      {
        "rank": 4,
        "score": 0.3603965078589939,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "4b052954d15aa028e360cb69e541194e1cd3642721001fd031fc6d25b2a17709"
      },
      {
        "rank": 5,
        "score": 0.3212415526783955,
        "documentPath": "packages/database/README.md",
        "chunkId": "629ccd1a5de960328cde841d34782ad8d182e3e24ecd88738e01d5da86efd445"
      }
    ],
    "firstRelevantRank": 3
  },
  {
    "id": "onboarding-003",
    "question": "local-first 실행 방식은 외부 SaaS 배포와 어떻게 다른가요?",
    "expectedDocumentPaths": [
      "docs/local-first-execution.md"
    ],
    "answerable": true,
    "latencyMs": 159.4147499999999,
    "results": [
      {
        "rank": 1,
        "score": 0.3929263348776071,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 2,
        "score": 0.3542601156980214,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 3,
        "score": 0.3490160264256237,
        "documentPath": "docs/local-first-execution.md",
        "chunkId": "54f4d7504e9a7c78471e29e3717c32f33b7ef489e7e8c52c3cdb577e041d7261"
      },
      {
        "rank": 4,
        "score": 0.3423744198882511,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d025dc0cd41d5e5f7c1ec3fb8d51527ef4840bed83aa9a17b663a051b07d83f9"
      },
      {
        "rank": 5,
        "score": 0.3394588011461658,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      }
    ],
    "firstRelevantRank": 3
  },
  {
    "id": "product-history-001",
    "question": "이 프로젝트가 Retrieval-first 구조를 선택한 이유는 무엇인가요?",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-dogfooding/README.md"
    ],
    "answerable": true,
    "latencyMs": 139.7943749999995,
    "results": [
      {
        "rank": 1,
        "score": 0.45756688509900645,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 2,
        "score": 0.44591400701077843,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 3,
        "score": 0.3978316302799305,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 4,
        "score": 0.36794528954508676,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 5,
        "score": 0.34628293395063825,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "927b01006922d2837fc65136536d69fa10b1cd91dc483949ca7f5442b0b21a53"
      }
    ],
    "firstRelevantRank": 1
  },
  {
    "id": "implementation-001",
    "question": "rag-core 패키지는 어떤 역할을 담당하나요?",
    "expectedDocumentPaths": [
      "packages/rag-core/README.md"
    ],
    "answerable": true,
    "latencyMs": 185.09070800000154,
    "results": [
      {
        "rank": 1,
        "score": 0.3573500549267541,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "fac1a2cfab7833303afcc52d8c0accf93df9cf584d4d2051eed16c1cc928cd16"
      },
      {
        "rank": 2,
        "score": 0.35231494709472233,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 3,
        "score": 0.3339987039799597,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 4,
        "score": 0.3176235466441295,
        "documentPath": "README.md",
        "chunkId": "8a1d468c7e90f119f78c3e2eb1fd097ba21c1b68540442b72a06357d876763d5"
      },
      {
        "rank": 5,
        "score": 0.31752696896071886,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "implementation-002",
    "question": "database 패키지는 RAG 흐름에서 어떤 데이터를 저장하나요?",
    "expectedDocumentPaths": [
      "packages/database/README.md"
    ],
    "answerable": true,
    "latencyMs": 171.3478750000013,
    "results": [
      {
        "rank": 1,
        "score": 0.35933954055293804,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 2,
        "score": 0.3385366144190398,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 3,
        "score": 0.30984944808248827,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "6a7029da48e799670f20654c593668919a21dd3ea61bc56f4e156db37637a3e8"
      },
      {
        "rank": 4,
        "score": 0.3063540045731741,
        "documentPath": "packages/connectors/README.md",
        "chunkId": "37b7bb8198c7b2d3daee73803b8dfe073f5da9f3485498012b4a3d09a27772dc"
      },
      {
        "rank": 5,
        "score": 0.30539487133692067,
        "documentPath": "README.md",
        "chunkId": "8a1d468c7e90f119f78c3e2eb1fd097ba21c1b68540442b72a06357d876763d5"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "implementation-003",
    "question": "Notion과 로컬 Git 문서 수집은 어느 패키지에서 담당하나요?",
    "expectedDocumentPaths": [
      "packages/connectors/README.md"
    ],
    "answerable": true,
    "latencyMs": 177.9282920000005,
    "results": [
      {
        "rank": 1,
        "score": 0.6607327938179555,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 2,
        "score": 0.5733021949872636,
        "documentPath": "packages/connectors/README.md",
        "chunkId": "37b7bb8198c7b2d3daee73803b8dfe073f5da9f3485498012b4a3d09a27772dc"
      },
      {
        "rank": 3,
        "score": 0.5478371766308667,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 4,
        "score": 0.5231794183159062,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 5,
        "score": 0.5189755276423685,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      }
    ],
    "firstRelevantRank": 2
  },
  {
    "id": "multi-document-001",
    "question": "문서 수집부터 검색까지의 전체 데이터 흐름을 설명해 주세요.",
    "expectedDocumentPaths": [
      "packages/connectors/README.md",
      "packages/rag-core/README.md",
      "packages/database/README.md"
    ],
    "answerable": true,
    "latencyMs": 204.4449999999997,
    "results": [
      {
        "rank": 1,
        "score": 0.3936435667278859,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 2,
        "score": 0.35356952538115816,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 3,
        "score": 0.34259498818765977,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 4,
        "score": 0.3370461345439094,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 5,
        "score": 0.3234069940438511,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "multi-document-002",
    "question": "검색 결과가 외부 Agent의 답변 근거로 전달되는 과정을 설명해 주세요.",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-dogfooding/README.md"
    ],
    "answerable": true,
    "latencyMs": 167.46945899999992,
    "results": [
      {
        "rank": 1,
        "score": 0.4192477140137998,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 2,
        "score": 0.37143504192456733,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 3,
        "score": 0.3422040350010901,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "927b01006922d2837fc65136536d69fa10b1cd91dc483949ca7f5442b0b21a53"
      },
      {
        "rank": 4,
        "score": 0.330288292893406,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 5,
        "score": 0.3256967238162167,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      }
    ],
    "firstRelevantRank": 1
  },
  {
    "id": "unanswerable-001",
    "question": "townbase의 2027년 매출 목표와 영업이익률은 얼마인가요?",
    "expectedDocumentPaths": [],
    "answerable": false,
    "latencyMs": 156.41095799999857,
    "results": [
      {
        "rank": 1,
        "score": 0.27732721072494715,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 2,
        "score": 0.26934862999495246,
        "documentPath": "packages/database/README.md",
        "chunkId": "909171c02dddd8db19ce5bf4fb2628ce398f8d702c80219ef46ab807a915b973"
      },
      {
        "rank": 3,
        "score": 0.2623242736697715,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d0ec3166a5a595dee3b8c1f5356e2386cf304b15efc49ff3aaf8b940dbfcf88b"
      },
      {
        "rank": 4,
        "score": 0.2352212224051855,
        "documentPath": "packages/database/README.md",
        "chunkId": "fa115ff6ed6cea9aeff7c219415ea0294de49f4a534afadc4819332663ced902"
      },
      {
        "rank": 5,
        "score": 0.22743632034316852,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2cf4b4e8f68c403682648509aa0f73fc7abb4bcc48e8b8e8bb6823f449c6c78d"
      }
    ],
    "firstRelevantRank": null
  }
]
```

## Chunking 400/50 실행 결과 2026-08-24T09:37:15.681Z

- 실행 시각: 2026-08-24T09:37:15.682Z
- Corpus: 6개 문서, 53개 Chunk
- Chunking: maxTokens=400, overlapTokens=50
- Embedding: text-embedding-3-small, 1536차원
- 질문 수: 10개
- Hit@5: 6/10 (60.0%)
- MRR: 0.3667
- 평균 검색 latency: 236.7ms
- Answerable 질문 평균 latency: 243.2ms

## 질문별 결과

| ID | Answerable | 첫 관련 결과 순위 | Latency | Top 결과 문서 |
| --- | --- | ---: | ---: | --- |
| onboarding-001 | true | 2 | 795.4ms | docs/local-dogfooding/README.md |
| onboarding-002 | true | 3 | 145.3ms | docs/local-dogfooding/README.md |
| onboarding-003 | true | 3 | 146.8ms | README.md |
| product-history-001 | true | 1 | 178.7ms | README.md |
| implementation-001 | true | - | 162.2ms | docs/local-dogfooding/README.md |
| implementation-002 | true | - | 172.3ms | README.md |
| implementation-003 | true | 2 | 203.8ms | README.md |
| multi-document-001 | true | - | 170.0ms | README.md |
| multi-document-002 | true | 1 | 214.3ms | README.md |
| unanswerable-001 | false | - | 177.7ms | README.md |

## 전체 검색 결과(JSON)

```json
[
  {
    "id": "onboarding-001",
    "question": "로컬에서 townbase를 실행하려면 어떤 순서로 준비해야 하나요?",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-first-execution.md"
    ],
    "answerable": true,
    "latencyMs": 795.4004999999997,
    "results": [
      {
        "rank": 1,
        "score": 0.41700794062094126,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 2,
        "score": 0.38640047467331406,
        "documentPath": "docs/local-first-execution.md",
        "chunkId": "2244053df357b222498c284dfd4ae33a7b54f420c243340ce5f80cc9cf55cdd1"
      },
      {
        "rank": 3,
        "score": 0.3807850886479405,
        "documentPath": "packages/database/README.md",
        "chunkId": "909171c02dddd8db19ce5bf4fb2628ce398f8d702c80219ef46ab807a915b973"
      },
      {
        "rank": 4,
        "score": 0.37127014910815836,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      },
      {
        "rank": 5,
        "score": 0.3633214658089059,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d62134e4da55d93e80ae6d8b5da3fddd6e31b5f6df73c7fb7d5afc4bd6f73aad"
      }
    ],
    "firstRelevantRank": 2
  },
  {
    "id": "onboarding-002",
    "question": "개발 환경에서 테스트를 실행하는 기본 명령은 무엇인가요?",
    "expectedDocumentPaths": [
      "README.md",
      "packages/rag-core/README.md"
    ],
    "answerable": true,
    "latencyMs": 145.27166699999998,
    "results": [
      {
        "rank": 1,
        "score": 0.4352625710572875,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 2,
        "score": 0.38973257766472424,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d62134e4da55d93e80ae6d8b5da3fddd6e31b5f6df73c7fb7d5afc4bd6f73aad"
      },
      {
        "rank": 3,
        "score": 0.37002146263580826,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      },
      {
        "rank": 4,
        "score": 0.3603543383944824,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "4b052954d15aa028e360cb69e541194e1cd3642721001fd031fc6d25b2a17709"
      },
      {
        "rank": 5,
        "score": 0.3212415526783955,
        "documentPath": "packages/database/README.md",
        "chunkId": "629ccd1a5de960328cde841d34782ad8d182e3e24ecd88738e01d5da86efd445"
      }
    ],
    "firstRelevantRank": 3
  },
  {
    "id": "onboarding-003",
    "question": "local-first 실행 방식은 외부 SaaS 배포와 어떻게 다른가요?",
    "expectedDocumentPaths": [
      "docs/local-first-execution.md"
    ],
    "answerable": true,
    "latencyMs": 146.8466669999998,
    "results": [
      {
        "rank": 1,
        "score": 0.3929263348776071,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 2,
        "score": 0.3545678738125255,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 3,
        "score": 0.3490160264256237,
        "documentPath": "docs/local-first-execution.md",
        "chunkId": "54f4d7504e9a7c78471e29e3717c32f33b7ef489e7e8c52c3cdb577e041d7261"
      },
      {
        "rank": 4,
        "score": 0.34238831082661636,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d025dc0cd41d5e5f7c1ec3fb8d51527ef4840bed83aa9a17b663a051b07d83f9"
      },
      {
        "rank": 5,
        "score": 0.33959558297110826,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      }
    ],
    "firstRelevantRank": 3
  },
  {
    "id": "product-history-001",
    "question": "이 프로젝트가 Retrieval-first 구조를 선택한 이유는 무엇인가요?",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-dogfooding/README.md"
    ],
    "answerable": true,
    "latencyMs": 178.7134159999996,
    "results": [
      {
        "rank": 1,
        "score": 0.45756688509900645,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 2,
        "score": 0.44591400701077843,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 3,
        "score": 0.3980326203400939,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 4,
        "score": 0.36794528954508676,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 5,
        "score": 0.3462661369077249,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "927b01006922d2837fc65136536d69fa10b1cd91dc483949ca7f5442b0b21a53"
      }
    ],
    "firstRelevantRank": 1
  },
  {
    "id": "implementation-001",
    "question": "rag-core 패키지는 어떤 역할을 담당하나요?",
    "expectedDocumentPaths": [
      "packages/rag-core/README.md"
    ],
    "answerable": true,
    "latencyMs": 162.24824999999964,
    "results": [
      {
        "rank": 1,
        "score": 0.3573692981072014,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "fac1a2cfab7833303afcc52d8c0accf93df9cf584d4d2051eed16c1cc928cd16"
      },
      {
        "rank": 2,
        "score": 0.35231494709472233,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 3,
        "score": 0.33368583249548567,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 4,
        "score": 0.3176235466441295,
        "documentPath": "README.md",
        "chunkId": "8a1d468c7e90f119f78c3e2eb1fd097ba21c1b68540442b72a06357d876763d5"
      },
      {
        "rank": 5,
        "score": 0.3175327224843715,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "implementation-002",
    "question": "database 패키지는 RAG 흐름에서 어떤 데이터를 저장하나요?",
    "expectedDocumentPaths": [
      "packages/database/README.md"
    ],
    "answerable": true,
    "latencyMs": 172.31254200000058,
    "results": [
      {
        "rank": 1,
        "score": 0.35933954055293804,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 2,
        "score": 0.3385366144190398,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 3,
        "score": 0.30986383419346986,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "6a7029da48e799670f20654c593668919a21dd3ea61bc56f4e156db37637a3e8"
      },
      {
        "rank": 4,
        "score": 0.3063540045731741,
        "documentPath": "packages/connectors/README.md",
        "chunkId": "37b7bb8198c7b2d3daee73803b8dfe073f5da9f3485498012b4a3d09a27772dc"
      },
      {
        "rank": 5,
        "score": 0.30539487133692067,
        "documentPath": "README.md",
        "chunkId": "8a1d468c7e90f119f78c3e2eb1fd097ba21c1b68540442b72a06357d876763d5"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "implementation-003",
    "question": "Notion과 로컬 Git 문서 수집은 어느 패키지에서 담당하나요?",
    "expectedDocumentPaths": [
      "packages/connectors/README.md"
    ],
    "answerable": true,
    "latencyMs": 203.7637080000004,
    "results": [
      {
        "rank": 1,
        "score": 0.6604293238478122,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 2,
        "score": 0.5733021949872636,
        "documentPath": "packages/connectors/README.md",
        "chunkId": "37b7bb8198c7b2d3daee73803b8dfe073f5da9f3485498012b4a3d09a27772dc"
      },
      {
        "rank": 3,
        "score": 0.5478371766308667,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 4,
        "score": 0.5229897700392427,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 5,
        "score": 0.5189755276423685,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      }
    ],
    "firstRelevantRank": 2
  },
  {
    "id": "multi-document-001",
    "question": "문서 수집부터 검색까지의 전체 데이터 흐름을 설명해 주세요.",
    "expectedDocumentPaths": [
      "packages/connectors/README.md",
      "packages/rag-core/README.md",
      "packages/database/README.md"
    ],
    "answerable": true,
    "latencyMs": 170.02266699999927,
    "results": [
      {
        "rank": 1,
        "score": 0.3936435667278859,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 2,
        "score": 0.35356952538115816,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 3,
        "score": 0.34259498818765977,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 4,
        "score": 0.33701196761096264,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 5,
        "score": 0.32339359786254196,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "multi-document-002",
    "question": "검색 결과가 외부 Agent의 답변 근거로 전달되는 과정을 설명해 주세요.",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-dogfooding/README.md"
    ],
    "answerable": true,
    "latencyMs": 214.25058400000034,
    "results": [
      {
        "rank": 1,
        "score": 0.4192477140137998,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 2,
        "score": 0.37163703480123766,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 3,
        "score": 0.34214710547990335,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "927b01006922d2837fc65136536d69fa10b1cd91dc483949ca7f5442b0b21a53"
      },
      {
        "rank": 4,
        "score": 0.33070956101533633,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 5,
        "score": 0.3256967238162167,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      }
    ],
    "firstRelevantRank": 1
  },
  {
    "id": "unanswerable-001",
    "question": "townbase의 2027년 매출 목표와 영업이익률은 얼마인가요?",
    "expectedDocumentPaths": [],
    "answerable": false,
    "latencyMs": 177.70266599999923,
    "results": [
      {
        "rank": 1,
        "score": 0.27710844668149737,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 2,
        "score": 0.26934862999495246,
        "documentPath": "packages/database/README.md",
        "chunkId": "909171c02dddd8db19ce5bf4fb2628ce398f8d702c80219ef46ab807a915b973"
      },
      {
        "rank": 3,
        "score": 0.26232529228322,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d0ec3166a5a595dee3b8c1f5356e2386cf304b15efc49ff3aaf8b940dbfcf88b"
      },
      {
        "rank": 4,
        "score": 0.2352212224051855,
        "documentPath": "packages/database/README.md",
        "chunkId": "fa115ff6ed6cea9aeff7c219415ea0294de49f4a534afadc4819332663ced902"
      },
      {
        "rank": 5,
        "score": 0.2275037985904842,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2cf4b4e8f68c403682648509aa0f73fc7abb4bcc48e8b8e8bb6823f449c6c78d"
      }
    ],
    "firstRelevantRank": null
  }
]
```

## Chunking 600/80 baseline 실행 결과 2026-08-24T09:37:18.825Z

- 실행 시각: 2026-08-24T09:37:18.825Z
- Corpus: 6개 문서, 53개 Chunk
- Chunking: maxTokens=600, overlapTokens=80
- Embedding: text-embedding-3-small, 1536차원
- 질문 수: 10개
- Hit@5: 6/10 (60.0%)
- MRR: 0.3667
- 평균 검색 latency: 171.4ms
- Answerable 질문 평균 latency: 172.2ms

## 질문별 결과

| ID | Answerable | 첫 관련 결과 순위 | Latency | Top 결과 문서 |
| --- | --- | ---: | ---: | --- |
| onboarding-001 | true | 2 | 212.0ms | docs/local-dogfooding/README.md |
| onboarding-002 | true | 3 | 166.6ms | docs/local-dogfooding/README.md |
| onboarding-003 | true | 3 | 161.2ms | README.md |
| product-history-001 | true | 1 | 165.4ms | README.md |
| implementation-001 | true | - | 157.0ms | docs/local-dogfooding/README.md |
| implementation-002 | true | - | 158.7ms | README.md |
| implementation-003 | true | 2 | 162.1ms | README.md |
| multi-document-001 | true | - | 198.6ms | README.md |
| multi-document-002 | true | 1 | 167.8ms | README.md |
| unanswerable-001 | false | - | 164.7ms | README.md |

## 전체 검색 결과(JSON)

```json
[
  {
    "id": "onboarding-001",
    "question": "로컬에서 townbase를 실행하려면 어떤 순서로 준비해야 하나요?",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-first-execution.md"
    ],
    "answerable": true,
    "latencyMs": 212.0331670000014,
    "results": [
      {
        "rank": 1,
        "score": 0.41700794062094126,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 2,
        "score": 0.3864312162901904,
        "documentPath": "docs/local-first-execution.md",
        "chunkId": "2244053df357b222498c284dfd4ae33a7b54f420c243340ce5f80cc9cf55cdd1"
      },
      {
        "rank": 3,
        "score": 0.38076023928334546,
        "documentPath": "packages/database/README.md",
        "chunkId": "909171c02dddd8db19ce5bf4fb2628ce398f8d702c80219ef46ab807a915b973"
      },
      {
        "rank": 4,
        "score": 0.37125601692697696,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      },
      {
        "rank": 5,
        "score": 0.3634005338701609,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d62134e4da55d93e80ae6d8b5da3fddd6e31b5f6df73c7fb7d5afc4bd6f73aad"
      }
    ],
    "firstRelevantRank": 2
  },
  {
    "id": "onboarding-002",
    "question": "개발 환경에서 테스트를 실행하는 기본 명령은 무엇인가요?",
    "expectedDocumentPaths": [
      "README.md",
      "packages/rag-core/README.md"
    ],
    "answerable": true,
    "latencyMs": 166.57420900000034,
    "results": [
      {
        "rank": 1,
        "score": 0.4352625710572875,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 2,
        "score": 0.38975992420864336,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d62134e4da55d93e80ae6d8b5da3fddd6e31b5f6df73c7fb7d5afc4bd6f73aad"
      },
      {
        "rank": 3,
        "score": 0.37005230971855907,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      },
      {
        "rank": 4,
        "score": 0.3603965078589939,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "4b052954d15aa028e360cb69e541194e1cd3642721001fd031fc6d25b2a17709"
      },
      {
        "rank": 5,
        "score": 0.32121769391143085,
        "documentPath": "packages/database/README.md",
        "chunkId": "629ccd1a5de960328cde841d34782ad8d182e3e24ecd88738e01d5da86efd445"
      }
    ],
    "firstRelevantRank": 3
  },
  {
    "id": "onboarding-003",
    "question": "local-first 실행 방식은 외부 SaaS 배포와 어떻게 다른가요?",
    "expectedDocumentPaths": [
      "docs/local-first-execution.md"
    ],
    "answerable": true,
    "latencyMs": 161.15620899999885,
    "results": [
      {
        "rank": 1,
        "score": 0.3929263348776071,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 2,
        "score": 0.3542601156980214,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 3,
        "score": 0.3489934101704766,
        "documentPath": "docs/local-first-execution.md",
        "chunkId": "54f4d7504e9a7c78471e29e3717c32f33b7ef489e7e8c52c3cdb577e041d7261"
      },
      {
        "rank": 4,
        "score": 0.34238831082661636,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d025dc0cd41d5e5f7c1ec3fb8d51527ef4840bed83aa9a17b663a051b07d83f9"
      },
      {
        "rank": 5,
        "score": 0.3394588011461658,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      }
    ],
    "firstRelevantRank": 3
  },
  {
    "id": "product-history-001",
    "question": "이 프로젝트가 Retrieval-first 구조를 선택한 이유는 무엇인가요?",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-dogfooding/README.md"
    ],
    "answerable": true,
    "latencyMs": 165.4384170000012,
    "results": [
      {
        "rank": 1,
        "score": 0.45756688509900645,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 2,
        "score": 0.44591400701077843,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 3,
        "score": 0.3978316302799305,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 4,
        "score": 0.36794528954508676,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 5,
        "score": 0.34628293395063825,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "927b01006922d2837fc65136536d69fa10b1cd91dc483949ca7f5442b0b21a53"
      }
    ],
    "firstRelevantRank": 1
  },
  {
    "id": "implementation-001",
    "question": "rag-core 패키지는 어떤 역할을 담당하나요?",
    "expectedDocumentPaths": [
      "packages/rag-core/README.md"
    ],
    "answerable": true,
    "latencyMs": 157.0271670000002,
    "results": [
      {
        "rank": 1,
        "score": 0.3573500549267541,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "fac1a2cfab7833303afcc52d8c0accf93df9cf584d4d2051eed16c1cc928cd16"
      },
      {
        "rank": 2,
        "score": 0.35231494709472233,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 3,
        "score": 0.3339987039799597,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 4,
        "score": 0.3176235466441295,
        "documentPath": "README.md",
        "chunkId": "8a1d468c7e90f119f78c3e2eb1fd097ba21c1b68540442b72a06357d876763d5"
      },
      {
        "rank": 5,
        "score": 0.31752696896071886,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "implementation-002",
    "question": "database 패키지는 RAG 흐름에서 어떤 데이터를 저장하나요?",
    "expectedDocumentPaths": [
      "packages/database/README.md"
    ],
    "answerable": true,
    "latencyMs": 158.69595800000025,
    "results": [
      {
        "rank": 1,
        "score": 0.35933954055293804,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 2,
        "score": 0.3385366144190398,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 3,
        "score": 0.30984944808248827,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "6a7029da48e799670f20654c593668919a21dd3ea61bc56f4e156db37637a3e8"
      },
      {
        "rank": 4,
        "score": 0.30642231358520045,
        "documentPath": "packages/connectors/README.md",
        "chunkId": "37b7bb8198c7b2d3daee73803b8dfe073f5da9f3485498012b4a3d09a27772dc"
      },
      {
        "rank": 5,
        "score": 0.30539487133692067,
        "documentPath": "README.md",
        "chunkId": "8a1d468c7e90f119f78c3e2eb1fd097ba21c1b68540442b72a06357d876763d5"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "implementation-003",
    "question": "Notion과 로컬 Git 문서 수집은 어느 패키지에서 담당하나요?",
    "expectedDocumentPaths": [
      "packages/connectors/README.md"
    ],
    "answerable": true,
    "latencyMs": 162.06929200000013,
    "results": [
      {
        "rank": 1,
        "score": 0.6607327938179555,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 2,
        "score": 0.5733273290580242,
        "documentPath": "packages/connectors/README.md",
        "chunkId": "37b7bb8198c7b2d3daee73803b8dfe073f5da9f3485498012b4a3d09a27772dc"
      },
      {
        "rank": 3,
        "score": 0.5478371766308667,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 4,
        "score": 0.5231794183159062,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 5,
        "score": 0.5189755276423685,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      }
    ],
    "firstRelevantRank": 2
  },
  {
    "id": "multi-document-001",
    "question": "문서 수집부터 검색까지의 전체 데이터 흐름을 설명해 주세요.",
    "expectedDocumentPaths": [
      "packages/connectors/README.md",
      "packages/rag-core/README.md",
      "packages/database/README.md"
    ],
    "answerable": true,
    "latencyMs": 198.5828330000004,
    "results": [
      {
        "rank": 1,
        "score": 0.3936435667278859,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 2,
        "score": 0.35356952538115816,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 3,
        "score": 0.34259498818765977,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 4,
        "score": 0.33701196761096264,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 5,
        "score": 0.3234069940438511,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "multi-document-002",
    "question": "검색 결과가 외부 Agent의 답변 근거로 전달되는 과정을 설명해 주세요.",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-dogfooding/README.md"
    ],
    "answerable": true,
    "latencyMs": 167.80954199999906,
    "results": [
      {
        "rank": 1,
        "score": 0.4192477140137998,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 2,
        "score": 0.37143504192456733,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 3,
        "score": 0.3422040350010901,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "927b01006922d2837fc65136536d69fa10b1cd91dc483949ca7f5442b0b21a53"
      },
      {
        "rank": 4,
        "score": 0.330288292893406,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 5,
        "score": 0.3256967238162167,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      }
    ],
    "firstRelevantRank": 1
  },
  {
    "id": "unanswerable-001",
    "question": "townbase의 2027년 매출 목표와 영업이익률은 얼마인가요?",
    "expectedDocumentPaths": [],
    "answerable": false,
    "latencyMs": 164.72362500000054,
    "results": [
      {
        "rank": 1,
        "score": 0.27732721072494715,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 2,
        "score": 0.26937141993417013,
        "documentPath": "packages/database/README.md",
        "chunkId": "909171c02dddd8db19ce5bf4fb2628ce398f8d702c80219ef46ab807a915b973"
      },
      {
        "rank": 3,
        "score": 0.2623242736697715,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d0ec3166a5a595dee3b8c1f5356e2386cf304b15efc49ff3aaf8b940dbfcf88b"
      },
      {
        "rank": 4,
        "score": 0.23527389538209897,
        "documentPath": "packages/database/README.md",
        "chunkId": "fa115ff6ed6cea9aeff7c219415ea0294de49f4a534afadc4819332663ced902"
      },
      {
        "rank": 5,
        "score": 0.22742098649864295,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2cf4b4e8f68c403682648509aa0f73fc7abb4bcc48e8b8e8bb6823f449c6c78d"
      }
    ],
    "firstRelevantRank": null
  }
]
```

## Chunking 800/100 실행 결과 2026-08-24T09:37:22.301Z

- 실행 시각: 2026-08-24T09:37:22.301Z
- Corpus: 6개 문서, 53개 Chunk
- Chunking: maxTokens=800, overlapTokens=100
- Embedding: text-embedding-3-small, 1536차원
- 질문 수: 10개
- Hit@5: 6/10 (60.0%)
- MRR: 0.3667
- 평균 검색 latency: 188.0ms
- Answerable 질문 평균 latency: 185.7ms

## 질문별 결과

| ID | Answerable | 첫 관련 결과 순위 | Latency | Top 결과 문서 |
| --- | --- | ---: | ---: | --- |
| onboarding-001 | true | 2 | 181.4ms | docs/local-dogfooding/README.md |
| onboarding-002 | true | 3 | 220.8ms | docs/local-dogfooding/README.md |
| onboarding-003 | true | 3 | 160.2ms | README.md |
| product-history-001 | true | 1 | 180.5ms | README.md |
| implementation-001 | true | - | 167.8ms | docs/local-dogfooding/README.md |
| implementation-002 | true | - | 160.2ms | README.md |
| implementation-003 | true | 2 | 161.4ms | README.md |
| multi-document-001 | true | - | 211.1ms | README.md |
| multi-document-002 | true | 1 | 227.8ms | README.md |
| unanswerable-001 | false | - | 208.9ms | README.md |

## 전체 검색 결과(JSON)

```json
[
  {
    "id": "onboarding-001",
    "question": "로컬에서 townbase를 실행하려면 어떤 순서로 준비해야 하나요?",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-first-execution.md"
    ],
    "answerable": true,
    "latencyMs": 181.41404200000034,
    "results": [
      {
        "rank": 1,
        "score": 0.417490124960352,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 2,
        "score": 0.3864372200171371,
        "documentPath": "docs/local-first-execution.md",
        "chunkId": "2244053df357b222498c284dfd4ae33a7b54f420c243340ce5f80cc9cf55cdd1"
      },
      {
        "rank": 3,
        "score": 0.3807850886479405,
        "documentPath": "packages/database/README.md",
        "chunkId": "909171c02dddd8db19ce5bf4fb2628ce398f8d702c80219ef46ab807a915b973"
      },
      {
        "rank": 4,
        "score": 0.37125601692697696,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      },
      {
        "rank": 5,
        "score": 0.3633540879462813,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d62134e4da55d93e80ae6d8b5da3fddd6e31b5f6df73c7fb7d5afc4bd6f73aad"
      }
    ],
    "firstRelevantRank": 2
  },
  {
    "id": "onboarding-002",
    "question": "개발 환경에서 테스트를 실행하는 기본 명령은 무엇인가요?",
    "expectedDocumentPaths": [
      "README.md",
      "packages/rag-core/README.md"
    ],
    "answerable": true,
    "latencyMs": 220.81491599999936,
    "results": [
      {
        "rank": 1,
        "score": 0.43434956085517373,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 2,
        "score": 0.3897765306193375,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d62134e4da55d93e80ae6d8b5da3fddd6e31b5f6df73c7fb7d5afc4bd6f73aad"
      },
      {
        "rank": 3,
        "score": 0.37005230971855907,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      },
      {
        "rank": 4,
        "score": 0.3611076331620182,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "4b052954d15aa028e360cb69e541194e1cd3642721001fd031fc6d25b2a17709"
      },
      {
        "rank": 5,
        "score": 0.3212415526783955,
        "documentPath": "packages/database/README.md",
        "chunkId": "629ccd1a5de960328cde841d34782ad8d182e3e24ecd88738e01d5da86efd445"
      }
    ],
    "firstRelevantRank": 3
  },
  {
    "id": "onboarding-003",
    "question": "local-first 실행 방식은 외부 SaaS 배포와 어떻게 다른가요?",
    "expectedDocumentPaths": [
      "docs/local-first-execution.md"
    ],
    "answerable": true,
    "latencyMs": 160.18366700000115,
    "results": [
      {
        "rank": 1,
        "score": 0.3929263348776071,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 2,
        "score": 0.3542601156980214,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 3,
        "score": 0.3490160264256237,
        "documentPath": "docs/local-first-execution.md",
        "chunkId": "54f4d7504e9a7c78471e29e3717c32f33b7ef489e7e8c52c3cdb577e041d7261"
      },
      {
        "rank": 4,
        "score": 0.34232083217684717,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d025dc0cd41d5e5f7c1ec3fb8d51527ef4840bed83aa9a17b663a051b07d83f9"
      },
      {
        "rank": 5,
        "score": 0.3394588011461658,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      }
    ],
    "firstRelevantRank": 3
  },
  {
    "id": "product-history-001",
    "question": "이 프로젝트가 Retrieval-first 구조를 선택한 이유는 무엇인가요?",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-dogfooding/README.md"
    ],
    "answerable": true,
    "latencyMs": 180.52316599999904,
    "results": [
      {
        "rank": 1,
        "score": 0.45756688509900645,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 2,
        "score": 0.44591400701077843,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 3,
        "score": 0.3978316302799305,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 4,
        "score": 0.36794528954508676,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 5,
        "score": 0.3462600529223757,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "927b01006922d2837fc65136536d69fa10b1cd91dc483949ca7f5442b0b21a53"
      }
    ],
    "firstRelevantRank": 1
  },
  {
    "id": "implementation-001",
    "question": "rag-core 패키지는 어떤 역할을 담당하나요?",
    "expectedDocumentPaths": [
      "packages/rag-core/README.md"
    ],
    "answerable": true,
    "latencyMs": 167.76345799999945,
    "results": [
      {
        "rank": 1,
        "score": 0.35733054890248983,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "fac1a2cfab7833303afcc52d8c0accf93df9cf584d4d2051eed16c1cc928cd16"
      },
      {
        "rank": 2,
        "score": 0.35231494709472233,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 3,
        "score": 0.3339987039799597,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 4,
        "score": 0.3176235466441295,
        "documentPath": "README.md",
        "chunkId": "8a1d468c7e90f119f78c3e2eb1fd097ba21c1b68540442b72a06357d876763d5"
      },
      {
        "rank": 5,
        "score": 0.31752696896071886,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "implementation-002",
    "question": "database 패키지는 RAG 흐름에서 어떤 데이터를 저장하나요?",
    "expectedDocumentPaths": [
      "packages/database/README.md"
    ],
    "answerable": true,
    "latencyMs": 160.19637499999953,
    "results": [
      {
        "rank": 1,
        "score": 0.35933954055293804,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 2,
        "score": 0.3385366144190398,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 3,
        "score": 0.3098640881482966,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "6a7029da48e799670f20654c593668919a21dd3ea61bc56f4e156db37637a3e8"
      },
      {
        "rank": 4,
        "score": 0.3063538887649886,
        "documentPath": "packages/connectors/README.md",
        "chunkId": "37b7bb8198c7b2d3daee73803b8dfe073f5da9f3485498012b4a3d09a27772dc"
      },
      {
        "rank": 5,
        "score": 0.30539487133692067,
        "documentPath": "README.md",
        "chunkId": "8a1d468c7e90f119f78c3e2eb1fd097ba21c1b68540442b72a06357d876763d5"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "implementation-003",
    "question": "Notion과 로컬 Git 문서 수집은 어느 패키지에서 담당하나요?",
    "expectedDocumentPaths": [
      "packages/connectors/README.md"
    ],
    "answerable": true,
    "latencyMs": 161.43133300000045,
    "results": [
      {
        "rank": 1,
        "score": 0.6607327938179555,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 2,
        "score": 0.573302749531472,
        "documentPath": "packages/connectors/README.md",
        "chunkId": "37b7bb8198c7b2d3daee73803b8dfe073f5da9f3485498012b4a3d09a27772dc"
      },
      {
        "rank": 3,
        "score": 0.5478371766308667,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 4,
        "score": 0.5231794183159062,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 5,
        "score": 0.5189755276423685,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      }
    ],
    "firstRelevantRank": 2
  },
  {
    "id": "multi-document-001",
    "question": "문서 수집부터 검색까지의 전체 데이터 흐름을 설명해 주세요.",
    "expectedDocumentPaths": [
      "packages/connectors/README.md",
      "packages/rag-core/README.md",
      "packages/database/README.md"
    ],
    "answerable": true,
    "latencyMs": 211.13558300000113,
    "results": [
      {
        "rank": 1,
        "score": 0.3936435667278859,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 2,
        "score": 0.35356952538115816,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 3,
        "score": 0.34259498818765977,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 4,
        "score": 0.3370461345439094,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 5,
        "score": 0.3234069940438511,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "multi-document-002",
    "question": "검색 결과가 외부 Agent의 답변 근거로 전달되는 과정을 설명해 주세요.",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-dogfooding/README.md"
    ],
    "answerable": true,
    "latencyMs": 227.8217910000003,
    "results": [
      {
        "rank": 1,
        "score": 0.4192477140137998,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 2,
        "score": 0.37143504192456733,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 3,
        "score": 0.3421640071537013,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "927b01006922d2837fc65136536d69fa10b1cd91dc483949ca7f5442b0b21a53"
      },
      {
        "rank": 4,
        "score": 0.330288292893406,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 5,
        "score": 0.3256967238162167,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      }
    ],
    "firstRelevantRank": 1
  },
  {
    "id": "unanswerable-001",
    "question": "townbase의 2027년 매출 목표와 영업이익률은 얼마인가요?",
    "expectedDocumentPaths": [],
    "answerable": false,
    "latencyMs": 208.90858299999854,
    "results": [
      {
        "rank": 1,
        "score": 0.27732721072494715,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 2,
        "score": 0.26934862999495246,
        "documentPath": "packages/database/README.md",
        "chunkId": "909171c02dddd8db19ce5bf4fb2628ce398f8d702c80219ef46ab807a915b973"
      },
      {
        "rank": 3,
        "score": 0.26235469720324167,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d0ec3166a5a595dee3b8c1f5356e2386cf304b15efc49ff3aaf8b940dbfcf88b"
      },
      {
        "rank": 4,
        "score": 0.2352212224051855,
        "documentPath": "packages/database/README.md",
        "chunkId": "fa115ff6ed6cea9aeff7c219415ea0294de49f4a534afadc4819332663ced902"
      },
      {
        "rank": 5,
        "score": 0.227439069495467,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2cf4b4e8f68c403682648509aa0f73fc7abb4bcc48e8b8e8bb6823f449c6c78d"
      }
    ],
    "firstRelevantRank": null
  }
]
```

## Answerability threshold 평가 결과 2026-08-24T09:37:22.302Z

- 기준: Chunking 600/80 baseline
- 정상 질문: 9개, 근거 없음 질문: 1개
- 판정식: `topScore >= 후보값` AND `averageTopThree >= 후보값 - 0.10`

### Score 분포

| 그룹 | 질문 수 | Top score 평균 | Top score 범위 | Top 3 평균 평균 | Top 3 평균 범위 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 정상 | 9 | 0.4326 | 0.3574~0.6607 | 0.4012 | 0.3359~0.5940 |
| 근거 없음 | 1 | 0.2773 | 0.2773~0.2773 | 0.2697 | 0.2697~0.2697 |

### Threshold 후보 비교

| Top threshold | Average Top 3 threshold | Accuracy | 정상 질문 거절 | 근거 없음 허용 |
| ---: | ---: | ---: | ---: | ---: |
| 0.55 | 0.45 | 20.0% | 8/9 | 0/1 |
| 0.60 | 0.50 | 20.0% | 8/9 | 0/1 |
| 0.65 | 0.55 | 20.0% | 8/9 | 0/1 |
| 0.70 | 0.60 | 10.0% | 9/9 | 0/1 |

### 질문별 score

| ID | 기대 Answerable | Top score | Average Top 3 |
| --- | --- | ---: | ---: |
| onboarding-001 | true | 0.4170 | 0.3947 |
| onboarding-002 | true | 0.4353 | 0.3984 |
| onboarding-003 | true | 0.3929 | 0.3654 |
| product-history-001 | true | 0.4576 | 0.4338 |
| implementation-001 | true | 0.3574 | 0.3479 |
| implementation-002 | true | 0.3593 | 0.3359 |
| implementation-003 | true | 0.6607 | 0.5940 |
| multi-document-001 | true | 0.3936 | 0.3633 |
| multi-document-002 | true | 0.4192 | 0.3776 |
| unanswerable-001 | false | 0.2773 | 0.2697 |

## 테스트 003. Score 분포 및 Answerability threshold 평가

### 조건

- Chunking `600/80` baseline, Embedding `text-embedding-3-small`, 1536차원, `topK=5`를 사용했다.
- 정상 질문 9개와 근거 없음 질문 1개를 분리했다.
- 후보 Top score는 `0.55`, `0.60`, `0.65`, `0.70`이다.
- Average Top 3 threshold는 비교 편의를 위해 Top threshold보다 `0.10` 낮게 설정했다.

### 핵심 결과

- 정상 질문 Top score 평균: `0.4326` (범위 `0.3574~0.6607`)
- 근거 없음 질문 Top score: `0.2773`
- 정상 질문 Average Top 3 평균: `0.4012`
- 근거 없음 질문 Average Top 3: `0.2697`
- 후보별 정확도: `0.55=20.0%`, `0.60=20.0%`, `0.65=20.0%`, `0.70=10.0%`

### 해석

- 현재 후보값은 정상 질문 9개 중 8~9개를 거절해, 이 평가 Corpus에서는 너무 높게 동작했다.
- 근거 없음 질문을 허용한 경우는 없었다.
- 현재 데이터셋은 정상 질문 9개·근거 없음 질문 1개로 작으므로, 이 결과만으로 최종 threshold를 확정하지 않는다.
- 기존 설정 `minimumTopScore=0.65`, `minimumAverageTopThreeScore=0.55`는 이번 score 분포 기준으로 재검토 대상이다.

## Chunking 400/50 실행 결과 2026-08-24T09:45:49.218Z

- 실행 시각: 2026-08-24T09:45:49.219Z
- Corpus: 6개 문서, 53개 Chunk
- Chunking: maxTokens=400, overlapTokens=50
- Embedding: text-embedding-3-small, 1536차원
- 질문 수: 10개
- Hit@5: 6/10 (60.0%)
- MRR: 0.3667
- 평균 검색 latency: 160.2ms
- Answerable 질문 평균 latency: 161.0ms

## 질문별 결과

| ID | Answerable | 첫 관련 결과 순위 | Latency | Top 결과 문서 |
| --- | --- | ---: | ---: | --- |
| onboarding-001 | true | 2 | 140.4ms | docs/local-dogfooding/README.md |
| onboarding-002 | true | 3 | 142.2ms | docs/local-dogfooding/README.md |
| onboarding-003 | true | 3 | 140.4ms | README.md |
| product-history-001 | true | 1 | 159.1ms | README.md |
| implementation-001 | true | - | 143.7ms | docs/local-dogfooding/README.md |
| implementation-002 | true | - | 160.2ms | README.md |
| implementation-003 | true | 2 | 187.7ms | README.md |
| multi-document-001 | true | - | 179.0ms | README.md |
| multi-document-002 | true | 1 | 196.6ms | README.md |
| unanswerable-001 | false | - | 152.6ms | README.md |

## 전체 검색 결과(JSON)

```json
[
  {
    "id": "onboarding-001",
    "question": "로컬에서 townbase를 실행하려면 어떤 순서로 준비해야 하나요?",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-first-execution.md"
    ],
    "answerable": true,
    "latencyMs": 140.36791600000015,
    "results": [
      {
        "rank": 1,
        "score": 0.41755413202179725,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 2,
        "score": 0.38640047467331406,
        "documentPath": "docs/local-first-execution.md",
        "chunkId": "2244053df357b222498c284dfd4ae33a7b54f420c243340ce5f80cc9cf55cdd1"
      },
      {
        "rank": 3,
        "score": 0.3807850886479405,
        "documentPath": "packages/database/README.md",
        "chunkId": "909171c02dddd8db19ce5bf4fb2628ce398f8d702c80219ef46ab807a915b973"
      },
      {
        "rank": 4,
        "score": 0.37127014910815836,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      },
      {
        "rank": 5,
        "score": 0.3634005338701609,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d62134e4da55d93e80ae6d8b5da3fddd6e31b5f6df73c7fb7d5afc4bd6f73aad"
      }
    ],
    "firstRelevantRank": 2
  },
  {
    "id": "onboarding-002",
    "question": "개발 환경에서 테스트를 실행하는 기본 명령은 무엇인가요?",
    "expectedDocumentPaths": [
      "README.md",
      "packages/rag-core/README.md"
    ],
    "answerable": true,
    "latencyMs": 142.16795899999988,
    "results": [
      {
        "rank": 1,
        "score": 0.43443732994053097,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 2,
        "score": 0.38975992420864336,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d62134e4da55d93e80ae6d8b5da3fddd6e31b5f6df73c7fb7d5afc4bd6f73aad"
      },
      {
        "rank": 3,
        "score": 0.37002146263580826,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      },
      {
        "rank": 4,
        "score": 0.3603965078589939,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "4b052954d15aa028e360cb69e541194e1cd3642721001fd031fc6d25b2a17709"
      },
      {
        "rank": 5,
        "score": 0.3212415526783955,
        "documentPath": "packages/database/README.md",
        "chunkId": "629ccd1a5de960328cde841d34782ad8d182e3e24ecd88738e01d5da86efd445"
      }
    ],
    "firstRelevantRank": 3
  },
  {
    "id": "onboarding-003",
    "question": "local-first 실행 방식은 외부 SaaS 배포와 어떻게 다른가요?",
    "expectedDocumentPaths": [
      "docs/local-first-execution.md"
    ],
    "answerable": true,
    "latencyMs": 140.43899999999985,
    "results": [
      {
        "rank": 1,
        "score": 0.3929263348776071,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 2,
        "score": 0.3545678738125255,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 3,
        "score": 0.3490160264256237,
        "documentPath": "docs/local-first-execution.md",
        "chunkId": "54f4d7504e9a7c78471e29e3717c32f33b7ef489e7e8c52c3cdb577e041d7261"
      },
      {
        "rank": 4,
        "score": 0.3423207602517544,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d025dc0cd41d5e5f7c1ec3fb8d51527ef4840bed83aa9a17b663a051b07d83f9"
      },
      {
        "rank": 5,
        "score": 0.33959558297110826,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      }
    ],
    "firstRelevantRank": 3
  },
  {
    "id": "product-history-001",
    "question": "이 프로젝트가 Retrieval-first 구조를 선택한 이유는 무엇인가요?",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-dogfooding/README.md"
    ],
    "answerable": true,
    "latencyMs": 159.0510409999997,
    "results": [
      {
        "rank": 1,
        "score": 0.45756688509900645,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 2,
        "score": 0.44591400701077843,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 3,
        "score": 0.3980326203400939,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 4,
        "score": 0.36794528954508676,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 5,
        "score": 0.34628293395063825,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "927b01006922d2837fc65136536d69fa10b1cd91dc483949ca7f5442b0b21a53"
      }
    ],
    "firstRelevantRank": 1
  },
  {
    "id": "implementation-001",
    "question": "rag-core 패키지는 어떤 역할을 담당하나요?",
    "expectedDocumentPaths": [
      "packages/rag-core/README.md"
    ],
    "answerable": true,
    "latencyMs": 143.65420900000026,
    "results": [
      {
        "rank": 1,
        "score": 0.3573500549267541,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "fac1a2cfab7833303afcc52d8c0accf93df9cf584d4d2051eed16c1cc928cd16"
      },
      {
        "rank": 2,
        "score": 0.35231494709472233,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 3,
        "score": 0.33368583249548567,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 4,
        "score": 0.3176235466441295,
        "documentPath": "README.md",
        "chunkId": "8a1d468c7e90f119f78c3e2eb1fd097ba21c1b68540442b72a06357d876763d5"
      },
      {
        "rank": 5,
        "score": 0.3175327224843715,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "implementation-002",
    "question": "database 패키지는 RAG 흐름에서 어떤 데이터를 저장하나요?",
    "expectedDocumentPaths": [
      "packages/database/README.md"
    ],
    "answerable": true,
    "latencyMs": 160.17366700000002,
    "results": [
      {
        "rank": 1,
        "score": 0.35933954055293804,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 2,
        "score": 0.3385366144190398,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 3,
        "score": 0.30984944808248827,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "6a7029da48e799670f20654c593668919a21dd3ea61bc56f4e156db37637a3e8"
      },
      {
        "rank": 4,
        "score": 0.30641908245071736,
        "documentPath": "packages/connectors/README.md",
        "chunkId": "37b7bb8198c7b2d3daee73803b8dfe073f5da9f3485498012b4a3d09a27772dc"
      },
      {
        "rank": 5,
        "score": 0.30539487133692067,
        "documentPath": "README.md",
        "chunkId": "8a1d468c7e90f119f78c3e2eb1fd097ba21c1b68540442b72a06357d876763d5"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "implementation-003",
    "question": "Notion과 로컬 Git 문서 수집은 어느 패키지에서 담당하나요?",
    "expectedDocumentPaths": [
      "packages/connectors/README.md"
    ],
    "answerable": true,
    "latencyMs": 187.69533300000012,
    "results": [
      {
        "rank": 1,
        "score": 0.6604293238478122,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 2,
        "score": 0.5733911955658685,
        "documentPath": "packages/connectors/README.md",
        "chunkId": "37b7bb8198c7b2d3daee73803b8dfe073f5da9f3485498012b4a3d09a27772dc"
      },
      {
        "rank": 3,
        "score": 0.5478371766308667,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 4,
        "score": 0.5229897700392427,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 5,
        "score": 0.5189755276423685,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      }
    ],
    "firstRelevantRank": 2
  },
  {
    "id": "multi-document-001",
    "question": "문서 수집부터 검색까지의 전체 데이터 흐름을 설명해 주세요.",
    "expectedDocumentPaths": [
      "packages/connectors/README.md",
      "packages/rag-core/README.md",
      "packages/database/README.md"
    ],
    "answerable": true,
    "latencyMs": 178.99049999999988,
    "results": [
      {
        "rank": 1,
        "score": 0.3936435667278859,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 2,
        "score": 0.35356952538115816,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 3,
        "score": 0.34259498818765977,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 4,
        "score": 0.3369852551812432,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 5,
        "score": 0.32339359786254196,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "multi-document-002",
    "question": "검색 결과가 외부 Agent의 답변 근거로 전달되는 과정을 설명해 주세요.",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-dogfooding/README.md"
    ],
    "answerable": true,
    "latencyMs": 196.58137499999975,
    "results": [
      {
        "rank": 1,
        "score": 0.4192477140137998,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 2,
        "score": 0.37163703480123766,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 3,
        "score": 0.3422040350010901,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "927b01006922d2837fc65136536d69fa10b1cd91dc483949ca7f5442b0b21a53"
      },
      {
        "rank": 4,
        "score": 0.33070956101533633,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 5,
        "score": 0.3256967238162167,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      }
    ],
    "firstRelevantRank": 1
  },
  {
    "id": "unanswerable-001",
    "question": "townbase의 2027년 매출 목표와 영업이익률은 얼마인가요?",
    "expectedDocumentPaths": [],
    "answerable": false,
    "latencyMs": 152.58262499999955,
    "results": [
      {
        "rank": 1,
        "score": 0.27710844668149737,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 2,
        "score": 0.26934862999495246,
        "documentPath": "packages/database/README.md",
        "chunkId": "909171c02dddd8db19ce5bf4fb2628ce398f8d702c80219ef46ab807a915b973"
      },
      {
        "rank": 3,
        "score": 0.2623242736697715,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d0ec3166a5a595dee3b8c1f5356e2386cf304b15efc49ff3aaf8b940dbfcf88b"
      },
      {
        "rank": 4,
        "score": 0.2352212224051855,
        "documentPath": "packages/database/README.md",
        "chunkId": "fa115ff6ed6cea9aeff7c219415ea0294de49f4a534afadc4819332663ced902"
      },
      {
        "rank": 5,
        "score": 0.22743632034316852,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2cf4b4e8f68c403682648509aa0f73fc7abb4bcc48e8b8e8bb6823f449c6c78d"
      }
    ],
    "firstRelevantRank": null
  }
]
```

## Chunking 600/80 baseline 실행 결과 2026-08-24T09:45:52.599Z

- 실행 시각: 2026-08-24T09:45:52.599Z
- Corpus: 6개 문서, 53개 Chunk
- Chunking: maxTokens=600, overlapTokens=80
- Embedding: text-embedding-3-small, 1536차원
- 질문 수: 10개
- Hit@5: 6/10 (60.0%)
- MRR: 0.3667
- 평균 검색 latency: 168.9ms
- Answerable 질문 평균 latency: 165.6ms

## 질문별 결과

| ID | Answerable | 첫 관련 결과 순위 | Latency | Top 결과 문서 |
| --- | --- | ---: | ---: | --- |
| onboarding-001 | true | 2 | 191.5ms | docs/local-dogfooding/README.md |
| onboarding-002 | true | 3 | 184.2ms | docs/local-dogfooding/README.md |
| onboarding-003 | true | 3 | 160.8ms | README.md |
| product-history-001 | true | 1 | 184.1ms | README.md |
| implementation-001 | true | - | 179.5ms | docs/local-dogfooding/README.md |
| implementation-002 | true | - | 137.6ms | README.md |
| implementation-003 | true | 2 | 141.8ms | README.md |
| multi-document-001 | true | - | 149.5ms | README.md |
| multi-document-002 | true | 1 | 161.7ms | README.md |
| unanswerable-001 | false | - | 198.5ms | README.md |

## 전체 검색 결과(JSON)

```json
[
  {
    "id": "onboarding-001",
    "question": "로컬에서 townbase를 실행하려면 어떤 순서로 준비해야 하나요?",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-first-execution.md"
    ],
    "answerable": true,
    "latencyMs": 191.4942089999995,
    "results": [
      {
        "rank": 1,
        "score": 0.41700794062094126,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 2,
        "score": 0.3864312162901904,
        "documentPath": "docs/local-first-execution.md",
        "chunkId": "2244053df357b222498c284dfd4ae33a7b54f420c243340ce5f80cc9cf55cdd1"
      },
      {
        "rank": 3,
        "score": 0.3807850886479405,
        "documentPath": "packages/database/README.md",
        "chunkId": "909171c02dddd8db19ce5bf4fb2628ce398f8d702c80219ef46ab807a915b973"
      },
      {
        "rank": 4,
        "score": 0.37125601692697696,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      },
      {
        "rank": 5,
        "score": 0.3634005338701609,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d62134e4da55d93e80ae6d8b5da3fddd6e31b5f6df73c7fb7d5afc4bd6f73aad"
      }
    ],
    "firstRelevantRank": 2
  },
  {
    "id": "onboarding-002",
    "question": "개발 환경에서 테스트를 실행하는 기본 명령은 무엇인가요?",
    "expectedDocumentPaths": [
      "README.md",
      "packages/rag-core/README.md"
    ],
    "answerable": true,
    "latencyMs": 184.22975000000042,
    "results": [
      {
        "rank": 1,
        "score": 0.4352625710572875,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 2,
        "score": 0.38975992420864336,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d62134e4da55d93e80ae6d8b5da3fddd6e31b5f6df73c7fb7d5afc4bd6f73aad"
      },
      {
        "rank": 3,
        "score": 0.37005230971855907,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      },
      {
        "rank": 4,
        "score": 0.3603965078589939,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "4b052954d15aa028e360cb69e541194e1cd3642721001fd031fc6d25b2a17709"
      },
      {
        "rank": 5,
        "score": 0.3212415526783955,
        "documentPath": "packages/database/README.md",
        "chunkId": "629ccd1a5de960328cde841d34782ad8d182e3e24ecd88738e01d5da86efd445"
      }
    ],
    "firstRelevantRank": 3
  },
  {
    "id": "onboarding-003",
    "question": "local-first 실행 방식은 외부 SaaS 배포와 어떻게 다른가요?",
    "expectedDocumentPaths": [
      "docs/local-first-execution.md"
    ],
    "answerable": true,
    "latencyMs": 160.84920799999963,
    "results": [
      {
        "rank": 1,
        "score": 0.3929263348776071,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 2,
        "score": 0.35448105991802326,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 3,
        "score": 0.3489934101704766,
        "documentPath": "docs/local-first-execution.md",
        "chunkId": "54f4d7504e9a7c78471e29e3717c32f33b7ef489e7e8c52c3cdb577e041d7261"
      },
      {
        "rank": 4,
        "score": 0.34238831082661636,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d025dc0cd41d5e5f7c1ec3fb8d51527ef4840bed83aa9a17b663a051b07d83f9"
      },
      {
        "rank": 5,
        "score": 0.33920291463385954,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      }
    ],
    "firstRelevantRank": 3
  },
  {
    "id": "product-history-001",
    "question": "이 프로젝트가 Retrieval-first 구조를 선택한 이유는 무엇인가요?",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-dogfooding/README.md"
    ],
    "answerable": true,
    "latencyMs": 184.14991699999973,
    "results": [
      {
        "rank": 1,
        "score": 0.4575374083250767,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 2,
        "score": 0.44591400701077843,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 3,
        "score": 0.3983291658898632,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 4,
        "score": 0.36794528954508676,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 5,
        "score": 0.34628293395063825,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "927b01006922d2837fc65136536d69fa10b1cd91dc483949ca7f5442b0b21a53"
      }
    ],
    "firstRelevantRank": 1
  },
  {
    "id": "implementation-001",
    "question": "rag-core 패키지는 어떤 역할을 담당하나요?",
    "expectedDocumentPaths": [
      "packages/rag-core/README.md"
    ],
    "answerable": true,
    "latencyMs": 179.4589589999996,
    "results": [
      {
        "rank": 1,
        "score": 0.3573500549267541,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "fac1a2cfab7833303afcc52d8c0accf93df9cf584d4d2051eed16c1cc928cd16"
      },
      {
        "rank": 2,
        "score": 0.35231494709472233,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 3,
        "score": 0.33976899437889463,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 4,
        "score": 0.3176235466441295,
        "documentPath": "README.md",
        "chunkId": "8a1d468c7e90f119f78c3e2eb1fd097ba21c1b68540442b72a06357d876763d5"
      },
      {
        "rank": 5,
        "score": 0.31752696896071886,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "implementation-002",
    "question": "database 패키지는 RAG 흐름에서 어떤 데이터를 저장하나요?",
    "expectedDocumentPaths": [
      "packages/database/README.md"
    ],
    "answerable": true,
    "latencyMs": 137.6254170000002,
    "results": [
      {
        "rank": 1,
        "score": 0.35933954055293804,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 2,
        "score": 0.3385366144190398,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 3,
        "score": 0.30984944808248827,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "6a7029da48e799670f20654c593668919a21dd3ea61bc56f4e156db37637a3e8"
      },
      {
        "rank": 4,
        "score": 0.30642231358520045,
        "documentPath": "packages/connectors/README.md",
        "chunkId": "37b7bb8198c7b2d3daee73803b8dfe073f5da9f3485498012b4a3d09a27772dc"
      },
      {
        "rank": 5,
        "score": 0.30539487133692067,
        "documentPath": "README.md",
        "chunkId": "8a1d468c7e90f119f78c3e2eb1fd097ba21c1b68540442b72a06357d876763d5"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "implementation-003",
    "question": "Notion과 로컬 Git 문서 수집은 어느 패키지에서 담당하나요?",
    "expectedDocumentPaths": [
      "packages/connectors/README.md"
    ],
    "answerable": true,
    "latencyMs": 141.8060830000004,
    "results": [
      {
        "rank": 1,
        "score": 0.6569686104707272,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 2,
        "score": 0.5733273290580242,
        "documentPath": "packages/connectors/README.md",
        "chunkId": "37b7bb8198c7b2d3daee73803b8dfe073f5da9f3485498012b4a3d09a27772dc"
      },
      {
        "rank": 3,
        "score": 0.5478371766308667,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 4,
        "score": 0.5231672471541422,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 5,
        "score": 0.5189755276423685,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      }
    ],
    "firstRelevantRank": 2
  },
  {
    "id": "multi-document-001",
    "question": "문서 수집부터 검색까지의 전체 데이터 흐름을 설명해 주세요.",
    "expectedDocumentPaths": [
      "packages/connectors/README.md",
      "packages/rag-core/README.md",
      "packages/database/README.md"
    ],
    "answerable": true,
    "latencyMs": 149.49637499999972,
    "results": [
      {
        "rank": 1,
        "score": 0.3936435667278859,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 2,
        "score": 0.35348315935960384,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 3,
        "score": 0.34259498818765977,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 4,
        "score": 0.33701196761096264,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 5,
        "score": 0.32647559145175875,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "multi-document-002",
    "question": "검색 결과가 외부 Agent의 답변 근거로 전달되는 과정을 설명해 주세요.",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-dogfooding/README.md"
    ],
    "answerable": true,
    "latencyMs": 161.65904200000023,
    "results": [
      {
        "rank": 1,
        "score": 0.41910665689666415,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 2,
        "score": 0.3737314736527382,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 3,
        "score": 0.3422040350010901,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "927b01006922d2837fc65136536d69fa10b1cd91dc483949ca7f5442b0b21a53"
      },
      {
        "rank": 4,
        "score": 0.3329805108617999,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 5,
        "score": 0.3256967238162167,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      }
    ],
    "firstRelevantRank": 1
  },
  {
    "id": "unanswerable-001",
    "question": "townbase의 2027년 매출 목표와 영업이익률은 얼마인가요?",
    "expectedDocumentPaths": [],
    "answerable": false,
    "latencyMs": 198.54449999999997,
    "results": [
      {
        "rank": 1,
        "score": 0.27526991052814687,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 2,
        "score": 0.26934862999495246,
        "documentPath": "packages/database/README.md",
        "chunkId": "909171c02dddd8db19ce5bf4fb2628ce398f8d702c80219ef46ab807a915b973"
      },
      {
        "rank": 3,
        "score": 0.2623242736697715,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d0ec3166a5a595dee3b8c1f5356e2386cf304b15efc49ff3aaf8b940dbfcf88b"
      },
      {
        "rank": 4,
        "score": 0.2352212224051855,
        "documentPath": "packages/database/README.md",
        "chunkId": "fa115ff6ed6cea9aeff7c219415ea0294de49f4a534afadc4819332663ced902"
      },
      {
        "rank": 5,
        "score": 0.22743632034316852,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2cf4b4e8f68c403682648509aa0f73fc7abb4bcc48e8b8e8bb6823f449c6c78d"
      }
    ],
    "firstRelevantRank": null
  }
]
```

## Chunking 800/100 실행 결과 2026-08-24T09:45:55.710Z

- 실행 시각: 2026-08-24T09:45:55.710Z
- Corpus: 6개 문서, 53개 Chunk
- Chunking: maxTokens=800, overlapTokens=100
- Embedding: text-embedding-3-small, 1536차원
- 질문 수: 10개
- Hit@5: 6/10 (60.0%)
- MRR: 0.3667
- 평균 검색 latency: 166.4ms
- Answerable 질문 평균 latency: 167.4ms

## 질문별 결과

| ID | Answerable | 첫 관련 결과 순위 | Latency | Top 결과 문서 |
| --- | --- | ---: | ---: | --- |
| onboarding-001 | true | 2 | 155.6ms | docs/local-dogfooding/README.md |
| onboarding-002 | true | 3 | 159.8ms | docs/local-dogfooding/README.md |
| onboarding-003 | true | 3 | 149.4ms | README.md |
| product-history-001 | true | 1 | 169.7ms | README.md |
| implementation-001 | true | - | 150.3ms | docs/local-dogfooding/README.md |
| implementation-002 | true | - | 190.8ms | README.md |
| implementation-003 | true | 2 | 189.7ms | README.md |
| multi-document-001 | true | - | 170.8ms | README.md |
| multi-document-002 | true | 1 | 170.8ms | README.md |
| unanswerable-001 | false | - | 157.7ms | README.md |

## 전체 검색 결과(JSON)

```json
[
  {
    "id": "onboarding-001",
    "question": "로컬에서 townbase를 실행하려면 어떤 순서로 준비해야 하나요?",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-first-execution.md"
    ],
    "answerable": true,
    "latencyMs": 155.59358299999985,
    "results": [
      {
        "rank": 1,
        "score": 0.41755413202179725,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 2,
        "score": 0.3864372200171371,
        "documentPath": "docs/local-first-execution.md",
        "chunkId": "2244053df357b222498c284dfd4ae33a7b54f420c243340ce5f80cc9cf55cdd1"
      },
      {
        "rank": 3,
        "score": 0.3807850886479405,
        "documentPath": "packages/database/README.md",
        "chunkId": "909171c02dddd8db19ce5bf4fb2628ce398f8d702c80219ef46ab807a915b973"
      },
      {
        "rank": 4,
        "score": 0.3713072237677031,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      },
      {
        "rank": 5,
        "score": 0.36338595999307544,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d62134e4da55d93e80ae6d8b5da3fddd6e31b5f6df73c7fb7d5afc4bd6f73aad"
      }
    ],
    "firstRelevantRank": 2
  },
  {
    "id": "onboarding-002",
    "question": "개발 환경에서 테스트를 실행하는 기본 명령은 무엇인가요?",
    "expectedDocumentPaths": [
      "README.md",
      "packages/rag-core/README.md"
    ],
    "answerable": true,
    "latencyMs": 159.7645420000008,
    "results": [
      {
        "rank": 1,
        "score": 0.43443732994053097,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 2,
        "score": 0.3897191016213639,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d62134e4da55d93e80ae6d8b5da3fddd6e31b5f6df73c7fb7d5afc4bd6f73aad"
      },
      {
        "rank": 3,
        "score": 0.3700292751093235,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      },
      {
        "rank": 4,
        "score": 0.3603965078589939,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "4b052954d15aa028e360cb69e541194e1cd3642721001fd031fc6d25b2a17709"
      },
      {
        "rank": 5,
        "score": 0.3212415526783955,
        "documentPath": "packages/database/README.md",
        "chunkId": "629ccd1a5de960328cde841d34782ad8d182e3e24ecd88738e01d5da86efd445"
      }
    ],
    "firstRelevantRank": 3
  },
  {
    "id": "onboarding-003",
    "question": "local-first 실행 방식은 외부 SaaS 배포와 어떻게 다른가요?",
    "expectedDocumentPaths": [
      "docs/local-first-execution.md"
    ],
    "answerable": true,
    "latencyMs": 149.37183399999958,
    "results": [
      {
        "rank": 1,
        "score": 0.39350001136527,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 2,
        "score": 0.35448105991802326,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 3,
        "score": 0.3490160264256237,
        "documentPath": "docs/local-first-execution.md",
        "chunkId": "54f4d7504e9a7c78471e29e3717c32f33b7ef489e7e8c52c3cdb577e041d7261"
      },
      {
        "rank": 4,
        "score": 0.3423207602517544,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d025dc0cd41d5e5f7c1ec3fb8d51527ef4840bed83aa9a17b663a051b07d83f9"
      },
      {
        "rank": 5,
        "score": 0.33920291463385954,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      }
    ],
    "firstRelevantRank": 3
  },
  {
    "id": "product-history-001",
    "question": "이 프로젝트가 Retrieval-first 구조를 선택한 이유는 무엇인가요?",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-dogfooding/README.md"
    ],
    "answerable": true,
    "latencyMs": 169.7079159999994,
    "results": [
      {
        "rank": 1,
        "score": 0.4575374083250767,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 2,
        "score": 0.4454215792255063,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 3,
        "score": 0.3983291658898632,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 4,
        "score": 0.36794647494454447,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 5,
        "score": 0.3462865426000197,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "927b01006922d2837fc65136536d69fa10b1cd91dc483949ca7f5442b0b21a53"
      }
    ],
    "firstRelevantRank": 1
  },
  {
    "id": "implementation-001",
    "question": "rag-core 패키지는 어떤 역할을 담당하나요?",
    "expectedDocumentPaths": [
      "packages/rag-core/README.md"
    ],
    "answerable": true,
    "latencyMs": 150.27387500000077,
    "results": [
      {
        "rank": 1,
        "score": 0.3573258250957687,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "fac1a2cfab7833303afcc52d8c0accf93df9cf584d4d2051eed16c1cc928cd16"
      },
      {
        "rank": 2,
        "score": 0.35223536764968444,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 3,
        "score": 0.33976899437889463,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 4,
        "score": 0.3175040343852098,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      },
      {
        "rank": 5,
        "score": 0.3174871668505753,
        "documentPath": "README.md",
        "chunkId": "8a1d468c7e90f119f78c3e2eb1fd097ba21c1b68540442b72a06357d876763d5"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "implementation-002",
    "question": "database 패키지는 RAG 흐름에서 어떤 데이터를 저장하나요?",
    "expectedDocumentPaths": [
      "packages/database/README.md"
    ],
    "answerable": true,
    "latencyMs": 190.79991700000028,
    "results": [
      {
        "rank": 1,
        "score": 0.3593729918066655,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 2,
        "score": 0.3385344386424649,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 3,
        "score": 0.30984944808248827,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "6a7029da48e799670f20654c593668919a21dd3ea61bc56f4e156db37637a3e8"
      },
      {
        "rank": 4,
        "score": 0.30642231358520045,
        "documentPath": "packages/connectors/README.md",
        "chunkId": "37b7bb8198c7b2d3daee73803b8dfe073f5da9f3485498012b4a3d09a27772dc"
      },
      {
        "rank": 5,
        "score": 0.3048504584223799,
        "documentPath": "README.md",
        "chunkId": "8a1d468c7e90f119f78c3e2eb1fd097ba21c1b68540442b72a06357d876763d5"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "implementation-003",
    "question": "Notion과 로컬 Git 문서 수집은 어느 패키지에서 담당하나요?",
    "expectedDocumentPaths": [
      "packages/connectors/README.md"
    ],
    "answerable": true,
    "latencyMs": 189.65245800000048,
    "results": [
      {
        "rank": 1,
        "score": 0.6569686104707272,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 2,
        "score": 0.5733273290580242,
        "documentPath": "packages/connectors/README.md",
        "chunkId": "37b7bb8198c7b2d3daee73803b8dfe073f5da9f3485498012b4a3d09a27772dc"
      },
      {
        "rank": 3,
        "score": 0.54773674150619,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 4,
        "score": 0.5231672471541422,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 5,
        "score": 0.518764421340549,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      }
    ],
    "firstRelevantRank": 2
  },
  {
    "id": "multi-document-001",
    "question": "문서 수집부터 검색까지의 전체 데이터 흐름을 설명해 주세요.",
    "expectedDocumentPaths": [
      "packages/connectors/README.md",
      "packages/rag-core/README.md",
      "packages/database/README.md"
    ],
    "answerable": true,
    "latencyMs": 170.8378329999996,
    "results": [
      {
        "rank": 1,
        "score": 0.3937185165965985,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 2,
        "score": 0.35348315935960384,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 3,
        "score": 0.3423307315892503,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 4,
        "score": 0.3369852551812432,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 5,
        "score": 0.32647559145175875,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "multi-document-002",
    "question": "검색 결과가 외부 Agent의 답변 근거로 전달되는 과정을 설명해 주세요.",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-dogfooding/README.md"
    ],
    "answerable": true,
    "latencyMs": 170.808708999999,
    "results": [
      {
        "rank": 1,
        "score": 0.41910665689666415,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 2,
        "score": 0.3737314736527382,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 3,
        "score": 0.34214112568043165,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "927b01006922d2837fc65136536d69fa10b1cd91dc483949ca7f5442b0b21a53"
      },
      {
        "rank": 4,
        "score": 0.3329805108617999,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 5,
        "score": 0.3253469174416814,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      }
    ],
    "firstRelevantRank": 1
  },
  {
    "id": "unanswerable-001",
    "question": "townbase의 2027년 매출 목표와 영업이익률은 얼마인가요?",
    "expectedDocumentPaths": [],
    "answerable": false,
    "latencyMs": 157.68129200000112,
    "results": [
      {
        "rank": 1,
        "score": 0.27526991052814687,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 2,
        "score": 0.26934862999495246,
        "documentPath": "packages/database/README.md",
        "chunkId": "909171c02dddd8db19ce5bf4fb2628ce398f8d702c80219ef46ab807a915b973"
      },
      {
        "rank": 3,
        "score": 0.2623242736697715,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d0ec3166a5a595dee3b8c1f5356e2386cf304b15efc49ff3aaf8b940dbfcf88b"
      },
      {
        "rank": 4,
        "score": 0.2352212224051855,
        "documentPath": "packages/database/README.md",
        "chunkId": "fa115ff6ed6cea9aeff7c219415ea0294de49f4a534afadc4819332663ced902"
      },
      {
        "rank": 5,
        "score": 0.22743632034316852,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2cf4b4e8f68c403682648509aa0f73fc7abb4bcc48e8b8e8bb6823f449c6c78d"
      }
    ],
    "firstRelevantRank": null
  }
]
```

## Answerability threshold 평가 결과 2026-08-24T09:45:55.711Z

- 기준: Chunking 600/80 baseline
- 정상 질문: 9개, 근거 없음 질문: 1개
- 판정식: `topScore >= 후보값` AND `averageTopThree >= 후보값 - 0.10`

### Score 분포

| 그룹 | 질문 수 | Top score 평균 | Top score 범위 | Top 3 평균 평균 | Top 3 평균 범위 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 정상 | 9 | 0.4321 | 0.3574~0.6570 | 0.4014 | 0.3359~0.5927 |
| 근거 없음 | 1 | 0.2753 | 0.2753~0.2753 | 0.2690 | 0.2690~0.2690 |

### Threshold 후보 비교

| Top threshold | Average Top 3 threshold | Accuracy | 정상 질문 거절 | 근거 없음 허용 |
| ---: | ---: | ---: | ---: | ---: |
| 0.55 | 0.45 | 20.0% | 8/9 | 0/1 |
| 0.60 | 0.50 | 20.0% | 8/9 | 0/1 |
| 0.65 | 0.55 | 20.0% | 8/9 | 0/1 |
| 0.70 | 0.60 | 10.0% | 9/9 | 0/1 |

### 질문별 score

| ID | 기대 Answerable | Top score | Average Top 3 |
| --- | --- | ---: | ---: |
| onboarding-001 | true | 0.4170 | 0.3947 |
| onboarding-002 | true | 0.4353 | 0.3984 |
| onboarding-003 | true | 0.3929 | 0.3655 |
| product-history-001 | true | 0.4575 | 0.4339 |
| implementation-001 | true | 0.3574 | 0.3498 |
| implementation-002 | true | 0.3593 | 0.3359 |
| implementation-003 | true | 0.6570 | 0.5927 |
| multi-document-001 | true | 0.3936 | 0.3632 |
| multi-document-002 | true | 0.4191 | 0.3783 |
| unanswerable-001 | false | 0.2753 | 0.2690 |

## Chunking 400/50 실행 결과 2026-08-24T09:46:25.160Z

- 실행 시각: 2026-08-24T09:46:25.161Z
- Corpus: 6개 문서, 53개 Chunk
- Chunking: maxTokens=400, overlapTokens=50
- Embedding: text-embedding-3-small, 1536차원
- 질문 수: 10개
- Hit@5: 6/10 (60.0%)
- MRR: 0.3667
- 평균 검색 latency: 172.8ms
- Answerable 질문 평균 latency: 174.0ms

## 질문별 결과

| ID | Answerable | 첫 관련 결과 순위 | Latency | Top 결과 문서 |
| --- | --- | ---: | ---: | --- |
| onboarding-001 | true | 2 | 178.7ms | docs/local-dogfooding/README.md |
| onboarding-002 | true | 3 | 168.2ms | docs/local-dogfooding/README.md |
| onboarding-003 | true | 3 | 151.2ms | README.md |
| product-history-001 | true | 1 | 182.6ms | README.md |
| implementation-001 | true | - | 152.2ms | docs/local-dogfooding/README.md |
| implementation-002 | true | - | 197.4ms | README.md |
| implementation-003 | true | 2 | 176.3ms | README.md |
| multi-document-001 | true | - | 169.2ms | README.md |
| multi-document-002 | true | 1 | 190.3ms | README.md |
| unanswerable-001 | false | - | 161.5ms | README.md |

## 전체 검색 결과(JSON)

```json
[
  {
    "id": "onboarding-001",
    "question": "로컬에서 townbase를 실행하려면 어떤 순서로 준비해야 하나요?",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-first-execution.md"
    ],
    "answerable": true,
    "latencyMs": 178.66375000000016,
    "results": [
      {
        "rank": 1,
        "score": 0.417490124960352,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 2,
        "score": 0.3864312162901904,
        "documentPath": "docs/local-first-execution.md",
        "chunkId": "2244053df357b222498c284dfd4ae33a7b54f420c243340ce5f80cc9cf55cdd1"
      },
      {
        "rank": 3,
        "score": 0.3807850886479405,
        "documentPath": "packages/database/README.md",
        "chunkId": "909171c02dddd8db19ce5bf4fb2628ce398f8d702c80219ef46ab807a915b973"
      },
      {
        "rank": 4,
        "score": 0.37125601692697696,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      },
      {
        "rank": 5,
        "score": 0.3633540879462813,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d62134e4da55d93e80ae6d8b5da3fddd6e31b5f6df73c7fb7d5afc4bd6f73aad"
      }
    ],
    "firstRelevantRank": 2
  },
  {
    "id": "onboarding-002",
    "question": "개발 환경에서 테스트를 실행하는 기본 명령은 무엇인가요?",
    "expectedDocumentPaths": [
      "README.md",
      "packages/rag-core/README.md"
    ],
    "answerable": true,
    "latencyMs": 168.21137499999986,
    "results": [
      {
        "rank": 1,
        "score": 0.43434956085517373,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 2,
        "score": 0.3897765306193375,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d62134e4da55d93e80ae6d8b5da3fddd6e31b5f6df73c7fb7d5afc4bd6f73aad"
      },
      {
        "rank": 3,
        "score": 0.37005230971855907,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      },
      {
        "rank": 4,
        "score": 0.3611076331620182,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "4b052954d15aa028e360cb69e541194e1cd3642721001fd031fc6d25b2a17709"
      },
      {
        "rank": 5,
        "score": 0.3212415526783955,
        "documentPath": "packages/database/README.md",
        "chunkId": "629ccd1a5de960328cde841d34782ad8d182e3e24ecd88738e01d5da86efd445"
      }
    ],
    "firstRelevantRank": 3
  },
  {
    "id": "onboarding-003",
    "question": "local-first 실행 방식은 외부 SaaS 배포와 어떻게 다른가요?",
    "expectedDocumentPaths": [
      "docs/local-first-execution.md"
    ],
    "answerable": true,
    "latencyMs": 151.18566599999986,
    "results": [
      {
        "rank": 1,
        "score": 0.3929263348776071,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 2,
        "score": 0.3542601156980214,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 3,
        "score": 0.3489934101704766,
        "documentPath": "docs/local-first-execution.md",
        "chunkId": "54f4d7504e9a7c78471e29e3717c32f33b7ef489e7e8c52c3cdb577e041d7261"
      },
      {
        "rank": 4,
        "score": 0.3423744198882511,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d025dc0cd41d5e5f7c1ec3fb8d51527ef4840bed83aa9a17b663a051b07d83f9"
      },
      {
        "rank": 5,
        "score": 0.3394588011461658,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      }
    ],
    "firstRelevantRank": 3
  },
  {
    "id": "product-history-001",
    "question": "이 프로젝트가 Retrieval-first 구조를 선택한 이유는 무엇인가요?",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-dogfooding/README.md"
    ],
    "answerable": true,
    "latencyMs": 182.59633399999984,
    "results": [
      {
        "rank": 1,
        "score": 0.45756688509900645,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 2,
        "score": 0.44591400701077843,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 3,
        "score": 0.3978316302799305,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 4,
        "score": 0.36794528954508676,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 5,
        "score": 0.3462600529223757,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "927b01006922d2837fc65136536d69fa10b1cd91dc483949ca7f5442b0b21a53"
      }
    ],
    "firstRelevantRank": 1
  },
  {
    "id": "implementation-001",
    "question": "rag-core 패키지는 어떤 역할을 담당하나요?",
    "expectedDocumentPaths": [
      "packages/rag-core/README.md"
    ],
    "answerable": true,
    "latencyMs": 152.15570900000012,
    "results": [
      {
        "rank": 1,
        "score": 0.35733054890248983,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "fac1a2cfab7833303afcc52d8c0accf93df9cf584d4d2051eed16c1cc928cd16"
      },
      {
        "rank": 2,
        "score": 0.35231494709472233,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 3,
        "score": 0.3339987039799597,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 4,
        "score": 0.3176235466441295,
        "documentPath": "README.md",
        "chunkId": "8a1d468c7e90f119f78c3e2eb1fd097ba21c1b68540442b72a06357d876763d5"
      },
      {
        "rank": 5,
        "score": 0.31752696896071886,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "implementation-002",
    "question": "database 패키지는 RAG 흐름에서 어떤 데이터를 저장하나요?",
    "expectedDocumentPaths": [
      "packages/database/README.md"
    ],
    "answerable": true,
    "latencyMs": 197.39075000000003,
    "results": [
      {
        "rank": 1,
        "score": 0.35933954055293804,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 2,
        "score": 0.3385366144190398,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 3,
        "score": 0.3098640881482966,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "6a7029da48e799670f20654c593668919a21dd3ea61bc56f4e156db37637a3e8"
      },
      {
        "rank": 4,
        "score": 0.30641908245071736,
        "documentPath": "packages/connectors/README.md",
        "chunkId": "37b7bb8198c7b2d3daee73803b8dfe073f5da9f3485498012b4a3d09a27772dc"
      },
      {
        "rank": 5,
        "score": 0.30539487133692067,
        "documentPath": "README.md",
        "chunkId": "8a1d468c7e90f119f78c3e2eb1fd097ba21c1b68540442b72a06357d876763d5"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "implementation-003",
    "question": "Notion과 로컬 Git 문서 수집은 어느 패키지에서 담당하나요?",
    "expectedDocumentPaths": [
      "packages/connectors/README.md"
    ],
    "answerable": true,
    "latencyMs": 176.34012500000017,
    "results": [
      {
        "rank": 1,
        "score": 0.6607327938179555,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 2,
        "score": 0.5733911955658685,
        "documentPath": "packages/connectors/README.md",
        "chunkId": "37b7bb8198c7b2d3daee73803b8dfe073f5da9f3485498012b4a3d09a27772dc"
      },
      {
        "rank": 3,
        "score": 0.5478371766308667,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 4,
        "score": 0.5231794183159062,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 5,
        "score": 0.5189755276423685,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      }
    ],
    "firstRelevantRank": 2
  },
  {
    "id": "multi-document-001",
    "question": "문서 수집부터 검색까지의 전체 데이터 흐름을 설명해 주세요.",
    "expectedDocumentPaths": [
      "packages/connectors/README.md",
      "packages/rag-core/README.md",
      "packages/database/README.md"
    ],
    "answerable": true,
    "latencyMs": 169.1606670000001,
    "results": [
      {
        "rank": 1,
        "score": 0.3936435667278859,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 2,
        "score": 0.35356952538115816,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 3,
        "score": 0.34259498818765977,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 4,
        "score": 0.3370461345439094,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 5,
        "score": 0.3234069940438511,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "multi-document-002",
    "question": "검색 결과가 외부 Agent의 답변 근거로 전달되는 과정을 설명해 주세요.",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-dogfooding/README.md"
    ],
    "answerable": true,
    "latencyMs": 190.3226669999999,
    "results": [
      {
        "rank": 1,
        "score": 0.4192477140137998,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 2,
        "score": 0.37143504192456733,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 3,
        "score": 0.3421640071537013,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "927b01006922d2837fc65136536d69fa10b1cd91dc483949ca7f5442b0b21a53"
      },
      {
        "rank": 4,
        "score": 0.330288292893406,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 5,
        "score": 0.3256967238162167,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      }
    ],
    "firstRelevantRank": 1
  },
  {
    "id": "unanswerable-001",
    "question": "townbase의 2027년 매출 목표와 영업이익률은 얼마인가요?",
    "expectedDocumentPaths": [],
    "answerable": false,
    "latencyMs": 161.51929100000052,
    "results": [
      {
        "rank": 1,
        "score": 0.27732721072494715,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 2,
        "score": 0.26934862999495246,
        "documentPath": "packages/database/README.md",
        "chunkId": "909171c02dddd8db19ce5bf4fb2628ce398f8d702c80219ef46ab807a915b973"
      },
      {
        "rank": 3,
        "score": 0.26235469720324167,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d0ec3166a5a595dee3b8c1f5356e2386cf304b15efc49ff3aaf8b940dbfcf88b"
      },
      {
        "rank": 4,
        "score": 0.2352212224051855,
        "documentPath": "packages/database/README.md",
        "chunkId": "fa115ff6ed6cea9aeff7c219415ea0294de49f4a534afadc4819332663ced902"
      },
      {
        "rank": 5,
        "score": 0.227439069495467,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2cf4b4e8f68c403682648509aa0f73fc7abb4bcc48e8b8e8bb6823f449c6c78d"
      }
    ],
    "firstRelevantRank": null
  }
]
```

## Chunking 600/80 baseline 실행 결과 2026-08-24T09:46:28.621Z

- 실행 시각: 2026-08-24T09:46:28.621Z
- Corpus: 6개 문서, 53개 Chunk
- Chunking: maxTokens=600, overlapTokens=80
- Embedding: text-embedding-3-small, 1536차원
- 질문 수: 10개
- Hit@5: 6/10 (60.0%)
- MRR: 0.3667
- 평균 검색 latency: 198.9ms
- Answerable 질문 평균 latency: 203.2ms

## 질문별 결과

| ID | Answerable | 첫 관련 결과 순위 | Latency | Top 결과 문서 |
| --- | --- | ---: | ---: | --- |
| onboarding-001 | true | 2 | 258.4ms | docs/local-dogfooding/README.md |
| onboarding-002 | true | 3 | 182.5ms | docs/local-dogfooding/README.md |
| onboarding-003 | true | 3 | 217.7ms | README.md |
| product-history-001 | true | 1 | 178.6ms | README.md |
| implementation-001 | true | - | 166.8ms | docs/local-dogfooding/README.md |
| implementation-002 | true | - | 174.8ms | README.md |
| implementation-003 | true | 2 | 286.6ms | README.md |
| multi-document-001 | true | - | 173.1ms | README.md |
| multi-document-002 | true | 1 | 190.0ms | README.md |
| unanswerable-001 | false | - | 160.8ms | README.md |

## 전체 검색 결과(JSON)

```json
[
  {
    "id": "onboarding-001",
    "question": "로컬에서 townbase를 실행하려면 어떤 순서로 준비해야 하나요?",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-first-execution.md"
    ],
    "answerable": true,
    "latencyMs": 258.35699999999997,
    "results": [
      {
        "rank": 1,
        "score": 0.41700794062094126,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 2,
        "score": 0.38640734297687307,
        "documentPath": "docs/local-first-execution.md",
        "chunkId": "2244053df357b222498c284dfd4ae33a7b54f420c243340ce5f80cc9cf55cdd1"
      },
      {
        "rank": 3,
        "score": 0.3807850886479405,
        "documentPath": "packages/database/README.md",
        "chunkId": "909171c02dddd8db19ce5bf4fb2628ce398f8d702c80219ef46ab807a915b973"
      },
      {
        "rank": 4,
        "score": 0.37127014910815836,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      },
      {
        "rank": 5,
        "score": 0.3634005338701609,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d62134e4da55d93e80ae6d8b5da3fddd6e31b5f6df73c7fb7d5afc4bd6f73aad"
      }
    ],
    "firstRelevantRank": 2
  },
  {
    "id": "onboarding-002",
    "question": "개발 환경에서 테스트를 실행하는 기본 명령은 무엇인가요?",
    "expectedDocumentPaths": [
      "README.md",
      "packages/rag-core/README.md"
    ],
    "answerable": true,
    "latencyMs": 182.52208299999984,
    "results": [
      {
        "rank": 1,
        "score": 0.4352625710572875,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 2,
        "score": 0.38975992420864336,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d62134e4da55d93e80ae6d8b5da3fddd6e31b5f6df73c7fb7d5afc4bd6f73aad"
      },
      {
        "rank": 3,
        "score": 0.37002146263580826,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      },
      {
        "rank": 4,
        "score": 0.3603965078589939,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "4b052954d15aa028e360cb69e541194e1cd3642721001fd031fc6d25b2a17709"
      },
      {
        "rank": 5,
        "score": 0.3212415526783955,
        "documentPath": "packages/database/README.md",
        "chunkId": "629ccd1a5de960328cde841d34782ad8d182e3e24ecd88738e01d5da86efd445"
      }
    ],
    "firstRelevantRank": 3
  },
  {
    "id": "onboarding-003",
    "question": "local-first 실행 방식은 외부 SaaS 배포와 어떻게 다른가요?",
    "expectedDocumentPaths": [
      "docs/local-first-execution.md"
    ],
    "answerable": true,
    "latencyMs": 217.67325000000073,
    "results": [
      {
        "rank": 1,
        "score": 0.3929263348776071,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 2,
        "score": 0.3545678738125255,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 3,
        "score": 0.3490562890106679,
        "documentPath": "docs/local-first-execution.md",
        "chunkId": "54f4d7504e9a7c78471e29e3717c32f33b7ef489e7e8c52c3cdb577e041d7261"
      },
      {
        "rank": 4,
        "score": 0.34238831082661636,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d025dc0cd41d5e5f7c1ec3fb8d51527ef4840bed83aa9a17b663a051b07d83f9"
      },
      {
        "rank": 5,
        "score": 0.33959558297110826,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      }
    ],
    "firstRelevantRank": 3
  },
  {
    "id": "product-history-001",
    "question": "이 프로젝트가 Retrieval-first 구조를 선택한 이유는 무엇인가요?",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-dogfooding/README.md"
    ],
    "answerable": true,
    "latencyMs": 178.64854100000048,
    "results": [
      {
        "rank": 1,
        "score": 0.45756688509900645,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 2,
        "score": 0.44591400701077843,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 3,
        "score": 0.3980326203400939,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 4,
        "score": 0.36794528954508676,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 5,
        "score": 0.34628293395063825,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "927b01006922d2837fc65136536d69fa10b1cd91dc483949ca7f5442b0b21a53"
      }
    ],
    "firstRelevantRank": 1
  },
  {
    "id": "implementation-001",
    "question": "rag-core 패키지는 어떤 역할을 담당하나요?",
    "expectedDocumentPaths": [
      "packages/rag-core/README.md"
    ],
    "answerable": true,
    "latencyMs": 166.8099169999996,
    "results": [
      {
        "rank": 1,
        "score": 0.3573500549267541,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "fac1a2cfab7833303afcc52d8c0accf93df9cf584d4d2051eed16c1cc928cd16"
      },
      {
        "rank": 2,
        "score": 0.35231494709472233,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 3,
        "score": 0.33368583249548567,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 4,
        "score": 0.3176235466441295,
        "documentPath": "README.md",
        "chunkId": "8a1d468c7e90f119f78c3e2eb1fd097ba21c1b68540442b72a06357d876763d5"
      },
      {
        "rank": 5,
        "score": 0.3175327224843715,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "implementation-002",
    "question": "database 패키지는 RAG 흐름에서 어떤 데이터를 저장하나요?",
    "expectedDocumentPaths": [
      "packages/database/README.md"
    ],
    "answerable": true,
    "latencyMs": 174.7661250000001,
    "results": [
      {
        "rank": 1,
        "score": 0.35933954055293804,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 2,
        "score": 0.3385366144190398,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 3,
        "score": 0.30984944808248827,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "6a7029da48e799670f20654c593668919a21dd3ea61bc56f4e156db37637a3e8"
      },
      {
        "rank": 4,
        "score": 0.30642231358520045,
        "documentPath": "packages/connectors/README.md",
        "chunkId": "37b7bb8198c7b2d3daee73803b8dfe073f5da9f3485498012b4a3d09a27772dc"
      },
      {
        "rank": 5,
        "score": 0.30539487133692067,
        "documentPath": "README.md",
        "chunkId": "8a1d468c7e90f119f78c3e2eb1fd097ba21c1b68540442b72a06357d876763d5"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "implementation-003",
    "question": "Notion과 로컬 Git 문서 수집은 어느 패키지에서 담당하나요?",
    "expectedDocumentPaths": [
      "packages/connectors/README.md"
    ],
    "answerable": true,
    "latencyMs": 286.55475000000024,
    "results": [
      {
        "rank": 1,
        "score": 0.6604293238478122,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 2,
        "score": 0.5733273290580242,
        "documentPath": "packages/connectors/README.md",
        "chunkId": "37b7bb8198c7b2d3daee73803b8dfe073f5da9f3485498012b4a3d09a27772dc"
      },
      {
        "rank": 3,
        "score": 0.5478371766308667,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 4,
        "score": 0.5229897700392427,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 5,
        "score": 0.5189755276423685,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      }
    ],
    "firstRelevantRank": 2
  },
  {
    "id": "multi-document-001",
    "question": "문서 수집부터 검색까지의 전체 데이터 흐름을 설명해 주세요.",
    "expectedDocumentPaths": [
      "packages/connectors/README.md",
      "packages/rag-core/README.md",
      "packages/database/README.md"
    ],
    "answerable": true,
    "latencyMs": 173.07425000000057,
    "results": [
      {
        "rank": 1,
        "score": 0.3936435667278859,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 2,
        "score": 0.35356952538115816,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 3,
        "score": 0.34259498818765977,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 4,
        "score": 0.33701196761096264,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 5,
        "score": 0.32339359786254196,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "multi-document-002",
    "question": "검색 결과가 외부 Agent의 답변 근거로 전달되는 과정을 설명해 주세요.",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-dogfooding/README.md"
    ],
    "answerable": true,
    "latencyMs": 189.95945800000027,
    "results": [
      {
        "rank": 1,
        "score": 0.4192477140137998,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 2,
        "score": 0.37163703480123766,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 3,
        "score": 0.3422040350010901,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "927b01006922d2837fc65136536d69fa10b1cd91dc483949ca7f5442b0b21a53"
      },
      {
        "rank": 4,
        "score": 0.33070956101533633,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 5,
        "score": 0.3256967238162167,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      }
    ],
    "firstRelevantRank": 1
  },
  {
    "id": "unanswerable-001",
    "question": "townbase의 2027년 매출 목표와 영업이익률은 얼마인가요?",
    "expectedDocumentPaths": [],
    "answerable": false,
    "latencyMs": 160.80870799999957,
    "results": [
      {
        "rank": 1,
        "score": 0.27710844668149737,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 2,
        "score": 0.26934862999495246,
        "documentPath": "packages/database/README.md",
        "chunkId": "909171c02dddd8db19ce5bf4fb2628ce398f8d702c80219ef46ab807a915b973"
      },
      {
        "rank": 3,
        "score": 0.2623242736697715,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d0ec3166a5a595dee3b8c1f5356e2386cf304b15efc49ff3aaf8b940dbfcf88b"
      },
      {
        "rank": 4,
        "score": 0.2352212224051855,
        "documentPath": "packages/database/README.md",
        "chunkId": "fa115ff6ed6cea9aeff7c219415ea0294de49f4a534afadc4819332663ced902"
      },
      {
        "rank": 5,
        "score": 0.22743632034316852,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2cf4b4e8f68c403682648509aa0f73fc7abb4bcc48e8b8e8bb6823f449c6c78d"
      }
    ],
    "firstRelevantRank": null
  }
]
```

## Chunking 800/100 실행 결과 2026-08-24T09:46:31.789Z

- 실행 시각: 2026-08-24T09:46:31.789Z
- Corpus: 6개 문서, 53개 Chunk
- Chunking: maxTokens=800, overlapTokens=100
- Embedding: text-embedding-3-small, 1536차원
- 질문 수: 10개
- Hit@5: 6/10 (60.0%)
- MRR: 0.3667
- 평균 검색 latency: 171.9ms
- Answerable 질문 평균 latency: 170.8ms

## 질문별 결과

| ID | Answerable | 첫 관련 결과 순위 | Latency | Top 결과 문서 |
| --- | --- | ---: | ---: | --- |
| onboarding-001 | true | 2 | 161.2ms | docs/local-dogfooding/README.md |
| onboarding-002 | true | 3 | 180.0ms | docs/local-dogfooding/README.md |
| onboarding-003 | true | 3 | 218.1ms | README.md |
| product-history-001 | true | 1 | 180.5ms | README.md |
| implementation-001 | true | - | 157.6ms | docs/local-dogfooding/README.md |
| implementation-002 | true | - | 182.7ms | README.md |
| implementation-003 | true | 2 | 143.8ms | README.md |
| multi-document-001 | true | - | 149.3ms | README.md |
| multi-document-002 | true | 1 | 164.5ms | README.md |
| unanswerable-001 | false | - | 181.5ms | README.md |

## 전체 검색 결과(JSON)

```json
[
  {
    "id": "onboarding-001",
    "question": "로컬에서 townbase를 실행하려면 어떤 순서로 준비해야 하나요?",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-first-execution.md"
    ],
    "answerable": true,
    "latencyMs": 161.15795900000012,
    "results": [
      {
        "rank": 1,
        "score": 0.41700794062094126,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 2,
        "score": 0.3864372200171371,
        "documentPath": "docs/local-first-execution.md",
        "chunkId": "2244053df357b222498c284dfd4ae33a7b54f420c243340ce5f80cc9cf55cdd1"
      },
      {
        "rank": 3,
        "score": 0.3807850886479405,
        "documentPath": "packages/database/README.md",
        "chunkId": "909171c02dddd8db19ce5bf4fb2628ce398f8d702c80219ef46ab807a915b973"
      },
      {
        "rank": 4,
        "score": 0.37145303058543333,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      },
      {
        "rank": 5,
        "score": 0.3634005338701609,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d62134e4da55d93e80ae6d8b5da3fddd6e31b5f6df73c7fb7d5afc4bd6f73aad"
      }
    ],
    "firstRelevantRank": 2
  },
  {
    "id": "onboarding-002",
    "question": "개발 환경에서 테스트를 실행하는 기본 명령은 무엇인가요?",
    "expectedDocumentPaths": [
      "README.md",
      "packages/rag-core/README.md"
    ],
    "answerable": true,
    "latencyMs": 179.96699999999873,
    "results": [
      {
        "rank": 1,
        "score": 0.4352625710572875,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 2,
        "score": 0.38975992420864336,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d62134e4da55d93e80ae6d8b5da3fddd6e31b5f6df73c7fb7d5afc4bd6f73aad"
      },
      {
        "rank": 3,
        "score": 0.37002329715037663,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      },
      {
        "rank": 4,
        "score": 0.3603965078589939,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "4b052954d15aa028e360cb69e541194e1cd3642721001fd031fc6d25b2a17709"
      },
      {
        "rank": 5,
        "score": 0.3212415526783955,
        "documentPath": "packages/database/README.md",
        "chunkId": "629ccd1a5de960328cde841d34782ad8d182e3e24ecd88738e01d5da86efd445"
      }
    ],
    "firstRelevantRank": 3
  },
  {
    "id": "onboarding-003",
    "question": "local-first 실행 방식은 외부 SaaS 배포와 어떻게 다른가요?",
    "expectedDocumentPaths": [
      "docs/local-first-execution.md"
    ],
    "answerable": true,
    "latencyMs": 218.05208299999867,
    "results": [
      {
        "rank": 1,
        "score": 0.3930640698437664,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 2,
        "score": 0.35470968341529474,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 3,
        "score": 0.3490160264256237,
        "documentPath": "docs/local-first-execution.md",
        "chunkId": "54f4d7504e9a7c78471e29e3717c32f33b7ef489e7e8c52c3cdb577e041d7261"
      },
      {
        "rank": 4,
        "score": 0.34238831082661636,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d025dc0cd41d5e5f7c1ec3fb8d51527ef4840bed83aa9a17b663a051b07d83f9"
      },
      {
        "rank": 5,
        "score": 0.33941599543640266,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      }
    ],
    "firstRelevantRank": 3
  },
  {
    "id": "product-history-001",
    "question": "이 프로젝트가 Retrieval-first 구조를 선택한 이유는 무엇인가요?",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-dogfooding/README.md"
    ],
    "answerable": true,
    "latencyMs": 180.4841660000002,
    "results": [
      {
        "rank": 1,
        "score": 0.45756688509900645,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 2,
        "score": 0.4458584492587283,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 3,
        "score": 0.3986841184254969,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 4,
        "score": 0.36794528954508676,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 5,
        "score": 0.34628293395063825,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "927b01006922d2837fc65136536d69fa10b1cd91dc483949ca7f5442b0b21a53"
      }
    ],
    "firstRelevantRank": 1
  },
  {
    "id": "implementation-001",
    "question": "rag-core 패키지는 어떤 역할을 담당하나요?",
    "expectedDocumentPaths": [
      "packages/rag-core/README.md"
    ],
    "answerable": true,
    "latencyMs": 157.58374999999978,
    "results": [
      {
        "rank": 1,
        "score": 0.3573500549267541,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "fac1a2cfab7833303afcc52d8c0accf93df9cf584d4d2051eed16c1cc928cd16"
      },
      {
        "rank": 2,
        "score": 0.35231494709472233,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 3,
        "score": 0.3339288165731047,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 4,
        "score": 0.3176235466441295,
        "documentPath": "README.md",
        "chunkId": "8a1d468c7e90f119f78c3e2eb1fd097ba21c1b68540442b72a06357d876763d5"
      },
      {
        "rank": 5,
        "score": 0.31761802309880804,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "implementation-002",
    "question": "database 패키지는 RAG 흐름에서 어떤 데이터를 저장하나요?",
    "expectedDocumentPaths": [
      "packages/database/README.md"
    ],
    "answerable": true,
    "latencyMs": 182.69304100000045,
    "results": [
      {
        "rank": 1,
        "score": 0.35933954055293804,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 2,
        "score": 0.3385366144190398,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 3,
        "score": 0.30984944808248827,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "6a7029da48e799670f20654c593668919a21dd3ea61bc56f4e156db37637a3e8"
      },
      {
        "rank": 4,
        "score": 0.30642231358520045,
        "documentPath": "packages/connectors/README.md",
        "chunkId": "37b7bb8198c7b2d3daee73803b8dfe073f5da9f3485498012b4a3d09a27772dc"
      },
      {
        "rank": 5,
        "score": 0.30539487133692067,
        "documentPath": "README.md",
        "chunkId": "8a1d468c7e90f119f78c3e2eb1fd097ba21c1b68540442b72a06357d876763d5"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "implementation-003",
    "question": "Notion과 로컬 Git 문서 수집은 어느 패키지에서 담당하나요?",
    "expectedDocumentPaths": [
      "packages/connectors/README.md"
    ],
    "answerable": true,
    "latencyMs": 143.83366699999897,
    "results": [
      {
        "rank": 1,
        "score": 0.6606616369100483,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 2,
        "score": 0.5733273290580242,
        "documentPath": "packages/connectors/README.md",
        "chunkId": "37b7bb8198c7b2d3daee73803b8dfe073f5da9f3485498012b4a3d09a27772dc"
      },
      {
        "rank": 3,
        "score": 0.5478371766308667,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 4,
        "score": 0.5228159863890417,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 5,
        "score": 0.5189755276423685,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      }
    ],
    "firstRelevantRank": 2
  },
  {
    "id": "multi-document-001",
    "question": "문서 수집부터 검색까지의 전체 데이터 흐름을 설명해 주세요.",
    "expectedDocumentPaths": [
      "packages/connectors/README.md",
      "packages/rag-core/README.md",
      "packages/database/README.md"
    ],
    "answerable": true,
    "latencyMs": 149.3161250000012,
    "results": [
      {
        "rank": 1,
        "score": 0.3936435667278859,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 2,
        "score": 0.35356952538115816,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 3,
        "score": 0.342953072091279,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 4,
        "score": 0.33701196761096264,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 5,
        "score": 0.3267104532337024,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "multi-document-002",
    "question": "검색 결과가 외부 Agent의 답변 근거로 전달되는 과정을 설명해 주세요.",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-dogfooding/README.md"
    ],
    "answerable": true,
    "latencyMs": 164.539084,
    "results": [
      {
        "rank": 1,
        "score": 0.4192477140137998,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 2,
        "score": 0.3739228829999348,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 3,
        "score": 0.3422040350010901,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "927b01006922d2837fc65136536d69fa10b1cd91dc483949ca7f5442b0b21a53"
      },
      {
        "rank": 4,
        "score": 0.3303798767678845,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 5,
        "score": 0.32553163850264577,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      }
    ],
    "firstRelevantRank": 1
  },
  {
    "id": "unanswerable-001",
    "question": "townbase의 2027년 매출 목표와 영업이익률은 얼마인가요?",
    "expectedDocumentPaths": [],
    "answerable": false,
    "latencyMs": 181.49241699999948,
    "results": [
      {
        "rank": 1,
        "score": 0.27737338703944836,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 2,
        "score": 0.26934862999495246,
        "documentPath": "packages/database/README.md",
        "chunkId": "909171c02dddd8db19ce5bf4fb2628ce398f8d702c80219ef46ab807a915b973"
      },
      {
        "rank": 3,
        "score": 0.2623242736697715,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d0ec3166a5a595dee3b8c1f5356e2386cf304b15efc49ff3aaf8b940dbfcf88b"
      },
      {
        "rank": 4,
        "score": 0.2352212224051855,
        "documentPath": "packages/database/README.md",
        "chunkId": "fa115ff6ed6cea9aeff7c219415ea0294de49f4a534afadc4819332663ced902"
      },
      {
        "rank": 5,
        "score": 0.22743632034316852,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2cf4b4e8f68c403682648509aa0f73fc7abb4bcc48e8b8e8bb6823f449c6c78d"
      }
    ],
    "firstRelevantRank": null
  }
]
```

## Answerability threshold 평가 결과 2026-08-24T09:46:31.790Z

- 기준: Chunking 600/80 baseline
- 정상 질문: 9개, 근거 없음 질문: 1개
- 판정식: `topScore >= 후보값` AND `averageTopThree >= 후보값 - 0.10`

### Score 분포

| 그룹 | 질문 수 | Top score 평균 | Top score 범위 | Top 3 평균 평균 | Top 3 평균 범위 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 정상 | 9 | 0.4325 | 0.3574~0.6604 | 0.4012 | 0.3359~0.5939 |
| 근거 없음 | 1 | 0.2771 | 0.2771~0.2771 | 0.2696 | 0.2696~0.2696 |

### Threshold 후보 비교

| Top threshold | Average Top 3 threshold | Accuracy | 정상 질문 거절 | 근거 없음 허용 |
| ---: | ---: | ---: | ---: | ---: |
| 0.55 | 0.45 | 20.0% | 8/9 | 0/1 |
| 0.60 | 0.50 | 20.0% | 8/9 | 0/1 |
| 0.65 | 0.55 | 20.0% | 8/9 | 0/1 |
| 0.70 | 0.60 | 10.0% | 9/9 | 0/1 |

### 질문별 score

| ID | 기대 Answerable | Top score | Average Top 3 |
| --- | --- | ---: | ---: |
| onboarding-001 | true | 0.4170 | 0.3947 |
| onboarding-002 | true | 0.4353 | 0.3983 |
| onboarding-003 | true | 0.3929 | 0.3655 |
| product-history-001 | true | 0.4576 | 0.4338 |
| implementation-001 | true | 0.3574 | 0.3478 |
| implementation-002 | true | 0.3593 | 0.3359 |
| implementation-003 | true | 0.6604 | 0.5939 |
| multi-document-001 | true | 0.3936 | 0.3633 |
| multi-document-002 | true | 0.4192 | 0.3777 |
| unanswerable-001 | false | 0.2771 | 0.2696 |

## Chunking 400/50 실행 결과 2026-08-24T09:55:36.893Z

- 실행 시각: 2026-08-24T09:55:36.894Z
- Corpus: 6개 문서, 53개 Chunk
- Chunking: maxTokens=400, overlapTokens=50
- Embedding: text-embedding-3-small, 1536차원
- 질문 수: 10개
- Hit@5: 6/10 (60.0%)
- MRR: 0.3667
- 평균 검색 latency: 187.7ms
- Answerable 질문 평균 latency: 186.1ms

## 질문별 결과

| ID | Answerable | 첫 관련 결과 순위 | Latency | Top 결과 문서 |
| --- | --- | ---: | ---: | --- |
| onboarding-001 | true | 2 | 179.0ms | docs/local-dogfooding/README.md |
| onboarding-002 | true | 3 | 177.0ms | docs/local-dogfooding/README.md |
| onboarding-003 | true | 3 | 188.8ms | README.md |
| product-history-001 | true | 1 | 182.7ms | README.md |
| implementation-001 | true | - | 187.1ms | docs/local-dogfooding/README.md |
| implementation-002 | true | - | 195.7ms | README.md |
| implementation-003 | true | 2 | 185.5ms | README.md |
| multi-document-001 | true | - | 161.9ms | README.md |
| multi-document-002 | true | 1 | 217.5ms | README.md |
| unanswerable-001 | false | - | 201.9ms | README.md |

## 전체 검색 결과(JSON)

```json
[
  {
    "id": "onboarding-001",
    "question": "로컬에서 townbase를 실행하려면 어떤 순서로 준비해야 하나요?",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-first-execution.md"
    ],
    "answerable": true,
    "latencyMs": 178.96741599999996,
    "results": [
      {
        "rank": 1,
        "score": 0.41700794062094126,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 2,
        "score": 0.38640047467331406,
        "documentPath": "docs/local-first-execution.md",
        "chunkId": "2244053df357b222498c284dfd4ae33a7b54f420c243340ce5f80cc9cf55cdd1"
      },
      {
        "rank": 3,
        "score": 0.38076023928334546,
        "documentPath": "packages/database/README.md",
        "chunkId": "909171c02dddd8db19ce5bf4fb2628ce398f8d702c80219ef46ab807a915b973"
      },
      {
        "rank": 4,
        "score": 0.37145303058543333,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      },
      {
        "rank": 5,
        "score": 0.3633214658089059,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d62134e4da55d93e80ae6d8b5da3fddd6e31b5f6df73c7fb7d5afc4bd6f73aad"
      }
    ],
    "firstRelevantRank": 2
  },
  {
    "id": "onboarding-002",
    "question": "개발 환경에서 테스트를 실행하는 기본 명령은 무엇인가요?",
    "expectedDocumentPaths": [
      "README.md",
      "packages/rag-core/README.md"
    ],
    "answerable": true,
    "latencyMs": 176.95474999999988,
    "results": [
      {
        "rank": 1,
        "score": 0.4352625710572875,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 2,
        "score": 0.38973257766472424,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d62134e4da55d93e80ae6d8b5da3fddd6e31b5f6df73c7fb7d5afc4bd6f73aad"
      },
      {
        "rank": 3,
        "score": 0.37002329715037663,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      },
      {
        "rank": 4,
        "score": 0.3603543383944824,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "4b052954d15aa028e360cb69e541194e1cd3642721001fd031fc6d25b2a17709"
      },
      {
        "rank": 5,
        "score": 0.32121769391143085,
        "documentPath": "packages/database/README.md",
        "chunkId": "629ccd1a5de960328cde841d34782ad8d182e3e24ecd88738e01d5da86efd445"
      }
    ],
    "firstRelevantRank": 3
  },
  {
    "id": "onboarding-003",
    "question": "local-first 실행 방식은 외부 SaaS 배포와 어떻게 다른가요?",
    "expectedDocumentPaths": [
      "docs/local-first-execution.md"
    ],
    "answerable": true,
    "latencyMs": 188.7770000000005,
    "results": [
      {
        "rank": 1,
        "score": 0.3930640698437664,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 2,
        "score": 0.35459318965465725,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 3,
        "score": 0.3490160264256237,
        "documentPath": "docs/local-first-execution.md",
        "chunkId": "54f4d7504e9a7c78471e29e3717c32f33b7ef489e7e8c52c3cdb577e041d7261"
      },
      {
        "rank": 4,
        "score": 0.34238831082661636,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d025dc0cd41d5e5f7c1ec3fb8d51527ef4840bed83aa9a17b663a051b07d83f9"
      },
      {
        "rank": 5,
        "score": 0.3396196109611671,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      }
    ],
    "firstRelevantRank": 3
  },
  {
    "id": "product-history-001",
    "question": "이 프로젝트가 Retrieval-first 구조를 선택한 이유는 무엇인가요?",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-dogfooding/README.md"
    ],
    "answerable": true,
    "latencyMs": 182.68308400000024,
    "results": [
      {
        "rank": 1,
        "score": 0.45750573593585475,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 2,
        "score": 0.4458584492587283,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 3,
        "score": 0.3984786576693541,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 4,
        "score": 0.3679572183088038,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 5,
        "score": 0.3462661369077249,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "927b01006922d2837fc65136536d69fa10b1cd91dc483949ca7f5442b0b21a53"
      }
    ],
    "firstRelevantRank": 1
  },
  {
    "id": "implementation-001",
    "question": "rag-core 패키지는 어떤 역할을 담당하나요?",
    "expectedDocumentPaths": [
      "packages/rag-core/README.md"
    ],
    "answerable": true,
    "latencyMs": 187.08408299999974,
    "results": [
      {
        "rank": 1,
        "score": 0.3573692981072014,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "fac1a2cfab7833303afcc52d8c0accf93df9cf584d4d2051eed16c1cc928cd16"
      },
      {
        "rank": 2,
        "score": 0.35223536764968444,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 3,
        "score": 0.3338739209830133,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 4,
        "score": 0.31761802309880804,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      },
      {
        "rank": 5,
        "score": 0.31751842812144604,
        "documentPath": "README.md",
        "chunkId": "8a1d468c7e90f119f78c3e2eb1fd097ba21c1b68540442b72a06357d876763d5"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "implementation-002",
    "question": "database 패키지는 RAG 흐름에서 어떤 데이터를 저장하나요?",
    "expectedDocumentPaths": [
      "packages/database/README.md"
    ],
    "answerable": true,
    "latencyMs": 195.6709579999997,
    "results": [
      {
        "rank": 1,
        "score": 0.359345801172545,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 2,
        "score": 0.3385344386424649,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 3,
        "score": 0.30986383419346986,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "6a7029da48e799670f20654c593668919a21dd3ea61bc56f4e156db37637a3e8"
      },
      {
        "rank": 4,
        "score": 0.3063540045731741,
        "documentPath": "packages/connectors/README.md",
        "chunkId": "37b7bb8198c7b2d3daee73803b8dfe073f5da9f3485498012b4a3d09a27772dc"
      },
      {
        "rank": 5,
        "score": 0.30534319850736025,
        "documentPath": "README.md",
        "chunkId": "8a1d468c7e90f119f78c3e2eb1fd097ba21c1b68540442b72a06357d876763d5"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "implementation-003",
    "question": "Notion과 로컬 Git 문서 수집은 어느 패키지에서 담당하나요?",
    "expectedDocumentPaths": [
      "packages/connectors/README.md"
    ],
    "answerable": true,
    "latencyMs": 185.48945899999944,
    "results": [
      {
        "rank": 1,
        "score": 0.6603738471899437,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 2,
        "score": 0.5733021949872636,
        "documentPath": "packages/connectors/README.md",
        "chunkId": "37b7bb8198c7b2d3daee73803b8dfe073f5da9f3485498012b4a3d09a27772dc"
      },
      {
        "rank": 3,
        "score": 0.54773674150619,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 4,
        "score": 0.5231774222953577,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 5,
        "score": 0.5188313306307062,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      }
    ],
    "firstRelevantRank": 2
  },
  {
    "id": "multi-document-001",
    "question": "문서 수집부터 검색까지의 전체 데이터 흐름을 설명해 주세요.",
    "expectedDocumentPaths": [
      "packages/connectors/README.md",
      "packages/rag-core/README.md",
      "packages/database/README.md"
    ],
    "answerable": true,
    "latencyMs": 161.90729199999987,
    "results": [
      {
        "rank": 1,
        "score": 0.39366846617499296,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 2,
        "score": 0.3535843913695189,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 3,
        "score": 0.342953072091279,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 4,
        "score": 0.33701196761096264,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 5,
        "score": 0.3267976889257497,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "multi-document-002",
    "question": "검색 결과가 외부 Agent의 답변 근거로 전달되는 과정을 설명해 주세요.",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-dogfooding/README.md"
    ],
    "answerable": true,
    "latencyMs": 217.4730410000002,
    "results": [
      {
        "rank": 1,
        "score": 0.4193097586168275,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 2,
        "score": 0.37381040109304275,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 3,
        "score": 0.34214710547990335,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "927b01006922d2837fc65136536d69fa10b1cd91dc483949ca7f5442b0b21a53"
      },
      {
        "rank": 4,
        "score": 0.3305160655480688,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 5,
        "score": 0.32553163850264577,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      }
    ],
    "firstRelevantRank": 1
  },
  {
    "id": "unanswerable-001",
    "question": "townbase의 2027년 매출 목표와 영업이익률은 얼마인가요?",
    "expectedDocumentPaths": [],
    "answerable": false,
    "latencyMs": 201.87441599999966,
    "results": [
      {
        "rank": 1,
        "score": 0.2773438908644009,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 2,
        "score": 0.26937141993417013,
        "documentPath": "packages/database/README.md",
        "chunkId": "909171c02dddd8db19ce5bf4fb2628ce398f8d702c80219ef46ab807a915b973"
      },
      {
        "rank": 3,
        "score": 0.26232529228322,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d0ec3166a5a595dee3b8c1f5356e2386cf304b15efc49ff3aaf8b940dbfcf88b"
      },
      {
        "rank": 4,
        "score": 0.23527389538209897,
        "documentPath": "packages/database/README.md",
        "chunkId": "fa115ff6ed6cea9aeff7c219415ea0294de49f4a534afadc4819332663ced902"
      },
      {
        "rank": 5,
        "score": 0.2275037985904842,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2cf4b4e8f68c403682648509aa0f73fc7abb4bcc48e8b8e8bb6823f449c6c78d"
      }
    ],
    "firstRelevantRank": null
  }
]
```

## Chunking 600/80 baseline 실행 결과 2026-08-24T09:55:40.159Z

- 실행 시각: 2026-08-24T09:55:40.159Z
- Corpus: 6개 문서, 53개 Chunk
- Chunking: maxTokens=600, overlapTokens=80
- Embedding: text-embedding-3-small, 1536차원
- 질문 수: 10개
- Hit@5: 6/10 (60.0%)
- MRR: 0.3667
- 평균 검색 latency: 162.6ms
- Answerable 질문 평균 latency: 161.0ms

## 질문별 결과

| ID | Answerable | 첫 관련 결과 순위 | Latency | Top 결과 문서 |
| --- | --- | ---: | ---: | --- |
| onboarding-001 | true | 2 | 169.9ms | docs/local-dogfooding/README.md |
| onboarding-002 | true | 3 | 159.4ms | docs/local-dogfooding/README.md |
| onboarding-003 | true | 3 | 150.8ms | README.md |
| product-history-001 | true | 1 | 163.6ms | README.md |
| implementation-001 | true | - | 144.1ms | docs/local-dogfooding/README.md |
| implementation-002 | true | - | 180.7ms | README.md |
| implementation-003 | true | 2 | 160.2ms | README.md |
| multi-document-001 | true | - | 158.6ms | README.md |
| multi-document-002 | true | 1 | 161.8ms | README.md |
| unanswerable-001 | false | - | 176.5ms | README.md |

## 전체 검색 결과(JSON)

```json
[
  {
    "id": "onboarding-001",
    "question": "로컬에서 townbase를 실행하려면 어떤 순서로 준비해야 하나요?",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-first-execution.md"
    ],
    "answerable": true,
    "latencyMs": 169.94366600000012,
    "results": [
      {
        "rank": 1,
        "score": 0.41700794062094126,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 2,
        "score": 0.3864372200171371,
        "documentPath": "docs/local-first-execution.md",
        "chunkId": "2244053df357b222498c284dfd4ae33a7b54f420c243340ce5f80cc9cf55cdd1"
      },
      {
        "rank": 3,
        "score": 0.3807850886479405,
        "documentPath": "packages/database/README.md",
        "chunkId": "909171c02dddd8db19ce5bf4fb2628ce398f8d702c80219ef46ab807a915b973"
      },
      {
        "rank": 4,
        "score": 0.37125601692697696,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      },
      {
        "rank": 5,
        "score": 0.3632654308107075,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d62134e4da55d93e80ae6d8b5da3fddd6e31b5f6df73c7fb7d5afc4bd6f73aad"
      }
    ],
    "firstRelevantRank": 2
  },
  {
    "id": "onboarding-002",
    "question": "개발 환경에서 테스트를 실행하는 기본 명령은 무엇인가요?",
    "expectedDocumentPaths": [
      "README.md",
      "packages/rag-core/README.md"
    ],
    "answerable": true,
    "latencyMs": 159.44645899999978,
    "results": [
      {
        "rank": 1,
        "score": 0.4352625710572875,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 2,
        "score": 0.389697404249173,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d62134e4da55d93e80ae6d8b5da3fddd6e31b5f6df73c7fb7d5afc4bd6f73aad"
      },
      {
        "rank": 3,
        "score": 0.37005230971855907,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      },
      {
        "rank": 4,
        "score": 0.3603543383944824,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "4b052954d15aa028e360cb69e541194e1cd3642721001fd031fc6d25b2a17709"
      },
      {
        "rank": 5,
        "score": 0.3212415526783955,
        "documentPath": "packages/database/README.md",
        "chunkId": "629ccd1a5de960328cde841d34782ad8d182e3e24ecd88738e01d5da86efd445"
      }
    ],
    "firstRelevantRank": 3
  },
  {
    "id": "onboarding-003",
    "question": "local-first 실행 방식은 외부 SaaS 배포와 어떻게 다른가요?",
    "expectedDocumentPaths": [
      "docs/local-first-execution.md"
    ],
    "answerable": true,
    "latencyMs": 150.80720799999926,
    "results": [
      {
        "rank": 1,
        "score": 0.3929263348776071,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 2,
        "score": 0.3542601156980214,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 3,
        "score": 0.3490160264256237,
        "documentPath": "docs/local-first-execution.md",
        "chunkId": "54f4d7504e9a7c78471e29e3717c32f33b7ef489e7e8c52c3cdb577e041d7261"
      },
      {
        "rank": 4,
        "score": 0.34238831082661636,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d025dc0cd41d5e5f7c1ec3fb8d51527ef4840bed83aa9a17b663a051b07d83f9"
      },
      {
        "rank": 5,
        "score": 0.3394588011461658,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      }
    ],
    "firstRelevantRank": 3
  },
  {
    "id": "product-history-001",
    "question": "이 프로젝트가 Retrieval-first 구조를 선택한 이유는 무엇인가요?",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-dogfooding/README.md"
    ],
    "answerable": true,
    "latencyMs": 163.62937499999953,
    "results": [
      {
        "rank": 1,
        "score": 0.45756688509900645,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 2,
        "score": 0.44591400701077843,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 3,
        "score": 0.3978316302799305,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 4,
        "score": 0.36794528954508676,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 5,
        "score": 0.3462661369077249,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "927b01006922d2837fc65136536d69fa10b1cd91dc483949ca7f5442b0b21a53"
      }
    ],
    "firstRelevantRank": 1
  },
  {
    "id": "implementation-001",
    "question": "rag-core 패키지는 어떤 역할을 담당하나요?",
    "expectedDocumentPaths": [
      "packages/rag-core/README.md"
    ],
    "answerable": true,
    "latencyMs": 144.0584170000002,
    "results": [
      {
        "rank": 1,
        "score": 0.3573692981072014,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "fac1a2cfab7833303afcc52d8c0accf93df9cf584d4d2051eed16c1cc928cd16"
      },
      {
        "rank": 2,
        "score": 0.35231494709472233,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 3,
        "score": 0.3339987039799597,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 4,
        "score": 0.3176235466441295,
        "documentPath": "README.md",
        "chunkId": "8a1d468c7e90f119f78c3e2eb1fd097ba21c1b68540442b72a06357d876763d5"
      },
      {
        "rank": 5,
        "score": 0.31752696896071886,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "implementation-002",
    "question": "database 패키지는 RAG 흐름에서 어떤 데이터를 저장하나요?",
    "expectedDocumentPaths": [
      "packages/database/README.md"
    ],
    "answerable": true,
    "latencyMs": 180.74095800000032,
    "results": [
      {
        "rank": 1,
        "score": 0.35933954055293804,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 2,
        "score": 0.3385366144190398,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 3,
        "score": 0.30986383419346986,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "6a7029da48e799670f20654c593668919a21dd3ea61bc56f4e156db37637a3e8"
      },
      {
        "rank": 4,
        "score": 0.30641908245071736,
        "documentPath": "packages/connectors/README.md",
        "chunkId": "37b7bb8198c7b2d3daee73803b8dfe073f5da9f3485498012b4a3d09a27772dc"
      },
      {
        "rank": 5,
        "score": 0.30539487133692067,
        "documentPath": "README.md",
        "chunkId": "8a1d468c7e90f119f78c3e2eb1fd097ba21c1b68540442b72a06357d876763d5"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "implementation-003",
    "question": "Notion과 로컬 Git 문서 수집은 어느 패키지에서 담당하나요?",
    "expectedDocumentPaths": [
      "packages/connectors/README.md"
    ],
    "answerable": true,
    "latencyMs": 160.2104590000008,
    "results": [
      {
        "rank": 1,
        "score": 0.6607327938179555,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 2,
        "score": 0.5733911955658685,
        "documentPath": "packages/connectors/README.md",
        "chunkId": "37b7bb8198c7b2d3daee73803b8dfe073f5da9f3485498012b4a3d09a27772dc"
      },
      {
        "rank": 3,
        "score": 0.5478371766308667,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 4,
        "score": 0.5231794183159062,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 5,
        "score": 0.5189755276423685,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      }
    ],
    "firstRelevantRank": 2
  },
  {
    "id": "multi-document-001",
    "question": "문서 수집부터 검색까지의 전체 데이터 흐름을 설명해 주세요.",
    "expectedDocumentPaths": [
      "packages/connectors/README.md",
      "packages/rag-core/README.md",
      "packages/database/README.md"
    ],
    "answerable": true,
    "latencyMs": 158.63875000000007,
    "results": [
      {
        "rank": 1,
        "score": 0.3936435667278859,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 2,
        "score": 0.35356952538115816,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 3,
        "score": 0.34259498818765977,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 4,
        "score": 0.33701196761096264,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 5,
        "score": 0.3234069940438511,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "multi-document-002",
    "question": "검색 결과가 외부 Agent의 답변 근거로 전달되는 과정을 설명해 주세요.",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-dogfooding/README.md"
    ],
    "answerable": true,
    "latencyMs": 161.76187500000015,
    "results": [
      {
        "rank": 1,
        "score": 0.4192477140137998,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 2,
        "score": 0.37143504192456733,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 3,
        "score": 0.34214710547990335,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "927b01006922d2837fc65136536d69fa10b1cd91dc483949ca7f5442b0b21a53"
      },
      {
        "rank": 4,
        "score": 0.330288292893406,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 5,
        "score": 0.3256967238162167,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      }
    ],
    "firstRelevantRank": 1
  },
  {
    "id": "unanswerable-001",
    "question": "townbase의 2027년 매출 목표와 영업이익률은 얼마인가요?",
    "expectedDocumentPaths": [],
    "answerable": false,
    "latencyMs": 176.50920900000165,
    "results": [
      {
        "rank": 1,
        "score": 0.27732721072494715,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 2,
        "score": 0.26934862999495246,
        "documentPath": "packages/database/README.md",
        "chunkId": "909171c02dddd8db19ce5bf4fb2628ce398f8d702c80219ef46ab807a915b973"
      },
      {
        "rank": 3,
        "score": 0.26232529228322,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d0ec3166a5a595dee3b8c1f5356e2386cf304b15efc49ff3aaf8b940dbfcf88b"
      },
      {
        "rank": 4,
        "score": 0.2352212224051855,
        "documentPath": "packages/database/README.md",
        "chunkId": "fa115ff6ed6cea9aeff7c219415ea0294de49f4a534afadc4819332663ced902"
      },
      {
        "rank": 5,
        "score": 0.2275037985904842,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2cf4b4e8f68c403682648509aa0f73fc7abb4bcc48e8b8e8bb6823f449c6c78d"
      }
    ],
    "firstRelevantRank": null
  }
]
```

## Chunking 800/100 실행 결과 2026-08-24T09:55:43.462Z

- 실행 시각: 2026-08-24T09:55:43.462Z
- Corpus: 6개 문서, 53개 Chunk
- Chunking: maxTokens=800, overlapTokens=100
- Embedding: text-embedding-3-small, 1536차원
- 질문 수: 10개
- Hit@5: 6/10 (60.0%)
- MRR: 0.3667
- 평균 검색 latency: 185.3ms
- Answerable 질문 평균 latency: 182.4ms

## 질문별 결과

| ID | Answerable | 첫 관련 결과 순위 | Latency | Top 결과 문서 |
| --- | --- | ---: | ---: | --- |
| onboarding-001 | true | 2 | 180.9ms | docs/local-dogfooding/README.md |
| onboarding-002 | true | 3 | 172.8ms | docs/local-dogfooding/README.md |
| onboarding-003 | true | 3 | 197.4ms | README.md |
| product-history-001 | true | 1 | 192.9ms | README.md |
| implementation-001 | true | - | 150.2ms | docs/local-dogfooding/README.md |
| implementation-002 | true | - | 214.4ms | README.md |
| implementation-003 | true | 2 | 187.1ms | README.md |
| multi-document-001 | true | - | 167.7ms | README.md |
| multi-document-002 | true | 1 | 178.3ms | README.md |
| unanswerable-001 | false | - | 211.4ms | README.md |

## 전체 검색 결과(JSON)

```json
[
  {
    "id": "onboarding-001",
    "question": "로컬에서 townbase를 실행하려면 어떤 순서로 준비해야 하나요?",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-first-execution.md"
    ],
    "answerable": true,
    "latencyMs": 180.93445799999972,
    "results": [
      {
        "rank": 1,
        "score": 0.41755413202179725,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 2,
        "score": 0.38640047467331406,
        "documentPath": "docs/local-first-execution.md",
        "chunkId": "2244053df357b222498c284dfd4ae33a7b54f420c243340ce5f80cc9cf55cdd1"
      },
      {
        "rank": 3,
        "score": 0.3807850886479405,
        "documentPath": "packages/database/README.md",
        "chunkId": "909171c02dddd8db19ce5bf4fb2628ce398f8d702c80219ef46ab807a915b973"
      },
      {
        "rank": 4,
        "score": 0.37141188521997437,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      },
      {
        "rank": 5,
        "score": 0.3634005338701609,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d62134e4da55d93e80ae6d8b5da3fddd6e31b5f6df73c7fb7d5afc4bd6f73aad"
      }
    ],
    "firstRelevantRank": 2
  },
  {
    "id": "onboarding-002",
    "question": "개발 환경에서 테스트를 실행하는 기본 명령은 무엇인가요?",
    "expectedDocumentPaths": [
      "README.md",
      "packages/rag-core/README.md"
    ],
    "answerable": true,
    "latencyMs": 172.78979199999958,
    "results": [
      {
        "rank": 1,
        "score": 0.43443732994053097,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 2,
        "score": 0.38975992420864336,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d62134e4da55d93e80ae6d8b5da3fddd6e31b5f6df73c7fb7d5afc4bd6f73aad"
      },
      {
        "rank": 3,
        "score": 0.3699207936296709,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      },
      {
        "rank": 4,
        "score": 0.35991531590166637,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "4b052954d15aa028e360cb69e541194e1cd3642721001fd031fc6d25b2a17709"
      },
      {
        "rank": 5,
        "score": 0.3212415526783955,
        "documentPath": "packages/database/README.md",
        "chunkId": "629ccd1a5de960328cde841d34782ad8d182e3e24ecd88738e01d5da86efd445"
      }
    ],
    "firstRelevantRank": 3
  },
  {
    "id": "onboarding-003",
    "question": "local-first 실행 방식은 외부 SaaS 배포와 어떻게 다른가요?",
    "expectedDocumentPaths": [
      "docs/local-first-execution.md"
    ],
    "answerable": true,
    "latencyMs": 197.38462499999878,
    "results": [
      {
        "rank": 1,
        "score": 0.3932821207309567,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 2,
        "score": 0.35470968341529474,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 3,
        "score": 0.3490160264256237,
        "documentPath": "docs/local-first-execution.md",
        "chunkId": "54f4d7504e9a7c78471e29e3717c32f33b7ef489e7e8c52c3cdb577e041d7261"
      },
      {
        "rank": 4,
        "score": 0.3423207602517544,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d025dc0cd41d5e5f7c1ec3fb8d51527ef4840bed83aa9a17b663a051b07d83f9"
      },
      {
        "rank": 5,
        "score": 0.33941599543640266,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      }
    ],
    "firstRelevantRank": 3
  },
  {
    "id": "product-history-001",
    "question": "이 프로젝트가 Retrieval-first 구조를 선택한 이유는 무엇인가요?",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-dogfooding/README.md"
    ],
    "answerable": true,
    "latencyMs": 192.91037499999948,
    "results": [
      {
        "rank": 1,
        "score": 0.45756688509900645,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 2,
        "score": 0.4465787652390143,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 3,
        "score": 0.3986841184254969,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 4,
        "score": 0.36794528954508676,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 5,
        "score": 0.3462865426000197,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "927b01006922d2837fc65136536d69fa10b1cd91dc483949ca7f5442b0b21a53"
      }
    ],
    "firstRelevantRank": 1
  },
  {
    "id": "implementation-001",
    "question": "rag-core 패키지는 어떤 역할을 담당하나요?",
    "expectedDocumentPaths": [
      "packages/rag-core/README.md"
    ],
    "answerable": true,
    "latencyMs": 150.19758400000137,
    "results": [
      {
        "rank": 1,
        "score": 0.3573258250957687,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "fac1a2cfab7833303afcc52d8c0accf93df9cf584d4d2051eed16c1cc928cd16"
      },
      {
        "rank": 2,
        "score": 0.35231494709472233,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 3,
        "score": 0.3339288165731047,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 4,
        "score": 0.3176235466441295,
        "documentPath": "README.md",
        "chunkId": "8a1d468c7e90f119f78c3e2eb1fd097ba21c1b68540442b72a06357d876763d5"
      },
      {
        "rank": 5,
        "score": 0.3175516900111466,
        "documentPath": "README.md",
        "chunkId": "7494d93e85afc2eae4be21777e0b8f8827f89d211c60c7ba44d493876b6a8f66"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "implementation-002",
    "question": "database 패키지는 RAG 흐름에서 어떤 데이터를 저장하나요?",
    "expectedDocumentPaths": [
      "packages/database/README.md"
    ],
    "answerable": true,
    "latencyMs": 214.429666,
    "results": [
      {
        "rank": 1,
        "score": 0.35933954055293804,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 2,
        "score": 0.3385366144190398,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 3,
        "score": 0.3098653939648859,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "6a7029da48e799670f20654c593668919a21dd3ea61bc56f4e156db37637a3e8"
      },
      {
        "rank": 4,
        "score": 0.30642231358520045,
        "documentPath": "packages/connectors/README.md",
        "chunkId": "37b7bb8198c7b2d3daee73803b8dfe073f5da9f3485498012b4a3d09a27772dc"
      },
      {
        "rank": 5,
        "score": 0.30539487133692067,
        "documentPath": "README.md",
        "chunkId": "8a1d468c7e90f119f78c3e2eb1fd097ba21c1b68540442b72a06357d876763d5"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "implementation-003",
    "question": "Notion과 로컬 Git 문서 수집은 어느 패키지에서 담당하나요?",
    "expectedDocumentPaths": [
      "packages/connectors/README.md"
    ],
    "answerable": true,
    "latencyMs": 187.0956669999996,
    "results": [
      {
        "rank": 1,
        "score": 0.6606616369100483,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 2,
        "score": 0.5733273290580242,
        "documentPath": "packages/connectors/README.md",
        "chunkId": "37b7bb8198c7b2d3daee73803b8dfe073f5da9f3485498012b4a3d09a27772dc"
      },
      {
        "rank": 3,
        "score": 0.5478371766308667,
        "documentPath": "README.md",
        "chunkId": "fa4d527c42b339af7b9b1c8de4d7824fcfd26919fe6dab594f628d4fb6a5ca82"
      },
      {
        "rank": 4,
        "score": 0.5228159863890417,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 5,
        "score": 0.5189755276423685,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      }
    ],
    "firstRelevantRank": 2
  },
  {
    "id": "multi-document-001",
    "question": "문서 수집부터 검색까지의 전체 데이터 흐름을 설명해 주세요.",
    "expectedDocumentPaths": [
      "packages/connectors/README.md",
      "packages/rag-core/README.md",
      "packages/database/README.md"
    ],
    "answerable": true,
    "latencyMs": 167.68345899999986,
    "results": [
      {
        "rank": 1,
        "score": 0.3936435667278859,
        "documentPath": "README.md",
        "chunkId": "b1da5c9270bb8960d7af4e569de6f61a5664d7027d7433b261b0dc70f9caf200"
      },
      {
        "rank": 2,
        "score": 0.35356952538115816,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 3,
        "score": 0.3422053668404075,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      },
      {
        "rank": 4,
        "score": 0.3369852551812432,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2f81ba2a395b63e7f67d05d930fbc3565e2e8010d563d88a49b455ffedefa357"
      },
      {
        "rank": 5,
        "score": 0.3267104532337024,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      }
    ],
    "firstRelevantRank": null
  },
  {
    "id": "multi-document-002",
    "question": "검색 결과가 외부 Agent의 답변 근거로 전달되는 과정을 설명해 주세요.",
    "expectedDocumentPaths": [
      "README.md",
      "docs/local-dogfooding/README.md"
    ],
    "answerable": true,
    "latencyMs": 178.25820899999962,
    "results": [
      {
        "rank": 1,
        "score": 0.4192477140137998,
        "documentPath": "README.md",
        "chunkId": "8df7955f74c893c22eb51325663d081dfc632c96bb894bce987605fe37716f87"
      },
      {
        "rank": 2,
        "score": 0.3739228829999348,
        "documentPath": "README.md",
        "chunkId": "55f67b86faa44b7d26d3b613b553c465eb0755733c54d9d115749878011528e7"
      },
      {
        "rank": 3,
        "score": 0.34214112568043165,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "927b01006922d2837fc65136536d69fa10b1cd91dc483949ca7f5442b0b21a53"
      },
      {
        "rank": 4,
        "score": 0.3303798767678845,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 5,
        "score": 0.32531299808306646,
        "documentPath": "README.md",
        "chunkId": "8713d5025e93c72a2a974a2fe8e2203241139b6fca318d1f7ad4a53bc3aed5d9"
      }
    ],
    "firstRelevantRank": 1
  },
  {
    "id": "unanswerable-001",
    "question": "townbase의 2027년 매출 목표와 영업이익률은 얼마인가요?",
    "expectedDocumentPaths": [],
    "answerable": false,
    "latencyMs": 211.40487500000017,
    "results": [
      {
        "rank": 1,
        "score": 0.27737338703944836,
        "documentPath": "README.md",
        "chunkId": "5d22dd345bc3b7103bc10e207ddb37363f169d0ae9d6668e453dd65d1ee18684"
      },
      {
        "rank": 2,
        "score": 0.26934862999495246,
        "documentPath": "packages/database/README.md",
        "chunkId": "909171c02dddd8db19ce5bf4fb2628ce398f8d702c80219ef46ab807a915b973"
      },
      {
        "rank": 3,
        "score": 0.2622227101571033,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "d0ec3166a5a595dee3b8c1f5356e2386cf304b15efc49ff3aaf8b940dbfcf88b"
      },
      {
        "rank": 4,
        "score": 0.2352212224051855,
        "documentPath": "packages/database/README.md",
        "chunkId": "fa115ff6ed6cea9aeff7c219415ea0294de49f4a534afadc4819332663ced902"
      },
      {
        "rank": 5,
        "score": 0.22742098649864295,
        "documentPath": "docs/local-dogfooding/README.md",
        "chunkId": "2cf4b4e8f68c403682648509aa0f73fc7abb4bcc48e8b8e8bb6823f449c6c78d"
      }
    ],
    "firstRelevantRank": null
  }
]
```

## Answerability threshold 평가 결과 2026-08-24T09:55:43.463Z

- 기준: Chunking 600/80 baseline
- 정상 질문: 9개, 근거 없음 질문: 1개
- 판정식: `topScore >= 후보값` AND `averageTopThree >= 후보값 - 0.10`

### Score 분포

| 그룹 | 질문 수 | Top score 평균 | Top score 범위 | Top 3 평균 평균 | Top 3 평균 범위 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 정상 | 9 | 0.4326 | 0.3574~0.6607 | 0.4012 | 0.3359~0.5940 |
| 근거 없음 | 1 | 0.2773 | 0.2773~0.2773 | 0.2697 | 0.2697~0.2697 |

### Threshold 후보 비교

| Top threshold | Average Top 3 threshold | Accuracy | 정상 질문 거절 | 근거 없음 허용 |
| ---: | ---: | ---: | ---: | ---: |
| 0.35 | 0.25 | 100.0% | 0/9 | 0/1 |
| 0.55 | 0.45 | 20.0% | 8/9 | 0/1 |
| 0.60 | 0.50 | 20.0% | 8/9 | 0/1 |
| 0.65 | 0.55 | 20.0% | 8/9 | 0/1 |
| 0.70 | 0.60 | 10.0% | 9/9 | 0/1 |

### 질문별 score

| ID | 기대 Answerable | Top score | Average Top 3 |
| --- | --- | ---: | ---: |
| onboarding-001 | true | 0.4170 | 0.3947 |
| onboarding-002 | true | 0.4353 | 0.3983 |
| onboarding-003 | true | 0.3929 | 0.3654 |
| product-history-001 | true | 0.4576 | 0.4338 |
| implementation-001 | true | 0.3574 | 0.3479 |
| implementation-002 | true | 0.3593 | 0.3359 |
| implementation-003 | true | 0.6607 | 0.5940 |
| multi-document-001 | true | 0.3936 | 0.3633 |
| multi-document-002 | true | 0.4192 | 0.3776 |
| unanswerable-001 | false | 0.2773 | 0.2697 |
