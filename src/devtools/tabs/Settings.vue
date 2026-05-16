<template>
  <div v-if="!loaded" class="loading">加载配置中…</div>
  <div v-else class="settings">
    <div v-if="toast" :class="['moo-toast', `moo-toast--${toastKind}`]">{{ toast }}</div>
    <header class="page-head">
      <h2>设置</h2>
      <span class="save-indicator" :class="`is-${saveState}`">
        <template v-if="saveState === 'saving'">保存中…</template>
        <template v-else-if="saveState === 'saved'">✓ 已保存</template>
        <template v-else-if="saveState === 'error'">⚠ 保存失败</template>
        <template v-else>改动自动保存</template>
      </span>
    </header>

    <main class="page-body">
      <!-- 全局开关 -->
      <section class="moo-card">
        <div class="moo-card__hd">
          <h3>全局</h3>
        </div>
        <div class="moo-card__bd">
          <Row label="启用扩展" desc="关闭后所有项目悬浮球都不会显示">
            <Switch v-model="config.globalEnabled" @update:modelValue="save" />
          </Row>
        </div>
      </section>

      <!-- 项目设置 -->
      <section class="moo-card">
        <div class="moo-card__hd">
          <h3>项目设置</h3>
          <select
            v-if="config.projects.length"
            v-model="activeId"
            class="moo-field proj-picker"
          >
            <option v-for="p in config.projects" :key="p.id" :value="p.id">{{ p.name || '(未命名)' }}</option>
          </select>
        </div>

        <div v-if="active" class="moo-card__bd">
          <h4 class="sub">抓取</h4>
          <Row label="网络请求" desc="抓取页面发起的 fetch / XHR，最多保留 N 条">
            <Switch v-model="active.capture.requests" @update:modelValue="save" />
          </Row>
          <Row label="Console 错误" desc="抓取 window.onerror / unhandledrejection / console.error">
            <Switch v-model="active.capture.consoleErrors" @update:modelValue="save" />
          </Row>
          <Row label="请求缓冲条数" desc="环形缓冲上限（5–500），超过会按 FIFO 滚动">
            <div class="num-input-wrap">
              <input
                type="number"
                min="5"
                max="500"
                class="moo-field narrow"
                :class="{ 'is-invalid': bufferSizeError }"
                :value="bufferSizeDraft"
                :aria-invalid="!!bufferSizeError"
                :aria-describedby="bufferSizeError ? 'buffer-size-err' : undefined"
                @input="bufferSizeDraft = ($event.target as HTMLInputElement).value"
                @change="onBufferSizeCommit"
                @blur="onBufferSizeCommit"
              />
              <span v-if="bufferSizeError" id="buffer-size-err" class="field-err">
                {{ bufferSizeError }}
              </span>
            </div>
          </Row>

          <h4 class="sub">脱敏</h4>
          <Row label="密码框遮罩" desc="截图前给 type=password 输入框盖一层灰条">
            <Switch v-model="active.redact.maskPasswordInputs" @update:modelValue="save" />
          </Row>
          <Row label="Header 黑名单" desc="抓取请求时这些 header 的值会被替换为 ***" class="kv-row">
            <TagInput
              :model-value="active.redact.headerKeys"
              placeholder="如 authorization、cookie"
              @update:modelValue="(v: string[]) => { active!.redact.headerKeys = v; save() }"
            />
          </Row>
          <Row label="Body 字段黑名单" desc="抓取请求体 JSON 时这些字段会被替换" class="kv-row">
            <TagInput
              :model-value="active.redact.bodyKeys"
              placeholder="如 password、token"
              @update:modelValue="(v: string[]) => { active!.redact.bodyKeys = v; save() }"
            />
          </Row>

          <h4 class="sub">localStorage 白名单</h4>
          <Row label="抓取这些 key" desc="提交时一并附上对应值（按页面 localStorage 优先）" class="kv-row">
            <TagInput
              :model-value="active.capture.storageKeys"
              placeholder="如 user_token、locale"
              @update:modelValue="(v: string[]) => { active!.capture.storageKeys = v; save() }"
            />
          </Row>
        </div>

        <div v-else class="moo-empty">
          <div class="moo-empty__title">还没有项目</div>
          <div>请先在「环境」Tab 新建一个项目。</div>
        </div>
      </section>

      <!-- 存储管理 -->
      <section class="moo-card">
        <div class="moo-card__hd">
          <h3>存储</h3>
        </div>
        <div class="moo-card__bd">
          <Row label="历史记录" :desc="`最多保留 ${HISTORY_MAX} 条；超出自动按 FIFO 丢弃`">
            <div class="row-stats">
              <span class="stat">{{ historyCount }} 条</span>
              <button class="moo-btn moo-btn--sm" :disabled="busy === 'history'" @click="clearHistoryAll">
                {{ busy === 'history' ? '清空中…' : '清空' }}
              </button>
            </div>
          </Row>
          <Row label="重试队列" desc="上报失败的 todo 暂存在这里；扩展每 5 分钟自动重试一次">
            <div class="row-stats">
              <span class="stat">{{ queueCount }} 条</span>
              <button class="moo-btn moo-btn--sm" :disabled="busy === 'flush'" @click="flushQueue">
                {{ busy === 'flush' ? '重试中…' : '立即重试' }}
              </button>
              <button class="moo-btn moo-btn--sm" :disabled="busy === 'clearQueue' || queueCount === 0" @click="clearQueue">
                清空
              </button>
            </div>
          </Row>
        </div>
      </section>

      <!-- 关于 -->
      <section class="moo-card">
        <div class="moo-card__hd">
          <h3>关于</h3>
        </div>
        <div class="moo-card__bd">
          <Row label="版本">
            <span class="moo-chip">{{ version }}</span>
          </Row>
          <Row label="快捷键">
            <span class="kbd">⌘/Ctrl</span>
            <span class="kbd">⇧</span>
            <span class="kbd">B</span>
            <span class="hint" style="margin-left: 6px;">触发截图</span>
          </Row>
          <Row label="文档">
            <a class="link" href="https://gitee.com/charsen/moo-chrome-dev-tool" target="_blank">Gitee · moo-chrome-dev-tool ↗</a>
          </Row>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, h, ref, onBeforeUnmount, onMounted, watch } from 'vue'
import type { MooConfig, Project } from '@/types/config'
import { loadConfig, saveConfig } from '@/storage/config'
import { listHistory, clearHistory } from '@/storage/history'
import { MSG } from '@/types/messages'
import { safeSendMessage } from '@/utils/messaging'
import { confirmDialog } from '../components/confirm'

const HISTORY_MAX = 30

const config = ref<MooConfig>({ projects: [], globalEnabled: true })
const loaded = ref(false)
const activeId = ref('')
const historyCount = ref(0)
const queueCount = ref(0)
const busy = ref<'' | 'history' | 'flush' | 'clearQueue'>('')
const version = chrome.runtime.getManifest().version

const active = computed<Project | undefined>(() =>
  config.value.projects.find((p) => p.id === activeId.value)
)

async function refreshStats() {
  const hist = await listHistory()
  historyCount.value = hist.length
  const r = await chrome.storage.local.get('mooRetryQueue')
  queueCount.value = Array.isArray(r.mooRetryQueue) ? r.mooRetryQueue.length : 0
}

onMounted(async () => {
  config.value = await loadConfig()
  if (config.value.projects.length) activeId.value = config.value.projects[0].id
  await refreshStats()
  loaded.value = true
})

// 仅在 mounted 后才允许自动保存（避免 onMounted 写一份 default config 进去）
const ready = ref(false)
watch(loaded, (v) => { if (v) ready.value = true })

type SaveState = 'idle' | 'saving' | 'saved' | 'error'
const saveState = ref<SaveState>('idle')
let inflight = 0
let savedTimer: number | undefined

const toast = ref('')
const toastKind = ref<'success' | 'error' | 'info'>('info')
let toastTimer: number | undefined
function showToast(msg: string, kind: 'success' | 'error' | 'info' = 'info') {
  toast.value = msg
  toastKind.value = kind
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = ''), kind === 'error' ? 5000 : 2600)
}

async function save() {
  if (!ready.value) return
  inflight++
  saveState.value = 'saving'
  try {
    await saveConfig(config.value)
    inflight--
    // 仅在没有后续保存还在路上时才切到 saved，避免来回闪 saving↔saved
    if (inflight === 0) {
      saveState.value = 'saved'
      if (savedTimer) clearTimeout(savedTimer)
      savedTimer = window.setTimeout(() => {
        if (saveState.value === 'saved') saveState.value = 'idle'
      }, 1500)
    }
  } catch (e) {
    inflight--
    saveState.value = 'error'
    console.error('[Moo settings] 保存失败', e)
  }
}

// 缓冲条数行内校验：input 时显示错误，blur/change 时 clamp 并保存。
// 这样用户在键入过程中能看到「5–500」范围提示，不用等失焦才发现输错了。
const bufferSizeDraft = ref<string>('')
// 双 ?. 兼容老存储里可能缺 capture 字段的 Project（防御性）
watch(
  () => active.value?.capture?.requestBufferSize,
  (n) => { bufferSizeDraft.value = n != null ? String(n) : '' },
  { immediate: true }
)

const bufferSizeError = computed<string>(() => {
  const v = String(bufferSizeDraft.value ?? '').trim()
  if (!v) return '不能为空'
  const n = Number(v)
  if (!Number.isFinite(n)) return '需为数字'
  if (n < 5) return '不能小于 5'
  if (n > 500) return '不能大于 500'
  return ''
})

function onBufferSizeCommit() {
  if (!active.value || !active.value.capture) return
  const v = String(bufferSizeDraft.value ?? '').trim()
  const n = Number(v)
  // 无效输入：snap 回当前已保存值，让 UI 与 state 同步（避免红边一直挂着）
  if (!Number.isFinite(n) || n < 5 || n > 500) {
    bufferSizeDraft.value = String(active.value.capture.requestBufferSize ?? 50)
    return
  }
  const clamped = Math.max(5, Math.min(500, Math.round(n)))
  bufferSizeDraft.value = String(clamped)
  if (active.value.capture.requestBufferSize !== clamped) {
    active.value.capture.requestBufferSize = clamped
    save()
  }
}

async function clearHistoryAll() {
  const n = historyCount.value
  const ok = await confirmDialog({
    title: '清空所有历史记录',
    message: `将删除 ${n} 条记录，操作不可恢复。`,
    danger: true,
    confirmText: '清空'
  })
  if (!ok) return
  busy.value = 'history'
  try {
    await clearHistory()
    await refreshStats()
    showToast(`已清空 ${n} 条历史`, 'success')
  } catch (e) {
    showToast(`清空失败: ${(e as Error).message}`, 'error')
  } finally {
    busy.value = ''
  }
}

async function flushQueue() {
  busy.value = 'flush'
  try {
    const res = await safeSendMessage({ type: MSG.RETRY_QUEUE_FLUSH, source: 'devtools' })
    await refreshStats()
    const processed = (res as { processed?: number } | undefined)?.processed ?? 0
    showToast(processed > 0 ? `重试完成，${processed} 条已上报` : '队列已空 / 全部失败，无变化', processed > 0 ? 'success' : 'info')
  } catch (e) {
    showToast(`重试失败: ${(e as Error).message}`, 'error')
  } finally {
    busy.value = ''
  }
}

async function clearQueue() {
  const n = queueCount.value
  const ok = await confirmDialog({
    title: '清空未上报队列',
    message: `将丢弃 ${n} 条待重试的 bug，操作不可恢复。`,
    danger: true,
    confirmText: '清空'
  })
  if (!ok) return
  busy.value = 'clearQueue'
  try {
    await chrome.storage.local.set({ mooRetryQueue: [] })
    await refreshStats()
    showToast(`已清空 ${n} 条`, 'success')
  } catch (e) {
    showToast(`清空失败: ${(e as Error).message}`, 'error')
  } finally {
    busy.value = ''
  }
}

// 切 tab 时清掉 pending timer，避免在已销毁组件上 setState
onBeforeUnmount(() => {
  if (savedTimer) { clearTimeout(savedTimer); savedTimer = undefined }
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = undefined }
})

// ===================================================================
// 子组件（保持本文件简短，inline 定义）
// ===================================================================
const Row = (props: { label: string; desc?: string }, { slots }: any) =>
  h('div', { class: 'row' }, [
    h('div', { class: 'row-text' }, [
      h('div', { class: 'row-label' }, props.label),
      props.desc ? h('div', { class: 'row-desc' }, props.desc) : null
    ]),
    h('div', { class: 'row-ctrl' }, slots.default?.())
  ])

const Switch = (props: { modelValue: boolean }, { emit }: any) =>
  h(
    'button',
    {
      type: 'button',
      role: 'switch',
      class: ['moo-switch', { 'is-on': props.modelValue }],
      'aria-checked': props.modelValue ? 'true' : 'false',
      onClick: () => emit('update:modelValue', !props.modelValue)
    },
    h('span', { class: 'moo-switch-thumb' })
  )
;(Switch as any).props = ['modelValue']
;(Switch as any).emits = ['update:modelValue']

const TagInput = (props: { modelValue: string[]; placeholder?: string }, { emit }: any) => {
  const input = ref('')
  function add() {
    const v = input.value.trim()
    if (!v) return
    if (!props.modelValue.includes(v)) emit('update:modelValue', [...props.modelValue, v])
    input.value = ''
  }
  function remove(i: number) {
    emit('update:modelValue', props.modelValue.filter((_, idx) => idx !== i))
  }
  return h('div', { class: 'taginput' }, [
    ...props.modelValue.map((tag, i) =>
      h('span', { class: 'tag' }, [
        tag,
        h(
          'button',
          { class: 'tag-x', onClick: () => remove(i), type: 'button', 'aria-label': `移除 ${tag}` },
          '×'
        )
      ])
    ),
    h('input', {
      type: 'text',
      class: 'tag-add',
      placeholder: props.placeholder ?? '回车添加',
      value: input.value,
      onInput: (e: Event) => { input.value = (e.target as HTMLInputElement).value },
      onKeydown: (e: KeyboardEvent) => {
        if (e.key === 'Enter') { e.preventDefault(); add() }
        else if (e.key === 'Backspace' && !input.value && props.modelValue.length) {
          remove(props.modelValue.length - 1)
        }
      },
      onBlur: add
    })
  ])
}
;(TagInput as any).props = ['modelValue', 'placeholder']
;(TagInput as any).emits = ['update:modelValue']
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

.settings {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--moo-c-bg-soft);
  font-family: var(--moo-ff-sans);
  color: var(--moo-c-text);
  overflow: hidden;
}

.page-head {
  flex: none;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 14px 22px;
  border-bottom: 1px solid var(--moo-c-border);
  background: var(--moo-c-bg);
}
.page-head h2 {
  margin: 0;
  font-size: var(--moo-fs-lg);
  font-weight: 600;
  letter-spacing: -.01em;
}
.page-head .hint {
  font-size: var(--moo-fs-xs);
  color: var(--moo-c-text-dim);
}

.save-indicator {
  font-size: var(--moo-fs-xs);
  color: var(--moo-c-text-dim);
  font-variant-numeric: tabular-nums;
  transition: color var(--moo-motion-fast);
}
.save-indicator.is-saving { color: var(--moo-c-text); }
.save-indicator.is-saved  { color: var(--moo-c-success); font-weight: 500; }
.save-indicator.is-error  { color: var(--moo-c-danger);  font-weight: 500; }

.page-body {
  flex: 1;
  overflow: auto;
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 760px;
  margin: 0 auto;
  width: 100%;
  box-sizing: border-box;
}

.moo-card { background: var(--moo-c-bg); }
.moo-card__hd h3 {
  margin: 0;
  font-size: var(--moo-fs-md);
  font-weight: 600;
  letter-spacing: -.005em;
}
.proj-picker { width: 200px; }
.moo-card__bd .sub {
  margin: 16px 0 8px;
  font-size: var(--moo-fs-xs);
  font-weight: 600;
  color: var(--moo-c-text-dim);
  text-transform: uppercase;
  letter-spacing: .04em;
}
.moo-card__bd .sub:first-child { margin-top: 0; }

.row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 0;
  border-top: 1px solid var(--moo-c-divider);
}
.row:first-child, .moo-card__bd > .sub + .row { border-top: none; }
.row-text { flex: 1; min-width: 0; }
.row-label {
  font-size: var(--moo-fs-sm);
  font-weight: 500;
  color: var(--moo-c-text);
}
.row-desc {
  font-size: var(--moo-fs-xs);
  color: var(--moo-c-text-dim);
  margin-top: 2px;
  line-height: 1.55;
}
.row-ctrl {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
}
.row.kv-row { flex-direction: column; }
.row.kv-row .row-ctrl { width: 100%; }

.narrow { width: 96px; }

/* 数值输入的行内校验：红边 + 副文案，blur 时若仍非法会 snap 回上次有效值 */
.num-input-wrap {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}
.num-input-wrap .moo-field.is-invalid {
  border-color: var(--moo-c-danger);
  box-shadow: 0 0 0 3px var(--moo-c-danger-soft);
}
.num-input-wrap .field-err {
  font-size: var(--moo-fs-xs);
  color: var(--moo-c-danger-fg);
  line-height: 1.2;
}
.row-stats {
  display: flex;
  align-items: center;
  gap: 10px;
}
.stat {
  font-family: var(--moo-ff-mono);
  font-size: var(--moo-fs-xs);
  color: var(--moo-c-text-muted);
  min-width: 48px;
  text-align: right;
}

/* Switch 样式见 src/styles/tokens.css（.moo-switch / .moo-switch-thumb，挂全局是因为本组件用 h() 渲染） */

/* TagInput */
.taginput {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px 4px;
  border: 1px solid var(--moo-c-border);
  border-radius: var(--moo-r-md);
  background: var(--moo-c-bg);
  width: 100%;
  min-height: 28px;
  align-items: center;
}
.taginput:focus-within {
  border-color: var(--moo-c-brand);
  box-shadow: 0 0 0 3px var(--moo-c-focus-ring);
}
.tag {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 4px 2px 8px;
  height: 20px;
  border-radius: var(--moo-r-sm);
  background: var(--moo-c-brand-soft);
  color: var(--moo-c-brand);
  font-size: var(--moo-fs-xs);
  font-family: var(--moo-ff-mono);
}
.tag-x {
  background: transparent;
  border: none;
  color: var(--moo-c-brand);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0 2px;
  opacity: .6;
  border-radius: 2px;
}
.tag-x:hover { opacity: 1; }
.tag-add {
  flex: 1;
  min-width: 100px;
  border: none;
  outline: none;
  background: transparent;
  font-size: var(--moo-fs-sm);
  color: var(--moo-c-text);
  height: 22px;
  padding: 0 4px;
  font-family: inherit;
}

/* 键盘示意 */
.kbd {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 6px;
  border: 1px solid var(--moo-c-border);
  border-radius: var(--moo-r-sm);
  background: var(--moo-c-bg);
  color: var(--moo-c-text);
  font-family: var(--moo-ff-mono);
  font-size: var(--moo-fs-xs);
  box-shadow: 0 1px 0 var(--moo-c-border);
  margin-right: 4px;
}
.hint { font-size: var(--moo-fs-xs); color: var(--moo-c-text-dim); }
.link {
  color: var(--moo-c-brand);
  font-size: var(--moo-fs-sm);
  text-decoration: none;
  transition: color var(--moo-motion-fast);
}
.link:hover { color: var(--moo-c-brand-hover); text-decoration: underline; }
</style>
