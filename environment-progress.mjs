// Read fragmented JSONL updates without exposing model text or reasoning.
export async function readAnalysisResponse(response, onEvent) {
  if (!response.headers.get('content-type')?.includes('application/x-ndjson')) return response.json();
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', result;
  const accept = line => {
    if (!line.trim()) return;
    let event;
    try { event = JSON.parse(line); } catch { throw new Error('生成进度数据异常，原环境未修改，请重试。'); }
    if (event.type === 'result') result = event;
    else if (event.type === 'progress' || event.type === 'heartbeat') onEvent?.(event);
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) { buffer += decoder.decode(); break; }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n'); buffer = lines.pop();
      lines.forEach(accept);
    }
    accept(buffer);
  } finally { reader.releaseLock(); }
  if (!result) throw new Error('生成连接在结果返回前中断，原环境未修改，请重新生成。');
  return result;
}
