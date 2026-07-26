/**
 * Proxy RAG upstream partagé (web /api/rag + iOS /api/ios/v1/rag).
 */

/**
 * @returns {Promise<Response>} fetch Response (SSE body)
 */
export async function fetchAskWeb({
  upstream,
  apiKey,
  question,
  language = 'FR',
  client = 'web',
  inline_citations = true,
}) {
  const base = String(upstream || '').replace(/\/+$/, '');
  if (!base || !apiKey) {
    const err = new Error('RAG non configuré');
    err.status = 503;
    throw err;
  }
  const q = String(question || '').trim();
  if (!q) {
    const err = new Error('question requise');
    err.status = 400;
    throw err;
  }
  if (q.length > 4000) {
    const err = new Error('question trop longue');
    err.status = 400;
    throw err;
  }

  const upstreamRes = await fetch(`${base}/askWeb`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      question: q,
      language: String(language || 'FR').toUpperCase(),
      client: client || 'web',
      inline_citations: inline_citations !== false,
    }),
  });

  if (!upstreamRes.ok || !upstreamRes.body) {
    const err = new Error('Réponse RAG invalide');
    err.status = 502;
    err.upstreamStatus = upstreamRes.status;
    throw err;
  }
  return upstreamRes;
}

/** Pipe le flux SSE vers la réponse HTTP Node. */
export async function pipeSseToResponse(res, upstreamRes) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  try {
    for await (const chunk of upstreamRes.body) {
      res.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
  } finally {
    res.end();
  }
}
