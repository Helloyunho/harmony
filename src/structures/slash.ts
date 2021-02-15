import { Client } from '../models/client.ts'
import {
  AllowedMentionsPayload,
  ChannelTypes,
  EmbedPayload,
  MessageOptions
} from '../types/channel.ts'
import { INTERACTION_CALLBACK, WEBHOOK_MESSAGE } from '../types/endpoint.ts'
import {
  InteractionApplicationCommandData,
  InteractionApplicationCommandOption,
  InteractionChannelPayload,
  InteractionPayload,
  InteractionResponseFlags,
  InteractionResponsePayload,
  InteractionResponseType,
  InteractionType,
  SlashCommandOptionType
} from '../types/slash.ts'
import { Dict } from '../utils/dict.ts'
import { Permissions } from '../utils/permissions.ts'
import { SnowflakeBase } from './base.ts'
import { Channel } from './channel.ts'
import { Embed } from './embed.ts'
import { Guild } from './guild.ts'
import { Member } from './member.ts'
import { Message } from './message.ts'
import { Role } from './role.ts'
import { GuildTextChannel, TextChannel } from './textChannel.ts'
import { User } from './user.ts'

interface WebhookMessageOptions extends MessageOptions {
  embeds?: Embed[]
  name?: string
  avatar?: string
}

type AllWebhookMessageOptions = string | WebhookMessageOptions

/** Interaction Message related Options */
export interface InteractionMessageOptions {
  content?: string
  embeds?: EmbedPayload[]
  tts?: boolean
  flags?: number | InteractionResponseFlags[]
  allowedMentions?: AllowedMentionsPayload
  /** Whether to reply with Source or not. True by default */
  withSource?: boolean
}

export interface InteractionResponse extends InteractionMessageOptions {
  /** Type of Interaction Response */
  type?: InteractionResponseType
  /**
   * DEPRECATED: Use `ephemeral` instead.
   *
   * @deprecated
   */
  temp?: boolean
  /** Whether the Message Response should be Ephemeral (only visible to User) or not */
  ephemeral?: boolean
}

/** Represents a Channel Object for an Option in Slash Command */
export class InteractionChannel extends SnowflakeBase {
  name: string
  type: ChannelTypes
  permissions: Permissions

  constructor(client: Client, data: InteractionChannelPayload) {
    super(client)
    this.name = data.name
    this.type = data.type
    this.permissions = new Permissions(data.permissions)
  }

  /** Resolve to actual Channel object if present in Cache */
  async resolve<T = Channel>(): Promise<T | undefined> {
    return this.client.channels.get<T>(this.id)
  }
}

export interface InteractionApplicationCommandResolved {
  users: Dict<InteractionUser>
  members: Dict<Member>
  channels: Dict<InteractionChannel>
  roles: Dict<Role>
}

export class InteractionUser extends User {
  member?: Member
}

export class Interaction extends SnowflakeBase {
  /** Type of Interaction */
  type: InteractionType
  /** Interaction Token */
  token: string
  /** Interaction ID */
  id: string
  /** Data sent with Interaction. Only applies to Application Command, type may change in future. */
  data?: InteractionApplicationCommandData
  /** Channel in which Interaction was initiated */
  channel?: TextChannel | GuildTextChannel
  guild?: Guild
  /** Member object of who initiated the Interaction */
  member?: Member
  /** User object of who invoked Interaction */
  user: User
  responded: boolean = false
  resolved: InteractionApplicationCommandResolved

  constructor(
    client: Client,
    data: InteractionPayload,
    others: {
      channel?: TextChannel | GuildTextChannel
      guild?: Guild
      member?: Member
      user: User
      resolved: InteractionApplicationCommandResolved
    }
  ) {
    super(client)
    this.type = data.type
    this.token = data.token
    this.member = others.member
    this.id = data.id
    this.user = others.user
    this.data = data.data
    this.guild = others.guild
    this.channel = others.channel
    this.resolved = others.resolved
  }

  /** Name of the Command Used (may change with future additions to Interactions!) */
  get name(): string | undefined {
    return this.data?.name
  }

  get options(): InteractionApplicationCommandOption[] {
    return this.data?.options ?? []
  }

  /** Get an option by name */
  option<T>(name: string): T {
    const op = this.options.find((e) => e.name === name)
    if (op === undefined || op.value === undefined) return undefined as any
    if (op.type === SlashCommandOptionType.USER)
      return this.resolved.users[op.value] as any
    else if (op.type === SlashCommandOptionType.ROLE)
      return this.resolved.roles[op.value] as any
    else if (op.type === SlashCommandOptionType.CHANNEL)
      return this.resolved.channels[op.value] as any
    else return op.value
  }

  /** Respond to an Interaction */
  async respond(data: InteractionResponse): Promise<Interaction> {
    if (this.responded) throw new Error('Already responded to Interaction')
    let flags = 0
    if (data.ephemeral === true || data.temp === true)
      flags |= InteractionResponseFlags.EPHEMERAL
    if (data.flags !== undefined) {
      if (Array.isArray(data.flags))
        flags = data.flags.reduce((p, a) => p | a, flags)
      else if (typeof data.flags === 'number') flags |= data.flags
    }
    const payload: InteractionResponsePayload = {
      type:
        data.type ??
        (data.withSource === false
          ? InteractionResponseType.CHANNEL_MESSAGE
          : InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE),
      data:
        data.type === undefined ||
        data.type === InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE ||
        data.type === InteractionResponseType.CHANNEL_MESSAGE
          ? {
              content: data.content ?? '',
              embeds: data.embeds,
              tts: data.tts ?? false,
              flags,
              allowed_mentions: data.allowedMentions ?? undefined
            }
          : undefined
    }

    await this.client.rest.post(
      INTERACTION_CALLBACK(this.id, this.token),
      payload
    )
    this.responded = true

    return this
  }

  /** Acknowledge the Interaction */
  async acknowledge(withSource?: boolean): Promise<Interaction> {
    await this.respond({
      type:
        withSource === true
          ? InteractionResponseType.ACK_WITH_SOURCE
          : InteractionResponseType.ACKNOWLEDGE
    })
    return this
  }

  /** Reply with a Message to the Interaction */
  async reply(content: string): Promise<Interaction>
  async reply(options: InteractionMessageOptions): Promise<Interaction>
  async reply(
    content: string,
    options: InteractionMessageOptions
  ): Promise<Interaction>
  async reply(
    content: string | InteractionMessageOptions,
    messageOptions?: InteractionMessageOptions
  ): Promise<Interaction> {
    let options: InteractionMessageOptions | undefined =
      typeof content === 'object' ? content : messageOptions
    if (
      typeof content === 'object' &&
      messageOptions !== undefined &&
      options !== undefined
    )
      Object.assign(options, messageOptions)
    if (options === undefined) options = {}
    if (typeof content === 'string') Object.assign(options, { content })

    await this.respond(
      Object.assign(options, {
        type:
          options.withSource === false
            ? InteractionResponseType.CHANNEL_MESSAGE
            : InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE
      })
    )

    return this
  }

  /** Edit the original Interaction response */
  async editResponse(data: {
    content?: string
    embeds?: Embed[]
  }): Promise<Interaction> {
    const url = WEBHOOK_MESSAGE(
      this.client.user?.id as string,
      this.token,
      '@original'
    )
    await this.client.rest.patch(url, {
      content: data.content ?? '',
      embeds: data.embeds ?? []
    })
    return this
  }

  /** Delete the original Interaction Response */
  async deleteResponse(): Promise<Interaction> {
    const url = WEBHOOK_MESSAGE(
      this.client.user?.id as string,
      this.token,
      '@original'
    )
    await this.client.rest.delete(url)
    return this
  }

  get url(): string {
    return `https://discord.com/api/v8/webhooks/${this.client.user?.id}/${this.token}`
  }

  /** Send a followup message */
  async send(
    text?: string | AllWebhookMessageOptions,
    option?: AllWebhookMessageOptions
  ): Promise<Message> {
    if (typeof text === 'object') {
      option = text
      text = undefined
    }

    if (text === undefined && option === undefined) {
      throw new Error('Either text or option is necessary.')
    }

    if (option instanceof Embed)
      option = {
        embeds: [option]
      }

    const payload: any = {
      content: text,
      embeds:
        (option as WebhookMessageOptions)?.embed !== undefined
          ? [(option as WebhookMessageOptions).embed]
          : (option as WebhookMessageOptions)?.embeds !== undefined
          ? (option as WebhookMessageOptions).embeds
          : undefined,
      file: (option as WebhookMessageOptions)?.file,
      tts: (option as WebhookMessageOptions)?.tts,
      allowed_mentions: (option as WebhookMessageOptions)?.allowedMentions
    }

    if ((option as WebhookMessageOptions)?.name !== undefined) {
      payload.username = (option as WebhookMessageOptions)?.name
    }

    if ((option as WebhookMessageOptions)?.avatar !== undefined) {
      payload.avatar = (option as WebhookMessageOptions)?.avatar
    }

    if (
      payload.embeds !== undefined &&
      payload.embeds instanceof Array &&
      payload.embeds.length > 10
    )
      throw new Error(
        `Cannot send more than 10 embeds through Interaction Webhook`
      )

    const resp = await this.client.rest.post(`${this.url}?wait=true`, payload)

    const res = new Message(
      this.client,
      resp,
      (this as unknown) as TextChannel,
      (this as unknown) as User
    )
    await res.mentions.fromPayload(resp)
    return res
  }

  /** Edit a Followup message */
  async editMessage(
    msg: Message | string,
    data: {
      content?: string
      embeds?: Embed[]
      file?: any
      allowed_mentions?: {
        parse?: string
        roles?: string[]
        users?: string[]
        everyone?: boolean
      }
    }
  ): Promise<Interaction> {
    await this.client.rest.patch(
      WEBHOOK_MESSAGE(
        this.client.user?.id as string,
        this.token ?? this.client.token,
        typeof msg === 'string' ? msg : msg.id
      ),
      data
    )
    return this
  }

  /** Delete a follow-up Message */
  async deleteMessage(msg: Message | string): Promise<Interaction> {
    await this.client.rest.delete(
      WEBHOOK_MESSAGE(
        this.client.user?.id as string,
        this.token ?? this.client.token,
        typeof msg === 'string' ? msg : msg.id
      )
    )
    return this
  }
}
