import { fail } from './contract.mjs';

export async function responses(env, body, fetcher = fetch) {
  if (!env.OPENAI_API_KEY) fail(503, '后端尚未配置 OPENAI_API_KEY。');
  let response;
  try {
    response = await fetcher('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.OPENAI_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(35000)
    });
  } catch {
    fail(502, 'OpenAI 请求未完成，请稍后重试。');
  }
  if (!response.ok) fail(502, 'OpenAI 请求失败（HTTP ' + response.status + '），请检查后端模型权限、额度和配置。');
  return response.json();
}

export async function studyFinal(record, env) {
  if (!record.examples?.length || env.PLANNER_STUDY_MODEL === 'off' || !env.OPENAI_API_KEY) return;
  const output = await responses(env, {
    model: env.PLANNER_STUDY_MODEL || 'gpt-6.2-astra',
    reasoning: { effort: env.PLANNER_STUDY_EFFORT || 'high' },
    store: false,
    instructions:
      '仅从当前定稿中的实际对象与行提炼案例。给适用条件和例外，仅引用输入的对象编号。未注明原因的人工修改只记为观察。输出 JSON。',
    input: JSON.stringify({
      rows: record.examples,
      edits: record.edits,
      reason: record.reason,
      scale: record.facts.scale
    }),
    text: {
      format: {
        type: 'json_schema',
        name: 'case_notes',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cases: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  objects: { type: 'array', items: { type: 'integer' } },
                  observation: { type: 'string' },
                  condition: { type: 'string' },
                  exception: { type: 'string' }
                },
                required: ['objects', 'observation', 'condition', 'exception']
              }
            }
          },
          required: ['cases']
        }
      }
    }
  });
  const text = output.output
    .flatMap((o) => (o.content || []).filter((c) => c.type === 'output_text').map((c) => c.text))
    .join('');
  const ids = new Set(record.booths.map((b) => b.id)),
    { cases } = JSON.parse(text);
  if (!Array.isArray(cases) || cases.some((c) => !c.objects?.length || c.objects.some((id) => !ids.has(id))))
    throw new Error('提炼结果的对象引用无效');
  record.lessons = cases;
}
