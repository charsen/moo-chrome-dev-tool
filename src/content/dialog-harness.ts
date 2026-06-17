// E2E 测试用 harness：把 content 世界的 SubmitDialog / Annotator cancel-guard 单独
// 挂在 chrome-extension://EXT/.../dialog-harness.html 上，Playwright 跑 ESC / mask /
// Tab 焦点循环 / 成功保护期 这些键盘 + 鼠标交互。
//
// 为啥需要：content 世界 dialog 平时挂在宿主页注入的 closed shadow 里，截图触发链路
// （悬浮球 click → 截图 → Annotator → SubmitDialog）很难在 Playwright headless 重现。
// harness 直接把组件实例化，绕开「截图 / 录屏」前置步骤直奔 dialog 状态。
//
// URL query：
//   ?case=submit                 — 挂 SubmitDialog（初始空表单）
//   ?case=submit&fail=true       — 挂 SubmitDialog 并 mock sendMessage 返回失败
//   ?case=submit&success=true    — 挂 SubmitDialog 并 mock sendMessage 返回成功（用于测 1.5s 保护期）
//   ?case=submit&matchCount=N    — 模拟本页命中 N 个项目；> 1 时 body 顶部出多匹配警告条
//   ?case=submit&kind=zentao     — 用禅道项目（警告条带「· 禅道 #projectId」）
//   ?case=annotator              — 挂 Annotator（小占位图）；测试侧通过 mouse 画 2 笔触发 cancel-guard
//
// 跟 panel-harness 同样的姿势：mock chrome.* API + shadow root 内挂载 + 不动业务代码。

import { computed, createApp, defineComponent, h, ref } from 'vue'
import { HOST_ID, SHADOW_CSS } from './styles'
import type { CapturedRequest } from '@/types/requests'
import type { ConsoleError } from '@/types/errors'

// ------------------- mock chrome.runtime.sendMessage --------------------------------
// SubmitDialog onSubmit 走 safeSendMessage(MSG.SUBMIT_BUG) —— 真 SW 在 harness 这种
// chrome-extension:// 页面上能 receive，但回的结果取决于真业务路径（拉 config / 拉
// server，可能 401 / 没配置 → 失败）。harness 自管 mock，让成功/失败/queued 字段都
// 可控，测试断言才稳。
//
// ⚠ 这里覆盖的是 chrome.runtime.sendMessage 本身——SubmitDialog 的 safeSendMessage 仍
// 然走原代码路径，只是底层的 sendMessage 返回值被换。等价于 background 收到消息后回
// 一份预设响应，组件那一侧零改动。
const params = new URLSearchParams(window.location.search)
const failMode = params.get('fail') === 'true'
const successMode = params.get('success') === 'true'
const queuedFlag = params.get('queued') === 'true'

const origSendMessage = chrome.runtime.sendMessage.bind(chrome.runtime)
;(chrome.runtime as unknown as { sendMessage: typeof origSendMessage }).sendMessage = ((
  msg: { type?: string }
) => {
  // 只兜 SUBMIT_BUG / PREVIEW_PAYLOAD；其他消息透传给真 SW
  if (msg && msg.type === 'SUBMIT_BUG') {
    if (failMode) {
      // res.error 走 formatSubmitResult 的 `提交失败：${res.error}` 路径，
      // 测试断言能拿到稳定的子串
      return Promise.resolve({
        ok: false,
        error: 'mock failure: server 503',
        queued: queuedFlag
      })
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      remoteId: 'mock-123',
      queued: false
    })
  }
  if (msg && msg.type === 'PREVIEW_PAYLOAD') {
    return Promise.resolve({ ok: true, rendered: '{"mock":true}' })
  }
  return origSendMessage(msg)
}) as typeof origSendMessage

// ------------------- shadow root 同款外壳 -------------------------------------------
// 跟 content/index.ts 一致：shadow + 注入 SHADOW_CSS + mount 元素 pointer-events: auto。
// ⚠ 模式用 'open' 而非 prod 的 'closed'：Playwright locator 引擎**不穿透 closed shadow**
// （只穿透 open）。harness 没真实宿主页脚本威胁，open 安全无损。被测组件本身行为
// 与 shadow 模式无关，所以这一改不会让测试假阳。
const host = document.getElementById(HOST_ID)!
const shadow = host.attachShadow({ mode: 'open' })

const style = document.createElement('style')
style.textContent = SHADOW_CSS
shadow.appendChild(style)

const mount = document.createElement('div')
mount.style.cssText = 'pointer-events: auto;'
shadow.appendChild(mount)

// Playwright 跑测试时需要从外部拿到 shadow root 才能写断言（locator 自动穿透 closed
// shadow，但 evaluate 里手动遍历 DOM 用得到）。挂个全局 hook，仅 harness 用。
;(window as unknown as { __mooHarnessShadow: ShadowRoot }).__mooHarnessShadow = shadow

// ------------------- case 选择 + 挂 Vue ---------------------------------------------

interface EmitLog { event: string; payload: unknown[] }
const emitLog = ref<EmitLog[]>([])
;(window as unknown as { __mooHarnessEmits: typeof emitLog }).__mooHarnessEmits = emitLog

function logEmit(event: string, ...payload: unknown[]): void {
  emitLog.value.push({ event, payload })
}

const caseName = params.get('case') ?? 'submit'

async function bootstrap(): Promise<void> {
  if (caseName === 'floating-ball') {
    // FloatingBall 锁拖动行为：onDown / endDrag 多渠道 cleanup（pointerup/cancel/blur）
    // 验证「lost pointerup」场景下球不会跟着鼠标继续跑
    const FloatingBall = (await import('./FloatingBall.vue')).default
    const matches = [{
      id: 'p1',
      name: 'harness 项目',
      matchPatterns: ['<all_urls>'],
      servers: [],
      defaultServerId: '',
      capture: { requests: true, consoleErrors: true, storageKeys: [], requestBufferSize: 50 },
      redact: { headerKeys: [], bodyKeys: [], maskPasswordInputs: false },
      enabled: true,
      token: ''
    }]
    const Root = defineComponent({
      setup() {
        return () =>
          h(FloatingBall as unknown as ReturnType<typeof defineComponent>, {
            hidden: false,
            matches,
            onSelectProject: (id: string) => logEmit('select-project', id),
            onCapture: () => logEmit('capture'),
            onRecord: () => logEmit('record')
          })
      }
    })
    createApp(Root).mount(mount)
    return
  }
  if (caseName === 'annotator') {
    // 200×200 透明 PNG（pixel-perfect 最小 base64）—— Annotator 拿 naturalWidth/Height
    // 当 canvas 尺寸，足够鼠标画 2 笔 + 不撑爆 1280×800 视口
    const tinyPng = await makeTinyPng(200, 200)
    const Annotator = (await import('./Annotator.vue')).default
    const Root = defineComponent({
      setup() {
        return () =>
          h(Annotator, {
            image: tinyPng,
            onCancel: () => logEmit('cancel'),
            // Annotator emit 的是 'finish'（不是 'confirm'）——「下一步」走这个事件。
            // download 测试要断言「点下载不 emit finish/cancel」，必须把 finish 真接上。
            onFinish: (dataUrl: string) => logEmit('finish', dataUrl.length)
          })
      }
    })
    createApp(Root).mount(mount)
  } else {
    // submit case
    const SubmitDialog = (await import('./SubmitDialog.vue')).default
    // ?shots=N → 生成 N 张小占位图作 images prop（多图 UI 用例）；缺省 0 = 无图
    const shotCount = Number(params.get('shots') ?? '0') || 0
    const shotImages: string[] = []
    for (let i = 0; i < shotCount; i++) shotImages.push(await makeTinyPng(120, 80))
    // 注入 mock requests，方便测试展开 row / 复制按钮 / 收起全部
    // ?requests=N → 生成 N 条 mock 请求，requestBody 是一段长文本（用于断言复制原文）
    const reqCount = Number(params.get('requests') ?? '0') || 0
    function makeMockRequest(i: number): CapturedRequest {
      const longBody = `LONG_BODY_${i}_` + 'x'.repeat(2000)  // 2000+ 字符，超过 previewBody 1500 截断阈值
      const respBody = JSON.stringify({ id: i, payload: 'response-' + i, fill: 'y'.repeat(2000) })
      return {
        id: `req-${i}`,
        kind: 'fetch' as const,
        method: 'POST',
        url: `https://api.example.com/endpoint-${i}`,
        requestHeaders: { 'Content-Type': 'application/json' },
        requestBody: longBody,
        status: 200,
        ok: true,
        responseHeaders: { 'Content-Type': 'application/json' },
        responseBody: respBody,
        responseSizeBytes: respBody.length,
        startTime: performance.now() - (i * 100),
        duration: 50 + i * 5,
        startedAt: new Date().toISOString()
      } as CapturedRequest
    }

    // ⚠ 回归锁关键：requests / errors 用 ref + computed(() => ref.value)，**完全复刻**
    // useRequests.ts 的数据流（模块 ref → push() 原地 mutate → computed(() => ref.value)
    // 每次返回同一数组 proxy 引用）。push 钩子必须 in-place `.push()`，**不能重赋值**
    // —— 重赋值会让浅 watch 也触发，掩盖被测 bug（修复前 `() => props.requests` 就假绿了）。
    const reqRef = ref<CapturedRequest[]>(
      Array.from({ length: reqCount }, (_, i) => makeMockRequest(i))
    )
    const errRef = ref<ConsoleError[]>([])
    const reqProp = computed(() => reqRef.value)   // 同 useRequests: 同一 proxy 引用
    const errProp = computed(() => errRef.value)
    let pushSeq = reqCount
    let errSeq = 0
    // 测试侧通过这俩钩子在 dialog 挂载后动态 push（in-place）新请求 / 新错误，
    // 验证「dialog 开着期间新进来自动勾选」。返回新条目 id 供断言。
    ;(window as unknown as { __mooHarnessPushRequest: () => string }).__mooHarnessPushRequest = () => {
      const r = makeMockRequest(pushSeq++)
      reqRef.value.push(r)  // in-place，不重赋值
      return r.id
    }
    ;(window as unknown as { __mooHarnessPushError: () => string }).__mooHarnessPushError = () => {
      const e: ConsoleError = {
        id: `err-${errSeq++}`,
        level: 'error',
        message: `harness runtime error ${errSeq}`,
        startedAt: new Date().toISOString(),
        startTime: performance.now()
      }
      errRef.value.push(e)  // in-place，不重赋值
      return e.id
    }
    // ?kind=zentao → 用禅道项目（多匹配警告条要带「· 禅道 #projectId」核对信息）；
    // 缺省 webhook。禅道 projectId 固定 42，e2e 断言警告条含 #42。
    const isZentao = params.get('kind') === 'zentao'
    const project = isZentao
      ? {
          id: 'pz',
          name: '禅道示例项目',
          matchPatterns: ['<all_urls>'],
          servers: [],
          defaultServerId: '',
          kind: 'zentao' as const,
          zentao: {
            baseUrl: 'https://zentao.example.com',
            account: 'tester',
            password: 'pw',
            projectId: 42,
            defaultType: 'codeerror',
            defaultSeverity: 3 as const,
            defaultPri: 3 as const,
            moduleId: 0
          },
          capture: { requests: true, consoleErrors: true, storageKeys: [], requestBufferSize: 50 },
          redact: { headerKeys: [], bodyKeys: [], maskPasswordInputs: false },
          enabled: true,
          token: 'tok'
        }
      : {
          id: 'p1',
          name: '示例项目',
          matchPatterns: ['<all_urls>'],
          servers: [
            {
              id: 's1',
              name: '主上报',
              endpoint: 'https://intake.example.com/api/bugs',
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              payloadTemplate: '{"title":"{{title}}"}',
              imageField: 'screenshot',
              imageFormat: 'base64' as const
            }
          ],
          defaultServerId: 's1',
          capture: { requests: true, consoleErrors: true, storageKeys: [], requestBufferSize: 50 },
          redact: { headerKeys: [], bodyKeys: [], maskPasswordInputs: false },
          enabled: true,
          token: 'tok'
        }
    // ?matchCount=N → 模拟本页命中 N 个 Moo 项目。> 1 触发 body 顶部多匹配警告条。
    // 缺省 1（唯一匹配，无歧义）→ 不显示。
    const matchCount = Number(params.get('matchCount') ?? '1') || 1
    const Root = defineComponent({
      setup() {
        return () =>
          h(SubmitDialog as unknown as ReturnType<typeof defineComponent>, {
            project,
            matchCount,
            // v0.8.10 多图：image 单值 prop 改 images 数组（空数组 = 无图，同旧 image:''）。
            // ?shots=N 生成 N 张占位缩略，供测试断言多图 UI（重标/重截/删除/再截一张）
            images: shotImages,
            video: null,
            requests: reqProp.value,
            errors: errProp.value,
            onCancel: () => logEmit('cancel'),
            onSubmitted: (ok: boolean, message: string) => logEmit('submitted', ok, message),
            onReannotate: (i: number) => logEmit('reannotate', i),
            onRecapture: (i: number) => logEmit('recapture', i),
            onAddShot: () => logEmit('add-shot'),
            onRemoveShot: (i: number) => logEmit('remove-shot', i),
            onAsyncLoadFailed: (m: string) => logEmit('async-load-failed', m)
          })
      }
    })
    createApp(Root).mount(mount)
  }
}

// 生成纯色 PNG：用 canvas toDataURL 比手写 base64 二进制可读多了
async function makeTinyPng(w: number, h: number): Promise<string> {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#f0f0f0'
  ctx.fillRect(0, 0, w, h)
  // 加个十字标记便于人眼调试 harness 时辨别画布原点
  ctx.strokeStyle = '#999'
  ctx.beginPath()
  ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2)
  ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h)
  ctx.stroke()
  return c.toDataURL('image/png')
}

void bootstrap()
