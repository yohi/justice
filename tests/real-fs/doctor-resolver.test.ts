// tests/real-fs/doctor-resolver.test.ts
// 設計書 §9.1.1「実モジュール統合テスト」: 一時 package cache fixture（実ディスク上に
// ~/.cache/opencode/packages/@yohi/justice@<version>/node_modules/@yohi/justice/ 相当を
// 構築）と absolute path fixture 経由で、doctor の resolver が実モジュールを import し、
// FF-009 と同一の契約判定を返すことを検証する。
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkLoaderContract } from "../../src/core/loader-contract";
import { normalizeSpecifier, resolveSpecifier } from "../../src/core/doctor-specifier";
import { createCliFileReader, runDoctor } from "../../src/runtime/doctor-cli";

let root: string;
let cacheRoot: string;
const VERSION = "3.0.0";
const packageDir = (): string =>
  `${cacheRoot}/packages/@yohi/justice@${VERSION}/node_modules/@yohi/justice`;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "justice-doctor-integration-"));
  cacheRoot = join(root, "cache", "opencode");
  // 現在のビルド成果物（dist/ と package.json）を package cache レイアウトにコピー
  await cp(resolve("dist"), join(packageDir(), "dist"), { recursive: true });
  await cp(resolve("package.json"), join(packageDir(), "package.json"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("doctor resolver integration (real modules)", () => {
  it("resolves the versioned cache entry and applies the FF-009 contract judgment", async () => {
    const resolution = await resolveSpecifier(normalizeSpecifier(`@yohi/justice@${VERSION}`), {
      fileReader: createCliFileReader(),
      cacheRoot,
    });
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    const mod = (await import(resolution.entry.entryFile)) as Record<string, unknown>;
    const contract = checkLoaderContract(mod);
    expect(contract.ok).toBe(true);
    expect(contract.pluginFactories).toHaveLength(1);
  });

  it("resolves the ./opencode subpath to the same single plugin", async () => {
    const resolution = await resolveSpecifier(
      normalizeSpecifier(`@yohi/justice@${VERSION}/opencode`),
      { fileReader: createCliFileReader(), cacheRoot },
    );
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    const mod = (await import(resolution.entry.entryFile)) as Record<string, unknown>;
    const contract = checkLoaderContract(mod);
    expect(contract.ok).toBe(true);
    expect(contract.pluginFactories).toHaveLength(1);
  });

  it("runDoctor exits 0 against the cached healthy install", async () => {
    const configPath = join(root, "opencode.jsonc");
    await writeFile(configPath, `{ "plugin": ["@yohi/justice@${VERSION}"] }`);
    const report = await runDoctor({
      fileReader: createCliFileReader(),
      env: {},
      cwd: root,
      homeDir: root,
      cacheRoot,
      logPaths: [],
      importer: (entryFile) => import(entryFile) as Promise<Record<string, unknown>>,
    });
    expect(report.exitCode).toBe(0);
    expect(report.text).toContain("ローダ契約 OK");
  });

  it("runDoctor resolves an absolute-path registration", async () => {
    const absEntry = join(packageDir(), "dist", "opencode-plugin.js");
    const configPath = join(root, "opencode-abs.jsonc");
    await writeFile(configPath, `{ "plugin": ["${absEntry}"] }`);
    const report = await runDoctor({
      fileReader: createCliFileReader(),
      env: { OPENCODE_CONFIG: configPath },
      cwd: root,
      homeDir: root,
      cacheRoot,
      logPaths: [],
      importer: (entryFile) => import(entryFile) as Promise<Record<string, unknown>>,
    });
    expect(report.exitCode).toBe(0);
  });
});
