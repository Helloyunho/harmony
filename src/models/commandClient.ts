import { Message } from '../structures/message.ts'
import { GuildTextChannel } from '../structures/textChannel.ts'
import { awaitSync } from '../utils/mixedPromise.ts'
import { Client, ClientOptions } from './client.ts'
import {
  CategoriesManager,
  Command,
  CommandContext,
  CommandOptions,
  CommandsManager,
  parseCommand
} from './command.ts'
import { Extension, ExtensionsManager } from './extensions.ts'

type PrefixReturnType = string | string[] | Promise<string | string[]>

/** Command Client options extending Client Options to provide a lot of Commands-related customizations */
export interface CommandClientOptions extends ClientOptions {
  /** Global prefix(s) of the bot. */
  prefix: string | string[]
  /** Whether to enable mention prefix or not. */
  mentionPrefix?: boolean
  /** Method to get a Guild's custom prefix(s). */
  getGuildPrefix?: (guildID: string) => PrefixReturnType
  /** Method to get a User's custom prefix(s). */
  getUserPrefix?: (userID: string) => PrefixReturnType
  /** Method to get a Channel's custom prefix(s). */
  getChannelPrefix?: (channelID: string) => PrefixReturnType
  /** Method to check if certain Guild is blacklisted from using Commands. */
  isGuildBlacklisted?: (guildID: string) => boolean | Promise<boolean>
  /** Method to check if certain User is blacklisted from using Commands. */
  isUserBlacklisted?: (guildID: string) => boolean | Promise<boolean>
  /** Method to check if certain Channel is blacklisted from using Commands. */
  isChannelBlacklisted?: (guildID: string) => boolean | Promise<boolean>
  /** Allow spaces after prefix? Recommended with Mention Prefix ON. */
  spacesAfterPrefix?: boolean
  /** List of Bot's Owner IDs whom can access `ownerOnly` commands. */
  owners?: string[]
  /** Whether to allow Bots to use Commands or not, not allowed by default. */
  allowBots?: boolean
  /** Whether to allow Commands in DMs or not, allowed by default. */
  allowDMs?: boolean
  /** Whether Commands should be case-sensitive or not, not by default. */
  caseSensitive?: boolean
}

export class CommandClient extends Client implements CommandClientOptions {
  prefix: string | string[]
  mentionPrefix: boolean

  getGuildPrefix: (guildID: string) => PrefixReturnType
  getUserPrefix: (userID: string) => PrefixReturnType
  getChannelPrefix: (channelID: string) => PrefixReturnType

  isGuildBlacklisted: (guildID: string) => boolean | Promise<boolean>
  isUserBlacklisted: (guildID: string) => boolean | Promise<boolean>
  isChannelBlacklisted: (guildID: string) => boolean | Promise<boolean>

  spacesAfterPrefix: boolean
  owners: string[]
  allowBots: boolean
  allowDMs: boolean
  caseSensitive: boolean

  extensions: ExtensionsManager = new ExtensionsManager(this)
  commands: CommandsManager = new CommandsManager(this)
  categories: CategoriesManager = new CategoriesManager(this)

  _decoratedCommands?: { [name: string]: Command }

  constructor(options: CommandClientOptions) {
    super(options)
    this.prefix = options.prefix
    this.mentionPrefix =
      options.mentionPrefix === undefined ? false : options.mentionPrefix

    this.getGuildPrefix =
      options.getGuildPrefix === undefined
        ? (id: string) => this.prefix
        : options.getGuildPrefix
    this.getUserPrefix =
      options.getUserPrefix === undefined
        ? (id: string) => this.prefix
        : options.getUserPrefix

    this.getChannelPrefix =
      options.getChannelPrefix === undefined
        ? (id: string) => this.prefix
        : options.getChannelPrefix

    this.isUserBlacklisted =
      options.isUserBlacklisted === undefined
        ? (id: string) => false
        : options.isUserBlacklisted
    this.isGuildBlacklisted =
      options.isGuildBlacklisted === undefined
        ? (id: string) => false
        : options.isGuildBlacklisted
    this.isChannelBlacklisted =
      options.isChannelBlacklisted === undefined
        ? (id: string) => false
        : options.isChannelBlacklisted

    this.spacesAfterPrefix =
      options.spacesAfterPrefix === undefined
        ? false
        : options.spacesAfterPrefix

    this.owners = options.owners === undefined ? [] : options.owners
    this.allowBots = options.allowBots === undefined ? false : options.allowBots
    this.allowDMs = options.allowDMs === undefined ? true : options.allowDMs
    this.caseSensitive =
      options.caseSensitive === undefined ? false : options.caseSensitive

    if (this._decoratedCommands !== undefined) {
      Object.values(this._decoratedCommands).forEach((entry) => {
        this.commands.add(entry)
      })
      this._decoratedCommands = undefined
    }

    this.on(
      'messageCreate',
      async (msg: Message) => await this.processMessage(msg)
    )
  }

  /** Processes a Message to Execute Command. */
  async processMessage(msg: Message): Promise<any> {
    if (!this.allowBots && msg.author.bot === true) return

    const isUserBlacklisted = await awaitSync(
      this.isUserBlacklisted(msg.author.id)
    )
    if (isUserBlacklisted === true) return

    const isChannelBlacklisted = await awaitSync(
      this.isChannelBlacklisted(msg.channel.id)
    )
    if (isChannelBlacklisted === true) return

    if (msg.guild !== undefined) {
      const isGuildBlacklisted = await awaitSync(
        this.isGuildBlacklisted(msg.guild.id)
      )
      if (isGuildBlacklisted === true) return
    }

    let prefix: string | string[] = []
    if (typeof this.prefix === 'string') prefix = [...prefix, this.prefix]
    else prefix = [...prefix, ...this.prefix]

    const userPrefix = await awaitSync(this.getUserPrefix(msg.author.id))
    if (userPrefix !== undefined) {
      if (typeof userPrefix === 'string') prefix = [...prefix, userPrefix]
      else prefix = [...prefix, ...userPrefix]
    }

    if (msg.guild !== undefined) {
      const guildPrefix = await awaitSync(this.getGuildPrefix(msg.guild.id))
      if (guildPrefix !== undefined) {
        if (typeof guildPrefix === 'string') prefix = [...prefix, guildPrefix]
        else prefix = [...prefix, ...guildPrefix]
      }
    }

    prefix = [...new Set(prefix)]

    let mentionPrefix = false

    let usedPrefix = prefix
      .filter((v) => msg.content.startsWith(v))
      .sort((b, a) => a.length - b.length)[0]
    if (usedPrefix === undefined && this.mentionPrefix) mentionPrefix = true

    if (mentionPrefix) {
      if (msg.content.startsWith(this.user?.mention as string) === true)
        usedPrefix = this.user?.mention as string
      else if (
        msg.content.startsWith(this.user?.nickMention as string) === true
      )
        usedPrefix = this.user?.nickMention as string
      else return
    }

    if (typeof usedPrefix !== 'string') return
    prefix = usedPrefix

    const parsed = parseCommand(this, msg, prefix)
    if (parsed === undefined) return
    const command = this.commands.fetch(parsed)

    if (command === undefined) return
    const category =
      command.category !== undefined
        ? this.categories.get(command.category)
        : undefined

    // Guild whitelist exists, and if does and Command used in a Guild, is this Guild allowed?
    // This is a bit confusing here, if these settings on a Command exist, and also do on Category, Command overrides them
    if (
      command.whitelistedGuilds === undefined &&
      category?.whitelistedGuilds !== undefined &&
      msg.guild !== undefined &&
      category.whitelistedGuilds.includes(msg.guild.id) === false
    )
      return
    if (
      command.whitelistedGuilds !== undefined &&
      msg.guild !== undefined &&
      command.whitelistedGuilds.includes(msg.guild.id) === false
    )
      return

    // Checks for Channel Whitelist
    if (
      command.whitelistedChannels === undefined &&
      category?.whitelistedChannels !== undefined &&
      category.whitelistedChannels.includes(msg.channel.id) === false
    )
      return
    if (
      command.whitelistedChannels !== undefined &&
      command.whitelistedChannels.includes(msg.channel.id) === false
    )
      return

    // Checks for Users Whitelist
    if (
      command.whitelistedUsers === undefined &&
      category?.whitelistedUsers !== undefined &&
      category.whitelistedUsers.includes(msg.author.id) === false
    )
      return
    if (
      command.whitelistedUsers !== undefined &&
      command.whitelistedUsers.includes(msg.author.id) === false
    )
      return

    const ctx: CommandContext = {
      client: this,
      name: parsed.name,
      prefix,
      args: parsed.args,
      argString: parsed.argString,
      message: msg,
      author: msg.author,
      command,
      channel: msg.channel,
      guild: msg.guild
    }

    // In these checks too, Command overrides Category if present
    // Checks if Command is only for Owners
    if (
      (command.ownerOnly !== undefined || category === undefined
        ? command.ownerOnly
        : category.ownerOnly) === true &&
      !this.owners.includes(msg.author.id)
    )
      return this.emit('commandOwnerOnly', ctx)

    // Checks if Command is only for Guild
    if (
      (command.guildOnly !== undefined || category === undefined
        ? command.guildOnly
        : category.guildOnly) === true &&
      msg.guild === undefined
    )
      return this.emit('commandGuildOnly', ctx)

    // Checks if Command is only for DMs
    if (
      (command.dmOnly !== undefined || category === undefined
        ? command.dmOnly
        : category.dmOnly) === true &&
      msg.guild !== undefined
    )
      return this.emit('commandDmOnly', ctx)

    if (
      command.nsfw === true &&
      (msg.guild === undefined ||
        ((msg.channel as unknown) as GuildTextChannel).nsfw !== true)
    )
      return this.emit('commandNSFW', ctx)

    const allPermissions =
      command.permissions !== undefined
        ? command.permissions
        : category?.permissions

    if (
      (command.botPermissions !== undefined ||
        category?.permissions !== undefined) &&
      msg.guild !== undefined
    ) {
      // TODO: Check Overwrites too
      const me = await msg.guild.me()
      const missing: string[] = []

      let permissions =
        command.botPermissions === undefined
          ? category?.permissions
          : command.botPermissions

      if (permissions !== undefined) {
        if (typeof permissions === 'string') permissions = [permissions]

        if (allPermissions !== undefined)
          permissions = [...new Set(...permissions, ...allPermissions)]

        for (const perm of permissions) {
          if (me.permissions.has(perm) === false) missing.push(perm)
        }

        if (missing.length !== 0)
          return this.emit('commandBotMissingPermissions', ctx, missing)
      }
    }

    if (
      (command.userPermissions !== undefined ||
        category?.userPermissions !== undefined) &&
      msg.guild !== undefined
    ) {
      let permissions =
        command.userPermissions !== undefined
          ? command.userPermissions
          : category?.userPermissions

      if (permissions !== undefined) {
        if (typeof permissions === 'string') permissions = [permissions]

        if (allPermissions !== undefined)
          permissions = [...new Set(...permissions, ...allPermissions)]

        const missing: string[] = []

        for (const perm of permissions) {
          const has = msg.member?.permissions.has(perm)
          if (has !== true) missing.push(perm)
        }

        if (missing.length !== 0)
          return this.emit('commandUserMissingPermissions', ctx, missing)
      }
    }

    if (command.args !== undefined) {
      if (typeof command.args === 'boolean' && parsed.args.length === 0)
        return this.emit('commandMissingArgs', ctx)
      else if (
        typeof command.args === 'number' &&
        parsed.args.length < command.args
      )
        this.emit('commandMissingArgs', ctx)
    }

    try {
      this.emit('commandUsed', ctx)

      const beforeExecute = await awaitSync(command.beforeExecute(ctx))
      if (beforeExecute === false) return

      const result = await awaitSync(command.execute(ctx))
      command.afterExecute(ctx, result)
    } catch (e) {
      this.emit('commandError', ctx, e)
    }
  }
}

/** Command decorator */
export function command(options?: CommandOptions) {
  return function (target: CommandClient | Extension, name: string) {
    if (target._decoratedCommands === undefined) target._decoratedCommands = {}

    const prop = ((target as unknown) as {
      [name: string]: (ctx: CommandContext) => any
    })[name]

    if (typeof prop !== 'function')
      throw new Error('@command decorator can only be used on functions')

    const command = new Command()

    command.name = name
    command.execute = prop

    if (options !== undefined) Object.assign(command, options)

    if (target instanceof Extension) command.extension = target

    target._decoratedCommands[command.name] = command
  }
}
