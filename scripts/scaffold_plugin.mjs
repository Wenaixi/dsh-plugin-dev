#!/usr/bin/env node
// DSH 插件组合包（bundle）脚手架。
// 用法：node scripts/scaffold_plugin.mjs <plugin-dir> [--client]
// 生成：package.json（含 dsh.bundle 声明）、cordis.patch.yml、index.js 入口；
//       --client 追加 exports["./client"] 与 lib/client.js 双面骨架。

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

const dir = resolve(process.argv[2] ?? '.')
const withClient = process.argv.includes('--client')
const name = basename(dir)

if (existsSync(dir) && existsSync(join(dir, 'package.json'))) {
  console.error('目标目录已存在 package.json，拒绝覆盖：' + dir)
  process.exit(1)
}
mkdirSync(dir, { recursive: true })

const pkg = {
  name,
  version: '0.1.0',
  type: 'module',
  main: 'index.js',
  files: ['index.js', 'cordis.patch.yml'],
  exports: { '.': './index.js' },
  dsh: { bundle: { patch: './cordis.patch.yml' } },
  peerDependencies: { '@deepseek-ai/dsh': '>=0.2.0-rc.1' },
}
if (withClient) {
  pkg.files.push('lib')
  pkg.exports['./client'] = './lib/client.js'
  pkg.dsh.client = { platform: 'web', inject: ['@deepseek-ai/dsh-client-ui-settings'] }
  pkg.peerDependencies.react = '^18.2.0'
}

writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')

writeFileSync(join(dir, 'cordis.patch.yml'), [
  '- insert:',
  '    - id: ' + name + '-entry',
  "      name: '" + name + "'",
  '      config: {}',
  '      disabled: false',
  '',
].join('\n'))

writeFileSync(join(dir, 'index.js'), [
  '// ' + name + '：DSH 插件入口（Host 侧）',
  "import type { Context } from '@deepseek-ai/cordis'",
  '',
  "export const name = '" + name + "'",
  '',
  'export function apply(ctx: Context) {',
  '  // 在此注册效果；卸载时自动回滚',
  '}',
  '',
].join('\n'))

if (withClient) {
  mkdirSync(join(dir, 'lib'), { recursive: true })
  writeFileSync(join(dir, 'lib/client.js'), [
    '// ' + name + '：浏览器侧（lazy factory，仅挂裸包名行）',
    "import type { Context as ClientContext } from '@deepseek-ai/cordis'",
    '',
    'export function apply(ctx: ClientContext) {',
    '  // ctx.slots.inject(...) 注册 UI 组件',
    '}',
    '',
  ].join('\n'))
}

console.log('已生成 DSH 插件骨架：' + dir)
console.log('  package.json（dsh.bundle 声明）')
console.log('  cordis.patch.yml（装配补丁）')
console.log('  index.js（Host 入口）')
if (withClient) console.log('  lib/client.js（Browser 入口）')
console.log('下一步：dsh plugin add ' + dir)
