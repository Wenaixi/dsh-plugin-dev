#!/usr/bin/env node
// DSH 插件工程脚手架（零外部依赖，纯原生 Node.js 实现）。
// 用法：node scripts/scaffold_plugin.mjs <target-dir> [--dual-face]

import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'

const args = process.argv.slice(2)
const targetDir = args.find((a) => !a.startsWith('--'))
const isDualFace = args.includes('--dual-face')

if (!targetDir) {
  console.error('用法: node scripts/scaffold_plugin.mjs <target-dir> [--dual-face]')
  process.exit(1)
}

const dir = resolve(targetDir)
if (existsSync(dir)) {
  console.error('目标目录已存在：' + dir)
  process.exit(1)
}

// 规范化包名：全部小写连字符
const rawName = basename(dir)
const sanitized = rawName.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '')
const pkgName = sanitized.startsWith('dsh-') ? sanitized : 'dsh-' + sanitized
const bundleId = pkgName.replace(/^dsh-/, '')

mkdirSync(dir, { recursive: true })

// 1. package.json
const pkgJson = {
  name: pkgName,
  version: '0.1.0',
  type: 'module',
  main: 'index.js',
  exports: {
    '.': './index.js'
  },
  dsh: {
    bundle: {
      id: bundleId,
      description: 'DSH 插件：' + pkgName
    }
  },
  peerDependencies: {
    '@deepseek-ai/dsh': '>=0.2.0-rc.1',
    '@deepseek-ai/cordis': '~4.0.4'
  }
}

if (isDualFace) {
  pkgJson.dsh.client = {
    platform: 'web',
    module: './lib/client.js'
  }
  pkgJson.exports['./client'] = './lib/client.js'
  mkdirSync(join(dir, 'lib'), { recursive: true })
}

writeFileSync(join(dir, 'package.json'), JSON.stringify(pkgJson, null, 2) + '\n')

// 2. index.js（纯 JS ESM，使用 JSDoc 类型注解）
const indexJs = `// ${pkgName} 插件入口
// 遵循 DSH 0.2.0-rc.2 / Cordis 4.0.4 插件规范

export const name = '${pkgName}'

/**
 * 插件装载入口
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {Record<string, unknown>} [config]
 */
export function apply(ctx, config = {}) {
  ctx.logger('${bundleId}').info('${pkgName} 已装载')

  ctx.on('ready', () => {
    ctx.logger('${bundleId}').info('${pkgName} 运行时已就绪')
  })
}
`
writeFileSync(join(dir, 'index.js'), indexJs)

// 3. client.js（仅在 --dual-face 时生成）
if (isDualFace) {
  const clientJs = `// ${pkgName} 浏览器端组件入口（Dual-Face Client UI）
export const name = '${pkgName}/client'

/**
 * 客户端装载入口
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  // 统一通过 ctx.slots.inject / ctx.slots.register 注入插槽
  // 严禁组件直接持有 ctx 实例
}
`
  writeFileSync(join(dir, 'lib/client.js'), clientJs)
}

// 4. cordis.patch.yml
const patchYml = `# ${pkgName} 组合包补丁配置
- insert:
    - id: ${bundleId}
      name: ${pkgName}
      config: {}
      disabled: false
`
writeFileSync(join(dir, 'cordis.patch.yml'), patchYml)

// 5. README.md
const readmeMd = `# ${pkgName}

DSH 插件组合包。

## 安装与装载

在所在 profile 的 `package.json` 中声明依赖并在 `cordis.patch.yml` 中组合生效。
`
writeFileSync(join(dir, 'README.md'), readmeMd)

console.log('脚手架生成完成：' + dir)
