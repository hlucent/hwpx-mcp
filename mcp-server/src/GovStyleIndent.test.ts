/**
 * Tests for applyGovStylePrefix, calibrated against the paragraph styles
 * observed in Desktop\[REDACTED_TEMPLATE]\[REDACTED_DOC] 서식.hwpx (both the
 * 서식 정의부 and <작성 예시> 실제 작성부, which were confirmed identical).
 */
import { describe, it, expect } from 'vitest';
import { applyGovStylePrefix, displayWidth, NOTE_WRAP_WIDTH_THRESHOLD } from './GovStyleIndent';

describe('applyGovStylePrefix', () => {
  it('□ gets no leading space and no style override', () => {
    const r = applyGovStylePrefix('□ 추진배경');
    expect(r.text).toBe('□ 추진배경');
    expect(r.level).toBe('□');
    expect(r.style).toBeUndefined();
  });

  it('○ gets exactly 1 leading space and no style override', () => {
    const r = applyGovStylePrefix('○ 현황과 문제점');
    expect(r.text).toBe(' ○ 현황과 문제점');
    expect(r.level).toBe('○');
    expect(r.style).toBeUndefined();
  });

  it('ㅇ (Hangul ieung) is treated the same as ○', () => {
    const r = applyGovStylePrefix('ㅇ 행 사 명 : 테스트');
    expect(r.text).toBe(' ㅇ 행 사 명 : 테스트');
    expect(r.level).toBe('○');
  });

  it('- gets exactly 3 leading spaces and no style override', () => {
    const r = applyGovStylePrefix('- 세부 내용');
    expect(r.text).toBe('   - 세부 내용');
    expect(r.level).toBe('-');
    expect(r.style).toBeUndefined();
  });

  it('short ※ (no wrap) gets 5 leading spaces and firstLineIndent 0', () => {
    // Matches the template's own short example: "     ※ 한컴돋움 13"
    const r = applyGovStylePrefix('※ 한컴돋움 13');
    expect(r.text).toBe('     ※ 한컴돋움 13');
    expect(r.level).toBe('※');
    expect(r.style).toEqual({ firstLineIndent: 0 });
  });

  it('long ※ (wraps) gets 5 leading spaces and firstLineIndent -41.16', () => {
    // Matches the <작성 예시> long example that carried firstLineIndent -41.16
    const long = '※ 희망 2023 나눔캠페인 (사회복지공동모금회 모금 캠페인)　: ’22.12.1. ~ ’23.1.31.';
    expect(displayWidth(long)).toBeGreaterThan(NOTE_WRAP_WIDTH_THRESHOLD);
    const r = applyGovStylePrefix(long);
    expect(r.text.startsWith('     ※')).toBe(true);
    expect(r.level).toBe('※');
    expect(r.style).toEqual({ firstLineIndent: -41.16 });
  });

  it('circled numbers get 1 leading space, firstLineIndent -151.38, margin 5/5', () => {
    const r1 = applyGovStylePrefix('① 사랑의열매 전달');
    expect(r1.text).toBe(' ① 사랑의열매 전달');
    expect(r1.level).toBe('①');
    expect(r1.style).toEqual({ firstLineIndent: -151.38, marginTop: 5, marginBottom: 5 });

    const r2 = applyGovStylePrefix('② 사랑의온도탑 제막');
    expect(r2.style).toEqual({ firstLineIndent: -151.38, marginTop: 5, marginBottom: 5 });
  });

  it('unrecognized marker passes text through unchanged with level none', () => {
    const r = applyGovStylePrefix('일반 텍스트');
    expect(r.text).toBe('일반 텍스트');
    expect(r.level).toBe('none');
    expect(r.style).toBeUndefined();
  });

  describe('displayWidth', () => {
    it('counts half-width ASCII as 1 and full-width Hangul as 2', () => {
      expect(displayWidth('ab')).toBe(2);
      expect(displayWidth('한글')).toBe(4);
      expect(displayWidth('a한')).toBe(3);
    });
  });
});
