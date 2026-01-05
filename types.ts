export interface Market {
  id: string;
  question: string;
  description: string;
  slug: string;
  outcomes: string[];
  outcomePrices: string[];
  clobTokenIds: string[];
  volume: string;
  liquidity: string;
  category: string;
  startDate: string; 
  endDate: string;   
  image?: string;
  polymarketUrl?: string;
}

/**
 * Interface representing the structure of market analysis returned by Gemini AI.
 */
export interface AIAnalysis {
  probability: number;
  confidence: number;
  reasoning: string;
}

export interface OrderBookLevel {
  price: number;
  size: number;
}

export interface OrderBook {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}

export interface TradingSecrets {
  privateKey: string;
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string;
  proxyAddress: string; // Dynamic proxy address
  isConfigured: boolean;
}

export interface TradeLog {
  id: string;
  timestamp: number;
  marketId: string;
  question: string;
  outcome: 'YES' | 'NO';
  side: 'BUY' | 'SELL';
  entryPrice: number;
  size: number;
  btcPriceAtEntry: number;
  modelProb: number;
  marketProb: number;
  volatilityAtEntry: number;
  status: 'OPEN' | 'CLOSED' | 'PARTIAL';
  pnl?: number;
}

export type TradeDirectionBias = 'BOTH' | 'YES_ONLY' | 'NO_ONLY';

export interface RiskConfig {
  maxPositionSize: number;
  edgeThreshold: number; 
  maxTradesPerSeries: number;
  volatilityLookback: number;
  minProbThreshold: number; // e.g., 80%
  takeProfitPct: number;    // e.g., 25% profit
  sellAmountPct: number;    // e.g., 50% of position
  directionBias: TradeDirectionBias;
  maxBuyCountPerMarket: number;
}

export interface BotStatus {
  isActive: boolean;
  strategy: string;
  balance: number;
  nativeBalance: number; // For POL gas tracking
  allowance: number;
  pnl: number;
  tradesCount: number;
  logs: TradeLog[];
  secrets: TradingSecrets;
}