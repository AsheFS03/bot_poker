import { ChannelMessage, EMarkdownType } from 'mezon-sdk';
import { CommandMessage } from '../../base/command.abstract';
import { Command } from '../../base/command-register.decorator';
import { LiengService } from './lieng.service';
import { MezonClientService } from '../../../mezon/services/mezon-client.service';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from '../../models/user.entity';
import { Repository } from 'typeorm';

@Command('lieng')
export class LiengCommand extends CommandMessage {
  constructor(
    private liengService: LiengService,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    clientService: MezonClientService,
  ) {
    super(clientService);
  }

  async execute(args: string[], message: ChannelMessage): Promise<void> {
    // If no args provided, show help message
    if (!args || args.length === 0) {
      await this.replyMessage(
        message,
        '❌ **Sử dụng lệnh Liêng:**\n' +
          '• `*lieng start [số tiền] @người1 @người2 ...`\n' +
          '• Ví dụ: `*lieng start 5000 @user1 @user2`\n' +
          '• Hoặc gõ `*lieng help` để xem thêm',
      );
      return;
    }

    const command = args[0].toLowerCase();
    const commandArgs = args.slice(1);

    try {
      switch (command) {
        case 'start':
          await this.handleStart(commandArgs, message);
          break;
        case 'help':
          await this.replyMessage(
            message,
            '📖 **Hướng dẫn chơi Liêng**\n\n' +
              '**Lệnh:**\n' +
              '• `*lieng start [số tiền cược] @người1 @người2 ...`\n\n' +
              '**Luật chơi:**\n' +
              '• Mỗi người nhận 3 lá bài\n' +
              '• Xếp hạng: Sáp > Liêng > Ảnh > Điểm\n' +
              '• Cược: Theo/Tố/Bỏ\n\n' +
              '**Ví dụ:** `*lieng start 5000 @user1 @user2`',
          );
          break;
        default:
          await this.replyMessage(
            message,
            '❌ Lệnh không hợp lệ. Gõ `*lieng help` để xem hướng dẫn.',
          );
      }
    } catch (error) {
      console.error('❌ Lieng command error:', error);
      await this.replyMessage(
        message,
        `❌ Lỗi: ${error.message || 'Có lỗi xảy ra'}`,
      );
    }
  }

  private async handleStart(args: string[], message: ChannelMessage) {
    const mentions = message.mentions || [];
    const betAmount = parseInt(args[0]) || 1000;

    if (mentions.length === 0) {
      await this.replyMessage(message, '❌ Cần mention người chơi!');
      return;
    }

    const players = mentions.map((m) => ({
      idUser: m.user_id,
      name: m.username || 'User',
    }));
    // Add creator
    players.push({
      idUser: message.sender_id || '',
      name: message.username || 'User',
    });

    // Unique
    const uniquePlayers = Array.from(
      new Map(players.map((p) => [p.idUser, p])).values(),
    ).map((p) => ({
      idUser: p.idUser || '',
      name: p.name,
    }));

    // CHECK TIỀN TRƯỚC KHI TẠO INVITE
    const fundCheck = await this.liengService.checkPlayersFunds(
      uniquePlayers,
      betAmount,
    );

    if (!fundCheck.success) {
      await this.replyMessage(message, `❌ ${fundCheck.message}`);
      return;
    }

    const result = await this.liengService.createLiengInvite(
      message.sender_id || '',
      message.clan_id || '',
      message.channel_id,
      message.message_id || '',
      uniquePlayers,
      betAmount,
    );

    if (result.success) {
      await this.replyMessage(
        message,
        `🎴 **Lời mời đã tạo!**\n💰 Cược: ${betAmount.toLocaleString()}\n⏰ Game tự động bắt đầu sau 30s hoặc khi tất cả đã phản hồi.`,
      );
    }
  }

  private async replyMessage(message: ChannelMessage, content: string) {
    try {
      const messageChannel = await this.getChannelMessage(message);
      if (!messageChannel) {
        console.error('❌ Cannot get channel message');
        return;
      }

      await messageChannel.reply({
        t: content,
        mk: [{ type: EMarkdownType.PRE, s: 0, e: content.length }],
      });
    } catch (error) {
      console.error('❌ Reply error:', error);
    }
  }
}
