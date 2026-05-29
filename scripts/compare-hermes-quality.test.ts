import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { discoverGuildhallArtifactRoots, guildhallProjectIdForOutputRoot, gradeArtifact, scoreQuality } from './compare-hermes-quality.mjs'

describe('Hermes quality comparator artifact discovery', () => {
  it('grades a Guildhall app from the task worktree while marking it unlanded', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-quality-root-'))
    const worktree = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-quality-worktree-'))
    await fs.mkdir(path.join(root, '.guildhall'), { recursive: true })
    await fs.writeFile(path.join(root, '.guildhall', 'TASKS.json'), JSON.stringify([
      {
        id: 'task-001',
        status: 'review',
        worktreePath: worktree,
      },
    ]))
    await fs.writeFile(path.join(worktree, 'index.html'), pantryAppHtml(), 'utf8')

    const roots = await discoverGuildhallArtifactRoots(root)
    const artifact = await gradeArtifact(root, { mode: 'app-explicit' }, path.join(root, 'screenshots'), roots)
    const score = scoreQuality({
      task: { mode: 'app-explicit' },
      artifact,
      exitedCleanly: false,
      truthfulCompletion: false,
      proofPresent: true,
    })

    expect(roots).toContain(worktree)
    expect(artifact.fileExists).toBe(true)
    expect(artifact.sourceRoot).toBe(worktree)
    expect(artifact.landedInProjectRoot).toBe(false)
    expect(artifact.browserProof.screenshots).toHaveLength(2)
    expect(score.checks.find(check => check.id === 'landed_in_project_root')?.passed).toBe(false)
    expect(score.total).toBeGreaterThan(5)
  })

  it('discovers task worktrees from the current versioned task store shape', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-quality-versioned-root-'))
    const worktree = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-quality-versioned-worktree-'))
    await fs.mkdir(path.join(root, '.guildhall'), { recursive: true })
    await fs.writeFile(path.join(root, '.guildhall', 'TASKS.json'), JSON.stringify({
      version: 1,
      tasks: [{ id: 'task-001', worktreePath: worktree }],
    }))

    await expect(discoverGuildhallArtifactRoots(root)).resolves.toEqual([worktree])
  })

  it('derives a unique Guildhall project id for each benchmark output root', () => {
    expect(guildhallProjectIdForOutputRoot('/tmp/run-a')).toBe('guildhall-hermes-quality-run-a')
    expect(guildhallProjectIdForOutputRoot('/tmp/run-b')).toBe('guildhall-hermes-quality-run-b')
    expect(guildhallProjectIdForOutputRoot('/tmp/!!!')).toMatch(/^guildhall-hermes-quality-/)
  })
})

function pantryAppHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Pantry Pulse</title>
  <style>
    :root { --surface: #fff8ed; --primary: #7a8f4d; --accent: #d98c35; --urgent: #d95d39; }
    body { margin: 0; font-family: system-ui, sans-serif; background: var(--surface); color: #2c261c; }
    main { max-width: 780px; margin: auto; padding: 32px; }
    article { border: 1px solid #dfc7a3; border-radius: 8px; padding: 12px; margin: 8px 0; background: white; }
    button { background: var(--primary); color: white; border: 0; border-radius: 6px; padding: 8px 12px; }
  </style>
</head>
<body>
  <main>
    <h1>Pantry Pulse</h1>
    <p><span id="count">7</span> remaining</p>
    <label><input type="radio" name="filter" checked> All</label>
    <label><input id="soon" type="radio" name="filter"> Expiring soon</label>
    <section id="items"></section>
  </main>
  <script>
    const items = ['Rice - grains - 2 bags - expires in 40 days', 'Beans - cans - 4 - expires in 12 days', 'Milk - dairy - 1 - expires in 2 days', 'Spinach - produce - 1 - expires in 1 day', 'Yogurt - dairy - 5 - expires in 3 days', 'Pasta - grains - 3 - expires in 90 days', 'Tomatoes - produce - 6 - expires in 4 days'];
    let current = items.slice();
    function render(list = current) {
      document.getElementById('items').innerHTML = list.map((item, index) => '<article><strong>' + item + '</strong> <button data-index="' + index + '">Mark used</button></article>').join('');
      document.getElementById('count').textContent = String(list.length);
    }
    document.getElementById('soon').addEventListener('change', () => render(current.slice(2, 6)));
    document.addEventListener('click', event => {
      if (!event.target.matches('button')) return;
      current.shift();
      render(current);
    });
    render();
  </script>
</body>
</html>`
}
