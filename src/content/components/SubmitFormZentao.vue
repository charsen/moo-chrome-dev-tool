<template>
  <!-- 上报目标 + cookie 状态条 -->
  <div class="moo-form-row">
    <label>上报到</label>
    <div class="server-pick">
      <div class="zentao-target">
        <span class="zentao-target-tag">禅道</span>
        <span class="zentao-target-base">{{ z?.baseUrl || '(未填地址)' }}</span>
        <span class="zentao-target-pid">项目 #{{ z?.projectId || '?' }}</span>
      </div>
      <div v-if="missingList" class="server-warn">
        ⚠ 禅道配置不完整，缺：{{ missingList }}。<br>
        请打开 <b>DevTools → Moo → 环境</b>，把缺的字段填上后再回来提交。
      </div>
      <div
        v-else-if="cookieState === 'unknown'"
        class="zentao-cookie-row checking"
      >
        <span>⏳ 正在检查禅道登录状态…</span>
      </div>
      <div
        v-else
        :class="['zentao-cookie-row', cookieState === 'ok' ? 'ok' : 'fail']"
      >
        <span>{{ cookieMsg }}</span>
        <a
          v-if="cookieState === 'fail' && z?.baseUrl"
          class="moo-btn small"
          :href="z.baseUrl"
          target="_blank"
          rel="noopener noreferrer"
        >打开禅道登录</a>
        <button
          v-if="cookieState === 'fail'"
          type="button"
          class="moo-btn small ghost"
          @click="pingCookie"
        >重新检查</button>
      </div>
    </div>
  </div>

  <!-- 类型 / 严重度 / 优先级 + 模块 + 指派给（仅配置完整时显示） -->
  <template v-if="!missingList">
    <div class="moo-form-row moo-zentao-fields">
      <label>分级</label>
      <div class="moo-zentao-row">
        <select
          :value="modelValue.zentaoType"
          class="zentao-field"
          @change="emitField('zentaoType', ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="t in ZENTAO_TYPE_OPTIONS" :key="t.value" :value="t.value">类型：{{ t.label }}</option>
        </select>
        <select
          :value="modelValue.zentaoSeverity"
          class="zentao-field"
          @change="emitField('zentaoSeverity', Number(($event.target as HTMLSelectElement).value) as 1|2|3|4)"
        >
          <option v-for="s in ZENTAO_SEVERITY_OPTIONS" :key="s.value" :value="s.value">严重度 {{ s.label }}</option>
        </select>
        <select
          :value="modelValue.zentaoPri"
          class="zentao-field"
          @change="emitField('zentaoPri', Number(($event.target as HTMLSelectElement).value) as 1|2|3|4)"
        >
          <option v-for="p in ZENTAO_PRI_OPTIONS" :key="p.value" :value="p.value">优先级 {{ p.label }}</option>
        </select>
      </div>
    </div>

    <div class="moo-form-row">
      <label for="moo-zentao-module">所属模块</label>
      <div class="zentao-assignee-pick">
        <select
          id="moo-zentao-module"
          :value="modelValue.zentaoModuleId"
          class="grow"
          :disabled="modulesLoading"
          @change="emitField('zentaoModuleId', Number(($event.target as HTMLSelectElement).value))"
        >
          <option :value="0">— 根模块（/）—</option>
          <option v-if="modulesLoading" disabled>正在拉模块列表…</option>
          <option v-for="m in modules" :key="m.id" :value="m.id">
            {{ m.path || m.name }}
          </option>
        </select>
        <button
          class="moo-btn zentao-assignee-refresh"
          type="button"
          :disabled="modulesLoading"
          :title="modules.length ? '重新拉模块列表' : '拉禅道模块列表'"
          @click="loadModules"
        >{{ modulesLoading ? '...' : (modules.length ? '↻' : '拉列表') }}</button>
      </div>
      <div v-if="modulesError" class="zentao-list-err">
        ⚠ 拉模块列表失败：{{ modulesError }}
      </div>
    </div>

    <div class="moo-form-row">
      <label for="moo-zentao-assignee">指派给</label>
      <div class="zentao-assignee-pick">
        <select
          id="moo-zentao-assignee"
          :value="modelValue.zentaoAssignedTo"
          class="grow"
          :disabled="usersLoading"
          @change="emitField('zentaoAssignedTo', ($event.target as HTMLSelectElement).value)"
        >
          <option value="">— 未指派（按项目规则自动分派）—</option>
          <option v-if="usersLoading" disabled>正在拉用户列表…</option>
          <option v-for="u in users" :key="u.account" :value="u.account">
            {{ u.realname }}（{{ u.account }}{{ u.role ? ` · ${u.role}` : '' }}）
          </option>
        </select>
        <button
          class="moo-btn zentao-assignee-refresh"
          type="button"
          :disabled="usersLoading"
          :title="users.length ? '重新拉用户列表' : '拉禅道用户列表'"
          @click="loadUsers"
        >{{ usersLoading ? '...' : (users.length ? '↻' : '拉列表') }}</button>
      </div>
      <div v-if="usersError" class="zentao-list-err">
        ⚠ 拉用户列表失败：{{ usersError }}（留空也能提交，按禅道项目规则自动分派）
      </div>
    </div>
  </template>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { Project } from '@/types/config'
import { MSG, type ZentaoListUsersRes, type ZentaoListModulesRes, type ZentaoPingCookieRes } from '@/types/messages'
import { ZENTAO_TYPE_OPTIONS, ZENTAO_SEVERITY_OPTIONS, ZENTAO_PRI_OPTIONS } from '@/utils/zentaoOptions'
import { safeSendMessage } from '@/utils/messaging'
import type { ZentaoFormFields } from './SubmitFormZentao.types'

const props = defineProps<{
  modelValue: ZentaoFormFields
  project: Project
  /** 缺字段清单（父算出来，因为 canSubmit / 录像超限等也用得到） */
  missingList: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: ZentaoFormFields): void
  /** cookie 预检结果给父用来 gate canSubmit。'unknown' 期间父也禁用提交。 */
  (e: 'update:cookieState', state: 'unknown' | 'ok' | 'fail'): void
}>()

const z = computed(() => props.project.zentao)

function emitField<K extends keyof ZentaoFormFields>(key: K, value: ZentaoFormFields[K]) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}

// ---------- cookie 预检 ----------
const cookieState = ref<'unknown' | 'ok' | 'fail'>('unknown')
const cookieMsg = ref('')
async function pingCookie() {
  const zz = z.value
  if (!zz?.baseUrl) return
  cookieState.value = 'unknown'
  emit('update:cookieState', 'unknown')
  cookieMsg.value = '正在登录禅道…'
  try {
    const res = await safeSendMessage<ZentaoPingCookieRes>({
      type: MSG.ZENTAO_PING_COOKIE,
      source: 'content',
      payload: { baseUrl: zz.baseUrl, account: zz.account, password: zz.password }
    })
    if (res?.ok) {
      cookieState.value = 'ok'
      cookieMsg.value = `✓ 已登录禅道（${res.realname ?? '未知用户'}）`
    } else {
      cookieState.value = 'fail'
      cookieMsg.value = res?.error ?? '禅道登录失败'
    }
  } catch (e) {
    cookieState.value = 'fail'
    cookieMsg.value = (e as Error).message
  }
  emit('update:cookieState', cookieState.value)
}

// ---------- 模块列表 ----------
const modules = ref<NonNullable<ZentaoListModulesRes['modules']>>([])
const modulesLoading = ref(false)
const modulesError = ref('')
async function loadModules() {
  const zz = z.value
  if (!zz?.baseUrl || !zz.account || !zz.password || !zz.projectId) return
  modulesLoading.value = true
  modulesError.value = ''
  try {
    const res = await safeSendMessage<ZentaoListModulesRes>({
      type: MSG.ZENTAO_LIST_MODULES,
      source: 'content',
      payload: { baseUrl: zz.baseUrl, account: zz.account, password: zz.password, projectId: zz.projectId }
    })
    if (res?.ok && res.modules) {
      modules.value = res.modules
    } else if (res && !res.ok) {
      modulesError.value = res.error ?? '未知错误'
    }
  } catch (e) {
    modulesError.value = (e as Error).message
  } finally {
    modulesLoading.value = false
  }
}

// ---------- 用户列表 ----------
const users = ref<NonNullable<ZentaoListUsersRes['users']>>([])
const usersLoading = ref(false)
const usersError = ref('')
async function loadUsers() {
  usersError.value = ''
  const zz = z.value
  if (!zz?.baseUrl || !zz.account || !zz.password) return
  usersLoading.value = true
  try {
    const res = await safeSendMessage<ZentaoListUsersRes>({
      type: MSG.ZENTAO_LIST_USERS,
      source: 'content',
      // v0.8.9：带 projectId → BG 能 discoverProduct，给「建单页视图数据」tier-3 兜底用
      // （普通账号 v2/v1 users 是权限墙，没这层就只有产品/管理类账号拉得到指派人列表）
      payload: { baseUrl: zz.baseUrl, account: zz.account, password: zz.password, projectId: zz.projectId }
    })
    if (res?.ok && res.users) {
      users.value = res.users
    } else if (res && !res.ok) {
      usersError.value = res.error ?? '未知错误'
    }
  } catch (e) {
    usersError.value = (e as Error).message
  } finally {
    usersLoading.value = false
  }
}

// ---------- mount: 配置完整时预拉一次 + 每 2 分钟复查 cookie ----------
let cookieRecheckTimer: number | undefined
onMounted(() => {
  if (!props.missingList) {
    void pingCookie()
    void loadUsers()
    void loadModules()
    // 长时间挂着 dialog 时 cookie 真过期，避免一直显示「✓ 已登录禅道」骗用户提交后才发现错
    cookieRecheckTimer = window.setInterval(() => {
      if (cookieState.value === 'ok') void pingCookie()
    }, 2 * 60_000)
  }
})

onBeforeUnmount(() => {
  if (cookieRecheckTimer) clearInterval(cookieRecheckTimer)
})
</script>
