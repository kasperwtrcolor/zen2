import React from 'react';
import { BotStatus, RiskConfig, Market, TradeLog, TradingSecrets, TradeDirectionBias } from '../types';
import { ShieldAlert, CheckCircle, RefreshCw, HelpCircle, ArrowUpCircle, ArrowDownCircle, Infinity } from 'lucide-react';

interface BotControlProps {
  status: BotStatus;
  risk: RiskConfig;
  selectedMarket: Market | null;
  modelProb: number;
  btcPrice: number;
  timeLeftSeconds: number;
  onToggle: () => void;
  onUpdateRisk: (risk: RiskConfig) => void;
  onUpdateSecrets: (secrets: TradingSecrets) => void;
  onExecuteTrade: (trade: Omit<TradeLog, 'id' | 'timestamp' | 'status'>) => void;
  onRetryProxy?: () => void;
  activeView: 'DASHBOARD' | 'SECRETS';
  /**
   * Whether the current user is authenticated via Privy. When true, the secret
   * configuration form will be replaced with a read-only view showing the
   * wallet and proxy addresses. Derived API credentials are handled
   * automatically and not displayed. When false, the legacy fields for
   * private key and API credentials are shown.
   */
  isPrivyUser?: boolean;
  /**
   * The onchain wallet address of the current user, if available from Privy.
   */
  walletAddress?: string;
}

const InfoFloater: React.FC<{ text: string }> = ({ text }) => (
  <div className="group relative inline-block ml-1 cursor-help">
    <HelpCircle size={10} className="text-white/30 hover:text-cyan-400 transition-colors" />
    <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-48 bg-black border border-white/20 p-2 text-[9px] text-white/80 rounded shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
      {text}
    </div>
  </div>
);

const BotControl: React.FC<BotControlProps> = ({ 
  status,
  risk,
  selectedMarket,
  modelProb,
  onToggle,
  onUpdateRisk,
  onUpdateSecrets,
  onRetryProxy,
  activeView,
  isPrivyUser = false,
  walletAddress
}) => {

  const handleSecretChange = (field: keyof TradingSecrets, value: string) => {
    const updated = { ...status.secrets, [field]: value };
    updated.isConfigured = !!(updated.privateKey && updated.apiKey && updated.apiSecret && updated.apiPassphrase);
    onUpdateSecrets(updated);
  };

  const handleRiskChange = (field: keyof RiskConfig, value: any) => {
    onUpdateRisk({ ...risk, [field]: value });
  };

  const upPriceNum = parseFloat(selectedMarket?.outcomePrices?.[0] || "0");
  const downPriceNum = parseFloat(selectedMarket?.outcomePrices?.[1] || "0");
  
  const upEdge = modelProb - (upPriceNum * 100);
  const downEdge = (100 - modelProb) - (downPriceNum * 100);

  if (activeView === 'SECRETS') {
    // For Phase 1 we always show a simplified configuration panel.  API keys
    // and private keys are never exposed in the frontend.  Users can view
    // their wallet address (if available) and set or auto-detect their
    // proxy address.  The 'isConfigured' flag indicates whether a proxy
    // address has been set.
    return (
      <div className="space-y-4 md:space-y-6 font-mono text-xs">
        <div className="space-y-1">
          <div className="text-[9px] md:text-[10px] uppercase opacity-50">Wallet Address</div>
          <input
            type="text"
            readOnly
            className="w-full bg-white/5 border border-white/10 p-3 outline-none rounded-sm text-cyan-400 text-xs"
            value={walletAddress || ''}
          />
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-[9px] md:text-[10px] uppercase opacity-50">
            <span>Proxy Address</span>
            {onRetryProxy && (
              <button onClick={onRetryProxy} title="Auto-Detect Proxy">
                <RefreshCw size={10} />
              </button>
            )}
          </div>
          <input
            className="w-full bg-white/5 border border-white/10 p-3 outline-none focus:border-cyan-500/50 transition-colors rounded-sm text-cyan-400 placeholder-white/20 text-xs"
            placeholder="0x... (Auto-detect)"
            value={status.secrets.proxyAddress}
            onChange={(e) => handleSecretChange('proxyAddress', e.target.value)}
          />
        </div>
        <div className="pt-2 md:pt-4 border-t border-white/10 flex items-center gap-4">
          {status.secrets.isConfigured ? (
            <CheckCircle className="text-green-500" size={14} />
          ) : (
            <ShieldAlert className="text-yellow-500" size={14} />
          )}
          <span className="opacity-60 text-[10px] md:text-xs">
            {status.secrets.isConfigured ? 'Vault Ready' : 'Proxy not configured'}
          </span>
        </div>
      </div>
    );
  }

  // DASHBOARD VIEW
  return (
    <div className="flex flex-col h-full font-mono gap-4 pr-1">
       
       <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-4">
              {/* Top Row: Pos Size & Edge */}
              <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 bg-white/5 border border-white/5 flex flex-col gap-1">
                     <div className="flex items-center">
                         <span className="text-[8px] uppercase opacity-40">Pos Size ($)</span>
                         <InfoFloater text="Maximum USD value allocated per individual trade execution." />
                     </div>
                     <input 
                        type="number" 
                        className="bg-transparent outline-none text-sm font-bold w-full" 
                        value={risk.maxPositionSize}
                        onChange={(e) => handleRiskChange('maxPositionSize', parseFloat(e.target.value))}
                     />
                  </div>
                  <div className="p-2 bg-white/5 border border-white/5 flex flex-col gap-1">
                     <div className="flex items-center">
                         <span className="text-[8px] uppercase opacity-40">Min Edge (%)</span>
                         <InfoFloater text="Minimum difference required between Alpha probability and Market price to trigger entry." />
                     </div>
                     <input 
                        type="number" 
                        className="bg-transparent outline-none text-sm font-bold text-cyan-400 w-full" 
                        value={risk.edgeThreshold}
                        onChange={(e) => handleRiskChange('edgeThreshold', parseFloat(e.target.value))}
                     />
                  </div>
                  <div className="p-2 bg-white/5 border border-white/5 flex flex-col gap-1">
                     <div className="flex items-center">
                         <span className="text-[8px] uppercase opacity-40">Max Buys</span>
                         <InfoFloater text="Limit the number of buy orders the bot can place for this specific market." />
                     </div>
                     <input 
                        type="number" 
                        min="1"
                        className="bg-transparent outline-none text-sm font-bold w-full" 
                        value={risk.maxBuyCountPerMarket ?? 1}
                        onChange={(e) => handleRiskChange('maxBuyCountPerMarket', parseInt(e.target.value))}
                     />
                  </div>
              </div>

              {/* Prob Threshold Slider */}
              <div className="p-2 bg-white/5 border border-white/5 space-y-2">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center">
                        <span className="text-[8px] uppercase opacity-40">Min Prob Threshold</span>
                        <InfoFloater text="Engine will only execute trades if the predicted probability exceeds this value." />
                    </div>
                    <span className="text-[10px] font-bold text-mercury">{risk.minProbThreshold}%</span>
                  </div>
                  <input 
                    type="range"
                    min="50"
                    max="99"
                    className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                    value={risk.minProbThreshold}
                    onChange={(e) => handleRiskChange('minProbThreshold', parseInt(e.target.value))}
                  />
              </div>

               {/* Direction Bias */}
               <div className="p-2 bg-white/5 border border-white/5">
                  <span className="text-[8px] uppercase opacity-40 mb-2 block flex items-center gap-1">
                      Trading Bias <InfoFloater text="Restrict bot to only trade YES, NO, or BOTH outcomes." />
                  </span>
                  <div className="flex gap-1">
                    <button 
                      onClick={() => handleRiskChange('directionBias', 'YES_ONLY')}
                      className={`flex-1 flex flex-col items-center justify-center p-2 rounded-sm border transition-all ${risk.directionBias === 'YES_ONLY' ? 'border-green-500 bg-green-500/10 text-green-400' : 'border-white/5 opacity-40'}`}
                    >
                      <ArrowUpCircle size={14} />
                      <span className="text-[8px] mt-1">YES ONLY</span>
                    </button>
                    <button 
                      onClick={() => handleRiskChange('directionBias', 'BOTH')}
                      className={`flex-1 flex flex-col items-center justify-center p-2 rounded-sm border transition-all ${risk.directionBias === 'BOTH' ? 'border-cyan-500 bg-cyan-500/10 text-cyan-400' : 'border-white/5 opacity-40'}`}
                    >
                      <Infinity size={14} />
                      <span className="text-[8px] mt-1">BI-DIR</span>
                    </button>
                    <button 
                      onClick={() => handleRiskChange('directionBias', 'NO_ONLY')}
                      className={`flex-1 flex flex-col items-center justify-center p-2 rounded-sm border transition-all ${risk.directionBias === 'NO_ONLY' ? 'border-red-500 bg-red-500/10 text-red-400' : 'border-white/5 opacity-40'}`}
                    >
                      <ArrowDownCircle size={14} />
                      <span className="text-[8px] mt-1">NO ONLY</span>
                    </button>
                  </div>
               </div>
          </div>

          <div className="space-y-4">
              {/* Take Profit Controls */}
               <div className="p-2 bg-white/5 border border-white/5 space-y-4 h-full">
                  <div className="flex justify-between items-center">
                      <span className="text-[8px] uppercase opacity-40 flex items-center gap-1">
                          Take Profit <InfoFloater text="Configure when to close positions and how much to sell." />
                      </span>
                  </div>
                  
                  {/* Row 1: TP Trigger */}
                  <div className="space-y-2">
                    <div className="text-[9px] opacity-60">TP Trigger %</div>
                    <div className="flex gap-2 items-center">
                        <div className="flex-1 bg-black/20 p-1 flex items-center border border-white/5 rounded">
                           <input 
                              type="number"
                              className="bg-transparent w-full text-center text-xs text-green-400 font-bold outline-none"
                              value={risk.takeProfitPct}
                              onChange={(e) => handleRiskChange('takeProfitPct', parseFloat(e.target.value))}
                           />
                           <span className="text-[8px] opacity-50 mr-1">%</span>
                        </div>
                        <div className="flex gap-1">
                            {[10, 20, 50, 100].map(pct => (
                                <button 
                                  key={pct}
                                  onClick={() => handleRiskChange('takeProfitPct', pct)}
                                  className={`text-[8px] px-1.5 py-1 rounded border transition-all ${risk.takeProfitPct === pct ? 'bg-white text-black border-white' : 'bg-transparent text-white/40 border-white/10 hover:border-white/30'}`}
                                >
                                  {pct}%
                                </button>
                            ))}
                        </div>
                    </div>
                  </div>

                  {/* Row 2: Sell Amount */}
                  <div className="space-y-2">
                    <div className="text-[9px] opacity-60">Sell Quantity %</div>
                    <div className="flex gap-2 items-center">
                        <div className="flex-1 bg-black/20 p-1 flex items-center border border-white/5 rounded">
                           <input 
                              type="number"
                              className="bg-transparent w-full text-center text-xs text-yellow-400 font-bold outline-none"
                              value={risk.sellAmountPct || 100}
                              onChange={(e) => handleRiskChange('sellAmountPct', parseFloat(e.target.value))}
                           />
                           <span className="text-[8px] opacity-50 mr-1">%</span>
                        </div>
                        <div className="flex gap-1">
                            {[25, 50, 75, 100].map(pct => (
                                <button 
                                  key={pct}
                                  onClick={() => handleRiskChange('sellAmountPct', pct)}
                                  className={`text-[8px] px-1.5 py-1 rounded border transition-all ${risk.sellAmountPct === pct ? 'bg-white text-black border-white' : 'bg-transparent text-white/40 border-white/10 hover:border-white/30'}`}
                                >
                                  {pct}%
                                </button>
                            ))}
                        </div>
                    </div>
                  </div>
               </div>
          </div>
       </div>

       {/* Live Analysis Bars */}
       <div className="space-y-2 py-2 border-t border-white/10 mt-2">
           <div className="bg-white/5 p-2 rounded text-[9px] opacity-70 leading-relaxed mb-2">
               <span className="text-cyan-400 font-bold">HOW IT WORKS:</span> The "Edge" is the spread between our model's probability and the market's current price.
               <br/>
               <span className="font-mono text-[8px] block my-1 p-1 bg-black/40 rounded border border-white/5 text-center">Edge = Model Prob - Market Price</span>
               Trades are only executed if this edge exceeds your configured threshold and updates automatically.
           </div>
           
           <div className="space-y-1">
               <div className="flex justify-between items-center text-[10px]">
                  <span className="opacity-50">YES Edge</span>
                  <span className={(upEdge > risk.edgeThreshold && modelProb >= risk.minProbThreshold) ? 'text-green-400 font-bold' : 'opacity-70'}>{upEdge.toFixed(1)}%</span>
               </div>
               <div className="w-full h-1 bg-white/10 relative">
                   <div className={`absolute h-full transition-all duration-500 ${upEdge > 0 ? 'bg-green-400' : 'bg-red-400'}`} style={{width: `${Math.min(Math.max(0, upEdge)*5, 100)}%`}}></div>
               </div>
           </div>
           
           <div className="space-y-1">
               <div className="flex justify-between items-center text-[10px]">
                  <span className="opacity-50">NO Edge</span>
                  <span className={(downEdge > risk.edgeThreshold && (100 - modelProb) >= risk.minProbThreshold) ? 'text-green-400 font-bold' : 'opacity-70'}>{downEdge.toFixed(1)}%</span>
               </div>
               <div className="w-full h-1 bg-white/10 relative">
                   <div className={`absolute h-full transition-all duration-500 ${downEdge > 0 ? 'bg-green-400' : 'bg-red-400'}`} style={{width: `${Math.min(Math.max(0, downEdge)*5, 100)}%`}}></div>
               </div>
           </div>
       </div>

       <button 
         onClick={onToggle}
         className={`w-full py-3 font-bold text-[10px] uppercase tracking-[0.2em] transition-all border rounded-sm mt-auto ${
            status.isActive 
            ? 'bg-red-500/10 border-red-500 text-red-500 hover:bg-red-500/20 shadow-[0_0_15px_rgba(239,68,68,0.2)]' 
            : 'bg-cyan-500 text-black border-cyan-500 hover:bg-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.3)]'
         }`}
       >
         {status.isActive ? 'SHUTDOWN_HFT' : 'BOOT_STRATEGY'}
       </button>
    </div>
  );
};

export default BotControl;