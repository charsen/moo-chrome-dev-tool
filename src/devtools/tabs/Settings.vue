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
          <span v-if="active" class="card-hd-meta">{{ active.name || '(未命名)' }} · 改动自动保存</span>
        </div>

        <div v-if="active" class="moo-card__bd">
          <!-- 多项目时把切换器放进 body 顶部并加 label，避免和卡片标题挤一起 -->
          <div v-if="config.projects.length > 1" class="proj-switcher">
            <span class="proj-switcher-label">当前项目</span>
            <select v-model="activeId" class="moo-field proj-picker">
              <option v-for="p in config.projects" :key="p.id" :value="p.id">{{ p.name || '(未命名)' }}</option>
            </select>
          </div>

          <h4 class="sub"><span class="sub-bar" />抓取</h4>
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

          <h4 class="sub"><span class="sub-bar" />脱敏</h4>
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

          <h4 class="sub"><span class="sub-bar" />localStorage 白名单</h4>
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

// 用户在 Environment 删了当前激活的项目时，这里 activeId 会变成 stale id，
// active computed 返回 undefined，整张表单消失。watch projects 变化时 re-pick
watch(
  () => config.value.projects,
  (projects) => {
    if (!projects.length) {
      activeId.value = ''
      return
    }
    if (!projects.find((p) => p.id === activeId.value)) {
      activeId.value = projects[0].id
    }
  },
  { deep: false }
)

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
  if (!v) return '请填一个数字（5–500 之间）'
  const n = Number(v)
  if (!Number.isFinite(n)) return '只能填数字'
  if (n < 5) return '至少留 5 条，否则页面只发 1-2 次请求就抓不到现场了'
  if (n > 500) return '最多 500 条；再多会占用太多内存且没必要'
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
    title: `清空 ${n} 条历史记录？`,
    message: `本地保留的 ${n} 条 bug 提交记录会全部删除，并且无法找回。\n服务端已经收到的 bug 数据不会受影响。`,
    danger: true,
    confirmText: '确认清空'
  })
  if (!ok) return
  busy.value = 'history'
  try {
    await clearHistory()
    await refreshStats()
    showToast(`已删除 ${n} 条本地历史`, 'success')
  } catch (e) {
    showToast(`没能清空：${(e as Error).message}`, 'error')
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
    const total = queueCount.value
    let msg: string
    if (processed > 0) msg = `成功重发 ${processed} 条`
    else if (total === 0) msg = '队列里没有待重试的内容，不用重试'
    else msg = `${total} 条都还在失败（可能后端没起，或者「请求 URL」写错了）`
    showToast(msg, processed > 0 ? 'success' : 'info')
  } catch (e) {
    showToast(`没能联系上扩展后台：${(e as Error).message}。请刷新页面或重新加载扩展`, 'error')
  } finally {
    busy.value = ''
  }
}

async function clearQueue() {
  const n = queueCount.value
  const ok = await confirmDialog({
    title: `丢弃 ${n} 条没成功上报的 bug？`,
    message: `这些 bug 之前提交时遇到了网络/服务端错误，被暂存在重试队列里。\n清空后它们彻底丢失，服务端不会再收到。如果你想保留这些数据，建议先点"立即重试"再清。`,
    danger: true,
    confirmText: '确认丢弃'
  })
  if (!ok) return
  busy.value = 'clearQueue'
  try {
    await chrome.storage.local.set({ mooRetryQueue: [] })
    await refreshStats()
    showToast(`已丢弃 ${n} 条`, 'success')
  } catch (e) {
    showToast(`没能清空：${(e as Error).message}`, 'error')
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
.card-hd-meta {
  font-size: var(--moo-fs-xs);
  color: var(--moo-c-text-dim);
  font-variant-numeric: tabular-nums;
}

/* 当前项目切换器（body 顶部，不再挤在 card 标题里） */
.proj-switcher {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 14px;
  margin-bottom: 6px;
  border-bottom: 1px dashed var(--moo-c-border);
}
.proj-switcher-label {
  font-size: var(--moo-fs-xs);
  color: var(--moo-c-text-dim);
  text-transform: uppercase;
  letter-spacing: .04em;
  font-weight: 600;
  flex: none;
}
.proj-picker { width: 240px; }

/* 子分区头部：加左侧竖条 accent，比纯文字 uppercase 更显眼 */
.moo-card__bd .sub {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 18px 0 6px;
  font-size: var(--moo-fs-sm);
  font-weight: 600;
  color: var(--moo-c-text);
  letter-spacing: -.005em;
}
.moo-card__bd .sub:first-child { margin-top: 0; }
.moo-card__bd .sub .sub-bar {
  display: inline-block;
  width: 3px;
  height: 14px;
  background: var(--moo-c-brand);
  border-radius: 2px;
  flex: none;
}

.row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 0;
  border-top: 1px solid var(--moo-c-divider);
  transition: background-color var(--moo-motion-fast);
}
.row:first-child, .moo-card__bd > .sub + .row { border-top: none; }
.row:hover { background: rgba(0, 0, 0, .015); }
@media (prefers-color-scheme: dark) {
  .row:hover { background: rgba(255, 255, 255, .025); }
}
.row-text { flex: 1; min-width: 0; }
.row-label {
  font-size: var(--moo-fs-sm);
  font-weight: 500;
  color: var(--moo-c-text);
  line-height: 1.4;
}
.row-desc {
  font-size: var(--moo-fs-xs);
  color: var(--moo-c-text-dim);
  margin-top: 3px;
  line-height: 1.6;
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
