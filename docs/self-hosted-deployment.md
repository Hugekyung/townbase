# v0.2 초기 배포 실행 안내

현재 제공: API·상태 웹·최초 관리자 등록·로그인/세션/비밀번호 변경/로컬 복구·PostgreSQL/pgvector·migration·분리된 파일 volume. **문서 등록·채팅은 아직 사용할 수 없다.** 상태 확인 성공은 제품 전체 준비 완료를 뜻하지 않는다.

## 1. 첫 실행

지원 검증 목표는 Linux x86_64, 4 vCPU·8GiB RAM·40GiB 여유 공간이다. Docker Engine/Desktop·Compose plugin과 이미지/패키지 다운로드 연결이 필요하다. Node를 설치하지 않았다면 비밀 파일 준비만 아래 컨테이너 명령을 사용한다.

설치마다 고유한 프로젝트 이름(예: `my-townbase`)을 정한다. 아래 모든 명령의 `my-townbase`를 해당 이름으로 바꾸고, 재시작·로그·종료·업그레이드에도 같은 `-p`를 사용한다. 같은 서버에 두 번째 설치를 만들 때는 프로젝트 이름과 호스트 포트를 모두 다르게 지정한다. 이름을 생략하면 설치 디렉터리 이름이 사용되므로 같은 이름의 디렉터리끼리도 충돌할 수 있다.

저장소 루트에서:

```bash
node deployment/prepare.mjs
# 최초 설치에서만 생성. 기존 설정은 보존한다.
if [ ! -e .townbase/compose.env ]; then
  printf 'TOWNBASE_PORT=3000\n' > .townbase/compose.env
fi
docker compose --env-file .townbase/compose.env -p my-townbase up -d --build --wait --wait-timeout 180
docker compose --env-file .townbase/compose.env -p my-townbase ps -a
TOWNBASE_STATUS_ADDRESS=$(docker compose --env-file .townbase/compose.env -p my-townbase port api 3000)
curl -f "http://${TOWNBASE_STATUS_ADDRESS}/readyz"
```

Node가 없는 호스트의 비밀 파일 준비 대안:

```bash
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" -w /workspace node:24.19.0-bookworm-slim node deployment/prepare.mjs
```

브라우저 주소는 `http://` 뒤에 위 `TOWNBASE_STATUS_ADDRESS` 값을 붙인다. 기본 설정이면 `http://127.0.0.1:3000`이다. 포트를 바꾸려면 `.townbase/compose.env`의 값을 `TOWNBASE_PORT=3100`으로 저장한 뒤 같은 기동 명령을 실행한다. 모든 재기동·업그레이드·재시도에도 위와 같이 `--env-file .townbase/compose.env`를 사용한다. 이 파일에는 포트·시험 플랫폼 같은 배포 설정만 두고 기존 v0.1 `.env`나 API Key를 복사하지 않는다. 이 경우 브라우저와 상태 확인 주소도 `http://127.0.0.1:3100`으로 바꾼다. 기본 컨테이너 아키텍처는 `linux/amd64`다. ARM 개발 장비에서 에뮬레이션 없이 시험하려면 설정 파일에 `TOWNBASE_PLATFORM=linux/arm64`를 저장하되 별도 지원 검증으로 구분한다.

기존 PR #34 초기 버전을 `townbase` 프로젝트로 시험했다면 새 이름으로 옮기지 말고 `-p townbase`를 계속 사용한다. 이름을 바꾸면 다른 volume을 참조해 데이터가 사라진 것처럼 보일 수 있다. 기존 DB·비밀 파일은 유지한 채 준비 명령을 재실행해 API용 비밀 파일을 추가하고, 업데이트한 migration을 실행한다. migration 완료 뒤 API 컨테이너도 재생성해야 새 제한 계정과 secret mount가 적용된다. `down -v`로 초기화하지 않는다.

## 2. 기동과 공개 범위

- DB health 통과 → migration 서비스 정상 종료 → API 시작 순서다. migration은 PostgreSQL transaction advisory lock으로 동시 runner를 차단하고, 기존 migration 적용 후 기본 workspace만 idempotent 생성한다. 관리자/비밀번호/자료 소유는 seed하지 않는다.
- API는 컨테이너 안에서 3000 포트를 사용하고 호스트에는 **127.0.0.1에만** 게시한다. DB는 호스트 포트를 게시하지 않는다. API가 웹 정적 파일을 같은 origin에서 제공하며 별도 Vite dev 서버를 운영 배포에 띄우지 않는다.
- `GET /health`는 프로세스 생존, `GET /readyz`는 DB·배포에 포함된 정확한 migration 집합·실제 테이블·서로 분리된 쓰기 가능 저장 경로를 확인한다. 오류는 503으로 표시한다. 경로·DB URL·Key·문서 본문은 응답하지 않는다.
- 초기 화면·상태 GET·`GET /setup/status`·`POST /setup/administrator`를 운영 프로필에 등록한다. `/setup/status`는 required/complete 상태만 반환하고 토큰은 제공하지 않는다. 기존 Notion/Git 수집·Gap/draft·MCP 모듈은 불러오지 않는다. 기존 기능은 삭제하지 않았으며 v0.1 개발 프로필에서만 사용한다. NODE_ENV=production에서 legacy_development 프로필은 시작을 거절한다.
- API는 비특권 node 사용자·읽기 전용 root filesystem·쓰기 가능한 전용 volume과 /tmp로 실행한다. build stage의 TypeScript를 API가 실행하지 않으며 배포된 패키지 `main`/`types`는 dist를 가리킨다.

## 3. 비밀과 데이터

| 위치 | 내용·처리 |
| --- | --- |
| `.townbase/secrets/postgres_password` | 최초 준비 시 32-byte 난수 생성. 재실행해도 덮어쓰지 않음. 상위 폴더0700, 파일 읽기 전용. 호스트에서 상위 폴더 권한 유지 필수 |
| Compose secret `/run/secrets/postgres_password` | DB/migration에만 읽기 전용 마운트. API에는 전달하지 않음 |
| `.townbase/secrets/runtime_password` → `/run/secrets/runtime_password` | 별도 32-byte 난수. migration/API에만 읽기 전용 마운트. API는 제한 계정 URL을 구성하고 로그에 출력하지 않음. 재실행 시 값 보존·파일0444·상위 폴더0700 |
| `postgres-data-v02` volume | 기존 v0.1 DB volume과 다름. 기존 DB에 새 비밀번호로 자동 연결하거나 데이터를 자동 가져오지 않음 |
| `documents` volume | 지속 문서용. 원본 API/수집은 이후 구현하며 지금 정적 웹에 공개하지 않음 |
| `attachments` volume | 일회성 첨부용, 지속 문서와 별도 경로/volume. 백업 제외·만료 삭제는 F/I에서 구현 |
| `recovery` volume | 비밀번호 복구 토큰 전용. 디렉터리0700·파일0600. 초기 등록/문서/첨부와 분리하고 백업 제외. 자동 백업은 아직 없음 |
| `bootstrap` volume | 초기 등록 토큰 전용. 디렉터리0700·파일0600. 문서/첨부·DB 백업과 분리하고 백업에서 제외할 대상. 자동 백업은 아직 없음 |

`.env`나 API Key·고객 파일을 Docker 이미지에 넣지 않는다. `.dockerignore`는 `.env*`(예시 제외)·`.townbase`·repos·fixtures·로컬 node_modules/dist를 제외한다. 초기 등록 토큰은 아래 로컬 명령으로만 발급한다. API Key/master key와 관리자 복구 토큰은 B04/C에서 추가한다. 현재 DB secret을 잃어버려도 기존 DB가 자동 초기화되거나 비밀번호가 자동 교체되지는 않는다. 별도 안전한 위치에 보관하고 분실 시 운영자가 DB 복구 절차를 수행해야 한다.

`docker compose --env-file .townbase/compose.env -p my-townbase down`은 volume을 남긴다. **`down -v`는 DB와 파일 volume을 삭제하므로 운영 자료에 사용하지 않는다.** 코드 업데이트/배포 전 백업은 여전히 운영자 책임이며 자동 백업 기능은 없다.

업그레이드는 쓰기를 중단하고 백업한 뒤 `docker compose --env-file .townbase/compose.env -p my-townbase stop api` → `docker compose --env-file .townbase/compose.env -p my-townbase up -d --build --wait --wait-timeout 180`로 수행한다. 이미 실행 중인 구버전 API가 migration 실패 시 자동으로 중지되는 것은 아니다. 준비 상태 확인 후에만 reverse proxy로 다시 공개한다.

## 4. 실패 확인과 재실행

```bash
docker compose --env-file .townbase/compose.env -p my-townbase ps -a
docker compose --env-file .townbase/compose.env -p my-townbase logs --tail=60 migration api
docker compose --env-file .townbase/compose.env -p my-townbase up -d --build --wait --wait-timeout 180
```

- secret 미준비: `node deployment/prepare.mjs`. 기존 파일을 삭제해서 해결하지 않는다.
- DB 준비 실패: 디스크/volume·보관된 DB 비밀과 현재 secret 일치를 확인한다. 기존 DB를 새 volume으로 바꿔 성공처럼 숨기지 않는다.
- migration 실패/중복 runner: API 시작을 막는다. 기존 runner 종료와 Prisma 상태를 확인한 뒤 재실행한다. 실패 로그는 비밀값이 섞일 수 있는 Prisma 원문 대신 요약만 남긴다. 실제 상태 확인은 해당 테스트/운영 대상을 검증한 관리자가 migration 컨테이너 안에서 수행한다. 실패를 임의로 `resolve --applied` 하지 않는다.
- API healthy 실패: `/readyz`에서 DB·구조·저장소를 구분해 확인한다. DB 중단 시 `/health`가200이어도 준비 상태는503이다. 복구 후 다시 조회한다. 아직 없는 인증 기능은 항상 unavailable이다.
- 앱 버전보다 새 DB migration도 정상 준비로 표시하지 않는다. downgrade가 필요하면 [B01 복원 절차](implementation/v0.2-b01-storage.md)를 따른다. 자료를 임의 삭제하는 down migration은 제공하지 않는다.

## 5. 외부 접속과 TLS 계약

기본 Compose는 loopback 전용 로컬 HTTP 등록을 명시 허용한다. 외부 관리자 등록·로그인은 HTTPS로만 공개한다. 조직이 준비한 reverse proxy·인증서를 사용하고 API·웹을 같은 HTTPS origin으로 제공한다. localhost 포트를 전체 인터페이스에 직접 공개하지 않는다.

호스트 Nginx 설정 예시(도메인·인증서 경로는 운영자가 제공, 이번 저장소에서 인증서를 발급하지 않음). 아래는 기본 포트3000 기준이며 포트를 변경했다면 `proxy_pass`도 실제 게시 포트로 맞춘다:

```nginx
server {
    listen 443 ssl;
    server_name townbase.example.org;
    ssl_certificate /etc/ssl/townbase/fullchain.pem;
    ssl_certificate_key /etc/ssl/townbase/privkey.pem;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $http_host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 95s;
    }
}
```

등록을 HTTPS로 제공할 때 `.townbase/compose.env`에 `TOWNBASE_PUBLIC_ORIGIN=https://townbase.example.org`와 `TOWNBASE_TRUSTED_PROXY_IP=<API 소켓에서 관측되는 신뢰 proxy의 정확한 IP>`를 설정한 뒤 API를 재생성한다. Origin에는 경로·끝 슬래시를 넣지 않는다. proxy의 Docker 네트워크 주소는 환경마다 다르므로 임의 주소/대역을 신뢰하지 않는다. proxy가 Host를 보존하고 `X-Forwarded-Proto`를 위와 같이 덮어써야 한다. API가 본 peer IP는 운영자가 네트워크 구성으로 확인한다. 주소가 바뀌면 새 주소를 확인하고 설정도 갱신한다.

설정한 HTTPS origin·Host·브라우저 Origin·`X-Townbase-Setup: 1`이 모두 일치하고, 신뢰한 peer에서 전달한 `X-Forwarded-Proto: https`인 등록만 허용한다. 공개 origin을 설정하면 로컬 HTTP 예외도 닫힌다. 공개 origin 미설정 시에는 로컬 origin/Host와 명시적 로컬 허용 값이 필요하며 전달 헤더가 섞이면 거절한다. 전체 Express trust proxy는 켜지 않는다. proxy는 API loopback 게시 주소로만 연결한다. 이 peer 검사는 다른 로컬 프로세스를 운영자로부터 격리하는 보안 경계가 아니다.

B03에서는 Origin/전달 경계의 자동 시험을 수행했다. 실제 조직의 인증서·proxy를 통한 TLS 운영 확인은 별도다. B04는 같은 전송 경계와 HttpOnly/SameSite=Strict cookie를 적용하며 공개 HTTPS origin을 설정하면 Secure를 추가한다. 명시적인 loopback HTTP 시험은 Secure 예외다. 로그인·복구는 8절을 따른다.

## 6. 기존 개발 경로

기존 localhost5432 DB·Notion/Git·MCP 개발은 `compose.legacy.yml`을 사용한다. v0.1용 `.env`는 이 경로에 속한다. 첫 실행에서 `.env.example`을 `.env`로 복사하고 DB 주소·접속값을 맞춘다. 기존 파일은 덮어쓰지 않는다.

```bash
if [ ! -e .env ]; then cp .env.example .env; fi
docker compose -f compose.legacy.yml up -d --wait --wait-timeout 90
pnpm install --frozen-lockfile
pnpm db:generate
pnpm build
pnpm db:deploy
pnpm dev
```

root `pnpm build`는 database→rag-core→agent-core→connectors→API→web 순서로 빌드한다. 패키지 직접 실행 전에도 필요한 dist가 있어야 한다. v0.1 CLI/fixture 회귀와 운영 프로필 노출 승인은 별개다.

공식 참고: [Compose 기동 조건](https://docs.docker.com/compose/how-tos/startup-order/), [Compose secrets](https://docs.docker.com/reference/compose-file/secrets/), [pnpm Docker](https://pnpm.io/docker), [Vite 실행 요건](https://vite.dev/guide/). 파일 기반 Compose secret의 uid/gid/mode 재매핑을 신뢰하지 않고 호스트 상위 디렉터리와 서비스별 마운트로 접근을 제한한다.

## PR #34 리뷰 보완 계약

- DB 소유자 `townbase`와 API 계정 `townbase_runtime`을 분리한다. `postgres_password`는 DB·migration에만, 별도 `runtime_password`는 migration·API에만 마운트한다. API는 DB 연결·public schema USAGE와 `_prisma_migrations`, `Installation`, `Administrator`, `InstallationAuditEvent`, `BootstrapState`, `Workspace` SELECT를 허용한다. 초기 등록에 필요한 Installation/Administrator/InstallationAuditEvent INSERT, BootstrapState UPDATE, Installation의 initializedAt/updatedAt 열 UPDATE만 추가했다. B04는 AuthenticationState SELECT/UPDATE, AdministratorSession SELECT/INSERT·lastSeenAt/revokedAt 열 UPDATE, Administrator passwordHash/updatedAt 열 UPDATE만 추가한다. DELETE·테이블 생성/구조 변경·역할 관리·migration 실행 권한은 주지 않는다. 이후 권한은 해당 기능과 함께 명시적으로 추가한다.
- migration이 실행 잠금 안에서 제한 계정을 생성/갱신하고 기존 직접 권한·역할 membership을 정리한다. API 계정 비밀번호는 보호된 파일에서 읽으며 로그에 남기지 않는다. 기존 DB 비밀번호는 자동 변경하지 않는다. 비밀 파일을 분실했을 때 새로 생성해 기존 DB가 복구된다고 가정하지 않는다.
- API와 migration은 모두 node 사용자·읽기 전용 root·capability 제거·권한 상승 금지로 실행한다. migration의 임시 캐시는 `/tmp` tmpfs에 둔다. 비밀 파일은 새 생성과 재실행 모두 `0444`, 상위 디렉터리는 `0700`을 적용하며 값은 보존한다.
- `/readyz`는 두 저장소 각각에서 임의 이름의 작은 파일을 배타 생성·쓰기·동기화·삭제한 뒤 준비 완료를 표시한다. 검사 순간의 쓰기 가능 여부이며 이후 모든 저장의 성공을 보장하지 않는다. DB 확인 도중 실패하면 연결을 다시 확인해 구조 오류와 연결 장애를 구분한다.
- 시작 오류는 실패 단계와 허용된 OS 오류 코드만 기록한다. 예: `listen:EADDRINUSE`, `web-artifacts:ENOENT`. 메시지·stack·경로·연결 문자열은 출력하지 않는다.

- 재사용 DB에 허용 범위를 넘는 사용자 schema·객체·기본 권한이 남아 API 제한을 우회하면 migration은 `TOWNBASE_UNSAFE_RUNTIME_GRANTS`로 실패하고 API 시작을 차단한다. 우회 권한이 발견되면 트랜잭션 변경을 되돌린다. API 계정의 직접 public schema·테이블·sequence·DB 권한과 역할 소속은 설정 과정에서 정리한다. PUBLIC 및 다른 계정의 객체·기본 ACL은 일괄 삭제하지 않는다. 단 PUBLIC의 public schema CREATE와 현재 DB CREATE/TEMPORARY 권한은 성공한 설정에서 제거한다. 이 DDL 제한은 같은 DB의 모든 계정에 적용된다. 설치 DB를 확인한 운영자가 필요한 권한만 명시적으로 정리한 뒤 재시도한다.

- B02 운영 DB는 설치 전용이다. PostgreSQL 시스템 schema를 제외한 모든 사용자 schema를 검사한다. API는 public 외 사용자 schema의 USAGE/CREATE를 허용하지 않으며 테이블 허용 목록은 schema까지 포함한 public의 위 여섯 테이블이다. 모든 사용자 schema의 테이블/열/sequence 권한과 모든 생성 역할의 관련 전역/schema 기본 ACL을 검사한다.
- 사용자 schema의 실행 가능한 임의 함수·프로시저는 차단한다. migration에 필요한 vector extension에 실제 소속된 SECURITY INVOKER 루틴만 기본 허용하며, SECURITY DEFINER는 extension 소속이어도 차단한다. 루틴·schema를 포함한 API/PUBLIC 기본 ACL 우회도 거절한다. PostgreSQL 시스템 schema와 필요한 vector extension이 신뢰 경계이며, DB 최고 관리자의 임의 객체 변조까지 방어하는 별도 DB 보안 제품을 뜻하지 않는다.


## 7. 최초 관리자 등록 (B03)

기동 후 서버 운영자가 같은 설치의 API 컨테이너에서 실행한다. 발급 자체는 토큰을 출력하지 않는다. 두 번째 명령은 보호된 운영자 터미널에서만 직접 확인한다. 채팅·티켓·로그에 붙이지 않는다.

```bash
docker compose --env-file .townbase/compose.env -p my-townbase exec -T api node deployment/bootstrap.mjs
docker compose --env-file .townbase/compose.env -p my-townbase exec -T api cat /var/lib/townbase/bootstrap/token
```

1. 웹에서 토큰·관리자 이름·비밀번호·비밀번호 확인을 입력한다. 비밀번호는 Unicode 문자 기준 15~128자이며 공백을 임의로 제거하지 않는다. 이름은 앞뒤 공백을 제거한 뒤 1~128자다.
2. 등록 후 웹이 DB 상태를 다시 조회해 등록 완료를 표시한다. 등록이 완료되면 관리자 로그인 화면을 제공한다.
3. 토큰은 32-byte 난수, 60분 만료·한 번만 사용. DB에는 SHA-256 digest만 저장한다. 비밀번호는 Argon2id(19MiB·2회·병렬1·32-byte hash)로 저장한다. 발급·거절·관리자 생성·소비는 감사 기록으로 남긴다.
4. 만료/분실/틀린 토큰은 첫 명령을 다시 실행해 교체한다. 기존 토큰은 즉시 무효화된다. 등록 전 실패 15분 10회부터 1~60초 지연을 DB에 보관한다. 운영자의 로컬 재발급은 이 제한도 초기화한다.
5. 등록 완료 또는 관리자 행 존재 시 HTTP 재등록과 로컬 재발급이 모두 닫힌다. 비활성 관리자도 새 등록을 허용하지 않는다. 비밀번호 분실 시 DB/volume을 지우지 않는다. 비밀번호 복구는 8절을 따른다.

발급 명령은 선택된 기본 workspace를 설치에 연결하는 명시적 운영 작업이다. migration은 이 연결이나 관리자 계정을 자동 생성하지 않는다. 최초 설치 이름은 해당 workspace 이름, 시간대는 UTC로 기록한다. 기존 설치의 이름·시간대는 보존하고 workspace가 다르면 발급을 거절한다.

DB 상태·발급 감사·파일 쓰기는 같은 등록 잠금 안에서 처리한다. 파일과 DB를 하나의 원자적 저장으로 묶을 수는 없으므로, 파일 교체 뒤 DB commit 전에 프로세스가 죽으면 파일/DB가 어긋날 수 있다. 등록은 일치하지 않는 토큰을 거절한다. 초기화 전이면 로컬 재발급으로 복구한다. 등록 완료 DB를 자동 초기화하지 않는다.

소비한 토큰 파일은 등록 직후 삭제한다. 만료 토큰은 즉시 거절하고 API 기동 시와 60초 주기로 파일/digest를 정리한다. 삭제 장애는 비밀값 없는 경고를 남기고 다시 시도한다. API 중단 중에는 물리 삭제가 미뤄진다. `bootstrap` volume은 문서·첨부·DB 백업에 합치지 않는다. [구현·검증 기록](implementation/v0.2-b03-administrator.md)을 참고한다.


### 개발용 웹 서버

기본 운영/검증 경로는 Docker API와 같은 origin에서 제공하는 웹이다. Vite 개발은 **별도의 새 개발 checkout과 시험용 Compose 프로젝트**에서 아래 순서로 실행한다. 운영 설치의 폴더·DB·volume을 개발용으로 전환하지 않는다. Node24·pnpm·Docker가 필요하며, 호스트3000 포트가 비어 있어야 한다.

```bash
pnpm install --frozen-lockfile
pnpm --filter @townbase/web build
node deployment/prepare.mjs
# 새 개발 checkout에서만 최초 생성. 기존 파일을 덮어쓰지 않는다.
if [ ! -e .townbase/compose.env ]; then
  printf 'TOWNBASE_PORT=3000\n' > .townbase/compose.env
fi
docker compose --env-file .townbase/compose.env -p my-townbase-dev up -d --build --wait --wait-timeout 180
pnpm --filter @townbase/web dev
```

Vite가 출력한 loopback 주소를 연다. `/readyz`·`/setup`은 API의 호스트 포트3000으로 전달한다. 기존 개발 설정의 포트가 다르면 `apps/web/vite.config.ts`의 target도 같은 포트로 맞춘다. Docker build가 공유 패키지→API→웹을 빌드하고, migration과 별도 저장 volume을 준비한다. API의 `TOWNBASE_RUNTIME_PROFILE=self_hosted`는 Dockerfile, `TOWNBASE_SETUP_LOCAL_HTTP=1`은 기본 Compose에 이미 설정되어 있다. 호스트에서 이 변수를 export하는 것만으로 DB/저장소/빌드가 준비되지는 않는다. `pnpm dev`의 legacy 프로필은 setup 경로를 제공하지 않으므로 이 안내의 API 실행 명령으로 사용하지 않는다.

초기 토큰은 앞 절과 같은 명령의 프로젝트 이름을 `my-townbase-dev`로 맞춰 발급한다. Vite는 Host/Origin을 보존하고 전달 헤더를 새로 만들지 않는다. `TOWNBASE_PUBLIC_ORIGIN`을 설정한 운영 API의 HTTPS 보호를 개발 proxy로 우회하지 않는다. 실제 정적 웹은 API runtime 이미지의 `/app/web/dist`에서 제공하며, Vite 소스/proxy 시험은 build를 상속한 migration 이미지에서 별도로 수행한다.

정상적으로 찾은 `/assets/` 빌드 파일만 `public, max-age=0`으로 브라우저 저장 후 재검증을 허용한다. HTML 진입점·API·오류 응답은 `no-store`를 유지한다. 정적 파일 경로라는 이유만으로 오류 응답의 보안 헤더나 캐시 금지를 해제하지 않는다.

초기 발급 오류는 `already_initialized`, `workspace_mismatch`, `workspace_unavailable`, `storage_unavailable`, `unavailable`의 안전한 코드/고정 안내만 출력한다. 알 수 없는 DB·파일 오류의 원문/stack은 출력하지 않는다. 파일 교체는 파일 내용과 상위 디렉터리를 순서대로 동기화한다. 파일/DB 사이의 별도 저장 경계와 재발급 복구 계약은 유지한다.


## 8. 로그인·비밀번호 변경·로컬 복구 (B04)

웹에서 최초 등록한 관리자 이름·비밀번호로 로그인한다. 세션은 절대8시간·유휴30분 후 만료된다. 로그아웃은 현재 로그인만 종료한다. 이미 만료/폐기된 세션도 브라우저 cookie를 지우고 종료하며, DB 장애로 결과를 확인할 수 없으면503으로 응답하고 재시도를 위해 cookie를 보존한다. 비밀번호 변경은 현재 비밀번호를 다시 입력하며 **모든 기존 로그인을 종료**하고 미사용 복구 토큰도 무효화한다. 새 비밀번호로 다시 로그인한다.

분실한 경우 서버 운영자가 해당 설치에서 다음 명령을 실행한다. DB·volume을 삭제하거나 bootstrap 등록을 다시 열지 않는다.

```bash
docker compose --env-file .townbase/compose.env -p my-townbase exec -T api node deployment/recovery.mjs
docker compose --env-file .townbase/compose.env -p my-townbase exec -T api cat /var/lib/townbase/recovery/token
```

두 번째 명령은 비밀을 의도적으로 읽는 서버 운영 작업이다. 터미널 출력·화면 공유·기록에 노출하지 않는다. 웹의 ‘비밀번호를 잊었어요’에서 토큰·새 비밀번호·확인을 입력한다. 토큰은60분 동안 한 번만 사용 가능하며 재발급하면 이전 토큰은 즉시 무효다. 성공하면 기존 세션을 모두 폐기하고 새 비밀번호로 로그인한다. 기존 자료·설치·관리자 ID는 보존한다. 비활성 관리자 재활성화나 새 관리자 생성 용도로 사용할 수 없다.

로그인과 복구는 각각15분 동안 실패10회부터1~60초 지연한다. DB에 보관하므로 재시작으로 우회되지 않는다. 서버 로컬 재발급으로 복구 제한을 초기화할 수 있다. HTTP로 복구 토큰을 발급하거나 읽는 경로는 없다.

recovery volume은 문서·첨부·DB 백업과 분리해 백업에서 제외한다. 소비 직후/기동/60초 주기로 파일을 삭제하며 중단·삭제 장애 중에는 물리 정리가 늦어진다. 파일/DB 불일치 시 인증은 거절하고 로컬 재발급한다. 파일이 있다고 유효한 토큰이라는 뜻은 아니다. 세션/감사 기록의 전체 보관 정리는 I 단계이며 자동 백업/복원 기능은 아직 없다.

인증 요청은 같은 origin의 웹을 사용한다. API 직접 호출 시 JSON·`X-Townbase-Auth: 1`·정확한 Origin/Host·허용된 전송이 필요하다. 공개 HTTPS 설정 시 cookie는 Secure이고 로컬 HTTP 예외가 닫힌다. 발급값을 URL/로그/브라우저 저장소에 넣지 않는다. [구현·시험 기록](implementation/v0.2-b04-authentication.md)을 참고한다.

복구 CLI의 실패 코드는 `administrator_unavailable`(초기화된 활성 관리자 없음), `storage_unavailable`(복구 경로·권한·파일 정리/쓰기 실패), `unavailable`(DB/배포 상태 또는 알 수 없는 오류)다. 파일 오류 원문·DB URL·stack은 출력하지 않는다. HTTP 인증 장애는 클라이언트에 `auth_unavailable`만 반환하며 서버에는 작업 종류와 허용된 진단 코드만 기록한다. `database_unavailable`은 연결 장애, `database_transaction_unavailable`은 연결 대기/트랜잭션 처리 장애, 나머지는 `unavailable`로 분류한다.
