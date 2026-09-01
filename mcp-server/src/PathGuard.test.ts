/**
 * Regression tests for the CWE-73 path traversal fix
 * (https://github.com/Dayoooun/hwpx-mcp/issues/3).
 *
 * All six affected tools (save_document, export_to_text, export_to_html,
 * open_document, insert_image, insert_image_in_cell) call resolveSafePath()
 * with the same two option shapes used below:
 *   - mustExist: true  -> open_document, insert_image, insert_image_in_cell
 *   - mustExist: false -> save_document, export_to_text, export_to_html
 * index.ts itself contains no branching logic beyond forwarding args to
 * resolveSafePath, so exercising both shapes here covers all six call sites.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  resolveSafePath,
  PathAccessDeniedError,
  _resetWorkspaceRootCacheForTests,
} from './PathGuard';

describe('PathGuard.resolveSafePath (CWE-73 fix)', () => {
  let workspaceRoot: string;
  let outsideDir: string;

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hwpx-workspace-'));
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hwpx-outside-'));
    process.env.HWPX_MCP_WORKSPACE_ROOT = workspaceRoot;
    _resetWorkspaceRootCacheForTests();
  });

  afterEach(() => {
    delete process.env.HWPX_MCP_WORKSPACE_ROOT;
    _resetWorkspaceRootCacheForTests();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  // ---- Happy path -------------------------------------------------------

  it('allows a relative path inside the workspace root', () => {
    const resolved = resolveSafePath('report.hwpx');
    expect(resolved).toBe(path.resolve(workspaceRoot, 'report.hwpx'));
  });

  it('allows a nested relative path inside the workspace root', () => {
    const resolved = resolveSafePath('sub/dir/report.hwpx');
    expect(resolved).toBe(path.resolve(workspaceRoot, 'sub/dir/report.hwpx'));
  });

  it('allows an absolute path that is itself inside the workspace root', () => {
    const inside = path.join(workspaceRoot, 'inside.hwpx');
    const resolved = resolveSafePath(inside);
    expect(resolved).toBe(path.resolve(inside));
  });

  // ---- save_document / export_to_text / export_to_html (mustExist: false) --

  describe('write-style tools (save_document, export_to_text, export_to_html)', () => {
    it('rejects an absolute path outside the workspace root', () => {
      const evil = path.join(outsideDir, 'pwned.hwpx');
      expect(() => resolveSafePath(evil)).toThrow(PathAccessDeniedError);
    });

    it('rejects a relative "../" traversal path that escapes the workspace root', () => {
      const evil = path.join('..', path.basename(outsideDir), 'pwned.hwpx');
      expect(() => resolveSafePath(evil)).toThrow(PathAccessDeniedError);
    });

    it('does not leak the resolved filesystem path in the thrown error message', () => {
      const evil = path.join(outsideDir, 'pwned.hwpx');
      try {
        resolveSafePath(evil);
        expect.fail('expected resolveSafePath to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(PathAccessDeniedError);
        expect((err as Error).message).not.toContain(outsideDir);
      }
    });
  });

  // ---- open_document / insert_image / insert_image_in_cell (mustExist: true) --

  describe('read-style tools (open_document, insert_image, insert_image_in_cell)', () => {
    it('rejects an absolute path outside the workspace root even if the file exists', () => {
      const evil = path.join(outsideDir, 'secret.hwpx');
      fs.writeFileSync(evil, 'not actually a hwpx file');
      expect(() => resolveSafePath(evil, { mustExist: true })).toThrow(PathAccessDeniedError);
    });

    it('rejects a "../" traversal path that escapes the workspace root', () => {
      const evilName = path.join('..', path.basename(outsideDir), 'secret.hwpx');
      fs.writeFileSync(path.join(outsideDir, 'secret.hwpx'), 'not actually a hwpx file');
      expect(() => resolveSafePath(evilName, { mustExist: true })).toThrow(PathAccessDeniedError);
    });

    it('rejects a path inside the workspace root that does not exist when mustExist is set', () => {
      expect(() => resolveSafePath('missing.hwpx', { mustExist: true })).toThrow(PathAccessDeniedError);
    });
  });

  // ---- Symlink escape (applies to every tool since they all funnel through here) --

  describe('symlink escape', () => {
    it('rejects a symlinked directory inside the workspace root that points outside it', () => {
      // Symlinks require elevated privileges on some Windows configurations;
      // skip gracefully rather than failing CI on unrelated permission issues.
      const linkPath = path.join(workspaceRoot, 'escape-link');
      try {
        fs.symlinkSync(outsideDir, linkPath, 'dir');
      } catch {
        return;
      }

      expect(() => resolveSafePath(path.join('escape-link', 'pwned.hwpx'))).toThrow(
        PathAccessDeniedError
      );
    });

    it('rejects a symlinked file inside the workspace root that points to a file outside it', () => {
      const targetFile = path.join(outsideDir, 'secret.hwpx');
      fs.writeFileSync(targetFile, 'secret contents');
      const linkPath = path.join(workspaceRoot, 'escape-link.hwpx');
      try {
        fs.symlinkSync(targetFile, linkPath, 'file');
      } catch {
        return;
      }

      expect(() => resolveSafePath('escape-link.hwpx', { mustExist: true })).toThrow(
        PathAccessDeniedError
      );
    });
  });

  // ---- Misc input validation ---------------------------------------------

  it('rejects an empty path', () => {
    expect(() => resolveSafePath('')).toThrow(PathAccessDeniedError);
  });

  it('rejects a non-string path', () => {
    expect(() => resolveSafePath(undefined)).toThrow(PathAccessDeniedError);
  });
});
