# 스토어 자동 제출

Node.js 22 이상에서 `bngts-extension` 디렉터리를 기준으로 실행합니다.

## 최초 설정

```powershell
Copy-Item .env.store.example .env.store
```

`.env.store`에 아래 값을 입력합니다. 이 파일은 Git과 스토어 ZIP에 포함되지 않습니다. CI에서는 같은 이름의 Secret 환경변수를 등록하면 됩니다.

- Chrome: `CWS_PUBLISHER_ID`, `CWS_EXTENSION_ID`, `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`
- Firefox: `WEB_EXT_API_KEY`, `WEB_EXT_API_SECRET`

Chrome 인증 설정:

1. Google Cloud에서 Chrome Web Store API를 활성화합니다.
2. OAuth 웹 애플리케이션 클라이언트를 만들고 승인된 리디렉션 URI에 `http://127.0.0.1:8765/oauth2/callback`을 추가합니다. 승인된 JavaScript 원본은 비워둡니다.
3. `.env.store`에 Client ID/Secret을 입력합니다. `npm run auth:chrome` 또는 배포 명령을 실행하면 토큰을 확인하고, 없거나 만료·취소되었을 때 Google 로그인 창을 엽니다. 확장 소유 계정으로 승인하면 Refresh Token을 자동 저장하고 계속 진행합니다. 테스트 모드에서는 로그인 계정을 테스트 사용자로 등록해야 합니다.
4. Chrome 개발자 대시보드의 Publisher > Settings에서 Publisher ID를 확인합니다. Extension ID는 기존 방통실 항목 ID가 예제에 들어 있습니다.

[Chrome 공식 인증 안내](https://developer.chrome.com/docs/webstore/using-api)

Firefox는 [AMO API 자격 증명 페이지](https://addons.mozilla.org/developers/addon/api/key/)에서 JWT issuer와 JWT secret을 발급받아 각각 API KEY/SECRET에 넣습니다. 기존 add-on ID `ext@bngts.com`을 그대로 사용합니다.

[Firefox 공식 제출 안내](https://extensionworkshop.com/documentation/develop/getting-started-with-web-ext/)

## 실행

```powershell
npm run auth:chrome      # 토큰 확인 및 필요 시 로그인; 업로드하지 않음
npm run publish:check    # 두 빌드를 검증, 업로드하지 않음
npm run publish:chrome   # 새로 빌드 → Chrome ZIP 업로드 → 심사 제출
npm run publish:firefox  # 새로 빌드 → Firefox AMO listed 제출
npm run publish:stores  # 새로 빌드 → Chrome 제출 → Firefox 제출
npm run upload:chrome   # Chrome 초안 업로드만, 심사 제출하지 않음
```

각 실행은 빌드를 새로 만들므로 이전 ZIP을 실수로 제출하지 않습니다. Chrome은 API v2를 사용하며 브라우저 실행이나 CRX 서명키가 필요하지 않습니다. Firefox는 설치된 web-ext를 사용하고 승인 대기는 생략합니다.

다음 업데이트는 스토어에 이미 제출한 버전보다 높여야 합니다. 로컬에서 자동 Git 커밋 없이 올리려면:

```powershell
npm version patch --no-git-tag-version
npm run publish:check
npm run publish:stores
```

자동화 범위는 **업로드와 심사 제출**입니다. 실제 공개는 각 스토어 심사 결과와 기존 공개 설정을 따릅니다. 최초 스토어 등록 정보·개인정보 관련 항목은 대시보드에서 작성해야 합니다. 두 스토어 제출은 원자적이지 않습니다. Chrome 성공 후 Firefox 실패 시 Firefox 명령만 재실행하고, 같은 버전을 양쪽에 무작정 재업로드하지 마세요.

토큰 만료·취소는 재로그인으로 처리하고, Client Secret 오류나 네트워크 오류는 원인을 표시하며 중단합니다. CI에서는 로그인 창을 열지 않으므로 로컬에서 재인증한 뒤 CI Secret을 갱신합니다. dry-run은 인증 창과 실제 업로드를 모두 생략합니다.

## 릴리스 노트

배포 시 CHANGELOG.md에서 package.json과 같은 버전의 내용을 추출합니다. Firefox에는 --amo-metadata의 version.release_notes로 자동 전송합니다. Chrome에는 공개 릴리스 노트 API가 없어 전송하지 않으며, 스토어 설명에 사용할 텍스트를 dist/release-notes-<version>.txt로 생성합니다. 현재 버전 항목이 없으면 제출을 중단합니다.
