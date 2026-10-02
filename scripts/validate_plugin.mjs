#!/usr/bin/env node
// DSH 插件组合包（bundle）规范校验器。
// 用法：node scripts/validate_plugin.mjs <plugin-dir> [...]
// 校验项：package.json 存在与必填字段、dsh.bundle 声明、cordis.patch.yml 存在与结构合规、
//         入口文件存在与 apply 导出契约、name 字段、exports 完整性、peerDependencies。

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

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

// 检查 JS 文件的语法合法性（利用 node --check 原生能力，零依赖且不执行代码）
function checkJsSyntax(filePath) {
  const res = spawnSync(process.execPath, ['--check', filePath], { encoding: 'utf8' })
  if (res.status !== 0) {
    return res.stderr?.trim() || res.stdout?.trim() || '语法检查失败'
  }
  return null
}

// 静态检查是否包含真实的 apply 导出声明（排除注释或裸调用干扰）
function hasApplyExport(src) {
  const lines = src.split(/\r?\n/)
  const exportRegex = /^\s*(?:export\s+(?:async\s+)?function\s+apply|exports\.apply\s*=|module\.exports(?:.apply)?\s*=)/
  return lines.some((line) => exportRegex.test(line))
}

// exports 允许两种写法：字符串，或条件导出对象（{ types, default } / { import }）
function exportPath(value) {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') return value.default ?? value.import ?? null
  return null
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
        // 声明了 patch 路径就必须真实存在，否则 Loader 找不到组合包补丁
        if (typeof pkg.dsh.bundle.patch === 'string') {
          check(
            existsSync(join(dir, pkg.dsh.bundle.patch)),
            'dsh.bundle.patch 指定的补丁文件不存在: ' + pkg.dsh.bundle.patch
          )
        }
      }

      // 双面插件声明校验
      if (pkg.dsh.client) {
        check(
          typeof pkg.dsh.client === 'object',
          'package.json.dsh.client 必须是一个对象'
        )
        if (typeof pkg.dsh.client === 'object') {
          check(
            pkg.dsh.client.platform === 'web',
            'package.json.dsh.client.platform 必须为 "web"'
          )
          check(
            typeof pkg.dsh.client.module === 'string' && pkg.dsh.client.module.length > 0,
            'package.json.dsh.client.module 必须指定客户端入口相对路径'
          )
          if (pkg.dsh.client.module) {
            const clientModulePath = join(dir, pkg.dsh.client.module)
            check(
              existsSync(clientModulePath),
              'dsh.client.module 指定的客户端入口文件不存在: ' + pkg.dsh.client.module
            )
          }
        }
        check(
          pkg.exports && pkg.exports['./client'],
          '声明了 dsh.client 时，package.json.exports 必须包含 "./client" 导出'
        )
        if (pkg.exports && pkg.exports['./client']) {
          const clientExportRel = exportPath(pkg.exports['./client'])
          check(clientExportRel !== null, 'exports["./client"] 必须是字符串或条件导出对象')
          const clientExportPath = clientExportRel ? join(dir, clientExportRel) : null
          check(
            clientExportPath !== null && existsSync(clientExportPath),
            'package.json.exports["./client"] 指定的文件不存在: ' + JSON.stringify(pkg.exports['./client'])
          )
          if (clientExportPath !== null && existsSync(clientExportPath)) {
            const syntaxErr = checkJsSyntax(clientExportPath)
            check(!syntaxErr, '客户端入口文件 JS 语法错误: ' + syntaxErr)
            try {
              const clientSrc = readFileSync(clientExportPath, 'utf8')
              check(hasApplyExport(clientSrc), '客户端入口文件必须导出 apply(ctx) 声明')
              // 双面插件的 Client 半侧只经插槽挂载组件
              check(
                /slots\.(inject|register)/.test(clientSrc),
                '客户端入口必须经 ctx.slots.inject/register 挂载组件'
              )
            } catch (e) {
              errors.push('读取客户端入口文件失败: ' + e.message)
            }
          }
        }
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
      if (pkg.exports['.']) {
        const rootExportRel = exportPath(pkg.exports['.'])
        check(rootExportRel !== null, 'exports["."] 必须是字符串或条件导出对象')
        const rootExportPath = rootExportRel ? join(dir, rootExportRel) : null
        check(
          rootExportPath !== null && existsSync(rootExportPath),
          'package.json.exports["."] 指定的文件不存在: ' + JSON.stringify(pkg.exports['.'])
        )
      }
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
      // 剥离注释行以防被伪造注释绕过
      const nonCommentText = content
        .split(/\r?\n/)
        .map((line) => {
          const idx = line.indexOf('#')
          return idx >= 0 ? line.slice(0, idx) : line
        })
        .join('\n')

      check(
        /-\s*insert\s*:/m.test(nonCommentText),
        'cordis.patch.yml 必须包含有效的 "- insert:" 顶层插入声明'
      )
      check(
        /\bid\s*:\s*[^\s#]+/m.test(nonCommentText) && /\bname\s*:\s*[^\s#]+/m.test(nonCommentText),
        'cordis.patch.yml 插入项必须包含有效的 "id:" 与 "name:" 字段'
      )

      if (pkg?.dsh?.bundle?.id) {
        const idMatch = nonCommentText.match(/\bid\s*:\s*([^\s#]+)/)
        if (idMatch) {
          check(
            idMatch[1] === pkg.dsh.bundle.id,
            `cordis.patch.yml 中的 id ("${idMatch[1]}") 必须与 dsh.bundle.id ("${pkg.dsh.bundle.id}") 一致`
          )
        }
      }
      if (pkg?.name) {
        const nameMatch = nonCommentText.match(/\bname\s*:\s*([^\s#]+)/)
        if (nameMatch) {
          check(
            nameMatch[1] === pkg.name,
            `cordis.patch.yml 中的 name ("${nameMatch[1]}") 必须与 package.json 中的 name ("${pkg.name}") 一致`
          )
        }
      }
    } catch (e) {
      errors.push('读取 cordis.patch.yml 失败: ' + e.message)
    }
  }

  // 3. 入口文件静态契约校验
  if (entryFile && existsSync(entryFile)) {
    const syntaxErr = checkJsSyntax(entryFile)
    check(!syntaxErr, '插件入口文件 JS 语法错误: ' + syntaxErr)
    try {
      const src = readFileSync(entryFile, 'utf8')
      check(hasApplyExport(src), '插件入口文件必须导出 apply(ctx) 声明')
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
