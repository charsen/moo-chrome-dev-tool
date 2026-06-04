<template>
  <div class="webhook-form">
    <div class="section-head">
      <h4>上报 Token</h4>
    </div>
    <div class="row">
      <label>Token</label>
      <div class="token-input">
        <input
          v-model="modelValue.token"
          :type="tokenVisible ? 'text' : 'password'"
          placeholder="从 moo-scaffold-cloud「接入 Token」页生成(需 todos 能力)"
          autocomplete="off"
          spellcheck="false"
          class="grow"
        />
        <button
          type="button"
          class="token-toggle"
          :aria-label="tokenVisible ? '隐藏 token' : '显示 token'"
          :title="tokenVisible ? '隐藏' : '显示'"
          @click="emit('update:tokenVisible', !tokenVisible)"
        >{{ tokenVisible ? '🙈' : '👁' }}</button>
      </div>
    </div>
    <div class="tpl-hint">
      token 通过 payload 模板的 <code class="inline-code" v-pre>{{token}}</code> 占位符注入 POST body 的 <code class="inline-code">token</code> 字段（webhook 风格，不进 header）。
      服务端从 body 读出 token 校验，命中后用账号 username 作为提交人。
      留空则按匿名提交（若服务端要求 token 会被拒）。
    </div>

    <div class="section-head">
      <h4>上报服务器</h4>
      <button class="moo-btn" @click="addServer">+ 新建服务器</button>
    </div>

    <div v-if="!modelValue.servers.length" class="server-empty-warn">
      ⚠ 这个项目没有上报服务器，<b>悬浮球能匹配但点提交会失败</b>。点上面「+ 新建服务器」配一个。
    </div>

    <div v-for="s in modelValue.servers" :key="s.id" class="server-card">
      <div class="row">
        <label>名称</label>
        <input v-model="s.name" />
        <label class="inline">
          <input
            type="radio"
            :name="`def-${modelValue.id}`"
            :value="s.id"
            v-model="modelValue.defaultServerId"
          />
          默认
        </label>
        <button class="moo-btn moo-btn--sm moo-btn--danger" @click="removeServer(s.id)">删除</button>
      </div>
      <div class="row">
        <label>请求 URL</label>
        <select v-model="s.method" class="method">
          <option>POST</option>
          <option>PUT</option>
          <option>PATCH</option>
        </select>
        <input v-model="s.endpoint" placeholder="https://your-bug-server/api/bugs" class="grow" />
      </div>
      <div class="row">
        <label>请求头</label>
      </div>
      <div class="kv-list">
        <!-- v0.7.9：header name 是 dict 内唯一 key，比 index 稳；删 header 后 i 漂移
             会让 input 复用串数据（旧 row 的 value 出现在新 row）-->
        <div v-for="(entry, i) in Object.entries(s.headers)" :key="entry[0]" class="kv-row">
          <input
            :value="entry[0]"
            @change="onHeaderKeyChange(s, i, ($event.target as HTMLInputElement).value)"
            placeholder="Header-Name"
          />
          <input
            :value="entry[1]"
            @input="onHeaderValChange(s, i, ($event.target as HTMLInputElement).value)"
            placeholder="value"
          />
          <button
            class="moo-btn moo-btn--sm"
            :aria-label="`移除 Header ${entry[0]}`"
            @click="removeHeader(s, entry[0])"
          >×</button>
        </div>
        <button class="moo-btn moo-btn--sm" @click="addHeader(s)">+ 添加 Header</button>
      </div>
      <div class="row">
        <label>图片字段</label>
        <input v-model="s.imageField" class="narrow" />
        <label>格式</label>
        <select v-model="s.imageFormat" class="narrow">
          <option value="base64">base64 (JSON)</option>
          <option value="multipart">multipart</option>
        </select>
      </div>
      <div class="row template-row-head">
        <label>Payload 模板</label>
        <button class="moo-btn moo-btn--sm" type="button" @click="openTemplateEditor(s)">
          ⤢ 大尺寸编辑
        </button>
      </div>
      <textarea v-model="s.payloadTemplate" class="template" rows="8" />
      <div class="tpl-hint">
        可用变量：
        <code v-pre>{{title}}</code>
        <code v-pre>{{description}}</code>
        <code v-pre>{{url}}</code>
        <code v-pre>{{userAgent}}</code>
        <code v-pre>{{viewport}}</code>
        <code v-pre>{{timestamp}}</code>
        <code v-pre>{{image}}</code>
        <code v-pre>{{requestsJson}}</code>
        <code v-pre>{{errorsJson}}</code>
      </div>
    </div>

    <PayloadEditorModal
      v-if="editingTemplate"
      :model-value="editingTemplate.server.payloadTemplate"
      @save="onTemplateSave"
      @cancel="editingTemplate = null"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Project } from '@/types/config'
import { useServerCrud } from '@/composables/useServerCrud'
import { confirmDialog } from '../components/confirm'
import PayloadEditorModal from '../components/PayloadEditorModal.vue'

const props = defineProps<{
  /** v-model 双向 — 子组件 mutate modelValue.servers / modelValue.token 直接生效；父 watch(draft) 触发 autoSave */
  modelValue: Project
  /** Token 输入框可见性 v-model（眼睛按钮切换；录屏/演示场景默认遮罩） */
  tokenVisible: boolean
}>()

const emit = defineEmits<{
  (e: 'update:tokenVisible', v: boolean): void
}>()

// useServerCrud 期望 activeProject 是 Ref<Project | undefined>，computed 包一层让 undefined 兼容。
// props 本身 reactive，computed getter 内直接读 props.modelValue 即可（toRef 之前是 antipattern：
// 每次 access new ref 立即解引用纯浪费 — general-purpose review 提的 minor）
const activeProject = computed<Project | undefined>(() => props.modelValue)

const {
  editingTemplate,
  openTemplateEditor,
  onTemplateSave,
  addServer,
  removeServer,
  onHeaderKeyChange,
  onHeaderValChange,
  addHeader,
  removeHeader
} = useServerCrud({ activeProject, confirmDialog })
</script>

<style scoped>
/* 子组件 scoped CSS：把原本依赖 Environment.vue scoped 的表单 / 服务器卡 / kv-list 样式
   复制一份到本组件，确保拆出后视觉无变化 */

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
.row .narrow { flex: 0 0 130px; }
.row .grow   { flex: 1; }
.row .method { flex: 0 0 90px; }

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

.token-input {
  flex: 1;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.token-input input { font-family: var(--moo-ff-mono); }
.token-toggle {
  flex: 0 0 28px;
  height: 28px;
  border: 1px solid var(--moo-c-border);
  background: var(--moo-c-bg);
  border-radius: var(--moo-r-md);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0;
  transition: background-color var(--moo-motion-fast), border-color var(--moo-motion-fast);
}
.token-toggle:hover { background: var(--moo-c-bg-soft); border-color: var(--moo-c-text-faint); }

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

.server-empty-warn {
  margin: 8px 0 12px;
  padding: 10px 12px;
  background: var(--moo-c-warn-soft);
  border: 1px solid var(--moo-c-warn);
  border-radius: var(--moo-r-md);
  color: var(--moo-c-warn-fg);
  font-size: var(--moo-fs-sm);
  line-height: 1.5;
}

.server-card {
  border: 1px solid var(--moo-c-border);
  border-radius: var(--moo-r-lg);
  padding: 14px;
  margin-bottom: 14px;
  background: var(--moo-c-bg-soft);
}

.kv-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 4px 0 10px;
}
.kv-row { display: flex; gap: 8px; align-items: center; }
.kv-row input {
  flex: 1;
  height: 26px;
  font-size: var(--moo-fs-sm);
  padding: 0 8px;
  border: 1px solid var(--moo-c-border);
  border-radius: var(--moo-r-md);
  background: var(--moo-c-bg);
  color: var(--moo-c-text);
  font-family: var(--moo-ff-mono);
  min-width: 0;
}
.kv-row input:focus {
  outline: none;
  border-color: var(--moo-c-brand);
  box-shadow: 0 0 0 3px var(--moo-c-focus-ring);
}

.template-row-head {
  align-items: center;
}
.template-row-head label { flex: 1; min-width: 0; }

.template {
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
.template:focus {
  outline: none;
  border-color: var(--moo-c-brand);
  box-shadow: 0 0 0 3px var(--moo-c-focus-ring);
}
</style>
