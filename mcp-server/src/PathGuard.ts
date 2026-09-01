/**
 * PathGuard - centralizes filesystem path validation for all MCP tools that
 * read or write files on behalf of the model (open_document, save_document,
 * export_to_text, export_to_html, insert_image, insert_image_in_cell).
 *
 * Fixes CWE-73 (arbitrary file read/write via unvalidated path) reported in
 * https://github.com/Dayoooun/hwpx-mcp/issues/3 for hwpx-mcp 0.2.0.
 *
 * The workspace root is intentionally NOT hardcoded - it is read from the
 * HWPX_MCP_WORKSPACE_ROOT environment variable so it can be injected via
 * claude_desktop_config.json's `env` block (or any other MCP host config).
 */
import * as fs from 'fs';
import * as path from 'path';

export class PathAccessDeniedError extends Error {
  constructor(message = '허용되지 않은 경로입니다.') {
    super(message);
    this.name = 'PathAccessDeniedError';
  }
}

let cachedWorkspaceRoot: string | null = null;

/**
 * Resolve the configured workspace root once per process. Falls back to the
 * server's current working directory if HWPX_MCP_WORKSPACE_ROOT is unset,
 * but logs a loud warning since that fallback is rarely what an operator
 * wants in production.
 */
export function getWorkspaceRoot(): string {
  if (cachedWorkspaceRoot) return cachedWorkspaceRoot;

  const configured = process.env.HWPX_MCP_WORKSPACE_ROOT;
  const root = configured && configured.trim().length > 0
    ? path.resolve(configured.trim())
    : path.resolve(process.cwd());

  if (!configured || configured.trim().length === 0) {
    console.error(
      `[PathGuard] WARNING: HWPX_MCP_WORKSPACE_ROOT is not set. ` +
      `Falling back to process.cwd() = "${root}". ` +
      `Set HWPX_MCP_WORKSPACE_ROOT explicitly to restrict file access.`
    );
  }

  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
    console.error(`[PathGuard] Created workspace root directory: ${root}`);
  }

  cachedWorkspaceRoot = root;
  return root;
}

/** Test-only hook to reset the cached workspace root between test cases. */
export function _resetWorkspaceRootCacheForTests(): void {
  cachedWorkspaceRoot = null;
}

function isWithinRoot(target: string, root: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export interface ResolveSafePathOptions {
  /** If true, throw when the resolved path does not exist on disk. */
  mustExist?: boolean;
}

/**
 * Resolve `inputPath` against the workspace root and verify the result
 * (including its real, symlink-resolved form) stays inside that root.
 *
 * Any absolute path, `../` traversal, or symlink that escapes the workspace
 * root causes a PathAccessDeniedError. The attempted path is logged to
 * stderr for operator diagnosis; the error surfaced to the MCP caller never
 * includes filesystem details.
 */
export function resolveSafePath(inputPath: unknown, options: ResolveSafePathOptions = {}): string {
  if (!inputPath || typeof inputPath !== 'string') {
    throw new PathAccessDeniedError('경로가 지정되지 않았습니다.');
  }

  const workspaceRoot = getWorkspaceRoot();
  // path.resolve ignores the base when inputPath is already absolute, which
  // is exactly what we want: an absolute path outside the root must fail
  // the isWithinRoot check below rather than being silently rebased.
  const resolved = path.resolve(workspaceRoot, inputPath);

  if (!isWithinRoot(resolved, workspaceRoot)) {
    console.error(
      `[PathGuard] Rejected path outside workspace root. ` +
      `input="${inputPath}" resolved="${resolved}" workspaceRoot="${workspaceRoot}"`
    );
    throw new PathAccessDeniedError();
  }

  // Walk up to the nearest existing ancestor so we can realpath() it even
  // when `resolved` itself does not exist yet (e.g. a new save target).
  let existingAncestor = resolved;
  while (!fs.existsSync(existingAncestor)) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) break; // reached filesystem root
    existingAncestor = parent;
  }

  let realAncestor: string;
  let realWorkspaceRoot: string;
  try {
    realAncestor = fs.realpathSync(existingAncestor);
    realWorkspaceRoot = fs.realpathSync(workspaceRoot);
  } catch {
    console.error(
      `[PathGuard] Rejected path - realpath resolution failed. ` +
      `input="${inputPath}" resolved="${resolved}"`
    );
    throw new PathAccessDeniedError();
  }

  const remainder = path.relative(existingAncestor, resolved);
  const realResolved = remainder ? path.join(realAncestor, remainder) : realAncestor;

  if (!isWithinRoot(realAncestor, realWorkspaceRoot) || !isWithinRoot(realResolved, realWorkspaceRoot)) {
    console.error(
      `[PathGuard] Rejected path - symlink escape detected. ` +
      `input="${inputPath}" resolved="${resolved}" realAncestor="${realAncestor}"`
    );
    throw new PathAccessDeniedError();
  }

  if (options.mustExist && !fs.existsSync(resolved)) {
    throw new PathAccessDeniedError('파일을 찾을 수 없습니다.');
  }

  return resolved;
}
