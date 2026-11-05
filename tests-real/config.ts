import { DEFAULT_REDACT } from '../src/types/config'

export function webhookProject(
  port: number,
  opts: { id?: string; name?: string; imageFormat?: 'base64' | 'multipart'; endpointPath?: string } = {}
) {
  const id = opts.id ?? 'p-real'
  const imageFormat = opts.imageFormat ?? 'base64'
  return {
    id,
    name: opts.name ?? '真机项目',
    matchPatterns: [`http://127.0.0.1:${port}/*`],
    kind: 'webhook' as const,
    servers: [{
      id: `s-${id}`,
      name: '本地接收端',
      endpoint: `http://127.0.0.1:${port}${opts.endpointPath ?? '/api/bug'}`,
      method: 'POST' as const,
      headers: imageFormat === 'base64' ? { 'Content-Type': 'application/json' } : {},
      payloadTemplate: imageFormat === 'base64'
        ? `{
  "title": "{{title}}",
  "description": "{{description}}",
  "url": "{{url}}",
  "screenshots": {{imagesJson}},
  "requests": {{requestsJson}},
  "errors": {{errorsJson}},
  "elements": {{elementsJson}}
}`
        : '{"title":"{{title}}","description":"{{description}}"}',
      imageField: 'screenshot',
      imageFormat
    }],
    defaultServerId: `s-${id}`,
    capture: { requests: true, consoleErrors: true, storageKeys: [], requestBufferSize: 50 },
    redact: {
      headerKeys: [...DEFAULT_REDACT.headerKeys],
      bodyKeys: [...DEFAULT_REDACT.bodyKeys],
      maskPasswordInputs: true
    },
    enabled: true
  }
}

export function zentaoProject(port: number) {
  return {
    id: 'p-zentao-real',
    name: '禅道真机项目',
    matchPatterns: [`http://127.0.0.1:${port}/*`],
    kind: 'zentao' as const,
    servers: [],
    defaultServerId: '',
    zentao: {
      baseUrl: `http://127.0.0.1:${port}`,
      account: 'tester',
      password: 'pw',
      projectId: 42,
      moduleId: 0,
      defaultType: 'codeerror',
      defaultSeverity: 3 as const,
      defaultPri: 3 as const,
      defaultKeywords: 'Moo'
    },
    capture: { requests: true, consoleErrors: true, storageKeys: [], requestBufferSize: 50 },
    redact: {
      headerKeys: [...DEFAULT_REDACT.headerKeys],
      bodyKeys: [...DEFAULT_REDACT.bodyKeys],
      maskPasswordInputs: true
    },
    enabled: true
  }
}

export function configWith(projects: unknown[]) {
  return { globalEnabled: true, projects }
}
