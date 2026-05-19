<template>
  <div class="body-viewer">
    <div class="bv-toolbar">
      <div class="bv-meta">
        <span class="bv-size">{{ sizeLabel }}</span>
        <span v-if="isJson" class="bv-tag" title="检测到 JSON">JSON</span>
      </div>
      <div class="bv-actions">
        <button
          v-if="isJson"
          type="button"
          class="bv-btn"
          :class="{ 'is-on': pretty }"
          :title="pretty ? '点击切换原文' : '点击格式化 + 染色'"
          @click="pretty = !pretty"
        >{{ pretty ? '格式化' : '原文' }}</button>
        <button
          type="button"
          class="bv-btn"
          title="复制到剪贴板"
          @click="copy"
        >{{ copied ? '已复制' : '复制' }}</button>
      </div>
    </div>
    <pre class="bv-pre mono" v-html="rendered" />
    <button
      v-if="truncated"
      type="button"
      class="bv-expand"
      @click="expanded = true"
    >展开剩余 {{ remainingLabel }}</button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  escapeHtml,
  highlightJson,
  overlayBodySearch,
  prettyPrintJson,
  tryParseJson
} from '@/utils/jsonHighlight'

const props = defineProps<{
  /** 原始 body 文本 */
  text: string
  /** body 内搜索 query（与外层搜框共享） */
  search?: string
  /** 字节数提示（来自抓包；没传就按 text.length 估） */
  sizeBytes?: number
}>()

// 折叠阈值：超过 3000 字符默认只渲染前 2000 字符。再大的 JSON 先 highlight
// 后截断对性能影响有限（regex 整段跑一次），但 DOM 节点数能省一大半。
const FOLD_THRESHOLD = 3000
const FOLD_HEAD = 2000

// 安全上限：超过 200KB 不尝试 JSON.parse + highlight（防止主线程长时间卡顿）
const NO_HIGHLIGHT_BYTES = 200_000

const parsed = computed(() => {
  if (props.text.length > NO_HIGHLIGHT_BYTES) return undefined
  return tryParseJson(props.text)
})
const isJson = computed(() => parsed.value !== undefined)
const pretty = ref(true) // JSON 默认走格式化
const expanded = ref(false)
const copied = ref(false)

// 切换不同 entry 时把展开状态归零，避免上一次的展开状态串到下一行
watch(() => props.text, () => {
  expanded.value = false
  copied.value = false
})

const displayText = computed(() => {
  if (isJson.value && pretty.value) {
    return prettyPrintJson(parsed.value)
  }
  return props.text
})

const truncated = computed(() => !expanded.value && displayText.value.length > FOLD_THRESHOLD)

const visibleText = computed(() => {
  return truncated.value ? displayText.value.slice(0, FOLD_HEAD) : displayText.value
})

const rendered = computed(() => {
  const base = isJson.value && pretty.value
    ? highlightJson(visibleText.value)
    : escapeHtml(visibleText.value)
  return overlayBodySearch(base, props.search ?? '')
})

const sizeLabel = computed(() => {
  const bytes = props.sizeBytes ?? props.text.length
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
})

const remainingLabel = computed(() => {
  const rest = displayText.value.length - FOLD_HEAD
  if (rest < 1024) return `${rest} 字符`
  return `${(rest / 1024).toFixed(1)} K 字符`
})

async function copy() {
  try {
    // 复制原文（无 HTML 标签），格式化态复制 pretty 文本——更符合"我要拿去贴别处"的直觉
    await navigator.clipboard.writeText(displayText.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 1500)
  } catch {
    // devtools panel 通常有 clipboard 权限；失败极少见。静默
  }
}
</script>

<style scoped>
.body-viewer {
  background: var(--moo-c-bg-soft);
  border: 1px solid var(--moo-c-border);
  border-radius: var(--moo-r-md);
  overflow: hidden;
}
.bv-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 8px;
  background: var(--moo-c-bg);
  border-bottom: 1px solid var(--moo-c-divider);
  font-size: 10px;
}
.bv-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--moo-c-text-dim);
  font-family: var(--moo-ff-mono);
}
.bv-size { font-size: 10px; }
.bv-tag {
  font-size: 9px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: var(--moo-r-sm);
  background: var(--moo-c-info-soft);
  color: var(--moo-c-info);
  letter-spacing: .03em;
}
.bv-actions { display: flex; gap: 4px; }
.bv-btn {
  font-family: inherit;
  font-size: 10px;
  padding: 2px 8px;
  border: 1px solid var(--moo-c-border);
  border-radius: var(--moo-r-sm);
  background: var(--moo-c-bg);
  color: var(--moo-c-text-muted);
  cursor: pointer;
  transition: background-color var(--moo-motion-fast), color var(--moo-motion-fast);
}
.bv-btn:hover { background: var(--moo-c-bg-soft); color: var(--moo-c-text); }
.bv-btn.is-on { background: var(--moo-c-brand-soft); color: var(--moo-c-brand); border-color: var(--moo-c-brand); }

.bv-pre {
  margin: 0;
  padding: 8px 10px;
  font-size: var(--moo-fs-xs);
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 220px;
  overflow: auto;
  font-family: var(--moo-ff-mono);
  color: var(--moo-c-text);
}
.bv-pre :deep(mark) {
  background: var(--moo-c-warn);
  color: var(--moo-c-bg);
  padding: 0 2px;
  border-radius: 2px;
  font-weight: 600;
}
/* JSON 语法染色：保持低对比度，留给 mark 高亮 + 文字本身被读 */
.bv-pre :deep(.jx-key)  { color: var(--moo-c-info); }
.bv-pre :deep(.jx-str)  { color: var(--moo-c-success-fg); }
.bv-pre :deep(.jx-num)  { color: var(--moo-c-warn-fg); }
.bv-pre :deep(.jx-bool) { color: var(--moo-c-brand); font-weight: 600; }
.bv-pre :deep(.jx-null) { color: var(--moo-c-text-dim); font-style: italic; }

.bv-expand {
  display: block;
  width: 100%;
  padding: 6px;
  background: var(--moo-c-bg);
  border: none;
  border-top: 1px solid var(--moo-c-divider);
  color: var(--moo-c-brand);
  font-family: inherit;
  font-size: var(--moo-fs-xs);
  cursor: pointer;
  transition: background-color var(--moo-motion-fast);
}
.bv-expand:hover { background: var(--moo-c-brand-soft); }
</style>
