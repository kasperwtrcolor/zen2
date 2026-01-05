const WS_URL = 'wss://ws-feed.exchange.coinbase.com';

export interface BTCData {
  price: number;
  volatility: number; 
  price15mAgo: number;
}

interface PriceEntry {
  timestamp: number;
  price: number;
}

let priceHistory: PriceEntry[] = [];
let currentPrice = 0;
let currentVol = 5.0; 
let ws: WebSocket | null = null;
let subscribers: ((data: BTCData) => void)[] = [];

const calculateVolatility = () => {
  if (priceHistory.length < 2) return 5.0;
  const prices = priceHistory.map(h => h.price);
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  const variance = prices.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / prices.length;
  return Math.max(Math.sqrt(variance), 1.0);
};

const getPrice15mAgo = (): number => {
  const now = Date.now();
  const target = now - (15 * 60 * 1000);
  const closest = priceHistory.reduce((prev, curr) => {
    return (Math.abs(curr.timestamp - target) < Math.abs(prev.timestamp - target) ? curr : prev);
  }, priceHistory[0]);
  return closest ? closest.price : currentPrice;
};

export const startBTCStream = () => {
  if (ws) return;
  ws = new WebSocket(WS_URL);
  ws.onopen = () => {
    ws?.send(JSON.stringify({
      type: 'subscribe',
      product_ids: ['BTC-USD'],
      channels: ['ticker']
    }));
  };
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'ticker' && data.price) {
        const price = parseFloat(data.price);
        currentPrice = price;
        priceHistory.push({ timestamp: Date.now(), price });
        const limit = Date.now() - (20 * 60 * 1000);
        priceHistory = priceHistory.filter(h => h.timestamp > limit);
        currentVol = calculateVolatility();
        const update = { price: currentPrice, volatility: currentVol, price15mAgo: getPrice15mAgo() };
        subscribers.forEach(cb => cb(update));
      }
    } catch (e) {}
  };
  ws.onerror = () => {
    ws = null;
    setTimeout(startBTCStream, 5000);
  };
  ws.onclose = () => {
    ws = null;
    setTimeout(startBTCStream, 5000);
  };
};

export const subscribeToBTC = (callback: (data: BTCData) => void) => {
  subscribers.push(callback);
  if (!ws) startBTCStream();
  if (currentPrice > 0) {
    callback({ price: currentPrice, volatility: currentVol, price15mAgo: getPrice15mAgo() });
  }
  return () => {
    subscribers = subscribers.filter(s => s !== callback);
  };
};

export const calculateProbability = (currentPrice: number, strikePrice: number, timeToExpiryMinutes: number, volatility: number, price15mAgo: number): number => {
  if (currentPrice === 0 || price15mAgo === 0) return 50;
  const move = ((currentPrice - price15mAgo) / price15mAgo) * 1000; 
  let prob = 50 + (move * 2); 
  const distance = ((currentPrice - strikePrice) / strikePrice) * 1000;
  prob += (distance * 1);
  return Math.min(99, Math.max(1, Math.round(prob)));
}