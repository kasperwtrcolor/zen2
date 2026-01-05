import React, { useState, useEffect } from 'react';
import { Market, OrderBook, TradeLog, TradingSecrets } from '../types';
import { fetchOrderBook } from '../services/polymarketService';

interface OrderBookViewProps {
  market: Market | null;
  onExecuteTrade: (trade: Omit<TradeLog, 'id' | 'timestamp' | 'status'>) => void;
  btcPrice: number;
  modelProb: number;
  balance: number;
  nativeBalance: number;
  allowance: number;
  secrets: TradingSecrets;
  onRefresh?: () => void;
  onAuthorize?: () => void;
}

const OrderBookView: React.FC<OrderBookViewProps> = ({ 
  market, balance, nativeBalance, onRefresh 
}) => {
  const [upBook, setUpBook] = useState<OrderBook>({ bids: [], asks: [] });
  const [downBook, setDownBook] = useState<OrderBook>({ bids: [], asks: [] });

  const refreshDepth = async () => {
    if (!market || !market.clobTokenIds || market.clobTokenIds.length < 2) return;
    try {
      const [up, down] = await Promise.all([
        fetchOrderBook(market.clobTokenIds[0]),
        fetchOrderBook(market.clobTokenIds[1])
      ]);
      setUpBook(up);
      setDownBook(down);
    } catch (err) {}
  };

  useEffect(() => {
    refreshDepth();
    const interval = setInterval(refreshDepth, 5000); 
    return () => clearInterval(interval);
  }, [market?.id]);

  const renderSide = (title: string, bids: any[], asks: any[], color: string) => {
    const maxVol = Math.max(...[...bids, ...asks].map(l => l.size), 1);
    
    return (
        <div className="flex-1 flex flex-col gap-1">
            <div className={`text-[9px] uppercase font-bold tracking-wider mb-2 ${color === 'green' ? 'text-green-400' : 'text-red-400'}`}>
                {title}
            </div>
            
            <div className="flex-1 flex flex-col justify-end gap-0.5">
                {asks.slice(0, 5).reverse().map((l, i) => (
                    <div key={i} className="flex justify-between text-[9px] font-mono relative pr-1">
                        <div className={`absolute right-0 h-full ${color === 'green' ? 'bg-red-500' : 'bg-red-500'} opacity-10`} style={{width: `${(l.size/maxVol)*100}%`}}></div>
                        <span className="text-red-400 z-10">{l.price.toFixed(2)}</span>
                        <span className="opacity-50 z-10">{Math.round(l.size)}</span>
                    </div>
                ))}
            </div>
            
            <div className="h-px bg-white/10 my-1"></div>

            <div className="flex-1 flex flex-col gap-0.5">
                {bids.slice(0, 5).map((l, i) => (
                    <div key={i} className="flex justify-between text-[9px] font-mono relative pr-1">
                         <div className={`absolute right-0 h-full ${color === 'green' ? 'bg-green-500' : 'bg-green-500'} opacity-10`} style={{width: `${(l.size/maxVol)*100}%`}}></div>
                        <span className="text-green-400 z-10">{l.price.toFixed(2)}</span>
                        <span className="opacity-50 z-10">{Math.round(l.size)}</span>
                    </div>
                ))}
            </div>
        </div>
    );
  };

  if (!market) return <div className="h-full flex items-center justify-center opacity-20 font-mono text-xs uppercase">No Market Selected</div>;

  return (
    <div className="h-full flex gap-4">
       {renderSide("YES Contract", upBook.bids, upBook.asks, "green")}
       <div className="w-px bg-white/5 h-full"></div>
       {renderSide("NO Contract", downBook.bids, downBook.asks, "red")}
    </div>
  );
};

export default OrderBookView;