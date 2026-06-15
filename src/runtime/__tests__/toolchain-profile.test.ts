import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  deriveBootstrapHypothesisFromProfiles,
  detectToolchainProfiles,
} from '../toolchain-profile.js'

const roots: string[] = []

function project(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'guildhall-toolchain-'))
  roots.push(root)
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('toolchain profiles', () => {
  it('detects Python CLI projects without Node leakage', () => {
    const root = project({
      'pyproject.toml': '[project]\nname = "demo-cli"\n',
      'uv.lock': '',
      'tests/test_cli.py': 'def test_cli(): assert True\n',
    })

    const profiles = detectToolchainProfiles(root)
    expect(profiles.map((profile) => profile.id)).toContain('python')

    const hypothesis = deriveBootstrapHypothesisFromProfiles(profiles)
    expect(hypothesis.packageManager).toBe('uv')
    expect(hypothesis.commands).toContain('uv sync')
    expect(hypothesis.successGates).toContain('uv run pytest')
    expect(hypothesis.proofKinds).toEqual(expect.arrayContaining(['command', 'cli']))
    expect(JSON.stringify(hypothesis)).not.toMatch(/pnpm|package\.json|browser proof/i)
  })

  it('detects Rust libraries with cargo gates', () => {
    const root = project({
      'Cargo.toml': '[package]\nname = "calc"\nversion = "0.1.0"\nedition = "2021"\n',
      'src/lib.rs': 'pub fn add(a:i32,b:i32)->i32{a+b}\n',
    })

    const hypothesis = deriveBootstrapHypothesisFromProfiles(detectToolchainProfiles(root))
    expect(hypothesis.commands).toEqual([])
    expect(hypothesis.successGates).toEqual(
      expect.arrayContaining(['cargo test', 'cargo clippy --all-targets --all-features']),
    )
    expect(JSON.stringify(hypothesis)).not.toMatch(/pnpm|vitest|tsconfig/i)
  })

  it('detects Go services with go test gates', () => {
    const root = project({
      'go.mod': 'module example.com/demo\n\ngo 1.22\n',
      'server_test.go': 'package main\n',
    })

    const hypothesis = deriveBootstrapHypothesisFromProfiles(detectToolchainProfiles(root))
    expect(hypothesis.successGates).toContain('go test ./...')
    expect(JSON.stringify(hypothesis)).not.toMatch(/pnpm|package\.json|Vue|Svelte/i)
  })

  it('detects Java Gradle services', () => {
    const root = project({
      'build.gradle.kts': 'plugins { java }\n',
      'gradlew': '#!/bin/sh\n',
      'src/test/java/AppTest.java': 'class AppTest {}\n',
    })

    const hypothesis = deriveBootstrapHypothesisFromProfiles(detectToolchainProfiles(root))
    expect(hypothesis.successGates).toContain('./gradlew test')
    expect(JSON.stringify(hypothesis)).not.toMatch(/npm|tsconfig|browser proof/i)
  })

  it('detects Swift packages and native projects', () => {
    const swift = project({
      'Package.swift': '// swift-tools-version: 6.0\n',
      'Sources/App/App.swift': 'public struct App {}\n',
    })
    const native = project({
      'CMakeLists.txt': 'cmake_minimum_required(VERSION 3.20)\nproject(cli)\n',
      'src/main.c': 'int main(void) { return 0; }\n',
    })

    expect(deriveBootstrapHypothesisFromProfiles(detectToolchainProfiles(swift)).successGates).toContain(
      'swift test',
    )
    expect(deriveBootstrapHypothesisFromProfiles(detectToolchainProfiles(native)).successGates).toEqual(
      expect.arrayContaining(['cmake -S . -B build', 'cmake --build build', 'ctest --test-dir build']),
    )
  })

  it('detects Terraform modules as validation work instead of code builds', () => {
    const root = project({
      'main.tf': 'terraform { required_version = ">= 1.6.0" }\n',
    })

    const hypothesis = deriveBootstrapHypothesisFromProfiles(detectToolchainProfiles(root))
    expect(hypothesis.successGates).toEqual(['terraform fmt -check', 'terraform validate'])
    expect(hypothesis.proofKinds).toEqual(expect.arrayContaining(['command', 'review']))
    expect(JSON.stringify(hypothesis)).not.toMatch(/build|typecheck|pnpm|package\.json/i)
  })

  it('detects docs-only projects without inventing code gates', () => {
    const root = project({
      'README.md': '# Manual\n',
      'docs/install.md': 'Install the CLI.\n',
    })

    const hypothesis = deriveBootstrapHypothesisFromProfiles(detectToolchainProfiles(root))
    expect(hypothesis.commands).toEqual([])
    expect(hypothesis.successGates).toEqual([])
    expect(hypothesis.proofKinds).toContain('review')
    expect(JSON.stringify(hypothesis)).not.toMatch(/pnpm|pytest|cargo|browser proof/i)
  })
})
