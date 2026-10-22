# v0.2 초기 배포 실행 안내

현재 제공: API·초기 상태 웹·PostgreSQL/pgvector·migration·분리된 파일 volume. **관리자 등록·로그인·문서 등록·채팅은 아직 사용할 수 없다.** 상태 확인 성공은 제품 전체 준비 완료를 뜻하지 않는다.

## 1. 첫 실행

지원 검증 목표는 Linux x86_64, 4 vCPU·8GiB RAM·40GiB 여유 공간이다. Docker Engine/Desktop·Compose plugin과 이미지/패키지 다운로드 연결이 필요하다. Node를 설치하지 않았다면 비밀 파일 준비만 아래 컨테이너 명령을 사용한다.

저장소 루트에서:

```bash
node deployment/prepare.mjs
docker compose up -d --build
docker compose ps -a
curl -f http://127.0.0.1:3000/readyz
```

Node가 없는 호스트의 비밀 파일 준비 대안:

```bash
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" -w /workspace node:24.19.0-bookworm-slim node deployment/prepare.mjs
```

브라우저에서 `http://127.0.0.1:3000`을 연다. 포트 변경은 `TOWNBASE_PORT=3100 docker compose up -d --build`. 기본 컨테이너 아키텍처는 `linux/amd64`다. ARM 개발 장비에서 에뮬레이션 없이 시험하려면 `TOWNBASE_PLATFORM=linux/arm64`를 명시하되 별도 지원 검증으로 구분한다.

## 2. 기동과 공개 범위

- DB health 통과 → migration 서비스 정상 종료 → API 시작 순서다. migration은 PostgreSQL transaction advisory lock으로 동시 runner를 차단하고, 기존 migration 적용 후 기본 workspace만 idempotent 생성한다. 관리자/비밀번호/자료 소유는 seed하지 않는다.
- API는 컨테이너 안에서 3000 포트를 사용하고 호스트에는 **127.0.0.1에만** 게시한다. DB는 호스트 포트를 게시하지 않는다. API가 웹 정적 파일을 같은 origin에서 제공하며 별도 Vite dev 서버를 운영 배포에 띄우지 않는다.
- `GET /health`는 프로세스 생존, `GET /readyz`는 DB·배포에 포함된 정확한 migration 집합·실제 테이블·서로 분리된 쓰기 가능 저장 경로를 확인한다. 오류는 503으로 표시한다. 경로·DB URL·Key·문서 본문은 응답하지 않는다.
- 초기 화면과 위 두 GET만 운영 프로필에 등록한다. 기존 Notion/Git 수집·Gap/draft·MCP 모듈은 불러오지 않는다. 기존 기능은 삭제하지 않았으며 v0.1 개발 프로필에서만 사용한다. NODE_ENV=production에서 legacy_development 프로필은 시작을 거절한다.
- API는 비특권 node 사용자·읽기 전용 root filesystem·쓰기 가능한 전용 volume과 /tmp로 실행한다. build stage의 TypeScript를 API가 실행하지 않으며 배포된 패키지 `main`/`types`는 dist를 가리킨다.

## 3. 비밀과 데이터

| 위치 | 내용·처리 |
| --- | --- |
| `.townbase/secrets/postgres_password` | 최초 준비 시 32-byte 난수 생성. 재실행해도 덮어쓰지 않음. 상위 폴더0700, 파일 읽기 전용. 호스트에서 상위 폴더 권한 유지 필수 |
| Compose secret `/run/secrets/postgres_password` | DB/migration/API에만 읽기 전용 마운트. API·migration은 여기서 DB URL을 구성하고 URL 자체를 로그에 출력하지 않음 |
| `postgres-data-v02` volume | 기존 v0.1 DB volume과 다름. 기존 DB에 새 비밀번호로 자동 연결하거나 데이터를 자동 가져오지 않음 |
| `documents` volume | 지속 문서용. 원본 API/수집은 이후 구현하며 지금 정적 웹에 공개하지 않음 |
| `attachments` volume | 일회성 첨부용, 지속 문서와 별도 경로/volume. 백업 제외·만료 삭제는 F/I에서 구현 |

`.env`나 API Key·고객 파일을 Docker 이미지에 넣지 않는다. `.dockerignore`는 `.env*`(예시 제외)·`.townbase`·repos·fixtures·로컬 node_modules/dist를 제외한다. API Key/master key와 관리자 복구 토큰 저장은 B03/B04/C에서 추가한다. 현재 DB secret을 잃어버려도 기존 DB가 자동 초기화되거나 비밀번호가 자동 교체되지는 않는다. 별도 안전한 위치에 보관하고 분실 시 운영자가 DB 복구 절차를 수행해야 한다.

`docker compose down`은 volume을 남긴다. **`down -v`는 DB와 파일 volume을 삭제하므로 운영 자료에 사용하지 않는다.** 코드 업데이트/배포 전 백업은 여전히 운영자 책임이며 자동 백업 기능은 없다.

업그레이드는 쓰기를 중단하고 백업한 뒤 `docker compose stop api` → `docker compose up -d --build`로 수행한다. 이미 실행 중인 구버전 API가 migration 실패 시 자동으로 중지되는 것은 아니다. 준비 상태 확인 후에만 reverse proxy로 다시 공개한다.

## 4. 실패 확인과 재실행

```bash
docker compose ps -a
docker compose logs --tail=60 migration api
docker compose up -d --build
```

- secret 미준비: `node deployment/prepare.mjs`. 기존 파일을 삭제해서 해결하지 않는다.
- DB 준비 실패: 디스크/volume·보관된 DB 비밀과 현재 secret 일치를 확인한다. 기존 DB를 새 volume으로 바꿔 성공처럼 숨기지 않는다.
- migration 실패/중복 runner: API 시작을 막는다. 기존 runner 종료와 Prisma 상태를 확인한 뒤 재실행한다. 실패 로그는 비밀값이 섞일 수 있는 Prisma 원문 대신 요약만 남긴다. 실제 상태 확인은 해당 테스트/운영 대상을 검증한 관리자가 migration 컨테이너 안에서 수행한다. 실패를 임의로 `resolve --applied` 하지 않는다.
- API healthy 실패: `/readyz`에서 DB·구조·저장소를 구분해 확인한다. DB 중단 시 `/health`가200이어도 준비 상태는503이다. 복구 후 다시 조회한다. 아직 없는 인증 기능은 항상 unavailable이다.
- 앱 버전보다 새 DB migration도 정상 준비로 표시하지 않는다. downgrade가 필요하면 [B01 복원 절차](implementation/v0.2-b01-storage.md)를 따른다. 자료를 임의 삭제하는 down migration은 제공하지 않는다.

## 5. 외부 접속과 TLS 계약

현재 기본 주소는 로컬 HTTP이며 로그인 기능이 없다. 향후 관리자 로그인은 HTTPS로만 공개한다. 조직이 준비한 reverse proxy·인증서를 사용하고 API·웹을 같은 HTTPS origin으로 제공한다. localhost 포트를 전체 인터페이스에 직접 공개하지 않는다.

호스트 Nginx 설정 예시(도메인·인증서 경로는 운영자가 제공, 이번 저장소에서 인증서를 발급하지 않음):

```nginx
server {
    listen 443 ssl;
    server_name townbase.example.org;
    ssl_certificate /etc/ssl/townbase/fullchain.pem;
    ssl_certificate_key /etc/ssl/townbase/privkey.pem;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 95s;
    }
}
```

외부 전송 헤더를 무조건 신뢰하는 설정을 API에 추가하지 않았다. B03/B04에서 실제 proxy 경계·HTTPS 판정·Secure/HttpOnly/SameSite cookie·CSRF/Origin을 연결하고 검증해야 한다. 현재 TLS 안내는 인증 기능의 보안 시험 통과 기록이 아니다.

## 6. 기존 개발 경로

기존 localhost5432 DB·Notion/Git·MCP 개발은 `compose.legacy.yml`을 사용한다. v0.1용 `.env`는 이 경로에 속한다.

```bash
docker compose -f compose.legacy.yml up -d
pnpm install --frozen-lockfile
pnpm db:generate
pnpm build
pnpm dev
```

root `pnpm build`는 database→rag-core→agent-core→connectors→API→web 순서로 빌드한다. 패키지 직접 실행 전에도 필요한 dist가 있어야 한다. v0.1 CLI/fixture 회귀와 운영 프로필 노출 승인은 별개다.

공식 참고: [Compose 기동 조건](https://docs.docker.com/compose/how-tos/startup-order/), [Compose secrets](https://docs.docker.com/reference/compose-file/secrets/), [pnpm Docker](https://pnpm.io/docker), [Vite 실행 요건](https://vite.dev/guide/). 파일 기반 Compose secret의 uid/gid/mode 재매핑을 신뢰하지 않고 호스트 상위 디렉터리와 서비스별 마운트로 접근을 제한한다.
