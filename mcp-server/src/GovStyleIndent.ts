/**
 * 한국 공문서 표준서식 개조식(□/○/-/※/①②③) 위계 규칙.
 *
 * 수치 출처: 표준 정부 보고서 서식 샘플 문서
 * - 서식 정의부(파라그래프 index 4~7)와 <작성 예시> 실제 작성부(index 17~29)의
 *   marginLeft/firstLineIndent를 get_paragraph_style로 대조 확인함 (두 부분 완전 일치).
 *
 * 확정값:
 *   □         : 앞 공백 0칸, firstLineIndent 0
 *   ○/ㅇ      : 앞 공백 1칸, firstLineIndent 0
 *   -         : 앞 공백 3칸, firstLineIndent 0
 *   ※(줄바꿈 없음) : 앞 공백 5칸, firstLineIndent 0
 *   ※(줄바꿈 있음) : 앞 공백 5칸, firstLineIndent -41.16
 *   ①②③...  : 앞 공백 1칸, firstLineIndent -151.38, marginTop/marginBottom 5
 *
 * ※ 줄바꿈 여부 판정은 표준서식 파일에 페이지 폭/폰트 메트릭 API가 노출되어
 * 있지 않아 완전한 계산이 불가능하다. 대신 표준서식에서 실제로 관찰된 두 개의
 * 기준점(줄바꿈 없는 ※ 예문 14 width-units → indent 0, 줄바꿈되는 ※ 예문
 * 80+ width-units → indent -41.16)을 근거로 한 휴리스틱 임계값을 사용한다.
 * 경계값 근처의 텍스트는 육안으로 재확인을 권장한다.
 */

export type GovStyleLevel = '□' | '○' | '-' | '※' | '①' | 'none';

export interface GovStyleResult {
  /** 위계 마커에 맞는 공백이 삽입된 최종 텍스트 */
  text: string;
  level: GovStyleLevel;
  /** set_paragraph_style에 그대로 전달할 스타일 오버라이드 (없으면 undefined) */
  style?: {
    firstLineIndent?: number;
    marginTop?: number;
    marginBottom?: number;
  };
}

const CIRCLED_NUMBERS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';

/** ※ 줄바꿈 판정 임계값 (width-units). 표준서식 관찰값 기반 휴리스틱 — 정확한 계산 아님. */
export const NOTE_WRAP_WIDTH_THRESHOLD = 40;

/**
 * 반각 문자는 1, 전각(한글/CJK/전각기호) 문자는 2로 계산한 대략적인 표시 폭.
 */
export function displayWidth(s: string): number {
  let width = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    const isFullWidth =
      (code >= 0x1100 && code <= 0x11ff) || // Hangul Jamo
      (code >= 0x3000 && code <= 0x303f) || // CJK 기호/구두점
      (code >= 0x3130 && code <= 0x318f) || // Hangul 호환 자모
      (code >= 0xac00 && code <= 0xd7a3) || // 한글 음절
      (code >= 0x4e00 && code <= 0x9fff) || // CJK 한자
      (code >= 0xff00 && code <= 0xffef); // 전각 형태
    width += isFullWidth ? 2 : 1;
  }
  return width;
}

/**
 * 개조식 텍스트에 표준서식 위계 규칙(공백 + hanging indent)을 적용한다.
 * 입력 텍스트는 마커 문자(□/○/ㅇ/-/※/①...)로 시작해야 하며, 이미 붙어있는
 * 선행 공백은 없다고 가정한다 (있으면 중복 삽입될 수 있음).
 */
export function applyGovStylePrefix(rawText: string): GovStyleResult {
  const text = rawText;

  if (text.startsWith('□')) {
    return { text, level: '□' };
  }

  if (text.startsWith('○') || text.startsWith('ㅇ')) {
    return { text: ' ' + text, level: '○' };
  }

  if (text.startsWith('-')) {
    return { text: '   ' + text, level: '-' };
  }

  if (text.startsWith('※')) {
    const wraps = displayWidth(text) > NOTE_WRAP_WIDTH_THRESHOLD;
    return {
      text: '     ' + text,
      level: '※',
      style: wraps ? { firstLineIndent: -41.16 } : { firstLineIndent: 0 },
    };
  }

  if ([...CIRCLED_NUMBERS].some((c) => text.startsWith(c))) {
    return {
      text: ' ' + text,
      level: '①',
      style: { firstLineIndent: -151.38, marginTop: 5, marginBottom: 5 },
    };
  }

  return { text, level: 'none' };
}
