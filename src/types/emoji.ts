import { UserPayload } from './user.ts'

export interface EmojiPayload {
  id: string | null
  name: string | null
  roles?: string[]
  user?: UserPayload
  require_colons?: boolean
  managed?: boolean
  animated?: boolean
  available?: boolean
}
