'use client';

export class ApiError extends Error {
  status: number;
  code: string;
  field: string | null;
  constructor(status: number, code: string, message: string, field: string | null = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

/** fetch JSON com sessão (cookie). Lança ApiError em não-2xx — nunca "sucesso" sem 2xx. */
export async function api<T = unknown>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    credentials: 'same-origin',
    headers: {
      ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(rest.headers ?? {}),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: 'invalid_json', message: text.slice(0, 200) };
  }
  if (!res.ok) {
    const e = (data ?? {}) as { error?: string; message?: string; field?: string | null };
    throw new ApiError(
      res.status,
      e.error ?? 'error',
      e.message ?? `Erro ${res.status}`,
      e.field ?? null,
    );
  }
  return data as T;
}
