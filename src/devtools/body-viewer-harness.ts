// E2E 测试用 harness：把 BodyViewer 单独挂在一个 chrome-extension://ID/.../harness 页面，
// Playwright 跑真 Chrome 来截图 + DOM 断言。不在 prod 流程里被任何真实 UI 引用。
// 走 ?case=<key>&search=<text> 切场景。
import { createApp, h } from 'vue'
import BodyViewer from './components/BodyViewer.vue'
import '@/styles/tokens.css'

const params = new URLSearchParams(window.location.search)
const kase = params.get('case') ?? 'small'
const search = params.get('search') ?? ''

function makeText(): string {
  switch (kase) {
    case 'small':
      return '{"id":1,"name":"alice","active":true,"meta":null,"score":98.5}'
    case 'large':
      // 拼一个 >3K 字符的 JSON 数组（触发折叠）
      return JSON.stringify(
        Array.from({ length: 80 }, (_, i) => ({
          id: i,
          name: `item-${i}`,
          score: Math.random(),
          active: i % 2 === 0
        }))
      )
    case 'text':
      return 'this is just plain text, not JSON at all'
    case 'invalid':
      // 看起来像 JSON 但 parse 不通
      return '{ this is broken json '
    case 'xss':
      // 检查 string value 里的 <script> 不会注入
      return '{"x":"<script>alert(1)</script>","html":"<b>bold</b>"}'
    default:
      return ''
  }
}

createApp({
  render: () => h(BodyViewer, { text: makeText(), search })
}).mount('#app')
