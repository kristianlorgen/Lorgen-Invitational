import { NextResponse } from 'next/server';

export function ok(data: unknown = {}, status = 200) {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return NextResponse.json({ success: true, ...(data as Record<string, unknown>) }, { status });
  }

  return NextResponse.json({ success: true, data }, { status });
}

export function fail(message: string, status = 400, details?: unknown) {
  return NextResponse.json({ success: false, error: message, details }, { status });
}
