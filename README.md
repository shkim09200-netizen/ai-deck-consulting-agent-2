# AI Deck Consulting Agent — Engine (M1)

SparkLabs 데모데이 피칭덱 컨설팅 에이전트의 **코어 엔진**. 회사 자료를 넣으면
컨설팅 하우스 스타일로 **Script(.docx)** → 승인 게이트 → **Skeleton(.pptx)** 를 생성한다.
최종 디자인은 하지 않는다 (구조·대본·placeholder까지).

> 이 저장소는 구현 스펙 §15의 **M1 (헤드리스 코어 엔진)** 이다. 웹 UI(Next.js)는 M2에서 올라간다.

## 설치

```bash
npm install
```

## API 키

```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-..."
```

## 실행

```bash
# Step 1(Script)까지만 생성하고 승인 게이트에서 정지
npm run generate -- <회사자료_폴더_또는_파일> --out out

# 검토 후, Skeleton까지 생성 (승인)
npm run generate -- <회사자료_폴더> --out out --approve --version 0.1

# 웹사이트도 소스로
npm run generate -- ./inputs/acme --url https://acme.com --approve
```

산출물: `out/회사명_input.json`, `out/회사명_script_v0.1.docx`, `out/회사명_skeleton_v0.1.pptx`

## 파이프라인 (구현 스펙 §5)

1. **Ingestion** — docx/pdf/xlsx/csv/이미지/URL 파싱 → `CompanyInput` (Claude vision, 숫자 창작 금지)
2. **명확화 게이트** — 필수 누락 정보는 지어내지 않고 질문 생성 (§5.2)
3. **Step 1 Script** — `(click)` 마커·`[CONFIRM]` 포함 구어체 대본 (§4.1)
4. **승인 게이트** — Script 승인 전 Skeleton 미생성 (§ 품질 원칙 #1)
5. **Step 2 Skeleton** — `(click)` 기준 슬라이드 분할, 노트=대본 매핑, 체크리스트 미충족 시 `[NEEDS INPUT]` (§4.2·4.4·4.5)
6. **AI Review + 통합 트래커** — High/Med/Low 지적 + 모든 `[CONFIRM]`/`[NEEDS INPUT]` 집계 (§8-5·§9)

## 하우스 스타일 커스터마이징

`src/domain/houseStyle.ts` — 섹션 구조, 체크리스트, 시간 예산, 트랙션 대체 우선순위, 어조 규칙.
버전 관리되는 config이며 프로젝트별 override 가능.

## Few-shot 샘플 (§5.4)

`samples/scripts/*.docx` 를 스타일 예시로 자동 로드한다 (현재 SparkLabs Batch-24 6개 우수 스크립트 포함).
`samples/ir/*.pdf` 는 참고용 최종 덱. 섹터 가이드는 `sectorGuide` 슬롯으로 주입.

## 테스트

```bash
npm test        # 결정론적 부분: 플래그, docx 라운드트립, pptx 유효성, 샘플 로드, config 정합성
npm run typecheck
```

## 다음 (M2+)

Next.js 2-윈도우 UI · 진행률 · Split View 편집 · Yjs 실시간 협업 · 버전 히스토리 · 인증/RBAC/공유 · Export.
