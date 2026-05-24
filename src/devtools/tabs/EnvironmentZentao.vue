<template>
  <div class="zentao-form">
    <div class="section-head">
      <h4>禅道接入</h4>
    </div>
    <div class="row">
      <label>禅道地址</label>
      <input
        v-model="z.baseUrl"
        placeholder="https://your-zentao.example.net"
        class="grow"
        autocomplete="off"
        spellcheck="false"
      />
    </div>
    <div class="row">
      <label>账号</label>
      <input
        v-model="z.account"
        placeholder="禅道账号（同浏览器登录用的）"
        class="grow"
        autocomplete="off"
        spellcheck="false"
      />
    </div>
    <div class="row">
      <label>密码</label>
      <div class="token-input">
        <input
          v-model="z.password"
          :type="pwdVisible ? 'text' : 'password'"
          placeholder="禅道密码（本地存 chrome.storage.local，不上云不传同事）"
          autocomplete="off"
          spellcheck="false"
          class="grow"
        />
        <button
          type="button"
          class="token-toggle"
          :aria-label="pwdVisible ? '隐藏密码' : '显示密码'"
          :title="pwdVisible ? '隐藏' : '显示'"
          @click="emit('update:pwdVisible', !pwdVisible)"
        >{{ pwdVisible ? '🙈' : '👁' }}</button>
      </div>
    </div>
    <div class="row">
      <button
        class="moo-btn moo-btn--sm"
        :disabled="!!zentao.busy.value || !zentao.canCall.value"
        :title="zentao.canCall.value ? '调禅道 /login + /user 接口验证账号' : '先填齐地址 / 账号 / 密码'"
        @click="zentao.testConnection"
      >{{ zentao.busy.value === 'test' ? '测试中…' : '测试连接' }}</button>
      <button
        class="moo-btn moo-btn--sm"
        :disabled="!!zentao.busy.value || !zentao.canCall.value"
        :title="zentao.canCall.value ? '调禅道 /api.php/v2/projects（用户列表/模块列表在 SubmitDialog 里拉）' : '先填齐地址 / 账号 / 密码'"
        @click="zentao.loadProjects"
      >📋 拉项目列表</button>
      <span v-if="zentao.status.value" :class="['zentao-status', zentao.statusKind.value]">{{ zentao.status.value }}</span>
    </div>

    <div class="row" v-if="zentao.projectsList.value.length">
      <label>选项目</label>
      <select v-model.number="z.projectId" class="grow">
        <option :value="0">— 从下面选一个 —</option>
        <option v-for="p in zentao.projectsList.value" :key="p.id" :value="p.id">
          {{ p.name }}（#{{ p.id }}{{ p.status === 'closed' ? ' 已关闭' : '' }}）
        </option>
      </select>
    </div>
    <div class="row">
      <label>项目 ID</label>
      <input v-model.number="z.projectId" type="number" min="1" class="narrow" />
    </div>
    <div class="row">
      <label>模块 ID</label>
      <input v-model.number="z.moduleId" type="number" min="0" class="narrow" />
      <span class="tpl-hint">通常填 0（默认模块）</span>
    </div>

    <div class="zentao-defaults">
      <div class="zentao-defaults-title">提交默认值（每条 bug 提交时可单独改）</div>
      <div class="row">
        <label>类型</label>
        <select v-model="z.defaultType" class="narrow">
          <option v-for="t in ZENTAO_TYPE_OPTIONS" :key="t.value" :value="t.value">{{ t.label }}</option>
        </select>
        <span class="tpl-hint">禅道 bug type 字段</span>
      </div>
      <div class="row">
        <label>严重度</label>
        <select v-model.number="z.defaultSeverity" class="narrow">
          <option v-for="s in ZENTAO_SEVERITY_OPTIONS" :key="s.value" :value="s.value">{{ s.label }}</option>
        </select>
      </div>
      <div class="row">
        <label>优先级</label>
        <select v-model.number="z.defaultPri" class="narrow">
          <option v-for="p in ZENTAO_PRI_OPTIONS" :key="p.value" :value="p.value">{{ p.label }}</option>
        </select>
      </div>
      <div class="row">
        <label>默认关键词</label>
        <input
          v-model="z.defaultKeywords"
          placeholder="禅道搜索框输此字符可找到所有 Moo 上报的 bug"
          class="grow"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Project, ZentaoProjectConfig } from '@/types/config'
import { ZENTAO_TYPE_OPTIONS, ZENTAO_SEVERITY_OPTIONS, ZENTAO_PRI_OPTIONS } from '@/utils/zentaoOptions'
import { useZentaoEnvironment } from '@/composables/useZentaoEnvironment'

const props = defineProps<{
  /** v-model 双向 — 子组件直接 mutate modelValue.zentao.* 字段；父 watch(draft, deep) 触发 autoSave */
  modelValue: Project
  /** 密码可见性 v-model（与父组件 webhook token 的可见性独立） */
  pwdVisible: boolean
}>()

const emit = defineEmits<{
  /** v-model:pwdVisible 双向绑定的 update 事件 */
  (e: 'update:pwdVisible', v: boolean): void
}>()

/** 子组件假设父组件已保证 modelValue.kind === 'zentao' 且 modelValue.zentao 已存在 —
 *  父组件 watch(activeProject.kind) 在 kind 切到 zentao 时用 DEFAULT_ZENTAO 初始化 zentao 字段。
 *  这里用 ! 而非可空：让 template 简洁，违反时 dev 立即报错而不是静默漏字段。 */
const z = computed<ZentaoProjectConfig>(() => props.modelValue.zentao!)

// 凭证操作 + 测试连接 + 拉项目列表 + 凭证变化清 SW token cache 都在 composable 里
const zentao = useZentaoEnvironment({
  zentao: computed(() => props.modelValue.zentao),
  activeProjectId: computed(() => props.modelValue.id),
  activeKind: computed(() => props.modelValue.kind)
})
</script>

<style scoped>
/* 这里只放 zentao 子表单独有的样式；表单行（.row / label / input） + .section-head /
   .tpl-hint / .token-input / .token-toggle / .narrow / .grow / 通用按钮等都依赖
   Environment.vue 父级提供的 scoped CSS — 子组件的 root 元素 .zentao-form 被父
   scoped CSS 命中后内部 .row 等也命中（Vue scoped 是 attribute selector，不切断
   后代）。但保险起见把子组件自己 *新增* 的样式 scoped 在这里。 */

.zentao-status {
  font-size: var(--moo-fs-xs);
  font-family: var(--moo-ff-mono);
  margin-left: 8px;
}
.zentao-status.ok { color: var(--moo-c-success-fg); }
.zentao-status.err { color: var(--moo-c-danger-fg); }
.zentao-defaults {
  margin-top: 12px;
  padding: 10px 12px 4px;
  border: 1px solid var(--moo-c-border);
  border-radius: var(--moo-r-md);
  background: var(--moo-c-bg-elev);
}
.zentao-defaults-title {
  font-size: var(--moo-fs-sm);
  color: var(--moo-c-text);
  margin-bottom: 8px;
  font-weight: 500;
}

/* 表单内通用样式（之前在 Environment.vue scoped 里）。
   原本 .row / .row label / .row input / .row select / .narrow / .grow / .section-head /
   .tpl-hint / .token-input / .token-toggle 都依赖父级 scoped；
   拆成子组件后父级 scoped attr 不再命中这些 selector，所以同款样式复制一份到子组件 scoped。 */

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

.tpl-hint {
  font-size: var(--moo-fs-xs);
  color: var(--moo-c-text-muted);
  margin-top: 6px;
  line-height: 1.6;
}
</style>
