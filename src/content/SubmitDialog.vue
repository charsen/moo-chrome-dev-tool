<template>
  <ElementPicker v-if="picking" @pick="onElementPicked" @cancel="picking = false" />

  <MooDialog
    v-show="!picking"
    :title="`提交 Bug — ${project.name}`"
    labelled-by="moo-submit-title"
    initial-focus="container"
    @close="onMaskClick"
  >
      <!-- 提交成功内嵌反馈：取代 toast 一闪而过的反馈方式 -->
      <div v-if="successInfo" class="moo-submit-success">
        <div class="moo-success-icon" aria-hidden="true">✓</div>
        <div class="moo-success-title">提交成功</div>
        <div v-if="successInfo.remoteId" class="moo-success-id">
          已记录为 <code>#{{ successInfo.remoteId }}</code>
        </div>
        <a
          v-if="successInfo.viewUrl"
          class="moo-success-link"
          :href="successInfo.viewUrl"
          target="_blank"
          rel="noopener noreferrer"
        >禅道里看 →</a>
        <div class="moo-success-msg">{{ successInfo.message }}</div>
      </div>

      <div v-else class="moo-dialog-body">
        <!-- ① 标题（必填，置顶） -->
        <div class="moo-form-row">
          <label for="moo-title">标题 *</label>
          <input
            id="moo-title"
            ref="titleInput"
            v-model="title"
            placeholder="一句话描述问题"
          />
        </div>

        <!-- ② 描述 -->
        <div class="moo-form-row">
          <label for="moo-desc">描述</label>
          <textarea id="moo-desc" v-model="description" rows="3" placeholder="复现步骤、预期、实际…" />
        </div>

        <!-- ③ 截图缩略 -->
        <div class="moo-form-row" v-if="image">
          <label>截图</label>
          <div class="moo-thumb-wrap">
            <img class="moo-thumb moo-thumb--sm" :src="image" alt="截图预览" />
            <div class="moo-thumb-overlay">
              <button class="moo-thumb-action" type="button" @click="onReannotate">
                <span aria-hidden="true">✎</span> 重新标注
              </button>
              <button class="moo-thumb-action" type="button" @click="onRecapture">
                <span aria-hidden="true">🔄</span> 重新截图
              </button>
            </div>
          </div>
        </div>

        <!-- ④ 录像 -->
        <div class="moo-form-row" v-if="video">
          <label>录像</label>
          <div class="req-panel">
            <video class="moo-video-preview" :src="videoBlobUrl" controls preload="metadata" />
            <div class="req-controls" style="border-top: 1px solid var(--c-divider); border-bottom: 0;">
              <span class="req-hint">已录制 {{ fmtDuration(video.duration) }} · {{ fmtBytes(video.bytes) }}</span>
            </div>
          </div>
        </div>

        <!-- ⑤ 上报目标：kind 分支 —— zentao 显示禅道信息行，webhook 显示原 server 选择 -->
        <div class="moo-form-row" v-if="kind === 'zentao'">
          <label>上报到</label>
          <div class="server-pick">
            <div class="zentao-target">
              <span class="zentao-target-tag">禅道</span>
              <span class="zentao-target-base">{{ project.zentao?.baseUrl || '(未填地址)' }}</span>
              <span class="zentao-target-pid">项目 #{{ project.zentao?.projectId || '?' }}</span>
            </div>
            <div v-if="zentaoMissingList" class="server-warn">
              ⚠ 禅道配置不完整，缺：{{ zentaoMissingList }}。<br>
              请打开 <b>DevTools → Moo → 环境</b>，把缺的字段填上后再回来提交。
            </div>
            <!-- cookie 预检状态：依赖用户在浏览器登录禅道。失败时给「一键打开禅道」 -->
            <div
              v-else-if="zentaoCookieState !== 'unknown'"
              :class="['zentao-cookie-row', zentaoCookieState === 'ok' ? 'ok' : 'fail']"
            >
              <span>{{ zentaoCookieMsg }}</span>
              <a
                v-if="zentaoCookieState === 'fail' && project.zentao?.baseUrl"
                class="moo-btn small"
                :href="project.zentao.baseUrl"
                target="_blank"
                rel="noopener noreferrer"
              >打开禅道登录</a>
              <button
                v-if="zentaoCookieState === 'fail'"
                type="button"
                class="moo-btn small ghost"
                @click="pingZentaoCookie"
              >重新检查</button>
            </div>
          </div>
        </div>

        <!-- ⑤.0 录像太大警告（zentao 50M 上限） -->
        <div v-if="videoTooBigForZentao" class="moo-form-row">
          <label></label>
          <div class="server-warn">
            ⚠ 录像 {{ (video!.bytes / 1024 / 1024).toFixed(1) }} MB 超过禅道附件上限（{{ ZENTAO_MAX_ATTACHMENT_MB }} MB）。<br>
            提交后 bug 主体能建，但录像附件会失败上传，禅道里只能看到「⚠️ 附件上传失败」提示。可考虑重录一个短的。
          </div>
        </div>

        <!-- ⑤.1 禅道字段：每条 bug 可改的 type / severity / pri / assignedTo -->
        <template v-if="kind === 'zentao' && !zentaoMissingList">
          <div class="moo-form-row moo-zentao-fields">
            <label>分级</label>
            <div class="moo-zentao-row">
              <select v-model="zentaoType" class="zentao-field">
                <option v-for="t in ZENTAO_TYPE_OPTIONS" :key="t.value" :value="t.value">类型：{{ t.label }}</option>
              </select>
              <select v-model.number="zentaoSeverity" class="zentao-field">
                <option v-for="s in ZENTAO_SEVERITY_OPTIONS" :key="s.value" :value="s.value">严重度 {{ s.label }}</option>
              </select>
              <select v-model.number="zentaoPri" class="zentao-field">
                <option v-for="p in ZENTAO_PRI_OPTIONS" :key="p.value" :value="p.value">优先级 {{ p.label }}</option>
              </select>
            </div>
          </div>
          <div class="moo-form-row">
            <label for="moo-zentao-module">所属模块</label>
            <div class="zentao-assignee-pick">
              <select id="moo-zentao-module" v-model.number="zentaoModuleId" class="grow">
                <option :value="0">— 根模块（/）—</option>
                <option v-for="m in zentaoModules" :key="m.id" :value="m.id">
                  {{ m.path || m.name }}
                </option>
              </select>
              <button
                class="moo-btn zentao-assignee-refresh"
                type="button"
                :disabled="zentaoModulesLoading"
                :title="zentaoModules.length ? '重新拉模块列表' : '拉禅道模块列表'"
                @click="loadZentaoModules"
              >{{ zentaoModulesLoading ? '...' : (zentaoModules.length ? '↻' : '拉列表') }}</button>
            </div>
          </div>
          <div class="moo-form-row">
            <label for="moo-zentao-assignee">指派给</label>
            <div class="zentao-assignee-pick">
              <select id="moo-zentao-assignee" v-model="zentaoAssignedTo" class="grow">
                <option value="">— 未指派（按项目规则自动分派）—</option>
                <option v-for="u in zentaoUsers" :key="u.account" :value="u.account">
                  {{ u.realname }}（{{ u.account }}{{ u.role ? ` · ${u.role}` : '' }}）
                </option>
              </select>
              <button
                class="moo-btn zentao-assignee-refresh"
                type="button"
                :disabled="zentaoUsersLoading"
                :title="zentaoUsers.length ? '重新拉用户列表' : '拉禅道用户列表'"
                @click="loadZentaoUsers"
              >{{ zentaoUsersLoading ? '...' : (zentaoUsers.length ? '↻' : '拉列表') }}</button>
            </div>
          </div>
        </template>
        <div class="moo-form-row" v-else-if="showServerRow">
          <label for="moo-server">服务器</label>
          <div class="server-pick">
            <select id="moo-server" v-model="serverId">
              <option v-if="!project.servers.length" disabled value="">还没有上报服务器 —— 请先到 DevTools → Moo → 环境 → 新建一个</option>
              <option v-for="s in project.servers" :key="s.id" :value="s.id">
                {{ s.name }} — {{ s.endpoint || '（尚未填请求 URL）' }}
              </option>
            </select>
            <div v-if="serverEndpointMissing" class="server-warn">
              ⚠ 服务器「{{ currentServer?.name }}」还没填请求 URL，提交会失败。<br>
              请打开 <b>DevTools → Moo → 环境</b>，找到这个服务器，在「请求 URL」那一行填上后端地址（比如 <code>http://localhost:3000/bugs</code>），然后回来点提交。
            </div>
          </div>
        </div>

        <!-- ⑥ 附件折叠组：请求 / 错误 / 元素 -->
        <details class="moo-attach" open>
          <summary class="moo-attach-hd">
            <span class="moo-attach-chev" aria-hidden="true">▸</span>
            <span class="moo-attach-title">附带请求</span>
            <span class="moo-attach-count">{{ selectedIds.size }} / {{ filtered.length }}</span>
          </summary>
          <div class="moo-attach-bd">
            <div class="req-panel">
              <div class="req-controls">
                <select v-model.number="windowMs" class="req-window" aria-label="时间窗口">
                  <option :value="5000">最近 5s</option>
                  <option :value="15000">最近 15s</option>
                  <option :value="30000">最近 30s</option>
                  <option :value="60000">最近 60s</option>
                  <option :value="-1">全部</option>
                </select>
                <input v-model="urlFilter" placeholder="按 URL 过滤" class="req-filter" />
                <button class="moo-btn small" @click="selectAll">全选</button>
                <button class="moo-btn small" @click="selectNone">清空</button>
              </div>
              <div class="req-list" v-if="filtered.length">
                <div v-for="r in filtered" :key="r.id" class="req-row">
                  <label :class="['req-item', failClass(r.status)]">
                    <input type="checkbox" :checked="selectedIds.has(r.id)" @change="toggle(r.id)" />
                    <span :class="['method', String(r.method ?? '').toLowerCase()]">{{ r.method }}</span>
                    <span :class="['status', statusClass(r.status)]">{{ r.status || 'ERR' }}</span>
                    <span class="url" :title="r.url">{{ shortUrl(r.url) }}</span>
                    <span :class="['dur', durClass(r.duration)]">{{ Math.round(r.duration) }}ms</span>
                    <button
                      type="button"
                      class="req-expand-btn"
                      :title="expandedReqIds.has(r.id) ? '收起详情' : '展开请求/响应详情'"
                      @click.prevent.stop="toggleExpand(r.id)"
                    >{{ expandedReqIds.has(r.id) ? '▾' : '▸' }}</button>
                  </label>
                  <div v-if="expandedReqIds.has(r.id)" class="req-detail">
                    <div class="req-detail-row">
                      <span class="req-detail-label">URL</span>
                      <span class="req-detail-value">{{ r.url }}</span>
                    </div>
                    <div class="req-detail-row" v-if="r.requestBody">
                      <span class="req-detail-label">Request Body</span>
                      <pre class="req-detail-body">{{ previewBody(r.requestBody) }}</pre>
                    </div>
                    <div class="req-detail-row" v-if="r.responseBody">
                      <span class="req-detail-label">Response Body <em>({{ fmtBytes(r.responseSizeBytes) }})</em></span>
                      <pre class="req-detail-body">{{ previewBody(r.responseBody) }}</pre>
                    </div>
                    <div class="req-detail-row" v-if="r.error">
                      <span class="req-detail-label">Error</span>
                      <span class="req-detail-error">{{ r.error }}</span>
                    </div>
                    <div v-if="!r.requestBody && !r.responseBody && !r.error" class="req-detail-empty">
                      （无 body / 错误信息可显示 —— 可能是 GET 请求 / 二进制响应 / 仍在进行中）
                    </div>
                  </div>
                </div>
              </div>
              <div v-else class="req-empty">
                <div>当前时间窗口内没有可附带的请求。</div>
                <div class="req-empty-hint">
                  如果你刚装好扩展或刚改完配置，刷新一下页面再操作即可。
                </div>
              </div>
            </div>
          </div>
        </details>

        <details class="moo-attach" v-if="errors.length">
          <summary class="moo-attach-hd">
            <span class="moo-attach-chev" aria-hidden="true">▸</span>
            <span class="moo-attach-title">附带错误</span>
            <span class="moo-attach-count">{{ selectedErrIds.size }} / {{ errors.length }}</span>
          </summary>
          <div class="moo-attach-bd">
            <div class="req-panel">
              <div class="req-list">
                <label v-for="e in reversedErrors" :key="e.id" class="req-item">
                  <input type="checkbox" :checked="selectedErrIds.has(e.id)" @change="toggleErr(e.id)" />
                  <span
                    :class="['status', e.level === 'console' ? 'warn' : 'err']"
                    :title="errLevelTitle(e.level)"
                  >
                    {{ errLevelLabel(e.level) }}
                  </span>
                  <span class="url" :title="e.message">{{ e.message }}</span>
                </label>
              </div>
            </div>
          </div>
        </details>

        <details class="moo-attach">
          <summary class="moo-attach-hd">
            <span class="moo-attach-chev" aria-hidden="true">▸</span>
            <span class="moo-attach-title">附带元素</span>
            <span class="moo-attach-count">{{ pickedElements.length }} 个</span>
          </summary>
          <div class="moo-attach-bd">
            <div class="req-panel">
              <div class="req-controls">
                <button class="moo-btn small" @click="picking = true">📍 选元素</button>
                <button
                  v-if="pickedElements.length"
                  :class="['moo-btn', 'small', { 'is-confirming': clearElementsConfirming }]"
                  @click="onClearElementsClick"
                >{{ clearElementsConfirming ? '再点一下确认清空' : '清空' }}</button>
                <span class="req-hint" v-if="!pickedElements.length">点击"选元素"，在页面上指定 bug 涉及的具体 DOM</span>
              </div>
              <div v-if="pickedElements.length" class="req-list">
                <div v-for="(el, i) in pickedElements" :key="i" class="req-item el-item">
                  <span class="method" :title="'tag: ' + el.tag">{{ el.tag }}</span>
                  <span class="url" :title="el.selector">{{ el.selector }}</span>
                  <MooCloseBtn aria-label="移除此元素" @click="pickedElements.splice(i, 1)" />
                </div>
              </div>
            </div>
          </div>
        </details>

        <!-- ⑦ 预览请求体（仅展开后显示） -->
        <div class="moo-form-row" v-if="preview">
          <label>预览</label>
          <pre class="moo-preview">{{ preview }}</pre>
        </div>
      </div>
      <!-- 失败横幅：成功视图期间隐藏；toast 是一次性的，这里持久指示让用户清楚状态。
           不带操作按钮——footer 的「重试」按钮 ⌘↵ 已经是主操作位，重复一个会显得冗余 -->
      <div v-if="!successInfo && failureInfo" class="moo-submit-fail" role="alert">
        <div class="moo-submit-fail-head">
          <span class="moo-submit-fail-icon" aria-hidden="true">⚠</span>
          <span class="moo-submit-fail-title">提交失败</span>
          <button
            class="moo-submit-fail-dismiss"
            type="button"
            aria-label="关闭失败提示"
            @click="failureInfo = null"
          >×</button>
        </div>
        <div class="moo-submit-fail-msg">{{ failureInfo.message }}</div>
        <div v-if="failureInfo.cannotAutoRetry" class="moo-submit-fail-hint">
          这条带录像，body 太大没法进自动重试队列。<b>关闭此窗口后，只能去 DevTools → Moo → 历史 找到这条记录手动「重新提交」</b>。
        </div>
      </div>
      <footer v-if="!successInfo" class="moo-dialog-foot">
        <button class="moo-btn" @click="emit('cancel')">取消 <span class="kbd-hint">Esc</span></button>
        <button v-if="kind === 'webhook'" class="moo-btn ghost" :disabled="!canPreview || previewing" @click="onPreview">
          {{ previewing ? '预览中…' : '预览请求体' }}
        </button>
        <button class="moo-btn primary" :disabled="!canSubmit || submitting" @click="onSubmit">
          {{ submitting ? '提交中…' : (failureInfo ? '重试' : '提交') }} <span class="kbd-hint">⌘↵</span>
        </button>
      </footer>
  </MooDialog>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Project } from '@/types/config'
import type { CapturedRequest } from '@/types/requests'
import type { ConsoleError } from '@/types/errors'
import { MSG, type PreviewPayloadReq, type PreviewPayloadRes, type SubmitBugReq, type SubmitBugRes, type ZentaoListUsersRes, type ZentaoListModulesRes, type ZentaoPingCookieRes } from '@/types/messages'

import { ZENTAO_TYPE_OPTIONS, ZENTAO_SEVERITY_OPTIONS, ZENTAO_PRI_OPTIONS } from '@/utils/zentaoOptions'

/** 禅道 maxUploadSize 实测是 50M（manifest 里写死，普通账号无法改），保守取 49 MB */
const ZENTAO_MAX_ATTACHMENT_MB = 49

import { formatSubmitResult } from '@/utils/submitMessage'
import { safeSendMessage } from '@/utils/messaging'
// ElementPicker 只在用户点"选元素"按钮（picking=true）才挂载，默认根本不渲染。
// 异步拆 chunk 后 SubmitDialog 自身体积也跟着瘦——picker 只用全屏 overlay 那一下。
// PickedElement 类型仍按 type-only 静态导入，避免编译时依赖触发 chunk 合并。
// 真正的 defineAsyncComponent 放在 setup 内（onError 需要闭包 picking + emit）。
import type { PickedElement } from './ElementPicker.vue'
import MooCloseBtn from '@/components/MooCloseBtn.vue'
import MooDialog from './components/MooDialog.vue'
import type { RecordingResult } from './useRecorder'

const props = defineProps<{
  project: Project
  image?: string
  video?: RecordingResult | null
  requests: CapturedRequest[]
  errors: ConsoleError[]
}>()
const emit = defineEmits<{
  (e: 'cancel'): void
  (e: 'submitted', ok: boolean, message: string): void
  /** 退回 Annotator 用原始截图重新画一遍（ContentApp 负责切状态） */
  (e: 'reannotate'): void
  /** 丢弃当前截图，重新触发屏幕捕获（ContentApp 负责切状态） */
  (e: 'recapture'): void
  /** 异步子组件（ElementPicker）chunk 加载失败：扩展重载后老 hash 文件 404。
   *  自己没 toast，让 ContentApp 提示用户刷页。 */
  (e: 'async-load-failed', message: string): void
}>()

const title = ref('')
const description = ref('')

// video src 用 blob URL 代替 dataUrl：Chrome 给 <video src="data:...base64,..."> 有
// ~2MB 大小上限，1.9MB 的 webm 录像 base64 后 ~2.5MB 直接超限，video 元素显示
// 黑屏 0:00 但 controls 看着像正常的。blob URL 走 in-memory 引用，没有这个限制。
//
// ⚠ 不能用 `await fetch(dataUrl)` 转 blob：宿主页 CSP `connect-src 'self'` 不含
// data: scheme（实测 app.example.com 直接 "Failed to fetch"），catch 后回退到原
// dataUrl 又撞 video src 2MB 限制 → 黑屏。改 atob + Uint8Array 同步解析，
// 完全绕开 fetch，不受宿主 CSP 影响。代价：atob 几 MB base64 是同步的，
// 阻塞主线程几十 ms —— SubmitDialog 打开一次的开销可接受。
const videoBlobUrl = ref('')
function dataUrlToBlob(dataUrl: string): Blob | null {
  if (!dataUrl.startsWith('data:')) return null
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return null
  const header = dataUrl.slice(0, comma)
  const data = dataUrl.slice(comma + 1)
  const isB64 = /;base64$/i.test(header)
  const mime = header.slice(5).replace(/;base64$/i, '') || 'application/octet-stream'
  try {
    if (isB64) {
      const bin = atob(data)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      return new Blob([bytes], { type: mime })
    }
    return new Blob([decodeURIComponent(data)], { type: mime })
  } catch {
    return null
  }
}
watch(
  () => props.video?.dataUrl,
  (dataUrl, _old, onCleanup) => {
    const prev = videoBlobUrl.value
    onCleanup(() => { if (prev.startsWith('blob:')) URL.revokeObjectURL(prev) })
    if (!dataUrl) { videoBlobUrl.value = ''; return }
    const blob = dataUrlToBlob(dataUrl)
    if (blob) {
      videoBlobUrl.value = URL.createObjectURL(blob)
    } else {
      // 解析失败：小文件 dataUrl 还能直接给 video src 播
      videoBlobUrl.value = dataUrl
    }
  },
  { immediate: true }
)
onBeforeUnmount(() => {
  if (videoBlobUrl.value.startsWith('blob:')) {
    URL.revokeObjectURL(videoBlobUrl.value)
  }
})
const serverId = ref(props.project.defaultServerId || props.project.servers[0]?.id || '')
const preview = ref('')
const submitting = ref(false)
const titleInput = ref<HTMLInputElement | null>(null)
// 焦点陷阱 + Esc 收口到 MooDialog；本组件 onMounted 仍负责把焦点给到标题输入框（MooDialog initialFocus='container'
// 让 trap 不抢初始焦点）。Esc 路径见 MooDialog 的 @close → onMaskClick。

/** 提交成功后的内嵌反馈视图。设值即覆盖 body/footer 展示 ✓ 卡片。 */
const successInfo = ref<{ message: string; remoteId?: string; viewUrl?: string } | null>(null)
const SUCCESS_VIEW_MS = 1500
let successTimer: number | undefined

/** 提交失败后的内嵌持久横幅。toast 一闪而过，这里给用户「点击重试 / 知道为什么没成」
 *  的稳定锚点。cannotAutoRetry=true 时是「带录像且 body 超 1MB / multipart」这类
 *  background 没法入重试队列的场景，要明示用户「关闭窗口后只能去 历史 tab 重提」。 */
const failureInfo = ref<{ message: string; cannotAutoRetry: boolean } | null>(null)

const windowMs = ref(30000)
const urlFilter = ref('')
const openedAt = performance.now()
const selectedIds = ref<Set<string>>(new Set())
const selectedErrIds = ref<Set<string>>(new Set())
// 同事 dogfood 反馈：「光通过 url 来分辨有点难，我的使用习惯还要看请求和返回，用来对照字段情况」
// → 每个请求 row 可单独展开看 request/response body 详情卡片，不影响 checkbox 操作
const expandedReqIds = ref<Set<string>>(new Set())

function toggleExpand(id: string) {
  const next = new Set(expandedReqIds.value)
  if (next.has(id)) next.delete(id); else next.add(id)
  expandedReqIds.value = next
}

// 大 body 渲染会卡死 closed shadow（曾有同事截到 1 MB JSON 响应）—— 截到 1500 字符够看字段对照
function previewBody(s: string | null): string {
  if (!s) return ''
  if (s.length > 1500) return s.slice(0, 1500) + `\n\n… (前 1500 字, 共 ${s.length} 字)`
  return s
}

// element picker
const picking = ref(false)
const pickedElements = ref<PickedElement[]>([])

// onError 兜底：扩展刚被重载后，老 tab 里的 ElementPicker chunk URL 已 404。
// 不接 onError 的话 picking 卡 true，全屏 overlay 又没渲染，用户看着 SubmitDialog
// 「隐藏不动」摸不着头脑。重试一次防偶发，再失败把 picking 退回 + 让 ContentApp 弹 toast。
const ElementPicker = defineAsyncComponent({
  loader: () => import('./ElementPicker.vue'),
  timeout: 10000,
  onError(err, retry, fail, attempts) {
    if (attempts <= 1) {
      retry()
      return
    }
    console.error('[moo] async load failed: ElementPicker', err)
    fail()
    picking.value = false
    emit('async-load-failed', '扩展刚重载，请刷新当前页面（⌘R / F5）')
  }
})

// 「清空」附带元素时的两步确认：第一次点 → 按钮文字变「再点一下确认清空」，3 秒内
// 再点才真清；3 秒后自动复位。挑元素是有成本的工作（要在页面里找回每一个 DOM 节点
// 重选），误点「清空」全部丢光得不偿失。单个 × 删除不在此列，重选一个成本低不必拦。
const clearElementsConfirming = ref(false)
let clearElementsConfirmTimer: number | undefined
const CLEAR_CONFIRM_MS = 3000

function onClearElementsClick() {
  if (pickedElements.value.length < 2) {
    // 单个或空：confirm 没必要，徒增 friction
    pickedElements.value = []
    clearElementsConfirming.value = false
    return
  }
  if (!clearElementsConfirming.value) {
    clearElementsConfirming.value = true
    if (clearElementsConfirmTimer) clearTimeout(clearElementsConfirmTimer)
    clearElementsConfirmTimer = window.setTimeout(() => {
      clearElementsConfirming.value = false
    }, CLEAR_CONFIRM_MS)
    return
  }
  // 第二次点击 → 真的清
  if (clearElementsConfirmTimer) { clearTimeout(clearElementsConfirmTimer); clearElementsConfirmTimer = undefined }
  clearElementsConfirming.value = false
  pickedElements.value = []
}

function onElementPicked(el: PickedElement) {
  pickedElements.value.push(el)
  picking.value = false
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
function fmtDuration(s: number): string {
  const m = Math.floor(s / 60), ss = s % 60
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

const filtered = computed(() => {
  const all = props.requests
  let arr = windowMs.value < 0
    ? all
    : all.filter((r) => r.startTime + r.duration >= openedAt - windowMs.value)
  if (urlFilter.value.trim()) {
    const f = urlFilter.value.trim().toLowerCase()
    arr = arr.filter((r) => String(r.url ?? '').toLowerCase().includes(f))
  }
  return arr.slice().reverse() // 最新在上
})

const reversedErrors = computed(() => props.errors.slice().reverse())

// 默认勾选策略（同事 dogfood 反馈）：
//   - dialog 打开瞬间：**只勾最新一条**（不偷偷全选 → 不污染 bug 描述、不影响判断）
//   - dialog 打开期间新进来：自动勾上（很可能跟当前 bug 余波相关）
//   - 用户主动 toggle / selectAll / selectNone：照 UI 操作
// 改前是「filtered 内全部默认勾选」，同事反馈这让人疑惑「14/14 偷偷默认全选」
let prevRequestIds = new Set<string>()
let isFirstRequestWatch = true
watch(
  () => props.requests,
  (arr) => {
    if (isFirstRequestWatch) {
      // 首次：只勾最新一条（props.requests 末尾是最新）
      const latest = arr[arr.length - 1]
      if (latest) selectedIds.value = new Set([latest.id])
      prevRequestIds = new Set(arr.map((r) => r.id))
      isFirstRequestWatch = false
      return
    }
    // 后续 dialog 打开期间新进来的请求 → 自动勾
    const next = new Set(selectedIds.value)
    for (const r of arr) {
      if (!prevRequestIds.has(r.id)) next.add(r.id)
    }
    prevRequestIds = new Set(arr.map((r) => r.id))
    selectedIds.value = next
  },
  { immediate: true }
)

// 错误同款策略：首次只勾最新一条 + 后续 dialog 期间新出错自动勾
let prevErrorIds = new Set<string>()
let isFirstErrorWatch = true
watch(
  () => props.errors,
  (arr) => {
    if (isFirstErrorWatch) {
      const latestErr = arr[arr.length - 1]
      if (latestErr) selectedErrIds.value = new Set([latestErr.id])
      prevErrorIds = new Set(arr.map((e) => e.id))
      isFirstErrorWatch = false
      return
    }
    const next = new Set(selectedErrIds.value)
    for (const e of arr) {
      if (!prevErrorIds.has(e.id)) next.add(e.id)
    }
    prevErrorIds = new Set(arr.map((e) => e.id))
    selectedErrIds.value = next
  },
  { immediate: true }
)

function toggle(id: string) {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}

function selectAll() {
  selectedIds.value = new Set(filtered.value.map((r) => r.id))
}

function selectNone() {
  selectedIds.value = new Set()
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url)
    return u.pathname + u.search
  } catch {
    return url
  }
}

function statusClass(status: number): string {
  if (!status) return 'err'
  if (status >= 500) return 'err'
  if (status >= 400) return 'warn'
  return 'ok'
}

// 行级"出错强调"：4xx 给橙色左色条，5xx / 网络错给红色左色条。
// 配合现有 status chip 一起看：chip 标点、左色条扫面（眼睛跨几十行一扫就知道哪条挂了）
function failClass(status: number): string {
  if (!status) return 'is-err'
  if (status >= 500) return 'is-err'
  if (status >= 400) return 'is-warn'
  return ''
}

// 慢请求 duration 染色：≥1s 橙、≥3s 红。chip 系统只看 status，
// duration 是另一维度——200 但 5s 也是问题，光看 chip 看不出来
function durClass(duration: number): string {
  if (duration >= 3000) return 'dur--xslow'
  if (duration >= 1000) return 'dur--slow'
  return ''
}

function errLevelLabel(level: ConsoleError['level']): string {
  if (level === 'rejection') return 'REJ'
  if (level === 'console') return 'CON'
  return 'ERR'
}
function errLevelTitle(level: ConsoleError['level']): string {
  if (level === 'rejection') return 'Unhandled Promise Rejection'
  if (level === 'console') return 'console.error 调用'
  return 'window.onerror（运行时错误）'
}

const kind = computed(() => props.project.kind ?? 'webhook')

// === zentao 提交字段：每条 bug 可改，初值取 project.zentao default ===
const zentaoType = ref<string>(props.project.zentao?.defaultType || 'codeerror')
const zentaoSeverity = ref<1 | 2 | 3 | 4>((props.project.zentao?.defaultSeverity ?? 3) as 1 | 2 | 3 | 4)
const zentaoPri = ref<1 | 2 | 3 | 4>((props.project.zentao?.defaultPri ?? 3) as 1 | 2 | 3 | 4)
// 指派给：每条 bug 由用户在 SubmitDialog 单独选；环境配置不再有项目级默认（用户反馈每条情况不同）
const zentaoAssignedTo = ref<string>('')
/** 所属模块 id；0 = 根「/」。初值来自 project.zentao.moduleId（项目级默认） */
const zentaoModuleId = ref<number>(props.project.zentao?.moduleId ?? 0)
const zentaoModules = ref<NonNullable<ZentaoListModulesRes['modules']>>([])
const zentaoModulesLoading = ref(false)
async function loadZentaoModules() {
  const z = props.project.zentao
  if (!z?.baseUrl || !z.account || !z.password || !z.projectId) return
  zentaoModulesLoading.value = true
  try {
    const res = await safeSendMessage<ZentaoListModulesRes>({
      type: MSG.ZENTAO_LIST_MODULES,
      source: 'content',
      payload: { baseUrl: z.baseUrl, account: z.account, password: z.password, projectId: z.projectId }
    })
    if (res?.ok && res.modules) zentaoModules.value = res.modules
  } catch {
    // 静默；用户可点 ↻ 重试
  } finally {
    zentaoModulesLoading.value = false
  }
}

// cookie 预检：用户在浏览器禅道页面 session 是否有效 —— 提交链路依赖 cookie，
// 失效时让用户看见「请先登录禅道」+「一键打开」按钮，而不是提交完一脸懵
const zentaoCookieState = ref<'unknown' | 'ok' | 'fail'>('unknown')
const zentaoCookieMsg = ref('')
async function pingZentaoCookie() {
  const z = props.project.zentao
  if (!z?.baseUrl) return
  zentaoCookieState.value = 'unknown'
  zentaoCookieMsg.value = '正在登录禅道…'
  try {
    // v0.2.3 改：传账号密码，BG 调 ensureCookieSession（cookie 没在自动登录）—— 用户
    // 不再需要手动登录禅道页面。Moo SW 用账号密码调 v2 login 同时拿 token + 写 cookie
    const res = await safeSendMessage<ZentaoPingCookieRes>({
      type: MSG.ZENTAO_PING_COOKIE,
      source: 'content',
      payload: { baseUrl: z.baseUrl, account: z.account, password: z.password }
    })
    if (res?.ok) {
      zentaoCookieState.value = 'ok'
      zentaoCookieMsg.value = `✓ 已登录禅道（${res.realname ?? '未知用户'}）`
    } else {
      zentaoCookieState.value = 'fail'
      zentaoCookieMsg.value = res?.error ?? '禅道登录失败'
    }
  } catch (e) {
    zentaoCookieState.value = 'fail'
    zentaoCookieMsg.value = (e as Error).message
  }
}

// 用户列表（指派给下拉）：第一次 dialog 打开 + kind=zentao 时懒加载，避免不用禅道时浪费请求
const zentaoUsers = ref<NonNullable<ZentaoListUsersRes['users']>>([])
const zentaoUsersLoading = ref(false)
async function loadZentaoUsers() {
  const z = props.project.zentao
  if (!z?.baseUrl || !z.account || !z.password) return
  zentaoUsersLoading.value = true
  try {
    const res = await safeSendMessage<ZentaoListUsersRes>({
      type: MSG.ZENTAO_LIST_USERS,
      source: 'content',
      payload: { baseUrl: z.baseUrl, account: z.account, password: z.password }
    })
    if (res?.ok && res.users) zentaoUsers.value = res.users
  } catch {
    // 静默失败 —— 用户可以点按钮再试 / 也可以留空表示「按规则分派」
  } finally {
    zentaoUsersLoading.value = false
  }
}
// dialog 一打开就预拉一次（kind=zentao 时）—— 注意 onMounted 注册在 setup
// 同步段，回调在 mount 时执行，那时 zentaoMissingList 已经声明 OK
onMounted(() => {
  if (kind.value === 'zentao' && !zentaoMissingList.value) {
    void pingZentaoCookie()
    void loadZentaoUsers()
    void loadZentaoModules()
  }
})

// 前向引用：zentaoMissingList 在下面声明，但 onMounted callback 在 mount 时才执行

const canPreview = computed(() => kind.value === 'webhook' && !!serverId.value)
const currentServer = computed(() => props.project.servers.find((s) => s.id === serverId.value))
const serverEndpointMissing = computed(() => !!currentServer.value && !currentServer.value.endpoint?.trim())
/** 显示服务器选择行的条件（仅 webhook）：0 个 / 多个 / 唯一服务器配错了。
 * 单个且配置正确才隐藏（最常见的场景，减少表单噪音）。 */
const showServerRow = computed(() => {
  if (props.project.servers.length !== 1) return true
  return serverEndpointMissing.value
})

/** zentao 路径必填字段缺失清单（用于 UI 提示 + canSubmit 判定） */
const zentaoMissingList = computed(() => {
  if (kind.value !== 'zentao') return ''
  const z = props.project.zentao
  if (!z) return '禅道地址 / 账号 / 密码 / 项目 ID'
  const missing: string[] = []
  if (!z.baseUrl) missing.push('禅道地址')
  if (!z.account) missing.push('账号')
  if (!z.password) missing.push('密码')
  if (!z.projectId) missing.push('项目 ID')
  return missing.join(' / ')
})

/** 视频超过禅道 maxUploadSize 限制时给警告 + 提交时附件会失败（仍允许提交，bug 主体能建） */
const videoTooBigForZentao = computed(() => {
  if (kind.value !== 'zentao' || !props.video) return false
  return (props.video.bytes / 1024 / 1024) > ZENTAO_MAX_ATTACHMENT_MB
})

const canSubmit = computed(() => {
  if (!title.value.trim()) return false
  if (kind.value === 'zentao') {
    if (zentaoMissingList.value) return false
    // 提交前 cookie 必须有效；预检中状态 'unknown' 也允许（避免 race，BG 会再校验）
    if (zentaoCookieState.value === 'fail') return false
    return true
  }
  return !!serverId.value && !serverEndpointMissing.value
})

function selectedRequests(): CapturedRequest[] {
  const ids = selectedIds.value
  return props.requests.filter((r) => ids.has(r.id))
}

function selectedErrors(): ConsoleError[] {
  const ids = selectedErrIds.value
  return props.errors.filter((e) => ids.has(e.id))
}

function toggleErr(id: string) {
  const next = new Set(selectedErrIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedErrIds.value = next
}

function buildContext() {
  return {
    title: title.value,
    description: description.value,
    image: props.image ?? '',
    url: location.href,
    userAgent: navigator.userAgent,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    timestamp: new Date().toISOString(),
    requests: selectedRequests(),
    errors: selectedErrors(),
    elements: pickedElements.value,
    video: props.video ?? null
  }
}

const previewing = ref(false)
async function onPreview() {
  if (previewing.value) return
  const server = props.project.servers.find((s) => s.id === serverId.value)
  if (!server) return
  previewing.value = true
  try {
    try {
      const res = (await safeSendMessage({
        type: MSG.PREVIEW_PAYLOAD,
        source: 'content',
        payload: { server, context: buildContext() } satisfies PreviewPayloadReq
      })) as PreviewPayloadRes
      if (res.ok) {
        preview.value = res.rendered
      } else {
        preview.value = `生成预览时出错：${res.error}\n（可能「Payload 模板」里有语法问题，去 DevTools → Moo → 环境 → 上报服务器 → Payload 模板 检查一下）`
      }
    } catch (err) {
      preview.value = `生成预览时出错：${(err as Error).message}\n（可能「Payload 模板」里有语法问题，去 DevTools → Moo → 环境 → 上报服务器 → Payload 模板 检查一下）`
    }
  } finally {
    previewing.value = false
  }
}

async function onSubmit() {
  if (!canSubmit.value || submitting.value || successInfo.value) return
  submitting.value = true
  // 进入新一次提交：先清掉上次的失败横幅，避免重试中还看到旧错误文案
  failureInfo.value = null
  try {
    const ctx = buildContext()
    const req: SubmitBugReq = {
      serverId: serverId.value,
      projectId: props.project.id,
      title: title.value,
      description: description.value,
      image: props.image ?? '',
      url: ctx.url,
      userAgent: ctx.userAgent,
      viewport: ctx.viewport,
      timestamp: ctx.timestamp,
      requests: ctx.requests,
      errors: ctx.errors,
      elements: ctx.elements,
      video: ctx.video ?? undefined,
      // zentao 字段仅 kind=zentao 时填，webhook 路径 BG 会忽略这些字段
      ...(kind.value === 'zentao' ? {
        zentaoType: zentaoType.value,
        zentaoSeverity: zentaoSeverity.value,
        zentaoPri: zentaoPri.value,
        zentaoAssignedTo: zentaoAssignedTo.value || undefined,
        zentaoModuleId: zentaoModuleId.value
      } : {})
    }
    const res = (await safeSendMessage({
      type: MSG.SUBMIT_BUG,
      source: 'content',
      payload: req
    })) as SubmitBugRes
    const { ok, message } = formatSubmitResult(res)
    if (ok) {
      // 成功：展示 1.5s 的 ✓ 内嵌反馈再关闭。比 toast 一闪有更明确的"动作完成"感。
      // 禅道路径会带 viewUrl —— 让用户点链接直接跳禅道看（带 viewUrl 时延长展示
      // 时间到 4s，给用户机会点链接；不带的 webhook 路径保持原 1.5s）。
      successInfo.value = { message, remoteId: res.remoteId, viewUrl: res.viewUrl }
      const dur = res.viewUrl ? 4000 : SUCCESS_VIEW_MS
      successTimer = window.setTimeout(() => {
        emit('submitted', true, message)
      }, dur)
    } else {
      // 失败：dialog 不关，弹 toast 同时显示持久横幅。带录像 + 没入重试队列 → 标记
      // cannotAutoRetry，提示用户关窗后只能去 历史 Tab。判断依据是 background 返回的
      // queued 字段（multipart / body>1MB 时为 false/undefined）
      const cannotAutoRetry = !!req.video && !res.queued
      failureInfo.value = { message, cannotAutoRetry }
      emit('submitted', false, message)
    }
  } catch (err) {
    const message = `提交异常: ${(err as Error).message}`
    // req 在 try 内 block-scoped；catch 里用 props.video 等价
    failureInfo.value = { message, cannotAutoRetry: !!props.video }
    emit('submitted', false, message)
  } finally {
    submitting.value = false
  }
}

/** 成功面板期间禁止点遮罩取消，避免误关。失败/正常表单态 mask 点击仍走取消。 */
function onMaskClick() {
  if (successInfo.value) return
  emit('cancel')
}

function onReannotate() {
  if (submitting.value || successInfo.value) return
  emit('reannotate')
}

function onRecapture() {
  if (submitting.value || successInfo.value) return
  emit('recapture')
}

// 键盘快捷键：⌘/Ctrl+Enter 提交（Esc 走 MooDialog → onMaskClick 路径）
function onKeydown(e: KeyboardEvent) {
  if (picking.value) return // 选元素状态由 ElementPicker 自己接管
  if (successInfo.value) return // 成功视图期间快捷键全部禁用，等待自动关闭
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    void onSubmit()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown, true)
  // 自动聚焦标题输入，省一次点击
  nextTick(() => titleInput.value?.focus())
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true)
  if (successTimer) clearTimeout(successTimer)
  if (clearElementsConfirmTimer) clearTimeout(clearElementsConfirmTimer)
})
</script>
