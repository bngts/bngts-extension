# ![로고](./icon48.png) 방통실 Plus (bngts-extension)

> 현재 보고 있는 방송을 함께 봅니다. 치지직과 SOOP 로그인을 사용할 수 있도록 하며, 자동으로 멀티뷰를 위해 플레이어를 최적화합니다.

이 확장 프로그램은 [방통실(bngts.com)](https://bngts.com/)과 [Mul.Live(mul.live)](https://mul.live/)에서 모두 사용 가능합니다.

## 주요 기능

### 멀티뷰 지원

- **치지직(Chzzk)** 및 **SOOP** 스트리머를 한 화면에서 동시 시청
- 최대 50명의 스트리머 등록 가능
- 드래그 앤 드롭으로 순서 변경

### 스트리머 관리

- **스트리머 검색**: 닉네임 또는 ID로 검색하여 간편 추가
- **필터링**: 전체/온라인/오프라인 필터
- **정렬**: 커스텀/이름순/라이브 우선순
- **페이지네이션**: 5명씩 목록 표시

### 실시간 알림

- 등록한 스트리머 방송 시작 시 **푸시 알림** (설정에서 활성화 필요)
- 백그라운드에서 5분마다 방송 상태 확인 (팝업 열 때는 1분마다)
- 확장 프로그램 아이콘에 **실시간 방송 수 배지** 표시

### 로그인 연동

- **네이버(치지직)** 로그인 쿠키 자동 연동 (`NID_AUT`, `NID_SES`)
- **SOOP** 로그인 쿠키 자동 연동 (`AuthTicket`, `UserTicket`, `isBbs`)
- 멀티뷰에서 채팅 참여 가능

### 플레이어 최적화 (iframe 환경에서 동작)

- **치지직**: 자동 와이드 모드 전환, 채팅창 헤더 접기 버튼 자동 클릭
- **SOOP**: 임베드 모드에서 채팅 영역 숨김, 화질 선택 박스 표시, 다크 모드 자동 적용

### 툴팁 정보

- 마우스 오버 시 방송 제목, 썸네일, 시청자 수 표시 (기본 활성화, 설정에서 끌 수 있음)

## 지원 플랫폼

| 플랫폼 | 지원 여부 | 비고 |
|--------|----------|------|
| **치지직 (Chzzk)** | ✅ | 네이버 로그인 연동 |
| **SOOP (구 아프리카TV)** | ✅ | SOOP 로그인 연동, 5개 이상 선택 시 경고 표시 |

## 브라우저 지원

| 브라우저 | 최소 버전 |
|----------|----------|
| **Chrome** | 121 이상 |
| **Firefox** | 121 이상 |
| **Edge** | Chrome 기반 버전 |

## 설치

### Chrome 웹 스토어

[Chrome 웹 스토어에서 설치](https://chromewebstore.google.com/) (링크 추가 예정)

### Firefox Add-ons

[Firefox Add-ons에서 설치](https://addons.mozilla.org/) (링크 추가 예정)

### 수동 설치 (개발자 모드)

1. 이 저장소를 클론합니다
2. `npm run build` 실행
3. Chrome: `chrome://extensions` → 개발자 모드 → 압축해제된 확장 프로그램 로드 → `dist` 폴더 선택
4. Firefox: `about:debugging` → 임시 애드온 로드 → `dist/manifest.json` 선택

## 빌드

```bash
npm run build
```

## 권한 설명

| 권한 | 용도 |
|------|------|
| `activeTab` | 현재 탭에서 확장 프로그램 동작 |
| `alarms` | 5분마다 방송 상태 확인 |
| `cookies` | 치지직/SOOP 로그인 쿠키 연동 |
| `declarativeNetRequestWithHostAccess` | 확장 프로그램 설치 여부 헤더 전송 |
| `notifications` | 방송 시작 푸시 알림 |
| `storage` | 스트리머 목록 및 설정 저장 |

## 호스트 권한

- `*.naver.com` - 치지직 로그인 쿠키 접근
- `*.sooplive.co.kr` - SOOP 로그인 쿠키 접근
- `*.mul.live` - Mul.Live 콘텐츠 스크립트 실행
- `*.bngts.com` - 방통실 콘텐츠 스크립트 실행

## Fork 정보

이 프로젝트는 [jebibot/mullive-extension](https://github.com/jebibot/mullive-extension)의 포크입니다.

원본 프로젝트는 Jebibot에 의해 개발되었으며, 원본 라이센스(BSL 1.1)에 따라 1년 후 MIT 라이센스로 전환됩니다.

## 라이센스

이 프로젝트는 원본 프로젝트의 라이센스를 따릅니다.

원본 라이센스: Business Source License 1.1 (BSL 1.1)
- Licensor: Jebibot
- Licensed Work: Mul.Live Plus
- Change License: MIT License (원저작자 커밋 기준 1년 후 자동 전환)

자세한 내용은 [LICENSE](./LICENSE) 파일을 참조하세요.

## 문의

- Email: support@bngts.com
- GitHub Issues: [이슈 등록](https://github.com/bngts/bngts-extension/issues)

---

> 본 확장 프로그램은 치지직, SOOP과 관련이 없으며, 관련 상표는 각 소유자의 자산입니다. 본 확장 프로그램을 사용하여 발생하는 결과에 대한 모든 책임은 사용자에게 있습니다.
