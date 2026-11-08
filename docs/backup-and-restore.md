# v0.2 수동 백업·복원

백업 대상은 PostgreSQL(설정·암호화 Key·비용 예약·문서 색인·대화·첨부 **결과**)와 documents 원본이다. 첨부 원문/추출문·미사용 첨부 metadata·bootstrap/recovery 토큰·진단 로그·model master key·별도 삭제 기록은 묶지 않는다. 백업은 AES-256-GCM으로 암호화하며 변조/잘못된 키는 복호화 단계에서 거절한다. root/DB 운영자가 갖는 접근 권한까지 방어하는 기능은 아니다.

명령은 저장소 루트에서 Node24와 Docker Compose로 실행한다. `--project`는 설치 때의 고유 `-p` 이름이다. 실제 설치의 `.townbase/compose.env`를 사용한다. 절대 경로는 symlink 없는 실제 경로를 사용한다(macOS `/tmp` 대신 `/private/tmp`). 백업/키 디렉터리는0700, 백업 전용 키·내보낸 기록·백업은0600이다. model_master_key는 소유자 전용0700 secret 디렉터리 안에서 컨테이너 읽기용0444이며 prepare도 이를 정규화한다.

## 만들기

최초 한 번, DB 백업과 다른 안전한 위치에 백업 전용 키를 만든다. 이 키와 `.townbase/secrets/model_master_key`는 서로 다르며 둘 다 별도로 보존해야 한다.

```sh
node deployment/backup.mjs key --key-file=/secure/townbase-backup/backup-key
```

업그레이드 migration을 실행하기 전에도 아래 순서로 snapshot을 만든다. 명령이 성공했다고 출력한 파일과 별도 키의 보관을 확인한 뒤 업그레이드한다.

```sh
docker compose --env-file .townbase/compose.env -p my-townbase stop api
node deployment/backup.mjs create --project=my-townbase --key-file=/secure/townbase-backup/backup-key --directory=/secure/townbase-backup/archives
node deployment/backup.mjs journal-export --project=my-townbase --output=/secure/townbase-journal/current.json
docker compose --env-file .townbase/compose.env -p my-townbase up -d api
```

내보내기는 기존 파일을 덮어쓰지 않는다. 매번 새 파일명을 사용하고 최신 파일을 별도로 보존한다. 백업 디렉터리는 한 설치 전용이며 다른 설치와 섞으면 거절한다. API가 실행 중이면 일관된 snapshot을 만들지 않고 거절한다. PG는 실행 중이어야 한다. 출력에는 경로/시각만 있고 Key/DB URL은 없다.

주 보관본은 operations volume의 backups에 둔다. 시작/1분마다 최근7개·최대7일 중 먼저 도달하는 기준으로 정리한다. `--directory` 사본도 create 때 같은 기준으로 정리한다. 외부로 복사한 파일과 앱이 중지된 기간의 사본은 운영자가 같은 정책으로 만료시켜야 한다. 자동 백업 예약은 제공하지 않는다. 웹 운영 화면의 마지막 성공 백업 시각은 주 보관본 생성 성공 후에만 갱신한다.

## 삭제 기록의 의미

삭제/검색 제외 요청은 원문 없는 별도 삭제 의도를 operations/deletions에 fsync한 뒤 DB를 바꾼다. 기록 확정 후 DB 저장 실패·재시작이 생기면 다음 시작에서 그 의도를 마무리한다. 화면 오류를 삭제 취소로 해석하면 안 된다. 새 로그인/목록 조회로 실제 상태를 확인한다. 제외 후 명시 재포함한 더 최신 scopeRevision은 보존한다.

백업 이후의 삭제도 복원에 반영하려면 **현재 설치의 최신 삭제 기록**이 필요하다. DB 백업 내부의 옛 tombstone만으로는 충분하지 않다. 설치를 중지한 상태에서 최신 journal-export를 별도 복사한다. 원래 운영 디스크를 잃으면 마지막으로 별도 보존한 기록 이후 삭제를 알 수 없다. 기록의 시각/기존 ID digest 일치는 검사하지만 더 최신의 분실된 기록이 존재하는지 증명할 수는 없다. 운영자가 최신 보존 여부를 확인해야 한다. 이 기록에는 기록 UUID·설치 ID·workspace ID·소유 관리자 ID·대상 UUID·종류·시각·제외 scopeRevision이 있고 대화/문서 본문은 없다. 외부 사본 수명을 알 수 없어 자동 삭제하지 않는다.

## 새 설치에 복원

기존 DB/원본에 덮어쓰지 않는다. 새 checkout·새 Compose 이름·새 포트·새 volumes를 사용한다. 기존 설치의 model master key를 새 설치에 **먼저** 준비하고 prepare가 이를 보존하게 한다. 아래 경로는 실제 분리 보관 위치로 바꾼다.

```sh
mkdir -m 700 -p .townbase/secrets
install -m 444 /secure/separate/model_master_key .townbase/secrets/model_master_key
node deployment/prepare.mjs
```

`.townbase/compose.env`에 충돌하지 않는 포트를 지정한다. 안내의 초기 API 기동/migration은 아직 실행하지 않는다. 새 API 컨테이너는 만들기만 한다.

```sh
docker compose --env-file .townbase/compose.env -p my-townbase-restore up -d postgres
docker compose --env-file .townbase/compose.env -p my-townbase-restore create api
node deployment/backup.mjs restore --project=my-townbase-restore --key-file=/secure/townbase-backup/backup-key --backup=/secure/townbase-backup/archives/SELECTED.tbk --journal-file=/secure/townbase-journal/current.json --master-key-file=/secure/separate/model_master_key
```

복원은 암호 인증/체크섬/경로·migration 호환성을 확인하고 빈 DB와 빈 documents만 허용한다. DB와 원본을 복구한 뒤 최신 삭제 의도·보관 만료·orphan 정리, 제한 DB 권한, 모든 저장 Key 복호화와 남은 원본 hash/크기/권한을 확인한다. 검증 전에 `restore-pending`을 기록하며 검증이 실패하면 API 시작도 거절한다. 검증 실패 후 표식을 임의로 지워 공개하지 않는다. 오류를 해결해 새 빈 대상에 다시 복원한다. 정상 완료도 API를 자동 시작하지 않는다.

```sh
docker compose --env-file .townbase/compose.env -p my-townbase-restore up -d api
```

모든 이전 세션·복구 토큰을 폐기한다. 기존 관리자 비밀번호로 재로그인하고 문서/원본/검색 범위·과거 대화/첨부 결과·실행/비용 이력을 확인한다. 백업 이후 일반 변경은 복원되지 않는다. 첨부 원문은 복원되지 않으며 새 작업에는 재첨부한다. 기존 API Key가 해지됐으면 새 Key가 필요하다. master key를 분실하면 기존 암호문 Key는 복구할 수 없다.

복원 시 가격 확인을 해제해 유료 호출을 막는다. **공급자의 실제 사용 내역과 백업 시점 이후 과금을 먼저 대조**하고 월 예산을 조정한 뒤 설정 웹에서 가격을 다시 확인한다. 기존 비용 예약·unknown 호출을 임의로0원 처리하지 않는다. 모델 연결 시험/새 질문은 별도 비용이 발생한다.

rollback도 DB/image를 임의로 과거 버전으로 덮어쓰는 작업이 아니다. 해당 snapshot과 호환되는 이미지·migration으로 새 빈 환경에 같은 절차를 적용한다. 더 새로운 migration을 요구하는 백업은 구 이미지에서 거절한다. 실제 합성 복원 결과와 제한은 [최종 검증 기록](implementation/v0.2-final-basic-release.md)을 따른다.

백업/복원에는 원본·DB dump·평문 임시 묶음·암호문·사본을 동시에 둘 여유 공간이 필요하다. 40GiB 초기 권장 여유 공간이 어떤 크기의 DB도 백업할 수 있다는 뜻은 아니다. 명령은 사전 공간 예약을 하지 않는다. 공간 부족 시 성공을 표시하지 않고 임시 staging을 정리한다. API를 다시 열기 전 성공 출력·마지막 백업 시각·운영 저장 공간을 확인한다. 장비/이미지 다운로드·운영자 준비를 포함한 실제 복구 소요는 설치 환경에 따라 달라진다.

기본 API의 Docker 저장 로그는 끈다. 정상 진단은 operations/diagnostics의 허용 코드 파일로 확인한다. 그 경로조차 쓰지 못하는 초기 실패는 API를 중지한 뒤 같은 프로젝트에서 `docker compose --env-file .townbase/compose.env -p my-townbase up api`를 전경으로 실행해 고정 실패 코드를 확인한다. 다른 API를 동시에 실행하지 않는다. `docker compose logs api`가 비었다고 오류가 없다고 판단하지 않는다.

## 실패 경계와 파일 한도

생성/복원은 모두 manifest 최대20,000개, 개별 파일 최대40GiB를 적용한다. 초과 snapshot은 생성 때 실패하며 복원 불가 백업을 성공으로 기록하지 않는다. 삭제 기록 전체는 빈 대상 변경 전에 검증한다. 백업 이름 충돌은 기존 사본을 보존하며 Docker stdin EPIPE도 정상 실패 정리 경로로 처리한다.

삭제 의도를 승인한 뒤 기록 쓰기나 DB 적용이 불확실하면 인증된 자료 접근과 readiness를 차단한다. 운영자가 DB/저장 장애를 복구한 뒤 단일 API를 재시작하면 journal을 먼저 재적용한다. 오류 응답은 삭제 취소를 뜻하지 않는다. 백업은 API 중지 상태에서만 생성한다.

### Docker 명령 대기·종료 확인

일반 Docker 상태/제어 명령은2분, dump/restore 파일 전송과 문서 볼륨·삭제 기록의 `docker cp`는30분을 넘기면 실패 처리한다. 로컬 Docker CLI에 SIGKILL을 최대3회 시도하고3초 내 종료를 관측한다. 종료가 확인돼야 일반 staging 정리를 진행한다. 종료 미확인은 `TOWNBASE_BACKUP_CHILD_TERMINATION_UNCONFIRMED`로 진단하며 `.townbase/backup-staging-*`의0700/0600 자료를 보존한다. 운영자가 해당 프로젝트와 남은 프로세스·DB 상태를 확인하기 전에는 재시도하거나 staging을 정리하지 않는다.

로컬 Docker CLI 종료는 daemon 내부의 pg_dump/psql 종료 증명이 아니다. 실패한 restore는 복원 표식을 유지한 채 API가 중지된 상태로 남으므로, DB 작업 종료와 대상 상태를 확인한 뒤 빈 대상 복구 절차를 다시 선택한다. 시간 초과를 복원 성공으로 취급하지 않는다.
