import { NextRequest, NextResponse } from 'next/server'
import { getDeviceIdFromRequest } from '@/lib/server/jwt'

// POST /api/extract-document — server-side text extraction for binary docs
// the browser can't parse natively. Currently handles PDF; plaintext-y
// formats (txt/md/json/csv/xml/html) are extracted client-side via
// FileReader.readAsText and never hit this endpoint.
//
// Request body: { name, mimeType, dataBase64 }
// Response: { text } or { error }

export const maxDuration = 60

export async function POST(request: NextRequest) {
  const deviceId = getDeviceIdFromRequest(request.headers.get('Authorization'))
  if (!deviceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { name, mimeType, dataBase64 } = body
  if (typeof dataBase64 !== 'string' || dataBase64.length === 0) {
    return NextResponse.json({ error: 'Missing file data' }, { status: 400 })
  }

  const buf = Buffer.from(dataBase64, 'base64')

  // PDF
  if (mimeType === 'application/pdf' || name?.toLowerCase().endsWith('.pdf')) {
    try {
      // unpdf is a serverless-friendly pdfjs wrapper — no worker required,
      // which matters because Next's bundler doesn't lay down a worker
      // file at the path pdf-parse expects. Lazy import keeps the heavy
      // pdfjs dep out of the route's module graph at startup.
      const { extractText, getDocumentProxy } = await import('unpdf')
      const pdf = await getDocumentProxy(new Uint8Array(buf))
      // mergePages: true → returns text as a single joined string.
      const result = await extractText(pdf, { mergePages: true })
      const text = result.text as unknown as string
      return NextResponse.json({ text })
    } catch (err) {
      console.error('[extract-document] pdf-parse failed:', err)
      const message = err instanceof Error ? err.message : 'PDF extraction failed'
      return NextResponse.json({ error: message }, { status: 500 })
    }
  }

  return NextResponse.json({
    error: `Server-side extraction not supported for type '${mimeType}'. Convert to PDF or paste the text directly.`,
  }, { status: 415 })
}
