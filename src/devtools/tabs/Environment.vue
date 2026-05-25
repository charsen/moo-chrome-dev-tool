<template>
  <div v-if="!loaded" class="loading">加载配置中…</div>
  <div v-else class="env-wrap">
    <div v-if="toast" :class="['moo-toast', `moo-toast--${toastKind}`]" :role="toastKind === 'error' ? 'alert' : 'status'" aria-live="polite">{{ toast }}</div>
    <div class="save-bar" :class="`is-${saveState}`">
      <span class="status-msg">
        <template v-if="saveState === 'saving'">保存中…</template>
        <template v-else-if="saveState === 'error'">
          ⚠ 保存没成功 — 可能 chrome.storage 配额满了，请点「重试」或清理一些项目
          <button class="moo-btn moo-btn--sm moo-btn--danger" @click="retrySave">重试</button>
        </template>
        <template v-else>✓ 已自动保存</template>
      </span>
    </div>
    <div class="env">
      <aside class="sidebar">
        <div class="sidebar-head">
          <span>项目</span>
          <div class="head-actions">
            <button class="moo-btn moo-btn--sm" title="新建项目" @click="addProject">+</button>
            <button class="moo-btn moo-btn--sm" title="导入配置" @click="importConfig">↓</button>
            <button class="moo-btn moo-btn--sm" title="导出配置" @click="exportConfig">↑</button>
          </div>
        </div>
        <!-- 项目数 > 6 才显示搜索框：少量项目时一眼能看完，搜索反而占空间 -->
        <div v-if="draft.projects.length > 6" class="project-search">
          <input
            v-model="projectFilter"
            type="search"
            placeholder="搜索项目"
            aria-label="搜索项目"
          />
        </div>
        <ul class="project-list">
          <li
            v-for="p in filteredProjects"
            :key="p.id"
            :class="['project-item', { active: p.id === activeId }]"
            @click="activeId = p.id"
          >
            <span class="dot" :class="{ off: !p.enabled }" />
            <span class="name">{{ p.name || '(未命名)' }}</span>
            <span
              v-if="p.kind === 'zentao'"
              class="count count--zentao"
              :class="{ 'count--zero': !p.zentao?.projectId }"
              :title="p.zentao?.projectId ? `禅道项目 #${p.zentao.projectId}` : '禅道未配项目 ID，提交会失败'"
            >{{ p.zentao?.projectId ? '禅道' : '⚠ 未配' }}</span>
            <span
              v-else
              class="count"
              :class="{ 'count--zero': p.servers.length === 0 }"
              :title="p.servers.length === 0 ? '没有上报服务器，悬浮球能匹配但提交会失败' : `${p.servers.length} 个上报服务器`"
            >{{ p.servers.length === 0 ? '⚠ 无服务器' : p.servers.length }}</span>
          </li>
          <li v-if="!draft.projects.length" class="empty">暂无项目，点击 + 新建</li>
          <li v-else-if="!filteredProjects.length" class="empty">未匹配到项目</li>
        </ul>
      </aside>

      <main class="detail" v-if="activeProject">
        <div class="row">
          <label>项目名</label>
          <input v-model="activeProject.name" />
          <label class="inline">
            <input type="checkbox" v-model="activeProject.enabled" />
            启用
          </label>
          <button class="moo-btn moo-btn--danger" @click="removeProject(activeProject.id)">删除项目</button>
        </div>

        <div class="row">
          <label>URL 匹配（每行一个，<code class="inline-code">*</code> 匹配任意字符）</label>
        </div>
        <textarea
          class="patterns"
          rows="3"
          :value="activeProject.matchPatterns.join('\n')"
          @input="onPatternsChange($event)"
          @blur="onPatternsBlur"
          placeholder="https://*.example.com/*&#10;http://localhost:8080/*"
        />
        <!-- v0.7.0：实时校验提示 — 哪些 pattern 会被 chrome MV3 translator drop -->
        <div v-if="invalidPatternsHint.length" class="patterns-warn" role="alert">
          ⚠ 这些 pattern 不符合 chrome MV3 动态注册要求（v0.7.0 起），保存后悬浮球不会在这些规则上注入：
          <ul>
            <li v-for="(p, i) in invalidPatternsHint" :key="i"><code>{{ p || '(空行)' }}</code></li>
          </ul>
        </div>
        <div class="tpl-hint">
          <!-- v0.7.0 BREAKING：matchPatterns 必须严格 https?://host/path 形态（chrome MV3 动态注册要求） -->
          示例：<code>https://*.example.com/*</code> 匹配子域名 ·
          <code>http://localhost:8080/*</code> 匹配本地端口 ·
          <code>https://example.com/api/*</code> 匹配指定路径。
          <strong>v0.7.0 起</strong>：单个 <code>*</code> / 无 scheme / file:// / chrome-extension:// 不再支持（chrome MV3 严格要求）
        </div>

        <div class="section-head">
          <h4>上报方式</h4>
        </div>
        <div class="row kind-row">
          <label class="inline kind-opt">
            <input type="radio" :name="`kind-${activeProject.id}`" value="webhook" v-model="activeProject.kind" />
            Webhook（POST 到自建服务器）
          </label>
          <label class="inline kind-opt">
            <input type="radio" :name="`kind-${activeProject.id}`" value="zentao" v-model="activeProject.kind" />
            禅道
          </label>
        </div>

        <!-- v0.5.3 P1 第 3 步：zentao / webhook 子表单拆到独立组件，本主壳只管
             项目侧栏 + 项目元数据（名称 / URL / 启用 / kind radio）+ 自动保存条 + toast。
             双向绑定 v-model 让子组件直接 mutate activeProject.zentao / .servers / .token —
             父组件的 watch(draft, deep) 仍会 fire 触发 autoSave。 -->
        <EnvironmentZentao
          v-if="activeProject.kind === 'zentao' && activeProject.zentao"
          v-model="activeProject"
          v-model:pwd-visible="zentaoPwdVisible"
        />
        <EnvironmentWebhook
          v-else
          v-model="activeProject"
          v-model:token-visible="tokenVisible"
        />
      </main>

      <main class="detail empty-state" v-else>
        <p>左侧选择或新建一个项目开始配置。</p>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useConfig } from '@/composables/useConfig'
import { useAutoSave } from '@/composables/useAutoSave'
import { useToast } from '@/composables/useToast'
import { useConfigImportExport } from '@/composables/useConfigImportExport'
import {
  createDefaultProject,
  DEFAULT_ZENTAO,
  type MooConfig,
  type Project
} from '@/types/config'
import { clone } from '@/utils/clone'
import { toChromeMatchPatterns } from '@/background/dynamicScripts'
import { confirmDialog } from '../components/confirm'
import EnvironmentZentao from './EnvironmentZentao.vue'
import EnvironmentWebhook from './EnvironmentWebhook.vue'

const { config, loaded, save } = useConfig()

const draft = ref<MooConfig>({ projects: [], globalEnabled: true })
const activeId = ref<string>('')
const initialized = ref(false)
/** Token 输入框默认遮罩，眼睛按钮切换显示。录屏/演示场景不暴露明文。 */
const tokenVisible = ref(false)
/** 禅道密码独立的可见性 toggle（与 webhook token 不共用） */
const zentaoPwdVisible = ref(false)
/** 项目列表搜索（项目 > 6 个时显示搜索框） */
const projectFilter = ref('')

const filteredProjects = computed(() => {
  const f = projectFilter.value.trim().toLowerCase()
  if (!f) return draft.value.projects
  return draft.value.projects.filter((p) => (p.name || '').toLowerCase().includes(f))
})


// === 自动保存：draft 任何深层变化触发 800ms 防抖，再提交到 config 并落盘 ===
// 沿用了原有 draft 层是为了在用户高频输入（如 URL 模板）期间避免每次 keystroke
// 都触发 onConfigChanged → 内容脚本重新匹配的"在键入中已被部分应用"问题。
const { toast, toastKind, showToast: showToastRaw } = useToast()
// 包一层保留原有 error=5000 / 其他=2600 的 duration 策略
function showToast(msg: string, kind: 'success' | 'error' | 'info' = 'info') {
  showToastRaw(msg, kind, kind === 'error' ? 5000 : 2600)
}

// 防抖 + saveState 状态机统一走 useAutoSave；本 tab 关心的只剩 draft → config 同步逻辑
const { saveState, scheduleSave, flush: flushSave } = useAutoSave({
  debounceMs: 800,
  save: async () => {
    config.value = clone(draft.value)
    await save()
    isDirty.value = false
  },
  onError: (e) => {
    showToast(`改动没保存成功：${e.message}。点击顶部的"重试"按钮再试一次`, 'error')
  }
})

// 改成 ref 而非 computed —— 原本 `JSON.stringify(draft) !== JSON.stringify(config)`
// 每次 draft 改一字符就跑 2 份整份配置的 stringify（50-200KB）+ 比较。payloadTemplate
// textarea 编辑时输入延迟肉眼可感。改成 ref + 三处显式 flip：
//   watch(draft) 触发 → true；doSave 成功 → false；外部 config 应用 → false。
const isDirty = ref(false)
// 外部 config 应用 draft 时（reload / 多 tab 同步）抑制下一次 watch fire，
// 避免「应用外部更新」自身被当成用户改动重新触发 scheduleSave + 死循环写回。
let applyingExternal = false

// 加载完成 & 外部变更时同步 draft；只有"已初始化且脏"的情况下保留草稿，
// 第一次进入时 draft 是空、config 已加载——必须放行第一次同步。
watch(
  () => [loaded.value, config.value] as const,
  ([isLoaded]) => {
    if (!isLoaded) return
    if (initialized.value && isDirty.value) return
    applyingExternal = true
    draft.value = clone(config.value)
    if (!activeId.value && draft.value.projects[0]) {
      activeId.value = draft.value.projects[0].id
    }
    initialized.value = true
    isDirty.value = false
    // microtask 后放回，确保 draft 触发的 watch 已被本帧消化掉
    void Promise.resolve().then(() => { applyingExternal = false })
  },
  { immediate: true }
)

const activeProject = computed<Project | undefined>(() =>
  draft.value.projects.find((p) => p.id === activeId.value)
)

// v0.7.0：matchPatterns 实时校验 — 拿 dynamicScripts translator 跑一遍，列出会被 drop 的
// pattern 给用户改正用。零延迟反馈（不等保存）。
const invalidPatternsHint = computed<string[]>(() => {
  if (!activeProject.value) return []
  const { dropped } = toChromeMatchPatterns(activeProject.value.matchPatterns ?? [])
  return dropped
})

/** kind 切到 zentao 时若 zentao 字段不存在则用 default 初始化。 */
watch(
  () => activeProject.value?.kind,
  (kind) => {
    if (kind === 'zentao' && activeProject.value && !activeProject.value.zentao) {
      activeProject.value.zentao = { ...DEFAULT_ZENTAO }
    }
  }
)

// v0.5.3 P1：禅道凭证操作（测试连接 / 拉项目 / 凭证变化清缓存）已抽到 useZentaoEnvironment +
// EnvironmentZentao.vue 子组件，本主壳不再持禅道相关 state。

// 任何 draft 变更 → useAutoSave 防抖 800ms → 落盘
watch(
  draft,
  () => {
    if (!initialized.value) return
    if (applyingExternal) return
    isDirty.value = true
    scheduleSave()
  },
  { deep: true }
)

function retrySave() {
  void flushSave()
}

function addProject() {
  const p = createDefaultProject(`项目 ${draft.value.projects.length + 1}`)
  draft.value.projects.push(p)
  activeId.value = p.id
  // 过滤态下新建项目，filteredProjects 不含新项目导致侧栏看不见 — 重置 filter 让用户看到
  projectFilter.value = ''
}

async function removeProject(id: string) {
  const proj = draft.value.projects.find((p) => p.id === id)
  const serverCount = proj?.servers.length ?? 0
  const ok = await confirmDialog({
    title: `删除项目「${proj?.name || '(未命名)'}」？`,
    message: `项目下的 ${serverCount} 个上报服务器配置会一起被删，0.8 秒后自动保存到本地。\n该域名下的网页不再显示悬浮球。`,
    danger: true,
    confirmText: '确认删除'
  })
  if (!ok) return
  draft.value.projects = draft.value.projects.filter((p) => p.id !== id)
  if (activeId.value === id) {
    activeId.value = draft.value.projects[0]?.id ?? ''
  }
}

// v0.4.0：同事反馈「想输入两个 URL，怎么换行不了」—— 原来 @input 立即 filter(Boolean)
// 把用户刚 enter 出来的空行吃掉，:value 反应式重算不含换行 → textarea 看着没换行。
// 修：编辑过程中保留空行（split('\n') 不 trim 不 filter），blur 时再 normalize。
function onPatternsChange(e: Event) {
  if (!activeProject.value) return
  const text = (e.target as HTMLTextAreaElement).value
  activeProject.value.matchPatterns = text.split('\n')
}

function onPatternsBlur() {
  if (!activeProject.value) return
  // blur 时 normalize：trim 每行 + 去掉空行（提交时不希望落空字符串到 matchPatterns）
  activeProject.value.matchPatterns = activeProject.value.matchPatterns
    .map((s) => s.trim())
    .filter(Boolean)
}

// v0.5.3 P1 第 2 步：server / header / payload 模板 CRUD 已抽到 useServerCrud +
// EnvironmentWebhook.vue 子组件，本主壳不再持 webhook 相关 state。

// v0.5.3 P1：配置导入/导出抽到 composables/useConfigImportExport.ts
const { exportConfig, importConfig } = useConfigImportExport({
  draft,
  activeId,
  showToast,
  confirmDialog
})
</script>

<style scoped>
.loading {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--moo-c-text-dim);
  font-size: var(--moo-fs-sm);
}

.env-wrap {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--moo-c-bg);
}

/* 顶部保存状态条（自动保存语义，无手动按钮） */
.save-bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 14px;
  border-bottom: 1px solid var(--moo-c-border);
  background: var(--moo-c-bg);
  font-size: var(--moo-fs-xs);
  min-height: 28px;
}
.save-bar .status-msg {
  flex: 1;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--moo-c-text-muted);
  transition: color var(--moo-motion-fast);
}
.save-bar.is-saving .status-msg { color: var(--moo-c-text); }
.save-bar.is-saved  .status-msg { color: var(--moo-c-success); font-weight: 500; }
.save-bar.is-error  .status-msg { color: var(--moo-c-danger-fg);  font-weight: 500; }
/* retry 按钮按 canonical .moo-btn--sm.moo-btn--danger 出，无需 override */

/* 项目搜索框（项目 > 6 时显示） */
.project-search {
  padding: 4px 10px 6px;
  border-bottom: 1px solid var(--moo-c-divider);
}
.project-search input {
  width: 100%;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--moo-c-border);
  border-radius: var(--moo-r-md);
  background: var(--moo-c-bg);
  font-size: var(--moo-fs-xs);
  font-family: inherit;
  color: var(--moo-c-text);
  box-sizing: border-box; /* sidebar 固定 220px；width:100% + padding/border 没 box-sizing 会撑到 ~238px 触发 sidebar 横向滚动 */
  transition: border-color var(--moo-motion-fast), box-shadow var(--moo-motion-fast);
}
.project-search input:focus {
  outline: none;
  border-color: var(--moo-c-brand);
  box-shadow: 0 0 0 3px var(--moo-c-focus-ring);
}

/* 主体（侧栏 + 详情） */
.env {
  flex: 1;
  min-height: 0;
  display: flex;
  background: var(--moo-c-bg);
}

/* 项目侧栏 */
.sidebar {
  width: 220px;
  background: var(--moo-c-bg);
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--moo-c-border);
}
.sidebar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--moo-c-divider);
  font-size: var(--moo-fs-xs);
  font-weight: 600;
  color: var(--moo-c-text-muted);
  text-transform: uppercase;
  letter-spacing: .04em;
}
.head-actions { display: flex; gap: 2px; }
.project-list {
  list-style: none;
  margin: 0;
  padding: 4px;
  overflow: auto;
  flex: 1;
}
.project-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  cursor: pointer;
  font-size: var(--moo-fs-sm);
  border-radius: var(--moo-r-md);
  margin-bottom: 1px;
  transition: background-color var(--moo-motion-fast), color var(--moo-motion-fast);
}
.project-item:hover { background: var(--moo-c-bg-soft); }
.project-item.active {
  background: var(--moo-c-brand-soft);
  color: var(--moo-c-brand);
  font-weight: 500;
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--moo-c-success);
  flex: none;
  box-shadow: 0 0 0 2px var(--moo-c-success-halo);
}
.dot.off {
  background: var(--moo-c-text-faint);
  box-shadow: none;
}
.name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.count { color: var(--moo-c-text-dim); font-size: var(--moo-fs-xs); font-family: var(--moo-ff-mono); }
.project-item.active .count { color: var(--moo-c-brand); }
/* 0 服务器的项目：用警示色提示用户这条配置不完整，hover 看 title */
.count--zero,
.project-item.active .count--zero { color: var(--moo-c-warn-fg); font-family: var(--moo-ff-sans); }

.empty {
  padding: 16px;
  color: var(--moo-c-text-dim);
  font-size: var(--moo-fs-xs);
  text-align: center;
}
.empty.padded { padding: 24px; font-size: var(--moo-fs-sm); }

/* 详情面板 */
.detail {
  flex: 1;
  min-width: 0;
  background: var(--moo-c-bg);
  padding: 18px 22px;
  overflow: auto;
}
.empty-state {
  color: var(--moo-c-text-dim);
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 表单行：窄宽下允许 wrap，避免 label + input + radio + delete 挤在一行把
   input 压缩成 40px；wrap 后 label 单独一行 + input 占整行更易用 */
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 10px 0;
  flex-wrap: wrap;
}
.row label {
  font-size: var(--moo-fs-xs);
  color: var(--moo-c-text-muted);
  min-width: 84px;
  font-weight: 500;
}
.row label.inline {
  min-width: unset;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}
.row input[type="text"],
.row input[type="password"],
.row input:not([type]),
.row select {
  height: 28px;
  font-size: var(--moo-fs-sm);
  padding: 0 10px;
  border: 1px solid var(--moo-c-border);
  border-radius: var(--moo-r-md);
  background: var(--moo-c-bg);
  color: var(--moo-c-text);
  flex: 1;
  min-width: 0;
  font-family: inherit;
  transition: border-color var(--moo-motion-fast), box-shadow var(--moo-motion-fast);
}
.row input[type="text"]:focus,
.row input[type="password"]:focus,
.row input:not([type]):focus,
.row select:focus {
  outline: none;
  border-color: var(--moo-c-brand);
  box-shadow: 0 0 0 3px var(--moo-c-focus-ring);
}

/* URL 匹配模式 textarea（zentao + webhook 子表单各自带自己的 textarea 样式） */
.patterns {
  width: 100%;
  font-family: var(--moo-ff-mono);
  font-size: var(--moo-fs-sm);
  border: 1px solid var(--moo-c-border);
  border-radius: var(--moo-r-md);
  padding: 8px 10px;
  resize: vertical;
  box-sizing: border-box;
  line-height: 1.55;
  color: var(--moo-c-text);
  background: var(--moo-c-bg);
  transition: border-color var(--moo-motion-fast), box-shadow var(--moo-motion-fast);
}
.patterns:focus {
  outline: none;
  border-color: var(--moo-c-brand);
  box-shadow: 0 0 0 3px var(--moo-c-focus-ring);
}

/* 段落标题 */
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 22px 0 10px;
  padding-top: 14px;
  border-top: 1px solid var(--moo-c-divider);
}
.section-head h4 {
  margin: 0;
  font-size: var(--moo-fs-base);
  font-weight: 600;
  color: var(--moo-c-text);
  letter-spacing: -.005em;
}

/* 按钮全部走 canonical .moo-btn / .moo-btn--sm / .moo-btn--danger（tokens.css），
   不再 scoped 局部覆盖 */

/* 模板提示 + inline code（URL 匹配示例段用） */
/* v0.7.0：实时校验提示（哪些 pattern 会被 chrome MV3 translator drop）*/
.patterns-warn {
  margin-top: 6px;
  padding: 8px 10px;
  border: 1px solid var(--moo-c-warn-soft);
  background: var(--moo-c-warn-soft);
  color: var(--moo-c-warn-fg);
  border-radius: var(--moo-r-md);
  font-size: var(--moo-fs-xs);
  line-height: 1.6;
}
.patterns-warn ul { margin: 4px 0 0; padding-left: 18px; }
.patterns-warn code {
  background: var(--moo-c-bg);
  padding: 0 4px;
  border-radius: 3px;
  font-family: monospace;
  color: var(--moo-c-text);
}

.tpl-hint {
  font-size: var(--moo-fs-xs);
  color: var(--moo-c-text-muted);
  margin-top: 6px;
  line-height: 1.6;
}
.tpl-hint code {
  background: var(--moo-c-bg-elev);
  color: var(--moo-c-text-muted);
  padding: 1px 5px;
  border-radius: var(--moo-r-sm);
  margin-right: 4px;
  font-family: var(--moo-ff-mono);
  font-size: 10px;
}
.inline-code {
  background: var(--moo-c-bg-elev);
  color: var(--moo-c-text-muted);
  padding: 1px 5px;
  border-radius: var(--moo-r-sm);
  font-family: var(--moo-ff-mono);
  font-size: 10px;
}

/* ───────────────── v0.2.0 禅道 / webhook radio + 项目侧栏 badge ───────────────── */
.kind-row {
  gap: 16px;
}
.kind-opt {
  font-size: var(--moo-fs-sm);
  cursor: pointer;
}
.count--zentao {
  font-family: var(--moo-ff-sans);
}
</style>
