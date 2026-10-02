#!/usr/bin/env node
// DSH 插件组合包（bundle）规范校验器。
// 用法：node scripts/validate_plugin.mjs <plugin-dir> [...]
// 校验项：package.json 存在与必填字段、dsh.bundle 声明、cordis.patch.yml 存在与结构合规、
//         入口文件存在与 apply 导出契约、name 字段、exports 完整性、peerDependencies。

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const targets = process.argv.slice(2)
if (targets.length === 0) {
  targets.push('.')
}

let totalErrors = 0
let totalWarnings = 0

// 包名合法形状：裸名或 @scope/name（逐段校验）
function validPackageName(name) {
  if (typeof name !== 'string' || name.length === 0) return false
  const seg = (s) => /^[a-z0-9][a-z0-9-]*$/.test(s)
  if (name.startsWith('@')) {
    const parts = name.slice(1).split('/')
    return parts.length === 2 && seg(parts[0]) && seg(parts[1])
  }
  return !name.includes('/') && seg(name)
}

function validateOne(targetDir) {
  const dir = resolve(targetDir)
  const errors = []
  const warnings = []

  function check(cond, msg) {
    if (!cond) errors.push(msg)
  }

  // 1. package.json 校验
  const pkgPath = join(dir, 'package.json')
  check(existsSync(pkgPath), '缺少 package.json')

  let pkg = null
  if (existsSync(pkgPath)) {
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    } catch (e) {
      errors.push('package.json 不是合法的 JSON: ' + e.message)
    }
  }

  let entryFile = null

  if (pkg) {
    check(validPackageName(pkg.name), 'package.json.name 必须是合法 npm 包名（小写连字符，可带 scope）: ' + pkg.name)
    check(Boolean(pkg.version), '缺少 package.json.version')
    check(pkg.type === 'module', 'package.json.type 建议为 "module"')

    // 组合包必填元数据
    check(pkg.dsh && typeof pkg.dsh === 'object', '缺少 package.json.dsh 声明')
    if (pkg.dsh) {
      check(
        pkg.dsh.bundle && typeof pkg.dsh.bundle === 'object',
        '缺少 dsh.bundle 对象（组合包必须声明 dsh.bundle）'
      )
      if (pkg.dsh.bundle) {
        check(
          typeof pkg.dsh.bundle.id === 'string' && pkg.dsh.bundle.id.length > 0,
          '缺少 dsh.bundle.id'
        )
      }

      // 双面插件声明校验
      if (pkg.dsh.client) {
        check(
          pkg.exports && pkg.exports['./client'],
          '声明了 dsh.client 时，package.json.exports 必须包含 "./client" 导出'
        )
      }
    }

    // 入口与 exports 根导出校验
    const mainEntry = pkg.main ?? 'index.js'
    entryFile = join(dir, mainEntry)
    check(existsSync(entryFile), '入口文件不存在: ' + mainEntry)

    if (pkg.exports) {
      check(
        Boolean(pkg.exports['.']),
        'package.json.exports 应包含 "." 根导出'
      )
    } else {
      warnings.push('建议在 package.json 中配置显式 "exports"')
    }

    // 检查 peerDependencies
    if (!pkg.peerDependencies || !pkg.peerDependencies['@deepseek-ai/dsh']) {
      warnings.push('建议在 peerDependencies 中声明对 @deepseek-ai/dsh 的版本约束')
    }
  }

  // 2. cordis.patch.yml 校验与内容结构解析
  const patchYml = join(dir, 'cordis.patch.yml')
  const patchYaml = join(dir, 'cordis.patch.yaml')
  const hasPatch = existsSync(patchYml) || existsSync(patchYaml)
  check(hasPatch, '缺少 cordis.patch.yml（组合包必须携带补丁配置）')

  if (hasPatch) {
    const actualPatchPath = existsSync(patchYml) ? patchYml : patchYaml
    try {
      const content = readFileSync(actualPatchPath, 'utf8')
      check(content.includes('- insert:'), 'cordis.patch.yml 必须包含顶层 "- insert:" 插入声明')
      check(content.includes('id:') && content.includes('name:'), 'cordis.patch.yml 插入项必须包含 "id" 与 "name"')
    } catch (e) {
      errors.push('读取 cordis.patch.yml 失败: ' + e.message)
    }
  }

  // 3. 入口文件静态契约校验
  if (entryFile && existsSync(entryFile)) {
    try {
      const src = readFileSync(entryFile, 'utf8')
      const hasApply = src.includes('export function apply') || src.includes('exports.apply') || src.includes('apply(')
      check(hasApply, '插件入口文件必须导出 apply(ctx) 声明')
    } catch (e) {
      errors.push('读取入口文件失败: ' + e.message)
    }
  }

  if (errors.length > 0) {
    console.error('校验失败：' + dir)
    for (const e of errors) console.error('  [ERROR] ' + e)
    totalErrors += errors.length
  } else {
    console.log('校验通过：' + dir)
  }

  if (warnings.length > 0) {
    for (const w of warnings) console.warn('  [WARN]  ' + w)
    totalWarnings += warnings.length
  }
}

for (const target of targets) {
  validateOne(target)
}

if (totalErrors > 0) {
  process.exit(1)
}
