import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { User } from '../models/user.entity';
import { MezonClientService } from '../../mezon/services/mezon-client.service';
import {
  MezonClient,
  EMarkdownType,
} from 'mezon-sdk';

export interface Player {
  id: string;
  name: string;
  chips: number;
  seat: number;
  hole: string[];
  hasFolded: boolean;
  currentBet: number;
  isAllIn: boolean;
}

export interface PlayerAction {
  playerId: string;
  playerName: string;
  action: 'bet' | 'call' | 'raise' | 'check' | 'fold' | 'allin';
  amount?: number;
  totalBet?: number;
  timestamp: Date;
  round: string;
}

export interface GameInvite {
  gameId: string;
  creatorId: string;
  clanId: string;
  channelId: string;
  messageId: string;
  mentionedUsers: { idUser: string; name: string }[];
  confirmedUsers: string[];
  declinedUsers: string[];
  expiresAt: Date;
  betAmount: number;
}

export interface GameResult {
  success: boolean;
  message?: string;
  game?: any;
  gameStarted?: boolean;
}

@Injectable()
export abstract class GameBaseService {
  protected client: MezonClient;
  protected activeGames: Map<string, any> = new Map();
  protected gameInvites: Map<string, GameInvite> = new Map();

  protected readonly SUITS = ['♠️', '♥️', '♦️', '♣️'];
  protected readonly RANKS = [
    '2',
    '3',
    '4',
    '5',
    '6',
    '7',
    '8',
    '9',
    '10',
    'J',
    'Q',
    'K',
    'A',
  ];

  protected constructor(
    protected userRepository: Repository<User>,
    protected mezonClientService: MezonClientService,
  ) {
    this.client = this.mezonClientService.getClient();
  }

  // --- UTILS ---

  protected createDeck(): string[] {
    const deck: string[] = [];
    for (const suit of this.SUITS) {
      for (const rank of this.RANKS) {
        deck.push(`${rank}${suit}`);
      }
    }
    return deck;
  }

  protected shuffleDeck(deck: string[]): void {
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
  }

  protected createGameKey(
    clanId: string,
    channelId: string,
    gameId: string,
  ): string {
    return `${clanId}_${channelId}_${gameId}`;
  }

  protected async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  // --- MONEY MANAGEMENT ---

  public async checkPlayersFunds(
    playerIds: { idUser: string; name: string }[],
    betAmount: number,
  ): Promise<{ success: boolean; message?: string }> {
    try {
      const insufficientFundsPlayers: string[] = [];

      for (const playerId of playerIds) {
        const user = await this.userRepository.findOne({
          where: { user_id: playerId.idUser },
        });

        if (!user) {
          return {
            success: false,
            message: `Người chơi ${playerId.name} không tồn tại trong hệ thống`,
          };
        }

        if (user.amount < betAmount) {
          insufficientFundsPlayers.push(
            user.display_name || user.username || playerId.name,
          );
        }
      }

      if (insufficientFundsPlayers.length > 0) {
        return {
          success: false,
          message: `Người chơi sau không đủ tiền: ${insufficientFundsPlayers.join(', ')} (Cần: ${betAmount.toLocaleString()})`,
        };
      }

      return { success: true };
    } catch (error) {
      console.error('Error checking player funds:', error);
      return {
        success: false,
        message: 'Lỗi kiểm tra số dư người chơi',
      };
    }
  }

  public async deductPlayersFunds(
    playerIds: string[],
    betAmount: number,
  ): Promise<{ success: boolean; message?: string }> {
    try {
      for (const playerId of playerIds) {
        const user = await this.userRepository.findOne({
          where: { user_id: playerId },
        });

        if (user && user.amount >= betAmount) {
          user.amount -= betAmount;
          await this.userRepository.save(user);
        }
      }
      return { success: true };
    } catch (error) {
      console.error('Error deducting player funds:', error);
      return {
        success: false,
        message: 'Lỗi trừ tiền người chơi',
      };
    }
  }

  protected async addMoneyToUser(
    playerId: string,
    amount: number,
  ): Promise<void> {
    try {
      const user = await this.userRepository.findOne({
        where: { user_id: playerId },
      });

      if (user) {
        user.amount += amount;
        await this.userRepository.save(user);
      }
    } catch (error) {
      console.error('Error adding money to user:', error);
    }
  }

  // --- MESSAGING ---

  async sendChannelMessage(
    clanId: string,
    channelId: string,
    content: string,
    components?: any[],
    user_id?: string,
    user_name?: string,
  ): Promise<string | null> {
    try {
      const client = this.mezonClientService.getClient();
      const clan = client.clans.get(clanId);
      const channel = await clan?.channels.fetch(channelId);

      if (channel) {
        const messagePayload: any = { t: content };
        if (components) {
          messagePayload.components = components;
        }
        messagePayload.mk = [
          { type: EMarkdownType.PRE, s: 0, e: content.length },
        ];

        if (user_id) {
          // Simple mention logic if needed, referencing PokerService implementation
          messagePayload.mentions = [
            {
              user_id: user_id,
              s: 0, // Simplified for base
              e: content.length,
            },
          ];
          messagePayload.allow_mentions = true;
        }

        const message = await (channel as any).send(messagePayload);
        return message?.message_id || null;
      }
    } catch (error) {
      console.error('❌ Lỗi gửi tin nhắn channel:', error);
    }
    return null;
  }

  async sendPrivateMessage(
    userId: string,
    content: string,
    clanId?: string,
    channelId?: string,
  ): Promise<void> {
    try {
      const client = this.mezonClientService.getClient();

      // Try ephemeral first (in-channel private message)
      if (clanId && channelId) {
        try {
          const clan = client.clans.get(clanId);
          const channel = await clan?.channels.fetch(channelId);

          if (channel) {
            await channel.sendEphemeral(userId, {
              mk: [{ type: EMarkdownType.PRE, s: 0, e: content.length }],
              t: content,
            });
            return; // Success
          }
        } catch (ephemeralError: any) {
          // If ephemeral fails (invalid channel type), fall through to DM
          if (ephemeralError?.code !== 3) {
            throw ephemeralError; // Re-throw if it's not "Invalid channel type"
          }
          console.log('Ephemeral not supported, using DM instead');
        }
      }

      // Fallback: Send DM directly
      const user = await client.users.fetch(userId);
      if (user) {
        await user.sendDM({
          mk: [{ type: EMarkdownType.PRE, s: 0, e: content.length }],
          t: content,
        });
      }
    } catch (error) {
      console.error('Error sending private message:', error);
    }
  }

  async deleteChannelMessage(
    clanId: string,
    channelId: string,
    messageId: string,
  ): Promise<void> {
    try {
      const client = this.mezonClientService.getClient();
      const clan = client.clans.get(clanId);
      const channel = await clan?.channels.fetch(channelId);
      const messagesChannel = await channel?.messages.fetch(messageId);
      await messagesChannel?.delete();
    } catch {
      // Ignore error
    }
  }

  async editChannelMessage(
    clanId: string,
    channelId: string,
    messageId: string,
    content: string,
    components?: any[],
  ): Promise<void> {
    try {
      const client = this.mezonClientService.getClient();
      const clan = client.clans.get(clanId);
      const channel = await clan?.channels.fetch(channelId);
      const messagesChannel = await channel?.messages.fetch(messageId);

      if (channel) {
        const messagePayload: any = {
          t: content,
          mk: [{ type: EMarkdownType.PRE, s: 0, e: content.length }],
        };
        if (components) {
          messagePayload.components = components;
        }

        await messagesChannel?.update(messagePayload);
      }
    } catch (error) {
      console.error('❌ Lỗi edit tin nhắn channel:', error);
    }
  }

  // --- INVITE SYSTEM (Generic) ---

  async createInvite(
    creatorId: string,
    clanId: string,
    channelId: string,
    messageId: string,
    allPlayers: { idUser: string; name: string }[],
    betAmount: number,
    gameTypePrefix: string, // e.g. 'lieng'
  ): Promise<{ success: boolean; gameId: string; message?: string }> {
    await Promise.resolve();
    const gameId = `${gameTypePrefix}_${Date.now()}`;
    const inviteKey = `${clanId}_${channelId}_${gameId}`; // Unique per game instance

    const invite: GameInvite = {
      gameId,
      creatorId,
      clanId,
      channelId,
      messageId,
      mentionedUsers: allPlayers,
      confirmedUsers: [creatorId],
      declinedUsers: [],
      expiresAt: new Date(Date.now() + 30000), // 30s timeout
      betAmount,
    };

    this.gameInvites.set(inviteKey, invite);

    // Abstracting timeout logic is complex because it calls back to specific game start logic.
    // For now, we will let the Child Service handle the specific "Timeout" and "Start Game" calls
    // But we provide this helper to store the state.

    return { success: true, gameId, message: 'Invite created' };
  }

  public getGameInvite(gameId: string): GameInvite | null {
    for (const [_, invite] of this.gameInvites.entries()) {
      if (invite.gameId === gameId) {
        return invite;
      }
    }
    return null;
  }

  // Abstract methods that must be implemented by children
  abstract startGame(
    creatorId: string,
    clanId: string,
    channelId: string,
    playerIds: string[],
    betAmount: number,
  ): Promise<any>;
}
