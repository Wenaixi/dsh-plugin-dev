#!/usr/bin/env node
// DSH 插件组合包（bundle）规范校验器。
// 用法：node scripts/validate_plugin.mjs <plugin-dir>
// 校验项：package.json 存在与必填字段、dsh.bundle 声明、cordis.patch.yml 存在、
//         入口文件存在、name 字段、exports 完整性、peerDependencies。

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const dir = resolve(process.argv[2] ?? '.')
const errors = []
const warnings = []

function check(cond, msg) {
  if (!cond) errors.push(msg)
}

// 包名合法形状：裸名或 @scope/name（逐段校验，避免在正则里写字面斜杠）
function validPackageName(name) {
  if (typeof name !== 'string' || name.length === 0) return false
  const seg = (s) => /^[a-z0-9][a-z0-9-]*$/.test(s)
  if (name.startsWith('@')) {
    const parts = name.slice(1).split('/')
    return parts.length === 2 && seg(parts[0]) && seg(parts[1])
  }
  return !name.includes('/') && seg(name)
}

// 1. package.json
const pkgPath = join(dir, 'package.json')
if (!existsSync(pkgPath)) {
  errors.push('缺少 package.json')
} else {
  let pkg
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  } catch (e) {
    errors.push('package.json 不是合法 JSON：' + e.message)
    pkg = {}
  }
  check(validPackageName(pkg.name), 'name 字段缺失或不是合法包名（当前：' + (pkg.name ?? '(无)') + '）')
  check(typeof pkg.version === 'string', 'version 字段缺失')
  check(typeof pkg.main === 'string', 'main 字段缺失（应为 lib/index.js 或 index.js）')

  // 2. dsh.bundle 声明
  const dsh = pkg.dsh
  if (dsh) {
    if (dsh.bundle) {
      const patch = dsh.bundle.patch
      if (typeof patch === 'string') {
        check(existsSync(join(dir, patch)), 'dsh.bundle.patch 指向的文件不存在：' + patch)
        check(patch.endsWith('.yml') || patch.endsWith('.yaml'), 'patch 应为 .yml/.yaml 文件：' + patch)
      } else if (Array.isArray(patch)) {
        for (const p of patch) check(existsSync(join(dir, p)), 'dsh.bundle.patch 数组元素不存在：' + p)
      } else {
        errors.push('dsh.bundle.patch 必须是字符串路径或有序字符串数组')
      }
    } else {
      warnings.push('声明了 dsh 但缺少 dsh.bundle（若为纯依赖包可忽略）')
    }
    if (dsh.client) {
      if (dsh.client.platform !== 'web') errors.push('dsh.client.platform 必须为 "web"')
      const exports = pkg.exports ?? {}
      const client = exports['./client'] ?? exports['./client.js']
      if (!client) warnings.push('dsh.client 已声明但 exports 无 "./client" 子路径（浏览器半侧将不可达）')
      check(typeof pkg['peerDependencies']?.react === 'string', '声明 dsh.client 应同时 peerDependencies 声明 react')
    }
  } else {
    warnings.push('未声明 dsh.bundle——插件不会向装配体贡献配置层')
  }

  // 3. 入口文件
  const main = pkg.main ?? 'index.js'
  check(existsSync(join(dir, main)), 'main 入口不存在：' + main)
  const clientMain = pkg.exports?.['./client']?.default ?? pkg.exports?.['./client']
  if (typeof clientMain === 'string') {
    check(existsSync(join(dir, clientMain)), 'client 入口不存在：' + clientMain)
  }

  // 4. files 字段
  if (pkg.files) {
    for (const f of pkg.files) {
      if (!f.includes('*') && !existsSync(join(dir, f))) {
        warnings.push('files 中声明但本地不存在（发布时可能缺失）：' + f)
      }
    }
  }
}

// 输出
if (errors.length || warnings.length) {
  console.log('校验结果：' + dir)
  if (errors.length) {
    console.log('  [FAIL]')
    for (const e of errors) console.log('    - ' + e)
  } else {
    console.log('  [OK]  必填项全部通过')
  }
  if (warnings.length) {
    console.log('  警告：')
    for (const w of warnings) console.log('    - ' + w)
  }
  if (errors.length) process.exitCode = 1
} else {
  console.log('校验通过：' + dir)
}
