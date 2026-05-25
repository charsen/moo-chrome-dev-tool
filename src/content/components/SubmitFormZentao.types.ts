/** SubmitFormZentao 的 v-model 形状：每条 bug 用户可改的禅道字段。
 *  抽出来是因为 <script setup> 不能 export 类型，父子要共享得走独立 ts 文件。 */
export interface ZentaoFormFields {
  zentaoType: string
  zentaoSeverity: 1 | 2 | 3 | 4
  zentaoPri: 1 | 2 | 3 | 4
  zentaoAssignedTo: string
  zentaoModuleId: number
}
