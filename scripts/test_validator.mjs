#!/usr/bin/env node
import { mkdtempSync, rmSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert'

const baseTemp = mkdtempSync(join(tmpdir(), 'dsh-test-suite-'))


const NL = String.fromCharCode(10)
function run(cmd, args) {
  return spawnSync(process.execPath, [cmd, ...args], {
    encoding: 'utf8'
  })
}

try {
  console.log('--- 测试 1: 正向单面插件骨架生成与校验 ---')
  const singleDir = join(baseTemp, 'test-single')
  const sc1 = run('scripts/scaffold_plugin.mjs', [singleDir])
  assert.strictEqual(sc1.status, 0, '单面脚手架生成失败: ' + sc1.stderr)
  const val1 = run('scripts/validate_plugin.mjs', [singleDir])
  assert.strictEqual(val1.status, 0, '单面插件校验应通过: ' + val1.stderr)
  console.log('OK 正向单面插件校验通过')

  console.log('--- 测试 2: 正向双面插件骨架生成与校验 ---')
  const dualDir = join(baseTemp, 'test-dual')
  const sc2 = run('scripts/scaffold_plugin.mjs', [dualDir, '--dual-face'])
  assert.strictEqual(sc2.status, 0, '双面脚手架生成失败: ' + sc2.stderr)
  const val2 = run('scripts/validate_plugin.mjs', [dualDir])
  assert.strictEqual(val2.status, 0, '双面插件校验应通过: ' + val2.stderr)
  console.log('OK 正向双面插件校验通过，且骨架自带 slots 注入示例')

  console.log('--- 测试 3 (负向): 双面插件缺失客户端文件 lib/client.js 应被拦截 ---')
  const dualMissingClient = join(baseTemp, 'dual-missing-client')
  run('scripts/scaffold_plugin.mjs', [dualMissingClient, '--dual-face'])
  unlinkSync(join(dualMissingClient, 'lib', 'client.js'))
  const val3 = run('scripts/validate_plugin.mjs', [dualMissingClient])
  assert.notStrictEqual(val3.status, 0, '双面插件缺失 client.js 时必须失败')
  assert(val3.stderr.includes('客户端入口文件不存在'), '应报错客户端入口文件不存在')
  console.log('OK 成功拦截缺失客户端文件的双面插件')

  console.log('--- 测试 4 (负向): patch 仅含注释伪造标记应被拦截 ---')
  const fakePatchDir = join(baseTemp, 'fake-patch')
  run('scripts/scaffold_plugin.mjs', [fakePatchDir])
  writeFileSync(join(fakePatchDir, 'cordis.patch.yml'), '# - insert:' + NL + '#   - id: fake' + NL + '#     name: dsh-fake' + NL);
  const val4 = run('scripts/validate_plugin.mjs', [fakePatchDir])
  assert.notStrictEqual(val4.status, 0, '仅含注释的伪造 patch 必须失败')
  assert(val4.stderr.includes('有效'), '应报错缺少有效 insert 声明')
  console.log('OK 成功拦截伪造注释的 patch')

  console.log('--- 测试 5 (负向): 入口 JS 语法错误应被拦截 ---')
  const syntaxErrDir = join(baseTemp, 'syntax-err')
  run('scripts/scaffold_plugin.mjs', [syntaxErrDir])
  writeFileSync(join(syntaxErrDir, 'index.js'), 'export function apply( {');
  const val5 = run('scripts/validate_plugin.mjs', [syntaxErrDir])
  assert.notStrictEqual(val5.status, 0, '语法错误的 JS 入口必须失败')
  assert(val5.stderr.includes('语法错误'), '应报错 JS 语法错误')
  console.log('OK 成功拦截语法错误的插件入口')

  console.log('--- 测试 6 (负向): patch id 与 package.json 不一致应被拦截 ---')
  const mismatchDir = join(baseTemp, 'mismatch-id')
  run('scripts/scaffold_plugin.mjs', [mismatchDir])
  const patchContent = readFileSync(join(mismatchDir, 'cordis.patch.yml'), 'utf8')
  writeFileSync(join(mismatchDir, 'cordis.patch.yml'), patchContent.replace('id: mismatch-id', 'id: wrong-id'));
  const val6 = run('scripts/validate_plugin.mjs', [mismatchDir])
  assert.notStrictEqual(val6.status, 0, 'patch id 不匹配时必须失败')
  assert(val6.stderr.includes('一致'), '应报错 patch id 不一致')
  console.log('OK 成功拦截 patch id 不匹配的插件')

  console.log('--- 测试 7 (负向): dsh.bundle.patch 指向不存在的文件应被拦截 ---')
  const badPatchDir = join(baseTemp, 'bad-bundle-patch')
  run('scripts/scaffold_plugin.mjs', [badPatchDir])
  const pkgText = readFileSync(join(badPatchDir, 'package.json'), 'utf8')
  writeFileSync(join(badPatchDir, 'package.json'), pkgText.replace('./cordis.patch.yml', './missing.patch.yml'))
  const val7 = run('scripts/validate_plugin.mjs', [badPatchDir])
  assert.notStrictEqual(val7.status, 0, 'bundle.patch 指向缺失文件时必须失败')
  assert(val7.stderr.includes('patch 指定的补丁文件不存在'), '应报错补丁文件不存在')
  console.log('OK 成功拦截指向缺失补丁文件的 bundle')

  console.log('--- 测试 8 (负向): client 入口未经 slots 挂载应被拦截 ---')
  const noSlotsDir = join(baseTemp, 'no-slots')
  run('scripts/scaffold_plugin.mjs', [noSlotsDir, '--dual-face'])
  writeFileSync(join(noSlotsDir, 'lib', 'client.js'), 'export function apply(ctx) {}' + NL)
  const val8 = run('scripts/validate_plugin.mjs', [noSlotsDir])
  assert.notStrictEqual(val8.status, 0, 'client 入口不经 slots 挂载时必须失败')
  assert(val8.stderr.includes('slots.inject/register'), '应报错必须经 slots 挂载')
  console.log('OK 成功拦截不经插槽挂载的 client 入口')

  console.log('--- 测试 9: 文档示例回归 ---')
  const docDir = join(baseTemp, 'doc-example')
  run('scripts/scaffold_plugin.mjs', [docDir, '--dual-face'])
  const docLines = readFileSync('references/three-roles.md', 'utf8').split(NL)
  const fence = String.fromCharCode(96).repeat(3)
  const openAt = docLines.indexOf(fence + 'json')
  const closeAt = docLines.indexOf(fence, openAt + 1)
  assert(openAt >= 0 && closeAt > openAt, 'three-roles.md 应包含 package.json 的 json 代码块')
  const docPkg = JSON.parse(docLines.slice(openAt + 1, closeAt).join(NL))
  writeFileSync(join(docDir, 'package.json'), JSON.stringify(docPkg, null, 2) + NL)
  writeFileSync(join(docDir, 'lib', 'index.js'), 'export function apply(ctx) {}' + NL)
  const docPatch = ['# 文档示例补丁', '- insert:', '    - id: ' + docPkg.dsh.bundle.id, '      name: ' + docPkg.name, '      config: {}', '      disabled: false'].join(NL) + NL
  writeFileSync(join(docDir, 'cordis.patch.yml'), docPatch)
  const val9 = run('scripts/validate_plugin.mjs', [docDir])
  assert.strictEqual(val9.status, 0, 'three-roles.md 的双面示例必须能通过校验: ' + val9.stderr)
  console.log('OK 文档中的双面示例与校验器保持一致')

  console.log('\n全部 9 组正反向测试 100% 通过');
} finally {
  try {
    rmSync(baseTemp, { recursive: true, force: true })
  } catch {}
}