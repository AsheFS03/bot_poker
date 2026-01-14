import { ChannelMessage, EMarkdownType } from 'mezon-sdk';
import { Command } from 'src/bot/base/command-register.decorator';
import { EmbedProps } from 'src/bot/constants/configs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CommandMessage } from 'src/bot/base/command.abstract';
import { getRandomColor } from 'src/bot/utils/helps';
import { MezonClientService } from 'src/mezon/services/mezon-client.service';
import { RoleService } from './role.service';
import { User } from 'src/bot/models/user.entity';

@Command('role')
export class RoleCommand extends CommandMessage {
  constructor(
    clientService: MezonClientService,
    private roleService: RoleService,
    @InjectRepository(User) private userRepository: Repository<User>,
  ) {
    super(clientService);
  }

  async execute(args: string[], message: ChannelMessage) {
    const messageChannel = await this.getChannelMessage(message);
    const cmds = args.join(' ').split('+');
    const clan = await this.client.clans.fetch(message.clan_id || '');
    const response = await clan.listRoles();
    const roleList = response.roles?.roles || [];
    const options = roleList.filter(
      (role) => role.id !== '1840654634100723712',
    );
    const bot = await this.userRepository.findOne({
      where: { user_id: process.env.BOT_ID || '' },
    });
    if (!bot?.roleClan || !bot?.roleClan[message.clan_id || '']) {
      const content = `[Role] - You must assign role to bot!`;
      return await messageChannel?.reply({
        t: content,
        mk: [
          {
            type: EMarkdownType.PRE,
            s: 0,
            e: content.length,
          },
        ],
      });
    }
    const isSenderWhitelisted = bot?.whitelist?.[
      message.clan_id || ''
    ]?.includes(message.username || '');
    if (!isSenderWhitelisted) {
      const content = `[Role] - You have no permission!`;
      return await messageChannel?.reply({
        t: content,
        mk: [
          {
            type: EMarkdownType.PRE,
            s: 0,
            e: content.length,
          },
        ],
      });
    }

    const colorEmbed = getRandomColor();
    const embedComponents = this.roleService.generateEmbedComponents(options);
    const embed: EmbedProps[] = this.roleService.generateEmbedMessage(
      cmds[0],
      colorEmbed,
      embedComponents,
    );
    const components = this.roleService.generateButtonComponents({
      ...message,
      color: colorEmbed,
    });

    const roleMessageSent = await messageChannel?.reply({
      embed,
      components,
    });
    if (!roleMessageSent) return;
  }
}
