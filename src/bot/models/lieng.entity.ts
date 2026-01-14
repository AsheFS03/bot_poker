import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

export interface LiengGameState {
  id: string;
  clanId: string;
  channelId: string;
  createdAt: Date;
  players: any[]; // Specific LiengPlayer interface
  deck: string[];
  pot: number;
  currentBet: number;
  round: 'waiting' | 'betting' | 'showdown';
  dealerButton: number;
  currentPlayerIndex: number;
  isActive: boolean;
  betAmount: number;
  lastAggressorIndex: number | null;
  toActIds: string[];
  actionHistory: any[];
}

@Entity('lieng_games')
export class LiengGame {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  clanId: string;

  @Column()
  channelId: string;

  @Column()
  creatorId: string;

  @Column('jsonb')
  gameState: LiengGameState;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updatedAt: Date;
}
