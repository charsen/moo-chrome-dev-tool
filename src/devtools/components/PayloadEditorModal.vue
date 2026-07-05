<template>
  <div class="payload-mask" @click.self="onCancel">
    <div ref="modalRef" class="payload-modal" role="dialog" aria-modal="true" aria-labelledby="payload-edit-title" tabindex="-1">
      <header class="payload-hd">
        <h3 id="payload-edit-title">编辑 Payload 模板</h3>
        <MooCloseBtn @click="onCancel" />
      </header>
      <div class="payload-bd">
        <div class="payload-editor">
          <textarea
            ref="editorRef"
            v-model="draftText"
            class="payload-textarea"
            spellcheck="false"
            placeholder="例如：&#10;{&#10;  &quot;title&quot;: {{title}},&#10;  &quot;url&quot;: {{url}}&#10;}"
          />
          <div class="payload-hint">
            <code v-pre>{{xxx}}</code> 形式的占位符在提交时会被替换。点击右侧变量插入到光标位置。
          </div>
        </div>
        <aside class="payload-vars">
          <div class="vars-title">可用变量</div>
          <ul class="vars-list">
            <li v-for="v in VARIABLES" :key="v.name">
              <button
                type="button"
                class="var-btn"
                :title="v.desc"
                @click="insertVar(v.name)"
              >
                <code>&#123;&#123;{{ v.name }}&#125;&#125;</code>
                <span class="var-desc">{{ v.desc }}</span>
              </button>
            </li>
          </ul>
        </aside>
      </div>
      <footer class="payload-ft">
        <button class="moo-btn" @click="onCancel">取消 <span class="kbd">Esc</span></button>
        <button class="moo-btn moo-btn--primary" @click="onSave">应用</button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import MooCloseBtn from '@/components/MooCloseBtn.vue'
import { useFocusTrap } from '@/composables/useFocusTrap'

const props = defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  (e: 'cancel'): void
  (e: 'save', value: string): void
}>()

const draftText = ref(props.modelValue)
const editorRef = ref<HTMLTextAreaElement | null>(null)
const modalRef = ref<HTMLElement>()

// v0.5.1：focus trap（v0.4.9 给 ConfirmModal/MooAlert/MooDialog 都加了，这个 modal 漏了）
// Tab 键不溜出去 Environment 表单 + Esc 关闭后焦点回触发按钮
useFocusTrap(modalRef, { onEscape: () => onCancel(), initialFocus: 'first' })

const VARIABLES: { name: string; desc: string }[] = [
  { name: 'title', desc: 'Bug 标题' },
  { name: 'description', desc: 'Bug 描述' },
  { name: 'url', desc: '发现 bug 时的页面 URL' },
  { name: 'userAgent', desc: '浏览器 UA' },
  { name: 'viewport', desc: '视口尺寸 W×H' },
  { name: 'timestamp', desc: 'ISO 时间戳' },
  { name: 'image', desc: '截图 dataUrl / multipart' },
  { name: 'requestsJson', desc: '勾选的请求 JSON 数组' },
  { name: 'errorsJson', desc: '勾选的错误 JSON 数组' }
]

function insertVar(name: string) {
  const el = editorRef.value
  const token = `{{${name}}}`
  if (!el) {
    draftText.value += token
    return
  }
  const start = el.selectionStart ?? draftText.value.length
  const end = el.selectionEnd ?? start
  draftText.value =
    draftText.value.slice(0, start) + token + draftText.value.slice(end)
  // 把光标放到插入的 token 之后
  const pos = start + token.length
  // textarea 要等下次 tick 才能 setSelectionRange，否则被新 v-model 覆盖
  requestAnimationFrame(() => {
    el.focus()
    el.setSelectionRange(pos, pos)
  })
}

function onSave() {
  emit('save', draftText.value)
}
function onCancel() {
  emit('cancel')
}

function onKey(e: KeyboardEvent) {
  if (e.isComposing) return // 输入法组字中的 Esc/回车是选字操作，不是对 modal 的命令
  if (e.key === 'Escape') { e.stopPropagation(); onCancel() }
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); onSave() }
}

onMounted(() => {
  window.addEventListener('keydown', onKey, true)
  requestAnimationFrame(() => editorRef.value?.focus())
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))
</script>

<style scoped>
.payload-mask {
  position: fixed;
  inset: 0;
  background: var(--moo-c-scrim);
  z-index: 9100;
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(2px);
  animation: mask-in .15s;
}
@keyframes mask-in { from { opacity: 0 } to { opacity: 1 } }
.payload-modal {
  background: var(--moo-c-bg);
  border-radius: var(--moo-r-lg);
  width: min(960px, calc(100vw - 64px));
  height: min(640px, calc(100vh - 80px));
  display: flex;
  flex-direction: column;
  box-shadow: var(--moo-sh-lg);
  overflow: hidden;
}
.payload-hd {
  padding: 12px 16px;
  border-bottom: 1px solid var(--moo-c-divider);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.payload-hd h3 {
  margin: 0;
  font-size: var(--moo-fs-md);
  font-weight: 600;
}
.payload-bd {
  flex: 1;
  display: grid;
  /* minmax(0, 1fr)：grid item 默认 min-width: auto 会让编辑器内长行撑爆 cell；
     用 minmax(0, 1fr) 强制 cell 尊重 grid track 宽度，等价于 flex 的 min-width: 0 */
  grid-template-columns: minmax(0, 1fr) 240px;
  gap: 12px;
  padding: 12px 16px;
  min-height: 0;
}
/* 极窄场景（panel docked right < 460px 时 modal 自身宽度也会跟着缩）：
   1fr + 240px 放不下，改单列让 vars 列退到下方 */
@media (max-width: 520px) {
  .payload-bd {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) auto;
  }
  .payload-vars {
    border-left: none;
    border-top: 1px solid var(--moo-c-divider);
    padding-left: 0;
    padding-top: 8px;
    max-height: 140px;
  }
}
.payload-editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.payload-textarea {
  flex: 1;
  width: 100%;
  font-family: var(--moo-ff-mono);
  font-size: var(--moo-fs-sm);
  line-height: 1.5;
  padding: 12px 14px;
  border: 1px solid var(--moo-c-border);
  border-radius: var(--moo-r-md);
  background: var(--moo-c-bg);
  color: var(--moo-c-text);
  resize: none;
  outline: none;
  box-sizing: border-box; /* textarea 默认 content-box；width:100% + 14px padding + 1px border 会撑出 grid cell ~30px 触发横向滚动 */
  transition: border-color .12s, box-shadow .12s;
}
.payload-textarea:focus {
  border-color: var(--moo-c-brand);
  box-shadow: 0 0 0 3px var(--moo-c-focus-ring);
}
.payload-hint {
  font-size: var(--moo-fs-xs);
  color: var(--moo-c-text-dim);
}
.payload-hint code {
  font-family: var(--moo-ff-mono);
  background: var(--moo-c-bg-elev);
  color: var(--moo-c-text);
  padding: 1px 4px;
  border-radius: 3px;
}

.payload-vars {
  border-left: 1px solid var(--moo-c-divider);
  padding-left: 12px;
  overflow: auto;
}
.vars-title {
  font-size: var(--moo-fs-xs);
  text-transform: uppercase;
  letter-spacing: .04em;
  color: var(--moo-c-text-dim);
  margin-bottom: 8px;
  font-weight: 600;
}
.vars-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.var-btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 6px 8px;
  width: 100%;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--moo-r-sm);
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  box-sizing: border-box; /* aside 固定 240px；button width:100% + padding/border 没 box-sizing 会撑出 18px 触发 aside 横向滚动 */
  transition: background .12s, border-color .12s;
}
.var-btn:hover {
  background: var(--moo-c-bg-soft);
  border-color: var(--moo-c-border);
}
.var-btn code {
  font-family: var(--moo-ff-mono);
  font-size: var(--moo-fs-xs);
  color: var(--moo-c-brand);
  font-weight: 600;
}
.var-desc {
  font-size: var(--moo-fs-xs);
  color: var(--moo-c-text-dim);
  line-height: 1.3;
}

.payload-ft {
  padding: 10px 16px;
  border-top: 1px solid var(--moo-c-divider);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  background: var(--moo-c-bg-soft);
}
.payload-ft .kbd {
  margin-left: 6px;
  padding: 1px 5px;
  font-size: 10px;
  font-family: var(--moo-ff-mono);
  color: var(--moo-c-text-dim);
  background: var(--moo-c-bg-elev);
  border-radius: 3px;
}

/* .moo-close-btn 来自全局 tokens.css —— 不再 scoped 重复定义 */
</style>
