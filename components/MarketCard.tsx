import React, { useState, useEffect } from 'react';
import { Market } from '../types';
import { AlertCircle, Clock } from 'lucide-react';

interface MarketCardProps {
  market: Market;
  isSelected: boolean;
  onClick: () => void;
}

const MarketCard: React.FC<MarketCardProps> = ({ market, isSelected, onClick }) => {
  const [msLeft, setMsLeft] = useState<number>(0);
  const price = market.outcomePrices?.[0] ? parseFloat(market.outcomePrices[0]) * 100 : 0;

  useEffect(() => {
    const update = () => {
      const remaining = new Date(market.endDate).getTime() - Date.now();
      setMsLeft(remaining > 0 ? remaining : 0);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [market.endDate]);

  const isExpiringSoon = msLeft > 0 && msLeft < 60000;
  const isExpired = msLeft <= 0;

  const formatTime = (ms: number) => {
    const totalSecs = Math.floor(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div 
      onClick={onClick}
      className={`p-6 neo-brutal cursor-pointer transition-all relative ${
        isSelected ? 'bg-black text-white' : 'bg-white hover:bg-gray-50'
      } ${isExpiringSoon && !isSelected ? 'border-red-500 border-4' : ''}`}
    >
      <div className="flex justify-between items-center mb-4">
        <div className="font-heading text-xs tracking-tighter opacity-70">
          {market.category}
        </div>
        <div className="flex items-center gap-2 font-heading text-xs">
          <Clock size={14} />
          <span>{isExpired ? 'SETTLED' : formatTime(msLeft)}</span>
        </div>
      </div>
      
      <h3 className="text-xl font-display leading-tight mb-6 line-clamp-2">
        {market.question}
      </h3>

      <div className="flex items-center gap-4">
        <div className={`flex-1 h-4 border-2 ${isSelected ? 'border-white bg-gray-900' : 'border-black bg-gray-100'}`}>
          <div 
            className={`h-full transition-all duration-500 ${isSelected ? 'bg-white' : 'bg-black'}`} 
            style={{ width: `${price}%` }}
          ></div>
        </div>
        <span className="text-2xl font-heading w-16 text-right">
          {Math.round(price)}%
        </span>
      </div>
    </div>
  );
};

export default MarketCard;