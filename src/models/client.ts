/* eslint-disable @typescript-eslint/method-signature-style */
import { User } from '../structures/user.ts'
import { GatewayIntents } from '../types/gateway.ts'
import { Gateway } from '../gateway/index.ts'
import { RESTManager, RESTOptions, TokenType } from './rest.ts'
import { DefaultCacheAdapter, ICacheAdapter } from './cacheAdapter.ts'
import { UsersManager } from '../managers/users.ts'
import { GuildManager } from '../managers/guilds.ts'
import { ChannelsManager } from '../managers/channels.ts'
import { ClientPresence } from '../structures/presence.ts'
import { EmojisManager } from '../managers/emojis.ts'
import { ActivityGame, ClientActivity } from '../types/presence.ts'
import { Extension } from './extensions.ts'
import { SlashClient } from './slashClient.ts'
import { Interaction } from '../structures/slash.ts'
import { SlashModule } from './slashModule.ts'
import { ShardManager } from './shard.ts'
import { Application } from '../structures/application.ts'
import { Invite } from '../structures/invite.ts'
import { INVITE } from '../types/endpoint.ts'
import { ClientEvents } from '../gateway/handlers/index.ts'
import type { Collector } from './collectors.ts'
import { HarmonyEventEmitter } from '../utils/events.ts'
import { VoiceRegion } from '../types/voice.ts'
import { fetchAuto } from '../../deps.ts'
import { DMChannel } from '../structures/dmChannel.ts'
import { Template } from '../structures/template.ts'

/** OS related properties sent with Gateway Identify */
export interface ClientProperties {
  os?: 'darwin' | 'windows' | 'linux' | 'custom_os' | string
  browser?: 'harmony' | string
  device?: 'harmony' | string
}

/** Some Client Options to modify behaviour */
export interface ClientOptions {
  /** ID of the Client/Application to initialize Slash Client REST */
  id?: string
  /** Token of the Bot/User */
  token?: string
  /** Gateway Intents */
  intents?: GatewayIntents[]
  /** Cache Adapter to use, defaults to Collections one */
  cache?: ICacheAdapter
  /** Force New Session and don't use cached Session (by persistent caching) */
  forceNewSession?: boolean
  /** Startup presence of client */
  presence?: ClientPresence | ClientActivity | ActivityGame
  /** Force all requests to Canary API */
  canary?: boolean
  /** Time till which Messages are to be cached, in MS. Default is 3600000 */
  messageCacheLifetime?: number
  /** Time till which Message Reactions are to be cached, in MS. Default is 3600000 */
  reactionCacheLifetime?: number
  /** Whether to fetch Uncached Message of Reaction or not? */
  fetchUncachedReactions?: boolean
  /** Client Properties */
  clientProperties?: ClientProperties
  /** Enable/Disable Slash Commands Integration (enabled by default) */
  enableSlash?: boolean
  /** Disable taking token from env if not provided (token is taken from env if present by default) */
  disableEnvToken?: boolean
  /** Override REST Options */
  restOptions?: RESTOptions
  /** Whether to fetch Gateway info or not */
  fetchGatewayInfo?: boolean
  /** ADVANCED: Shard ID to launch on */
  shard?: number
  /** ADVACNED: Shard count. */
  shardCount?: number | 'auto'
}

/**
 * Discord Client.
 */
export class Client extends HarmonyEventEmitter<ClientEvents> {
  /** REST Manager - used to make all requests */
  rest: RESTManager
  /** User which Client logs in to, undefined until logs in */
  user?: User
  /** WebSocket ping of Client */
  ping = 0
  /** Token of the Bot/User */
  token?: string
  /** Cache Adapter */
  cache: ICacheAdapter = new DefaultCacheAdapter()
  /** Gateway Intents */
  intents?: GatewayIntents[]
  /** Whether to force new session or not */
  forceNewSession?: boolean
  /** Time till messages to stay cached, in MS. */
  messageCacheLifetime: number = 3600000
  /** Time till messages to stay cached, in MS. */
  reactionCacheLifetime: number = 3600000
  /** Whether to fetch Uncached Message of Reaction or not? */
  fetchUncachedReactions: boolean = false
  /** Client Properties */
  clientProperties: ClientProperties
  /** Slash-Commands Management client */
  slash: SlashClient
  /** Whether to fetch Gateway info or not */
  fetchGatewayInfo: boolean = true

  /** Users Manager, containing all Users cached */
  users: UsersManager = new UsersManager(this)
  /** Guilds Manager, providing cache & API interface to Guilds */
  guilds: GuildManager = new GuildManager(this)
  /** Channels Manager, providing cache interface to Channels */
  channels: ChannelsManager = new ChannelsManager(this)
  /** Channels Manager, providing cache interface to Channels */
  emojis: EmojisManager = new EmojisManager(this)

  /** Last READY timestamp */
  upSince?: Date

  /** Client's presence. Startup one if set before connecting */
  presence: ClientPresence = new ClientPresence()
  _decoratedEvents?: {
    [name: string]: (...args: any[]) => void
  }

  _decoratedSlash?: Array<{
    name: string
    guild?: string
    parent?: string
    group?: string
    handler: (interaction: Interaction) => any
  }>

  _id?: string

  /** Shard on which this Client is */
  shard?: number
  /** Shard Count */
  shardCount: number | 'auto' = 'auto'
  /** Shard Manager of this Client if Sharded */
  shards: ShardManager
  /** Collectors set */
  collectors: Set<Collector> = new Set()

  /** Since when is Client online (ready). */
  get uptime(): number {
    if (this.upSince === undefined) return 0
    else {
      const dif = Date.now() - this.upSince.getTime()
      if (dif < 0) return 0
      else return dif
    }
  }

  get gateway(): Gateway {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    return this.shards.list.get('0') as Gateway
  }

  constructor(options: ClientOptions = {}) {
    super()
    this._id = options.id
    this.token = options.token
    this.intents = options.intents
    this.shards = new ShardManager(this)
    this.forceNewSession = options.forceNewSession
    if (options.cache !== undefined) this.cache = options.cache
    if (options.presence !== undefined)
      this.presence =
        options.presence instanceof ClientPresence
          ? options.presence
          : new ClientPresence(options.presence)
    if (options.messageCacheLifetime !== undefined)
      this.messageCacheLifetime = options.messageCacheLifetime
    if (options.reactionCacheLifetime !== undefined)
      this.reactionCacheLifetime = options.reactionCacheLifetime
    if (options.fetchUncachedReactions === true)
      this.fetchUncachedReactions = true

    if (
      this._decoratedEvents !== undefined &&
      Object.keys(this._decoratedEvents).length !== 0
    ) {
      Object.entries(this._decoratedEvents).forEach((entry) => {
        this.on(entry[0] as keyof ClientEvents, entry[1].bind(this))
      })
      this._decoratedEvents = undefined
    }

    this.clientProperties =
      options.clientProperties === undefined
        ? {
            os: Deno.build.os,
            browser: 'harmony',
            device: 'harmony'
          }
        : options.clientProperties

    if (options.shard !== undefined) this.shard = options.shard
    if (options.shardCount !== undefined) this.shardCount = options.shardCount

    this.fetchGatewayInfo = options.fetchGatewayInfo ?? true

    if (this.token === undefined) {
      try {
        const token = Deno.env.get('DISCORD_TOKEN')
        if (token !== undefined) {
          this.token = token
          this.debug('Info', 'Found token in ENV')
        }
      } catch (e) {}
    }

    const restOptions: RESTOptions = {
      token: () => this.token,
      tokenType: TokenType.Bot,
      canary: options.canary,
      client: this
    }

    if (options.restOptions !== undefined)
      Object.assign(restOptions, options.restOptions)
    this.rest = new RESTManager(restOptions)

    this.slash = new SlashClient({
      id: () => this.getEstimatedID(),
      client: this,
      enabled: options.enableSlash
    })
  }

  /**
   * Sets Cache Adapter
   *
   * Should NOT be set after bot is already logged in or using current cache.
   * Please look into using `cache` option.
   */
  setAdapter(adapter: ICacheAdapter): Client {
    this.cache = adapter
    return this
  }

  /** Changes Presence of Client */
  setPresence(presence: ClientPresence | ClientActivity | ActivityGame): void {
    if (presence instanceof ClientPresence) {
      this.presence = presence
    } else this.presence = new ClientPresence(presence)
    this.gateway?.sendPresence(this.presence.create())
  }

  /** Emits debug event */
  debug(tag: string, msg: string): void {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.emit('debug', `[${tag}] ${msg}`)
  }

  getEstimatedID(): string {
    if (this.user !== undefined) return this.user.id
    else if (this.token !== undefined) {
      try {
        return atob(this.token.split('.')[0])
      } catch (e) {
        return this._id ?? 'unknown'
      }
    } else {
      return this._id ?? 'unknown'
    }
  }

  /** Fetch Application of the Client */
  async fetchApplication(): Promise<Application> {
    const app = await this.rest.api.oauth2.applications['@me'].get()
    return new Application(this, app)
  }

  /** Fetch an Invite */
  async fetchInvite(id: string): Promise<Invite> {
    return await new Promise((resolve, reject) => {
      this.rest
        .get(INVITE(id))
        .then((data) => {
          resolve(new Invite(this, data))
        })
        .catch((e) => reject(e))
    })
  }

  /**
   * This function is used for connecting to discord.
   * @param token Your token. This is required if not given in ClientOptions.
   * @param intents Gateway intents in array. This is required if not given in ClientOptions.
   */
  async connect(token?: string, intents?: GatewayIntents[]): Promise<Client> {
    if (token === undefined && this.token !== undefined) token = this.token
    else if (this.token === undefined && token !== undefined) {
      this.token = token
    } else throw new Error('No Token Provided')
    if (intents !== undefined && this.intents !== undefined) {
      this.debug(
        'client',
        'Intents were set in both client and connect function. Using the one in the connect function...'
      )
    } else if (intents === undefined && this.intents !== undefined) {
      intents = this.intents
    } else if (intents !== undefined && this.intents === undefined) {
      this.intents = intents
    } else throw new Error('No Gateway Intents were provided')

    this.rest.token = token
    if (this.shard !== undefined) {
      if (typeof this.shardCount === 'number')
        this.shards.cachedShardCount = this.shardCount
      await this.shards.launch(this.shard)
    } else await this.shards.connect()
    return this.waitFor('ready', () => true).then(() => this)
  }

  /** Destroy the Gateway connection */
  async destroy(): Promise<Client> {
    this.gateway.initialized = false
    this.gateway.sequenceID = undefined
    this.gateway.sessionID = undefined
    await this.gateway.cache.delete('seq')
    await this.gateway.cache.delete('session_id')
    this.gateway.close()
    this.user = undefined
    this.upSince = undefined
    return this
  }

  /** Attempt to Close current Gateway connection and Resume */
  async reconnect(): Promise<Client> {
    this.gateway.close()
    this.gateway.initWebsocket()
    return this.waitFor('ready', () => true).then(() => this)
  }

  /** Add a new Collector */
  addCollector(collector: Collector): boolean {
    if (this.collectors.has(collector)) return false
    else {
      this.collectors.add(collector)
      return true
    }
  }

  /** Remove a Collector */
  removeCollector(collector: Collector): boolean {
    if (!this.collectors.has(collector)) return false
    else {
      this.collectors.delete(collector)
      return true
    }
  }

  async emit(event: keyof ClientEvents, ...args: any[]): Promise<void> {
    const collectors: Collector[] = []
    for (const collector of this.collectors.values()) {
      if (collector.event === event) collectors.push(collector)
    }
    if (collectors.length !== 0) {
      this.collectors.forEach((collector) => collector._fire(...args))
    }
    // TODO(DjDeveloperr): Fix this ts-ignore
    // eslint-disable-next-line @typescript-eslint/prefer-ts-expect-error
    // @ts-ignore
    return super.emit(event, ...args)
  }

  /** Returns an array of voice region objects that can be used when creating servers. */
  async fetchVoiceRegions(): Promise<VoiceRegion[]> {
    return this.rest.api.voice.regions.get()
  }

  /** Modify current (Client) User. */
  async editUser(data: {
    username?: string
    avatar?: string
  }): Promise<Client> {
    if (data.username === undefined && data.avatar === undefined)
      throw new Error(
        'Either username or avatar or both must be specified to edit'
      )

    if (data.avatar?.startsWith('http') === true) {
      data.avatar = await fetchAuto(data.avatar)
    }

    await this.rest.api.users['@me'].patch({
      username: data.username,
      avatar: data.avatar
    })
    return this
  }

  /** Change Username of the Client User */
  async setUsername(username: string): Promise<Client> {
    return await this.editUser({ username })
  }

  /** Change Avatar of the Client User */
  async setAvatar(avatar: string): Promise<Client> {
    return await this.editUser({ avatar })
  }

  /** Create a DM Channel with a User */
  async createDM(user: User | string): Promise<DMChannel> {
    const id = typeof user === 'object' ? user.id : user
    const dmPayload = await this.rest.api.users['@me'].channels.post({
      recipient_id: id
    })
    await this.channels.set(dmPayload.id, dmPayload)
    return (this.channels.get<DMChannel>(dmPayload.id) as unknown) as DMChannel
  }

  /** Returns a template object for the given code. */
  async fetchTemplate(code: string): Promise<Template> {
    const payload = await this.rest.api.guilds.templates[code].get()
    return new Template(this, payload)
  }
}

/** Event decorator to create an Event handler from function */
export function event(name?: keyof ClientEvents) {
  return function (
    client: Client | Extension,
    prop: keyof ClientEvents | string
  ) {
    const listener = ((client as unknown) as {
      [name in keyof ClientEvents]: (...args: ClientEvents[name]) => any
    })[(prop as unknown) as keyof ClientEvents]
    if (typeof listener !== 'function')
      throw new Error('@event decorator requires a function')
    if (client._decoratedEvents === undefined) client._decoratedEvents = {}
    const key = name === undefined ? prop : name

    client._decoratedEvents[key] = listener
  }
}

/** Decorator to create a Slash Command handler */
export function slash(name?: string, guild?: string) {
  return function (client: Client | SlashClient | SlashModule, prop: string) {
    if (client._decoratedSlash === undefined) client._decoratedSlash = []
    const item = (client as { [name: string]: any })[prop]
    if (typeof item !== 'function') {
      throw new Error('@slash decorator requires a function')
    } else
      client._decoratedSlash.push({
        name: name ?? prop,
        guild,
        handler: item
      })
  }
}

/** Decorator to create a Sub-Slash Command handler */
export function subslash(parent: string, name?: string, guild?: string) {
  return function (client: Client | SlashModule | SlashClient, prop: string) {
    if (client._decoratedSlash === undefined) client._decoratedSlash = []
    const item = (client as { [name: string]: any })[prop]
    if (typeof item !== 'function') {
      throw new Error('@subslash decorator requires a function')
    } else
      client._decoratedSlash.push({
        parent,
        name: name ?? prop,
        guild,
        handler: item
      })
  }
}

/** Decorator to create a Grouped Slash Command handler */
export function groupslash(
  parent: string,
  group: string,
  name?: string,
  guild?: string
) {
  return function (client: Client | SlashModule | SlashClient, prop: string) {
    if (client._decoratedSlash === undefined) client._decoratedSlash = []
    const item = (client as { [name: string]: any })[prop]
    if (typeof item !== 'function') {
      throw new Error('@groupslash decorator requires a function')
    } else
      client._decoratedSlash.push({
        group,
        parent,
        name: name ?? prop,
        guild,
        handler: item
      })
  }
}
