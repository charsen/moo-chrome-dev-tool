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
          <Row label="重试队列" desc="提交失败的 bug 暂存在这里；扩展每 5 分钟自动重试一次">
            <div class="row-stats">
              <button
                type="button"
                class="queue-chev"
                :class="{ 'is-open': queueExpanded }"
                :disabled="queueCount === 0"
                :aria-expanded="queueExpanded ? 'true' : 'false'"
                :aria-controls="queueCount > 0 ? 'queue-detail-list' : undefined"
                :aria-label="queueExpanded ? '收起队列明细' : '展开队列明细'"
                @click="queueExpanded = !queueExpanded"
              >
                <span class="queue-chev-icon" aria-hidden="true">▸</span>
              </button>
              <span class="stat">{{ queueCount }} 条</span>
              <button class="moo-btn moo-btn--sm" :disabled="busy === 'flush'" @click="flushQueue">
                {{ busy === 'flush' ? '重试中…' : '立即重试' }}
              </button>
              <button class="moo-btn moo-btn--sm" :disabled="busy === 'clearQueue' || queueCount === 0" @click="clearQueue">
                清空
              </button>
            </div>
          </Row>
          <!-- 队列明细：默认收起；展开后按 request 视角列每条（不重复 History 的 bug 视角）。
               5/5 次的条目下次 flush 就被丢弃，给个 ⚠ 提醒用户在还没丢前手动删 / 检查 endpoint。 -->
          <div
            v-if="queueExpanded && queueItems.length"
            id="queue-detail-list"
            class="queue-detail-list"
            role="list"
          >
            <div
              v-for="q in queueItems"
              :key="q.enqueuedAt"
              class="queue-detail-item"
              role="listitem"
            >
              <div class="qdi-line">
                <span :class="['qdi-method', q.method.toLowerCase()]">{{ q.method }}</span>
                <span class="qdi-endpoint" :title="q.endpoint">{{ q.endpoint }}</span>
                <span class="qdi-ago">{{ relativeTime(q.enqueuedAt) }}</span>
                <button
                  type="button"
                  class="qdi-rm"
                  :disabled="busy === 'rmOne'"
                  :aria-label="`从队列移除：${q.method} ${q.endpoint}`"
                  @click="removeQueueOne(q.enqueuedAt)"
                >×</button>
              </div>
              <div class="qdi-line qdi-meta">
                <span
                  class="qdi-attempts"
                  :class="{ 'is-last': q.attempts >= RETRY_MAX_ATTEMPTS - 1 }"
                >第 {{ q.attempts }}/{{ RETRY_MAX_ATTEMPTS }} 次</span>
                <span v-if="q.attempts >= RETRY_MAX_ATTEMPTS - 1" class="qdi-warn" title="下次仍失败会被丢弃">
                  ⚠ 下次失败将被丢弃
                </span>
                <span v-if="q.lastError" class="qdi-error">上次：{{ q.lastError }}</span>
                <span v-else class="qdi-error qdi-error--pending">等待重试</span>
              </div>
            </div>
          </div>
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
import { computed, defineComponent, h, onMounted, ref, watch, type PropType } from 'vue'
import type { Project } from '@/types/config'
import { listHistory, clearHistory } from '@/storage/history'
import { MSG } from '@/types/messages'
import { safeSendMessage } from '@/utils/messaging'
// retryQueue 是纯函数模块（只读 chrome.storage.local），devtools 上下文可用，
// 直接 import 比走 sendMessage(RETRY_QUEUE_*) 少一次 SW 唤醒 + 一轮 IPC。
// Storage key 完全封在模块里，UI 不再知道叫 'mooRetryQueue'。
import {
  getQueueLength,
  getQueueItems,
  clearQueue as clearRetryQueue,
  removeQueueItem,
  RETRY_MAX_ATTEMPTS,
  type QueuedRequest
} from '@/background/retryQueue'
import { useConfig } from '@/composables/useConfig'
import { useAutoSave } from '@/composables/useAutoSave'
import { useToast } from '@/composables/useToast'
import { relativeTime } from '@/utils/relativeTime'
import { confirmDialog } from '../components/confirm'

const HISTORY_MAX = 30

// 用 useConfig composable：跟 Environment 一致 + 顺手补多 tab 同步（之前 Settings
// 直接 loadConfig 一次性读，Environment 那边改了配置 Settings 不会跟着刷）
const { config, loaded } = useConfig()
const activeId = ref('')
const historyCount = ref(0)
const queueCount = ref(0)
const queueItems = ref<QueuedRequest[]>([])
const queueExpanded = ref(false)
const busy = ref<'' | 'history' | 'flush' | 'clearQueue' | 'rmOne'>('')
const version = chrome.runtime.getManifest().version

const active = computed<Project | undefined>(() =>
  config.value.projects.find((p) => p.id === activeId.value)
)

async function refreshStats() {
  const hist = await listHistory()
  historyCount.value = hist.length
  // 一次性把 length + items 都读了——读 items 已经含 length，单次 storage.local.get 够。
  // 队列空了自动收起，避免「展开但没内容」的空态。
  queueItems.value = await getQueueItems()
  queueCount.value = queueItems.value.length
  if (queueCount.value === 0) queueExpanded.value = false
}

async function removeQueueOne(enqueuedAt: number) {
  busy.value = 'rmOne'
  try {
    const removed = await removeQueueItem(enqueuedAt)
    await refreshStats()
    if (removed) showToast('已从队列移除 1 条', 'success')
    else showToast('这条已经不在队列里了（可能刚被重试掉）', 'info')
  } catch (e) {
    showToast(`没能移除：${(e as Error).message}`, 'error')
  } finally {
    busy.value = ''
  }
}

onMounted(async () => {
  // useConfig 模块级 init promise 已经在跑；这里只等它完事 + 拿首项 + 拉统计
  // （useConfig.ready 内部已 await loadConfig）
  if (config.value.projects[0]) activeId.value = config.value.projects[0].id
  await refreshStats()
})

// loaded 翻 true 时再选第一项：onMounted 那会儿可能还没加载完
watch(loaded, (v) => {
  if (v && !activeId.value && config.value.projects[0]) {
    activeId.value = config.value.projects[0].id
  }
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
    if (!projects.find((p) => p.id === activeId.value) && projects[0]) {
      activeId.value = projects[0].id
    }
  },
  { deep: false }
)

const { toast, toastKind, showToast: showToastRaw } = useToast()
// 包一层保留原有 error=5000 / 其他=2600 的 duration 策略
function showToast(msg: string, kind: 'success' | 'error' | 'info' = 'info') {
  showToastRaw(msg, kind, kind === 'error' ? 5000 : 2600)
}

// 跟 Environment 一致走 useAutoSave；这里编辑路径都是显式 commit（toggle / blur 后），
// 不像 textarea 需要长时间防抖，给个 0 让 click toggle 立刻落盘但仍走统一状态机。
// 多次 toggle 命中 inflight 计数防止 saving↔saved 来回闪。
const { save: writeConfig } = useConfig()
const { saveState, scheduleSave: save } = useAutoSave({
  debounceMs: 0,
  save: writeConfig,
  onError: (e) => { showToast(`保存失败：${e.message}`, 'error') }
})

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
    if (processed > 0) msg = `成功重新提交 ${processed} 条`
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
    await clearRetryQueue()
    await refreshStats()
    showToast(`已丢弃 ${n} 条`, 'success')
  } catch (e) {
    showToast(`没能清空：${(e as Error).message}`, 'error')
  } finally {
    busy.value = ''
  }
}

// ===================================================================
// 子组件（保持本文件简短，inline 定义）
//
// 用 defineComponent 而不是 functional-component-with-as-any：
// 原来 `(Switch as any).props = [...]` 是 Vue 3 函数式组件挂 props 的
// 反 pattern —— 不仅丢类型还让 `<Switch v-model>` 没法被 vue-tsc 验证
// modelValue 类型。defineComponent 走标准 options API 后，props/emits
// 都有完整类型，模板里写错也会被 vue-tsc 抓住。
// ===================================================================
const Row = defineComponent({
  props: {
    label: { type: String, required: true },
    desc: String
  },
  setup(props, { slots }) {
    return () => h('div', { class: 'row' }, [
      h('div', { class: 'row-text' }, [
        h('div', { class: 'row-label' }, props.label),
        props.desc ? h('div', { class: 'row-desc' }, props.desc) : null
      ]),
      h('div', { class: 'row-ctrl' }, slots.default?.())
    ])
  }
})

const Switch = defineComponent({
  props: {
    modelValue: { type: Boolean, required: true }
  },
  emits: {
    'update:modelValue': (_v: boolean) => true
  },
  setup(props, { emit }) {
    return () => h(
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
  }
})

const TagInput = defineComponent({
  props: {
    modelValue: { type: Array as PropType<string[]>, required: true },
    placeholder: String
  },
  emits: {
    'update:modelValue': (_v: string[]) => true
  },
  setup(props, { emit }) {
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
    return () => h('div', { class: 'taginput' }, [
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
.proj-picker { width: 240px; max-width: 100%; }
/* max-width 100%：窄宽（≤ 260px 整 page-body）下固定 240 会撑出横向滚动 */

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
.row:hover { background: var(--moo-c-row-hover); }
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

/* 重试队列：折叠 chevron + 展开后的明细列表 */
.queue-chev {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--moo-c-border);
  border-radius: var(--moo-r-sm);
  background: var(--moo-c-bg);
  cursor: pointer;
  transition: background var(--moo-motion-fast), color var(--moo-motion-fast);
  color: var(--moo-c-text-dim);
}
.queue-chev:hover:not(:disabled) {
  background: var(--moo-c-row-hover);
  color: var(--moo-c-text);
}
.queue-chev:disabled {
  opacity: .4;
  cursor: not-allowed;
}
.queue-chev-icon {
  font-size: 10px;
  line-height: 1;
  transition: transform var(--moo-motion-fast);
}
.queue-chev.is-open .queue-chev-icon { transform: rotate(90deg); }

.queue-detail-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 4px 0 8px;
  padding: 8px;
  border-radius: var(--moo-r-md);
  background: var(--moo-c-bg-soft);
  /* 明细列表是「重试队列」row 的延伸，不要画顶 border 跟下一行 row 串成两条线 */
}
.queue-detail-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border: 1px solid var(--moo-c-border);
  border-radius: var(--moo-r-sm);
  background: var(--moo-c-bg);
}
.qdi-line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.qdi-meta {
  font-size: var(--moo-fs-xs);
  color: var(--moo-c-text-dim);
  flex-wrap: wrap;
}
/* method chip 跟 SubmitDialog 那边的 .method 视觉同款，但本组件用 h() 渲染不了
   shared CSS——直接抄一份 token-driven 配色 */
.qdi-method {
  flex: none;
  font-family: var(--moo-ff-mono);
  font-size: var(--moo-fs-xs);
  font-weight: 600;
  padding: 1px 6px;
  border-radius: var(--moo-r-sm);
  background: var(--moo-c-brand-soft);
  color: var(--moo-c-brand);
  text-transform: uppercase;
  letter-spacing: .03em;
}
.qdi-method.delete { background: var(--moo-c-danger-soft); color: var(--moo-c-danger-fg); }
.qdi-method.put,
.qdi-method.patch { background: var(--moo-c-warn-soft); color: var(--moo-c-warn-fg); }
.qdi-endpoint {
  flex: 1;
  min-width: 0;
  font-family: var(--moo-ff-mono);
  font-size: var(--moo-fs-xs);
  color: var(--moo-c-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.qdi-ago {
  flex: none;
  font-size: var(--moo-fs-xs);
  color: var(--moo-c-text-dim);
  font-variant-numeric: tabular-nums;
}
.qdi-rm {
  flex: none;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: var(--moo-r-sm);
  background: transparent;
  color: var(--moo-c-text-dim);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  transition: background var(--moo-motion-fast), color var(--moo-motion-fast);
}
.qdi-rm:hover:not(:disabled) {
  background: var(--moo-c-danger-soft);
  color: var(--moo-c-danger-fg);
}
.qdi-rm:disabled { opacity: .4; cursor: not-allowed; }

.qdi-attempts {
  font-variant-numeric: tabular-nums;
}
.qdi-attempts.is-last { color: var(--moo-c-danger-fg); font-weight: 500; }
.qdi-warn {
  color: var(--moo-c-danger-fg);
  font-weight: 500;
}
.qdi-error { color: var(--moo-c-text-muted); }
.qdi-error--pending { font-style: italic; }

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
  box-sizing: border-box; /* row-ctrl 在 kv-row 模式下 width:100%；padding/border 没 box-sizing 会让 taginput 比 row-ctrl 宽 10px 触发横向滚动 */
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
