# 모아

Supabase Auth로 계정을 관리하고, 사용자별 노트를 Supabase Postgres에 저장하는 노트 앱입니다. 브라우저는 로그인한 사용자의 노트만 읽고 쓸 수 있으며, 앱은 Vite로 여러 기기에서 접속할 수 있도록 실행됩니다.

## Supabase 설정

1. Supabase에서 프로젝트를 만듭니다.
2. 대시보드의 SQL Editor에서 [`supabase/schema.sql`](supabase/schema.sql)을 실행합니다. 테이블 생성과 Row Level Security 정책이 설정됩니다.
3. 로컬 실행은 `.env.example`을 복사해 `.env`로 만들고 Project URL과 publishable key를 입력합니다. Vercel에서는 프로젝트 환경 변수 `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`로 설정합니다. publishable key가 아직 제공되지 않는 프로젝트는 legacy `anon` key를 쓸 수 있습니다. `service_role` 또는 secret key를 입력하지 마세요.
4. Supabase Authentication의 URL Configuration에서 사용하는 주소를 허용합니다. 로컬은 `http://localhost:5173/**`, 같은 네트워크의 다른 기기는 `http://컴퓨터-LAN-IP:5173/**`를 Redirect URLs에 등록하세요.
5. 이메일 가입 확인을 켜 둔 경우 인증 메일 링크로 확인한 뒤 로그인합니다. 이메일 확인을 끄면 가입 즉시 로그인됩니다.

## 설치 및 실행

Node.js 18 이상과 npm이 필요합니다.

```bash
npm install
npm start
```

Windows에서는 `start-moa.bat`을 실행해도 됩니다. 의존성이 아직 설치되지 않았다면 BAT가 `npm install`을 실행합니다. 현재 기기에서는 `http://localhost:5173`, 같은 Wi-Fi의 다른 기기에서는 `http://컴퓨터-LAN-IP:5173`으로 접속합니다. 다른 기기에서도 쓰려면 이 컴퓨터가 켜져 있고 네트워크 방화벽에서 포트 5173 접속이 허용되어야 합니다.

배포용 파일을 만들려면 `npm run build`를 실행합니다. 생성된 `dist/`를 HTTPS를 지원하는 정적 호스팅에 배포할 수 있습니다. 배포 주소도 Supabase Redirect URLs에 추가하세요. Vercel은 `vercel.json`에 빌드와 출력 폴더가 설정되어 있습니다.

## 데이터 보안과 기존 노트

- 노트 행에는 Supabase Auth의 사용자 ID가 저장되고, RLS 정책이 각 행을 소유 사용자에게만 공개합니다.
- 브라우저에는 publishable/anon 키만 사용합니다. 이 키는 공개 가능한 키이며, 데이터 보호는 RLS 정책이 담당합니다.
- 기존 `data/notes.json`은 서버 앱으로 이관하지 않으며 현재는 로컬 백업으로 남아 있습니다. 본인 Supabase 계정으로 옮기려면 각 노트를 앱에 다시 입력하면 됩니다.
- `supabase-config.js`와 로컬 노트 파일은 Git에 포함되지 않습니다.
