/**
 * ESLint flat config（本仓首次引入，未发版批次）。
 *
 * 为什么现在才加：仓里此前**完全没有 linter**，但代码里躺着 2 条
 * `eslint-disable-next-line prefer-rest-params`（main-world.ts 的 XHR patch）——
 * 指令对着一个不存在的工具说话。CI 因此抓不到 unused / 不可达代码 / 死绑定这类
 * 类型检查覆盖不到的问题。
 *
 * 定位：**只做「代码正确性」信号，不做格式化**。仓里没有 Prettier，也不打算引入，
 * 所以不启用 eslint-plugin-vue 的 recommended（它含 max-attributes-per-line /
 * html-indent / attributes-order 等纯排版规则，对既有 23 个 .vue 会产出上百条噪音）。
 * 排版问题交给 review，lint 只拦「写错了」。
 *
 * 有意留给后续（不在本次范围）：
 *   - 类型感知规则（no-floating-promises / no-misused-promises / await-thenable）
 *     需要 projectService，`pnpm lint` 会慢一个量级。仓里已经普遍用 `void asyncFn()`
 *     显式表态，先不上；真要上单独一波，别和本次混。
 */
import globals from 'globals'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'

export default tseslint.config(
  {
    // 产物 / 依赖 / 报告目录 —— 与 .gitignore 对齐（dist-e2e* 是 e2e 构建产物）
    ignores: [
      'dist/**',
      'dist-e2e/**',
      'dist-e2e-multishot/**',
      'release/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      'node_modules/**'
    ]
  },

  // ─────────────────────── TS（src / tests / tests-e2e / scripts） ───────────────────────
  {
    files: ['**/*.ts', '**/*.mts'],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        // 扩展三端（content / background / offscreen）共用的 chrome.* 全局
        ...globals.webextensions
      }
    },
    rules: {
      // TS 自己做未定义标识符检查，eslint 这份在 .vue / 扩展世界全局下只会误报
      'no-undef': 'off',

      // 空 catch 是这个仓的刻意用法（"失败静默，不让非关键路径炸"），但空 if/for 是真 bug
      'no-empty': ['error', { allowEmptyCatch: true }],

      // unused 是本配置的主要目的之一。`_` 前缀 = 显式"我知道它没用"（mock 形参等）
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none', // catch (e) 只 log 一半的写法很常见，别逼人改名
          ignoreRestSiblings: true
        }
      ],

      // main-world.ts 里 patch fetch/XHR 必须用 any（origFetch.call(this, input as any, init)），
      // 这类边界是正当的。降成 warn：允许存在，但改动时 review 会看到。
      '@typescript-eslint/no-explicit-any': 'warn',

      // 同名 interface 声明合并 / 空 interface 在 types 里有正当用法（扩展 chrome 类型）
      '@typescript-eslint/no-empty-object-type': 'warn',

      eqeqeq: ['error', 'smart']
    }
  },

  // ───────────────────────────── Vue SFC ─────────────────────────────
  {
    files: ['**/*.vue'],
    // ⚠ 顺序要紧：tseslint.configs.recommended 里带一条 `languageOptions.parser = ts parser`
    // 的配置，若它排在 Vue 预设**之后**会把 parser 顶成裸 TS parser → .vue 全部 parse error
    // （23 个 SFC 全挂）。必须 TS 在前、Vue 在后，让 vue-eslint-parser 成为最终 parser，
    // 再由下面 parserOptions.parser 把 <script lang="ts"> 转交 TS parser。
    // flat/essential = 只留"写错会出 bug"的规则，不含排版（见文件头说明）
    extends: [...tseslint.configs.recommended, ...pluginVue.configs['flat/essential']],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.webextensions
      },
      parserOptions: {
        // <script lang="ts"> 要交给 TS parser，否则 lang="ts" 的 SFC 全部 parse 失败
        parser: tseslint.parser,
        extraFileExtensions: ['.vue']
      }
    },
    rules: {
      'no-undef': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
          ignoreRestSiblings: true
        }
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      eqeqeq: ['error', 'smart'],
      // 单文件组件名不强制多词（App.vue 是合法且惯用名）
      'vue/multi-word-component-names': 'off'
    }
  },

  // ─────────────────────── 构建/脚本侧 mjs（node 环境） ───────────────────────
  {
    files: ['scripts/**/*.mjs', '*.config.js'],
    languageOptions: {
      globals: { ...globals.node }
    }
  },

  // ─────────────────────── 类型声明文件（.d.ts） ───────────────────────
  {
    files: ['**/*.d.ts'],
    rules: {
      // Vue SFC 的模块声明天然是 `DefineComponent<{}, {}, any>`（vue-tsc/volar 的标准 shim）。
      // 这两个规则在 .d.ts 里没有可操作的意义，只会常驻噪音。
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off'
    }
  },

  // ─────────────────────── 测试文件 ───────────────────────
  {
    files: ['tests/**/*.ts', 'tests-e2e/**/*.ts'],
    rules: {
      // 测试里大量 `(globalThis as any).chrome = {...}` 这类 mock 接线，类型化收益远低于 churn，
      // 且测试代码不进产物、不构成线上风险。**但** unused / no-unreachable / eqeqeq 这些真信号
      // 在测试里照常生效（本仓启用 ESLint 时，靠 no-unused-vars 抓到过一个只增不查的断言计数器）。
      '@typescript-eslint/no-explicit-any': 'off'
    }
  },

  // ─────────────────────── 刻意 mutate 父级 draft 的表单组件 ───────────────────────
  {
    files: ['src/devtools/tabs/EnvironmentWebhook.vue'],
    rules: {
      // 该组件的父子契约**就是**「子组件直接 mutate modelValue.token / .defaultServerId /
      // .servers，父组件 watch(draft) 触发 autoSave」—— 组件内 defineProps 上方注释写明了。
      // EnvironmentZentao.vue 同款契约（那边的写法没被这条规则命中而已）。
      // 改成 emit 链要把每个嵌套输入都改一遍，属会动 UI 契约的重构，不在「引入 lint」这一步做。
      // 规则本身仍全局开启 —— 其它组件新增 props 变异照样会被拦。
      'vue/no-mutating-props': 'off'
    }
  }
)
