#!/usr/bin/env node
import { buildSync } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');
const pkg = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf8'));

const outClientJs = resolve(rootDir, 'lib/client.js');
const outClientDts = resolve(rootDir, 'lib/client.d.ts');

mkdirSync(dirname(outClientJs), { recursive: true });

// 1. 同步 version 到 src/client/version.js
const versionContent = `/**
 * 客户端版本号定义
 * 在 build-client.js 自动化打包时会自动同步 package.json 中的 version
 */
export const PLUGIN_VERSION = 'v${pkg.version || '1.0.0'}';
`;
writeFileSync(resolve(rootDir, 'src/client/version.js'), versionContent, 'utf8');

// 2. 使用 esbuild 将 src/client/index.jsx 打包为 CJS 兼容模块
const result = buildSync({
  entryPoints: [resolve(rootDir, 'src/client/index.jsx')],
  bundle: true,
  write: false,
  format: 'cjs',
  target: ['es2020'],
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime'],
});

const compiledCode = result.outputFiles[0].text;

// 3. 包装进 DSH ModuleLoader
const bundleContent = `/**
 * dsh-remote-mobile 客户端运行时 Bundle
 * 由 scripts/build-client.js 基于 esbuild 自动化编译打包，请勿直接手动修改此文件！
 * 源码请移步 src/client/ 目录进行模块化开发与维护。
 */
window.__ModuleLoader__.load({
  id: "dsh-remote-mobile",
  factory: function(require) {
    var module = { exports: {} };
    var exports = module.exports;

${compiledCode}

    return module.exports;
  }
});
`;

writeFileSync(outClientJs, bundleContent, 'utf8');
console.log(`✅ [build-client] 成功使用 esbuild 编译 JSX 并构建 Bundle -> lib/client.js (v${pkg.version})`);

// 4. 输出 client.d.ts 类型声明
const dtsContent = `declare const _default: (ctx: any) => void;
export default _default;
export declare const inject: string[];
export declare function apply(ctx: any): void;
export declare function TailscaleMobileSection(props: any): any;
`;
writeFileSync(outClientDts, dtsContent, 'utf8');
