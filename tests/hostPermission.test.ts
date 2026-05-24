import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hasHostPermission } from '@/utils/hostPermission'

/**
 * v0.5.3 #128 hostPermission helper 单测。
 */

let containsResult: boolean
let containsThrows = false

beforeEach(() => {
  containsResult = true
  containsThrows = false
  ;(globalThis as { chrome?: unknown }).chrome = {
    permissions: {
      async contains() {
        if (containsThrows) throw new Error('not supported')
        return containsResult
      }
    }
  }
})

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome
})

describe('hasHostPermission', () => {
  it('chrome.permissions.contains 返 true → true', async () => {
    containsResult = true
    expect(await hasHostPermission()).toBe(true)
  })

  it('chrome.permissions.contains 返 false → false', async () => {
    containsResult = false
    expect(await hasHostPermission()).toBe(false)
  })

  it('chrome.permissions.contains throw → false（不传播）', async () => {
    containsThrows = true
    expect(await hasHostPermission()).toBe(false)
  })
})
