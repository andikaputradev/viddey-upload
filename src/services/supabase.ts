import { createClient } from '@supabase/supabase-js'
import { config } from '../config.js'
import { retryWithBackoff } from '../lib/utils.js'

function db() {
  return createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: { persistSession: false },
  })
}

export interface VideoInsertPayload {
  slug: string
  title: string
  telegram_file_id: string
  telegram_file_path: string
  file_size: number
  mime_type: string
  delete_token: string
  upload_status: string
}

export async function insertVideo(payload: VideoInsertPayload): Promise<string> {
  return retryWithBackoff(
    async () => {
      const { data, error } = await db()
        .from('videos')
        .insert(payload)
        .select('id')
        .single<{ id: string }>()
      if (error !== null) throw new Error(`Supabase insert error: ${error.message}`)
      if (data === null) throw new Error('Supabase insert returned null data')
      return data.id
    },
    3,
    1000,
    'supabase.insertVideo'
  )
}

export async function slugExists(slug: string): Promise<boolean> {
  const { count, error } = await db()
    .from('videos')
    .select('id', { count: 'exact', head: true })
    .eq('slug', slug)
  if (error !== null) throw new Error(`Supabase slug check error: ${error.message}`)
  return (count ?? 0) > 0
}
