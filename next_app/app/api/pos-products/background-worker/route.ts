import { handleBackgroundWorkerRequest } from '@/lib/pos-products/background-worker-handler.server'

export const runtime = 'nodejs'
export const maxDuration = 30
export async function POST(request: Request) { return handleBackgroundWorkerRequest(request) }
