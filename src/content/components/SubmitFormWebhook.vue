<template>
  <div v-if="showServerRow" class="moo-form-row">
    <label for="moo-server">服务器</label>
    <div class="server-pick">
      <select
        id="moo-server"
        :value="modelValue"
        @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
      >
        <option v-if="!project.servers.length" disabled value="">还没有上报服务器 —— 请先到 DevTools → Moo → 环境 → 新建一个</option>
        <option v-for="s in project.servers" :key="s.id" :value="s.id">
          {{ s.name }} — {{ s.endpoint || '（尚未填请求 URL）' }}
        </option>
      </select>
      <div v-if="endpointMissing" class="server-warn">
        ⚠ 服务器「{{ currentServer?.name }}」还没填请求 URL，提交会失败。<br>
        请打开 <b>DevTools → Moo → 环境</b>，找到这个服务器，在「请求 URL」那一行填上后端地址（比如 <code>http://localhost:3000/bugs</code>），然后回来点提交。
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Project } from '@/types/config'

/** webhook 路径专用：服务器选择 + endpoint 缺失警告。
 *  父用 v-model 绑 serverId 字符串。 */
const props = defineProps<{
  modelValue: string
  project: Project
}>()

const emit = defineEmits<{ (e: 'update:modelValue', id: string): void }>()

const currentServer = computed(() => props.project.servers.find((s) => s.id === props.modelValue))
const endpointMissing = computed(() => !!currentServer.value && !currentServer.value.endpoint?.trim())
/** 显示服务器选择行的条件：0 个 / 多个 / 唯一服务器配错了。
 *  单个且配置正确才隐藏（最常见的场景，减少表单噪音）。 */
const showServerRow = computed(() => {
  if (props.project.servers.length !== 1) return true
  return endpointMissing.value
})
</script>
