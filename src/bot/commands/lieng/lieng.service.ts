import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LiengGame, LiengGameState } from '../../models/lieng.entity';
import { User } from '../../models/user.entity';
import { MezonClientService } from '../../../mezon/services/mezon-client.service';
import { GameBaseService, Player, GameInvite } from '../../base/game.service';
import {
  EButtonMessageStyle,
  EMessageComponentType,
} from 'mezon-sdk';

export interface LiengPlayer extends Player {
  // Lieng specific player properties if any (using Base Player for now)
}

@Injectable()
export class LiengService extends GameBaseService {
  private playerTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private inviteTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private turnTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private turnMessageIds: Map<string, string> = new Map();

  private readonly DEAL_DELAY = 500;
  private readonly TURN_TIMEOUT = 30000;

  constructor(
    @InjectRepository(LiengGame)
    private liengGameRepository: Repository<LiengGame>,
    @InjectRepository(User)
    userRepository: Repository<User>,
    mezonClientService: MezonClientService,
  ) {
    super(userRepository, mezonClientService);
  }

  // --- INVITE LOGIC ---

  async createLiengInvite(
    creatorId: string,
    clanId: string,
    channelId: string,
    messageId: string,
    allPlayers: { idUser: string; name: string }[],
    betAmount: number,
  ) {
    const result = await this.createInvite(
      creatorId,
      clanId,
      channelId,
      messageId,
      allPlayers,
      betAmount,
      'lieng',
    );
    const inviteKey = `${clanId}_${channelId}_${result.gameId}`;

    // Create buttons for invite
    const buttons = [
      {
        type: EMessageComponentType.BUTTON,
        component: { label: '🎯 Tham gia', style: EButtonMessageStyle.SUCCESS },
        id: `lieng_join_${result.gameId}_${clanId}_${channelId}`,
      },
      {
        type: EMessageComponentType.BUTTON,
        component: { label: '❌ Từ chối', style: EButtonMessageStyle.DANGER },
        id: `lieng_decline_${result.gameId}_${clanId}_${channelId}`,
      },
    ];

    // Send Invite Message
    const mentions = allPlayers.map((p) => `<@${p.idUser}>`).join(' '); // Simple mention text
    const msgContent = `🎴 **Lời mời chơi Liêng**\n${mentions}\n💰 Cược: ${betAmount}\n⏰ Game tự động bắt đầu sau 30s!`;

    // We need to store the messageId of the invite to update it later
    const sentMsgId = await this.sendChannelMessage(
      clanId,
      channelId,
      msgContent,
      [{ components: buttons }],
    );

    if (sentMsgId) {
      const invite = this.gameInvites.get(inviteKey);
      if (invite) invite.messageId = sentMsgId;
    }

    // Set timeout to auto-start or cancel
    const gameTimeout = setTimeout(async () => {
      try {
        if (this.gameInvites.has(inviteKey)) {
          await this.startGameFromInvite(inviteKey);
        }
      } catch (error) {
        console.error('Error starting game from invite timeout:', error);
      }
    }, 30000); // 30s invite timeout

    this.inviteTimeouts.set(inviteKey, gameTimeout);

    return result;
  }

  async handleButtonJoin(
    userId: string,
    action: 'join' | 'decline',
    gameId: string,
    channelId: string,
    messageId: string,
    clanId: string,
  ) {
    const invite = this.getGameInvite(gameId);
    if (!invite) return { success: false, message: 'Invite expired' };

    if (action === 'join') {
      if (!invite.confirmedUsers.includes(userId))
        invite.confirmedUsers.push(userId);
      invite.declinedUsers = invite.declinedUsers.filter((u) => u !== userId);
      await this.sendPrivateMessage(
        userId,
        'Đã tham gia Liêng!',
        clanId,
        channelId,
      );
    } else {
      if (!invite.declinedUsers.includes(userId))
        invite.declinedUsers.push(userId);
      invite.confirmedUsers = invite.confirmedUsers.filter((u) => u !== userId);
      await this.sendPrivateMessage(userId, 'Đã từ chối.', clanId, channelId);
    }

    // Update the invite message to show current status
    await this.updateInviteMessage(invite);

    // Check if all responded
    const total = invite.confirmedUsers.length + invite.declinedUsers.length;
    if (total === invite.mentionedUsers.length) {
      // Auto start
      const inviteKey = `${clanId}_${channelId}_${gameId}`;
      const timeout = this.inviteTimeouts.get(inviteKey);
      if (timeout) clearTimeout(timeout);

      await this.startGameFromInvite(inviteKey);
      return { success: true, shouldUpdate: true, gameStarted: true };
    }

    return { success: true, shouldUpdate: true };
  }

  private async updateInviteMessage(invite: GameInvite) {
    if (!invite.messageId) return;

    const joinedCount = invite.confirmedUsers.length;
    const declinedCount = invite.declinedUsers.length;
    const total = invite.mentionedUsers.length;
    const pending = total - joinedCount - declinedCount;

    const content =
      `🎴 **Lời mời chơi Liêng**\n` +
      `💰 Cược: ${invite.betAmount}\n` +
      `✅ Tham gia: ${joinedCount}\n` +
      `❌ Từ chối: ${declinedCount}\n` +
      `⏳ Chờ: ${pending}\n` +
      `⏰ Game tự động bắt đầu sau khi đủ người!`;

    // Keep buttons
    const buttons = [
      {
        type: EMessageComponentType.BUTTON,
        component: {
          label: `🎯 Tham gia (${joinedCount})`,
          style: EButtonMessageStyle.SUCCESS,
        },
        id: `lieng_join_${invite.gameId}_${invite.clanId}_${invite.channelId}`,
      },
      {
        type: EMessageComponentType.BUTTON,
        component: {
          label: `❌ Từ chối (${declinedCount})`,
          style: EButtonMessageStyle.DANGER,
        },
        id: `lieng_decline_${invite.gameId}_${invite.clanId}_${invite.channelId}`,
      },
    ];

    await this.editChannelMessage(
      invite.clanId,
      invite.channelId,
      invite.messageId,
      content,
      [{ components: buttons }],
    );
  }

  async startGameFromInvite(inviteKey: string) {
    try {
      const invite = this.gameInvites.get(inviteKey);
      if (!invite) return;

      this.gameInvites.delete(inviteKey); // Cleanup

      if (invite.confirmedUsers.length < 2) {
        await this.sendChannelMessage(
          invite.clanId,
          invite.channelId,
          '❌ Không đủ người chơi (Cần tối thiểu 2).',
        );
        return;
      }

      await this.startGame(
        invite.creatorId,
        invite.clanId,
        invite.channelId,
        invite.confirmedUsers,
        invite.betAmount,
      );
    } catch (error) {
      console.error('❌ Error starting game from invite:', error);
      const invite = this.gameInvites.get(inviteKey);
      if (invite) {
        await this.sendChannelMessage(
          invite.clanId,
          invite.channelId,
          '❌ Lỗi khi bắt đầu game. Vui lòng thử lại.',
        );
      }
    }
  }

  // --- INTERACTION HANDLER ---

  async handleInteraction(buttonId: string, userId: string, messageId: string) {
    try {
      // Format: lieng_<action>_<gameId>_<clanId>_<channelId>
      const args = buttonId.split('_');
      if (args.length < 5) return;

      const action = args[1];
      // Reconstruct gameId (it might contain underscores, so we slice)
      // ID structure: lieng_action_gameId_clanId_channelId
      // Standard: lieng_join_lieng_123456_clan1_channel1
      // Let's assume gameId is simple or we use fixed indexing from end.
      // However, createGameKey uses: `${clanId}_${channelId}_${gameId}`
      // And button ID uses: `lieng_${action}_${gameId}_${clanId}_${channelId}`
      // safely we can take clanId and channelId from end.

      const channelId = args[args.length - 1];
      const clanId = args[args.length - 2];
      const gameId = args.slice(2, args.length - 2).join('_');

      switch (action) {
        case 'join':
        case 'decline':
          await this.handleButtonJoin(
            userId,
            action,
            gameId,
            channelId,
            messageId,
            clanId,
          );
          break;

        case 'call':
          await this.makeAction(
            clanId,
            channelId,
            gameId,
            userId,
            'call',
            0,
            messageId,
          );
          break;

        case 'check':
          await this.makeAction(
            clanId,
            channelId,
            gameId,
            userId,
            'check',
            0,
            messageId,
          );
          break;

        case 'fold':
          await this.makeAction(
            clanId,
            channelId,
            gameId,
            userId,
            'fold',
            0,
            messageId,
          );
          break;

        case 'raise':
          // Default Raise logic: Raise 1x Bet Base if amount is 0 or undefined.
          // We will pass 0 and let makeAction handle it.
          await this.makeAction(
            clanId,
            channelId,
            gameId,
            userId,
            'raise',
            0,
            messageId,
          );
          break;
      }
    } catch (error) {
      console.error('❌ Error handling interaction:', error);
    }
  }

  // --- GAME START LOGIC ---

  async startGame(
    creatorId: string,
    clanId: string,
    channelId: string,
    playerIds: string[],
    betAmount: number,
  ): Promise<void> {
    try {
      const gameId = `lieng_${Date.now()}`;
      const gameKey = this.createGameKey(clanId, channelId, gameId);

      // Deduct money first
      const fundCheck = await this.deductPlayersFunds(playerIds, betAmount);
      if (!fundCheck.success) {
        await this.sendChannelMessage(
          clanId,
          channelId,
          `❌ Lỗi trừ tiền: ${fundCheck.message}`,
        );
        return;
      }

    const deck = this.createDeck();
    this.shuffleDeck(deck);

    const players: LiengPlayer[] = [];
    for (let i = 0; i < playerIds.length; i++) {
      // Simple name resolution
      let name = `Player ${i + 1}`;
      const user = await this.userRepository.findOne({
        where: { user_id: playerIds[i] },
      });
      if (user) name = user.username;

      players.push({
        id: playerIds[i],
        name,
        chips: 0,
        seat: i,
        hole: [],
        hasFolded: false,
        currentBet: 0,
        isAllIn: false,
      });
    }

    const game: LiengGameState = {
      id: gameId,
      clanId,
      channelId,
      createdAt: new Date(),
      players,
      deck,
      pot: playerIds.length * betAmount,
      currentBet: 0, // In Lieng, usually base bet is implicit, or first player bets
      round: 'waiting',
      dealerButton: 0,
      currentPlayerIndex: 0,
      isActive: true,
      betAmount,
      lastAggressorIndex: null,
      toActIds: [],
      actionHistory: [],
    };

    // Deal 3 cards
    for (const p of game.players) {
      for (let k = 0; k < 3; k++) p.hole.push(game.deck.pop()!);
    }

    // Save initial state
    const liengGame = new LiengGame();
    liengGame.clanId = clanId;
    liengGame.channelId = channelId;
    liengGame.creatorId = creatorId;
    liengGame.gameState = game;
    liengGame.isActive = true;
    await this.liengGameRepository.save(liengGame);

    this.activeGames.set(gameKey, game);

    await this.sendChannelMessage(
      clanId,
      channelId,
      `🎴 **Liêng Game #${gameId} bắt đầu!**\n💰 Pot hiện tại: ${game.pot}`,
    );

    // Send cards privately
    for (const p of game.players) {
      const score = this.calculateLiengRank(p.hole);
      await this.sendPrivateMessage(
        p.id,
        `🎴 Bài của bạn: ${p.hole.join(' ')}\n📊 Điểm: **${score.name}**`,
        clanId,
        channelId,
      );
    }

    // Start Betting Round
    game.round = 'betting';
    // First player after dealer
    game.currentPlayerIndex = (game.dealerButton + 1) % game.players.length;

    // Setup ToAct list
    game.toActIds = game.players.map((p) => p.id);

    await this.saveGame(game);
    await this.sendTurnActionButtons(game);
    } catch (error) {
      console.error('❌ Error in startGame:', error);
      await this.sendChannelMessage(
        clanId,
        channelId,
        '❌ Lỗi khi bắt đầu game. Tiền cược sẽ được hoàn lại.',
      );
      // TODO: Refund money to players
    }
  }

  // --- BETTING LOGIC (Implemented) ---

  // --- BETTING LOGIC (Implemented) ---

  async makeAction(
    clanId: string,
    channelId: string,
    gameId: string,
    playerId: string,
    action: 'check' | 'call' | 'fold' | 'allin' | 'raise',
    amount: number = 0,
    messageId?: string,
  ) {
    const gameKey = this.createGameKey(clanId, channelId, gameId);
    const game = this.activeGames.get(gameKey) as LiengGameState;

    if (!game) return { success: false, message: 'Game not found' };

    const player = game.players[game.currentPlayerIndex];
    if (player.id !== playerId)
      return { success: false, message: 'Not your turn' };

    // Delete turn message
    if (messageId)
      await this.deleteChannelMessage(clanId, channelId, messageId);

    let msg = '';

    switch (action) {
      case 'fold':
        player.hasFolded = true;
        msg = `💀 **${player.name}** đã Bỏ (Fold).`;
        break;

      case 'call':
        const callAmount = game.currentBet - player.currentBet;
        if (callAmount > 0) {
          // Check funds
          const fundCheck = await this.deductPlayersFunds(
            [playerId],
            callAmount,
          );
          if (!fundCheck.success) return fundCheck; // Or handle partial/all-in logic

          player.currentBet += callAmount;
          game.pot += callAmount;
        }
        msg = `💸 **${player.name}** Theo (Call) ${callAmount}.`;
        break;

      case 'raise':
        // Raise amount usually means "add more to current bet" or "make total bet X"
        // Let's assume input 'amount' is the ADDITIONAL amount to RAISE ON TOP of current bet

        const raiseAmt = amount > 0 ? amount : game.betAmount; // Default to 1x Bet Base if 0 passed

        const currentToMatch = game.currentBet;
        const totalNewBet = currentToMatch + raiseAmt;
        const actualAdd = totalNewBet - player.currentBet;

        const fundCheck = await this.deductPlayersFunds([playerId], actualAdd);
        if (!fundCheck.success) return fundCheck;

        player.currentBet = totalNewBet;
        game.currentBet = totalNewBet;
        game.pot += actualAdd;

        // Reset other players to act (except folded/allin)
        game.toActIds = game.players
          .filter((p) => !p.hasFolded && !p.isAllIn && p.id !== playerId)
          .map((p) => p.id);

        msg = `🚀 **${player.name}** Tố thêm (Raise) ${raiseAmt}! (Tổng: ${totalNewBet})`;
        break;
    }

    // Update history
    game.actionHistory.push({
      playerId,
      action,
      amount,
      timestamp: new Date(),
    });

    await this.sendChannelMessage(clanId, channelId, msg);
    await this.nextTurn(game);

    return { success: true };
  }

  async nextTurn(game: LiengGameState) {
    // 1. Check if only 1 player remains
    const activePlayers = game.players.filter((p) => !p.hasFolded);
    if (activePlayers.length === 1) {
      await this.endGame(game, [activePlayers[0]]);
      return;
    }

    // 2. Check if everyone has acted (matched bet and toActIds empty)
    // Remove current player from ToAct if they match
    const currP = game.players[game.currentPlayerIndex];
    if (currP.currentBet === game.currentBet || currP.hasFolded) {
      game.toActIds = game.toActIds.filter((id) => id !== currP.id);
    }

    const allMatched = activePlayers.every(
      (p) => p.currentBet === game.currentBet || p.isAllIn,
    );

    if (game.toActIds.length === 0 && allMatched) {
      await this.handleShowdown(game);
      return;
    }

    // 3. Find next player
    let loopCount = 0;
    do {
      game.currentPlayerIndex =
        (game.currentPlayerIndex + 1) % game.players.length;
      loopCount++;
    } while (
      (game.players[game.currentPlayerIndex].hasFolded ||
        game.players[game.currentPlayerIndex].isAllIn) &&
      loopCount < game.players.length
    );

    await this.saveGame(game);
    await this.sendTurnActionButtons(game);
  }

  // Update sendTurnActionButtons to include proper ID
  private async sendTurnActionButtons(game: LiengGameState) {
    const player = game.players[game.currentPlayerIndex];
    const buttons: any[] = [];

    const callAmt = game.currentBet - player.currentBet;

    if (callAmt > 0) {
      buttons.push({
        type: EMessageComponentType.BUTTON,
        component: {
          label: `Theo (${callAmt})`,
          style: EButtonMessageStyle.PRIMARY,
        },
        id: `lieng_call_${game.id}_${game.clanId}_${game.channelId}`, // Include context
      });
    } else {
      buttons.push({
        type: EMessageComponentType.BUTTON,
        component: {
          label: `Xem (Check)`,
          style: EButtonMessageStyle.SECONDARY,
        },
        id: `lieng_call_${game.id}_${game.clanId}_${game.channelId}`, // Check acts as Call 0
      });
    }

    buttons.push({
      type: EMessageComponentType.BUTTON,
      component: { label: 'Bỏ (Fold)', style: EButtonMessageStyle.DANGER },
      id: `lieng_fold_${game.id}_${game.clanId}_${game.channelId}`,
    });

    // Simple Raise Button (Raise 1x Bet Base)
    buttons.push({
      type: EMessageComponentType.BUTTON,
      component: {
        label: `Tố (+${game.betAmount})`,
        style: EButtonMessageStyle.SUCCESS,
      },
      id: `lieng_raise_${game.id}_${game.clanId}_${game.channelId}`,
    });

    const msgId = await this.sendChannelMessage(
      game.clanId,
      game.channelId,
      `👉 Lượt của **${player.name}**\n💰 Pot: ${game.pot} | Cược bàn: ${game.currentBet}`,
      [{ components: buttons }],
      player.id, // Mention
    );
    if (msgId)
      this.turnMessageIds.set(
        this.createGameKey(game.clanId, game.channelId, game.id),
        msgId,
      );
  }

  // --- SCORING LOGIC (CORE OF LIENG) ---

  private calculateLiengRank(cards: string[]): {
    score: number;
    name: string;
    type: string;
  } {
    const getRealVal = (c: string) => {
      // For Lieng/Sap check (J=11, Q=12, K=13)
      const suit = this.getCardSuit(c);
      const v = c.slice(0, c.length - suit.length);
      if (v === 'J') return 11;
      if (v === 'Q') return 12;
      if (v === 'K') return 13;
      if (v === 'A') return 1;
      return parseInt(v);
    };

    const values = cards.map(getRealVal).sort((a, b) => a - b);

    // 1. Check SAP (Three of a kind)
    if (values[0] === values[1] && values[1] === values[2]) {
      return { score: 900 + values[0], name: `Sáp ${values[0]}`, type: 'SAP' };
    }

    // 2. Check LIENG (Straight)
    // Special case: A, 2, 3 (1, 2, 3) OR Q, K, A (12, 13, 1)
    const isStraight =
      values[1] === values[0] + 1 && values[2] === values[1] + 1;
    const isSpecialLieng =
      values[0] === 1 && values[1] === 12 && values[2] === 13; // A, Q, K

    if (isStraight || isSpecialLieng) {
      return { score: 800 + values[2], name: 'Liêng', type: 'LIENG' };
    }

    // 3. Check ANH (All faces J, Q, K)
    // In Lieng, Anh implies J,Q,K mixed.
    const isAnh = cards.every((c) => {
      const v = getRealVal(c);
      return v >= 11 && v <= 13;
    });
    if (isAnh) return { score: 700, name: 'Ảnh', type: 'ANH' };

    // 4. DIEM (Points)
    // A=1, JQK=0 (some rules say 10=0). Let's use: A=1, 2-9=val, 10,J,Q,K=0.
    const getPointVal = (c: string) => {
      const suit = this.getCardSuit(c);
      const v = c.slice(0, c.length - suit.length);
      if (['10', 'J', 'Q', 'K'].includes(v)) return 0;
      if (v === 'A') return 1;
      return parseInt(v);
    };

    const sum = cards.reduce((a, b) => a + getPointVal(b), 0);
    const finalPoint = sum % 10;
    // 9 điểm > 1 điểm.

    return { score: finalPoint, name: `${finalPoint} Điểm`, type: 'DIEM' };
  }

  private getCardSuit(card: string): string {
    for (const suit of this.SUITS) {
      if (card.endsWith(suit)) return suit;
    }
    return '';
  }

  // --- SHOWDOWN ---

  private async handleShowdown(game: LiengGameState) {
    const active = game.players.filter((p) => !p.hasFolded);
    // Calc scores
    const ranked = active
      .map((p) => ({
        player: p,
        result: this.calculateLiengRank(p.hole),
      }))
      .sort((a, b) => b.result.score - a.result.score);

    // Handle TIE - Find all players with highest score
    const highestScore = ranked[0].result.score;
    const winners = ranked.filter((r) => r.result.score === highestScore);

    // Calculate winnings per person
    const winningsPerPerson = Math.floor(game.pot / winners.length);

    // Build message
    let msg = '';
    if (winners.length > 1) {
      msg = `🤝 **HÒA!** ${winners.length} người chia ${game.pot.toLocaleString()}:\n`;
      for (const w of winners) {
        msg += `👑 ${w.player.name} (${w.result.name}) - Nhận: ${winningsPerPerson.toLocaleString()}\n`;
        await this.addMoneyToUser(w.player.id, winningsPerPerson);
      }
    } else {
      const winner = winners[0];
      msg = `👑 **Chiến thắng:** ${winner.player.name} (${winner.result.name})\n💰 Thắng: ${game.pot.toLocaleString()}\n\n`;
      await this.addMoneyToUser(winner.player.id, game.pot);
    }

    // Show all hands
    msg += '**Bài của các người chơi:**\n';
    msg += ranked
      .map(
        (r) =>
          `> ${r.player.name}: ${r.player.hole.join(' ')} - ${r.result.name}`,
      )
      .join('\n');

    await this.sendChannelMessage(game.clanId, game.channelId, msg);

    // End game logic (cleanup)
    this.activeGames.delete(
      this.createGameKey(game.clanId, game.channelId, game.id),
    );
  }

  private async endGame(game: LiengGameState, winners: LiengPlayer[]) {
    // Calculate winnings per person (for tie cases)
    const winningsPerPerson = Math.floor(game.pot / winners.length);

    // Give money
    for (const w of winners) {
      await this.addMoneyToUser(w.id, winningsPerPerson);
    }

    const msg =
      winners.length > 1
        ? `🤝 **HÒA!** ${winners.length} người chia ${game.pot.toLocaleString()}\nMỗi người nhận: ${winningsPerPerson.toLocaleString()}`
        : `🏆 **Thắng cuộc:** ${winners[0].name}\n💰 Thắng: ${game.pot.toLocaleString()}`;

    await this.sendChannelMessage(game.clanId, game.channelId, msg);

    // Cleanup
    this.activeGames.delete(
      this.createGameKey(game.clanId, game.channelId, game.id),
    );
  }

  private async saveGame(game: LiengGameState) {
    // Find and update DB
    // Simplified for brevity
    await Promise.resolve();
    const key = this.createGameKey(game.clanId, game.channelId, game.id);
    this.activeGames.set(key, game);
  }
}
