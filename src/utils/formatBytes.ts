/**
 * 字节数转人类可读（B / KB / MB）。
 *
 * 之前 submit.ts（禅道 steps）与 SubmitDialog.vue（UI 预览）各有一份同款实现，
 * 唯一差异是 MB 段小数位：steps 用 2 位（归档精确），UI 预览用 1 位。抽到这里
 * 用 mbDigits 参数保留两边各自精度，KB 段固定 1 位（两处历史一致）。
 *
 * @param mbDigits MB 段小数位，默认 1。
 */
export function formatBytes(n: number, mbDigits = 1): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(mbDigits)} MB`
}
