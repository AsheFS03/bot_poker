import { Test, TestingModule } from '@nestjs/testing';
import { LiengService } from './lieng.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LiengGame } from '../../models/lieng.entity';
import { User } from '../../models/user.entity';
import { MezonClientService } from '../../../mezon/services/mezon-client.service';
import { Repository } from 'typeorm';

// Mock dependencies
const mockLiengGameRepository = {
  save: jest.fn(),
  findOne: jest.fn(),
  update: jest.fn(),
};

const mockUserRepository = {
  findOne: jest.fn(),
  save: jest.fn(),
};

const mockMezonClientService = {
  getClient: jest.fn().mockReturnValue({
    clans: {
      get: jest.fn().mockReturnValue({
        channels: {
          fetch: jest.fn().mockResolvedValue({
            send: jest.fn().mockResolvedValue({ message_id: 'msg_123' }),
            sendEphemeral: jest.fn(),
            messages: {
              fetch: jest.fn().mockResolvedValue({
                delete: jest.fn(),
                update: jest.fn(),
              }),
            },
          }),
        },
      }),
    },
  }),
};

describe('LiengService', () => {
  let service: LiengService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LiengService,
        {
          provide: getRepositoryToken(LiengGame),
          useValue: mockLiengGameRepository,
        },
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository,
        },
        {
          provide: MezonClientService,
          useValue: mockMezonClientService,
        },
      ],
    }).compile();

    service = module.get<LiengService>(LiengService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Scoring Logic (calculateLiengRank)', () => {
    // Helper to call private method
    const calculateRank = (hand: string[]) =>
      (service as any).calculateLiengRank(hand);

    it('should identify SAP (Three of a kind)', () => {
      const hand = ['3♠️', '3♥️', '3♦️'];
      const result = calculateRank(hand);
      expect(result.type).toBe('SAP');
      expect(result.score).toBeGreaterThan(900);
    });

    it('should identify LIENG (Straight)', () => {
      const hand = ['4♠️', '5♥️', '6♦️'];
      const result = calculateRank(hand);
      expect(result.type).toBe('LIENG');
      expect(result.score).toBeGreaterThan(800);
    });

    it('should identify special LIENG (A-Q-K)', () => {
      // Q, K, A
      const hand = ['Q♠️', 'K♥️', 'A♦️'];
      // Q=12, K=13, A=1 -> 1, 12, 13
      const result = calculateRank(hand);
      expect(result.type).toBe('LIENG');
    });

    it('should identify special LIENG (A-2-3)', () => {
      const hand = ['A♠️', '2♥️', '3♦️'];
      // A=1, 2=2, 3=3
      const result = calculateRank(hand);
      expect(result.type).toBe('LIENG');
    });

    it('should identify ANH (All Faces J/Q/K)', () => {
      const hand = ['J♠️', 'Q♥️', 'K♦️']; // Is Lieng actually but rules vary.
      // In my logic: Straight check comes before Anh check.
      // J, Q, K is a straight (11, 12, 13). So it should be LIENG.
      // Let's test non-straight ANH: J, J, Q
      const hand2 = ['J♠️', 'J♥️', 'Q♦️'];
      const result = calculateRank(hand2);
      expect(result.type).toBe('ANH');
    });

    it('should calculate POINTS correctly', () => {
      // 2 + 5 + 7 = 14 => 4 points
      const hand = ['2♠️', '5♥️', '7♦️'];
      const result = calculateRank(hand);
      expect(result.type).toBe('DIEM');
      expect(result.score).toBe(4);
    });

    it('should handle 10, J, Q, K as 0 points for DIEM calculation', () => {
      // 9 + J(0) + A(1) = 10 => 0 points
      const hand = ['9♠️', 'J♥️', 'A♦️'];
      const result = calculateRank(hand);
      expect(result.score).toBe(0);
    });
  });
});
