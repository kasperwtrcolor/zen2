import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ethers } from 'ethers';
import {
  fetchBTCSeriesMarkets,
  fetchWalletStats,
  fetchProxyAddress,
  // legacy REST-based order placement (still imported for backwards compatibility)
  placeClobOrder,
  deriveApiCredentialsFromSigner,
  placeOrderWithClient
} from './services/polymarketService';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { subscribeToBTC, calculateProbability } from './services/bitcoinService';
import { Market, BotStatus, RiskConfig, TradingSecrets, TradeLog } from './types';
import BotControl from './components/BotControl';
import OrderBookView from './components/OrderBookView';
import {
  Zap,
  Key,
  Terminal,
  Globe,
  RefreshCw,
  Layers,
  List,
  Play,
  Square,
  ExternalLink,
  Cpu,
  SlidersHorizontal,
  LogIn,
  LogOut
} from 'lucide-react';

interface SystemEvent {
  id: string;
  time: string;
  msg: string;
  type: 'INFO' | 'WARN' | 'SUCCESS' | 'ERROR';
}

const STORAGE_KEY = 'POLYBOT_VAULT_DATA';
const COOLDOWN_MS = 15000;

/**
 * The TradingTerminal component encapsulates the existing trading UI and logic.
 * It is isolated behind an authentication gate in Phase 1 to prevent
 * unauthenticated users from interacting with Polymarket or handling
 * credentials directly.  Future phases will move trading logic to the
 * backend.
 */
const TradingTerminal: React.FC = () => {
  // --- STATE ---
  const [activeView, setActiveView] = useState<'DASHBOARD' | 'LEDGER' | 'SECRETS' | 'CONTROLS'>('DASHBOARD');
  const [markets, setMarkets] = useState<Market[]>([]);
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
  const [btcPrice, setBtcPrice] = useState<number>(0);
  const [btcVol, setBtcVol] = useState<number>(0);
  const [btc15mAgo, setBtc15mAgo] = useState<number>(0);
  const [modelProb, setModelProb] = useState<number>(50);

  const [marketProbYes, setMarketProbYes] = useState<number>(50);
  const [marketProbNo, setMarketProbNo] = useState<number>(50);

  const [timeLeftStr, setTimeLeftStr] = useState<string>('00:00');
  const [isExpiring, setIsExpiring] = useState<boolean>(false);
  const [systemEvents, setSystemEvents] = useState<SystemEvent[]>([]);
  const [isScanningProxy, setIsScanningProxy] = useState(false);
  const [isRefreshingMarkets, setIsRefreshingMarkets] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);

  // ---- PRIVY AUTHENTICATION & WALLET ----
  // Use the Privy React hooks to manage user authentication and wallet state.
  const { ready, authenticated, login, logout } = usePrivy();
  const { wallets } = useWallets();
  // Store an ethers Signer derived from the user's active wallet. This will be
  // populated once the user has authenticated and the wallet object is ready.
  const [signer, setSigner] = useState<ethers.Signer | null>(null);
  // Cache Polymarket API credentials derived from the signer. These are kept in
  // memory and not persisted to local storage for security reasons.
  const [apiCreds, setApiCreds] = useState<{ apiKey: string; apiSecret: string; apiPassphrase: string } | null>(null);

  // Refs
  const botStatusRef = useRef<BotStatus | null>(null);
  const riskRef = useRef<RiskConfig | null>(null);
  const selectedMarketRef = useRef<Market | null>(null);
  const lastTradeTimeRef = useRef<number>(0);
  const processingTradeRef = useRef<boolean>(false);
  const followerRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);

  const [risk, setRisk] = useState<RiskConfig>({
    maxPositionSize: 10,
    edgeThreshold: 3.0,
    maxTradesPerSeries: 5,
    volatilityLookback: 60,
    minProbThreshold: 80,
    takeProfitPct: 20,
    sellAmountPct: 100,
    directionBias: 'BOTH',
    maxBuyCountPerMarket: 3
  });

  const [botStatus, setBotStatus] = useState<BotStatus>(() => {
    // Load any previously saved non-sensitive data (proxy address) from localStorage.
    const saved = localStorage.getItem(STORAGE_KEY);
    let parsed: Partial<TradingSecrets> = {};
    try {
      parsed = saved ? JSON.parse(saved) : {};
    } catch (e) {
      parsed = {};
    }
    const initialSecrets: TradingSecrets = {
      privateKey: '',
      apiKey: '',
      apiSecret: '',
      apiPassphrase: '',
      proxyAddress: parsed.proxyAddress || '',
      isConfigured: parsed.isConfigured || false
    };
    return {
      isActive: false,
      strategy: 'ALPHA ARB ENGINE',
      balance: 0.0,
      nativeBalance: 0.0,
      allowance: 0.0,
      pnl: 0.0,
      tradesCount: 0,
      logs: [],
      secrets: initialSecrets
    };
  });

  // --- EFFECTS ---
  // Keep the latest bot status in a ref and persist only non-sensitive data to localStorage.
  useEffect(() => {
    botStatusRef.current = botStatus;
    // Persist only the proxyAddress and configuration flag. Sensitive fields (apiKey,
    // apiSecret, apiPassphrase) are not stored in browser storage to prevent leaks.
    const { proxyAddress, isConfigured } = botStatus.secrets;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ proxyAddress, isConfigured }));
    } catch (e) {
      // ignore storage errors
    }
  }, [botStatus]);
  useEffect(() => { riskRef.current = risk; }, [risk]);
  useEffect(() => { selectedMarketRef.current = selectedMarket; }, [selectedMarket]);

  // When the user authenticates via Privy, derive an ethers Signer from their wallet.
  useEffect(() => {
    const initSigner = async () => {
      if (authenticated && wallets && wallets.length > 0) {
        try {
          // For Ethereum, use the first wallet. The `getEthereumProvider` method
          // yields an EIP-1193 provider. Wrap it with ethers.js to obtain a signer.
          const firstWallet: any = wallets[0];
          if (firstWallet && typeof firstWallet.getEthereumProvider === 'function') {
            const ethProvider = await firstWallet.getEthereumProvider();
            const browserProvider = new ethers.BrowserProvider(ethProvider);
            const signerInstance = await browserProvider.getSigner();
            setSigner(signerInstance);
            return;
          }
        } catch (e) {
          console.error('Failed to initialise signer:', e);
        }
      }
      setSigner(null);
    };
    initSigner();
  }, [authenticated, wallets]);

  // Derive Polymarket API credentials and auto-detect the proxy wallet once the signer is available.
  useEffect(() => {
    const deriveAndDetect = async () => {
      if (!signer) return;
      // Derive API credentials
      try {
        addEvent('Deriving Polymarket API credentials...', 'INFO');
        const creds = await deriveApiCredentialsFromSigner(signer);
        setApiCreds({
          apiKey: creds.apiKey,
          apiSecret: creds.apiSecret,
          apiPassphrase: creds.apiPassphrase
        });
        setBotStatus(prev => ({
          ...prev,
          secrets: {
            ...prev.secrets,
            apiKey: creds.apiKey,
            apiSecret: creds.apiSecret,
            apiPassphrase: creds.apiPassphrase,
            isConfigured: prev.secrets.proxyAddress ? true : prev.secrets.isConfigured
          }
        }));
        addEvent('API credentials derived successfully.', 'SUCCESS');
      } catch (e: any) {
        console.error(e);
        addEvent(`Failed to derive API credentials: ${e.message || e}`, 'ERROR');
      }
      // Auto-detect proxy wallet based on the signer’s address
      try {
        const eoa = await signer.getAddress();
        addEvent('Scanning Polygon Network for Proxy Wallet...', 'INFO');
        const proxy = await fetchProxyAddress(eoa);
        if (proxy) {
          setBotStatus(prev => ({
            ...prev,
            secrets: {
              ...prev.secrets,
              proxyAddress: proxy,
              isConfigured: true
            }
          }));
          addEvent(`Proxy Wallet Found: ${proxy.substring(0, 6)}...${proxy.substring(proxy.length - 4)}`, 'SUCCESS');
          // Balances will be synced by the wallet sync effect once the proxy is set
        } else {
          addEvent('No Proxy found. Please create one on Polymarket.', 'WARN');
        }
      } catch (e: any) {
        console.error(e);
        addEvent('Proxy auto-detect failed', 'ERROR');
      }
    };
    deriveAndDetect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signer]);

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
        if (window.matchMedia("(pointer: coarse)").matches) return;
        if (followerRef.current) {
            followerRef.current.style.left = e.clientX + 'px';
            followerRef.current.style.top = e.clientY + 'px';
        }
        if (anchorRef.current) {
            const tiltX = (e.clientY / window.innerHeight - 0.5) * 5;
            const tiltY = (e.clientX / window.innerWidth - 0.5) * -5;
            anchorRef.current.style.transform = `perspective(1000px) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`;
        }
    };
    window.addEventListener('mousemove', handleMove);
    return () => window.removeEventListener('mousemove', handleMove);
  }, []);

  const addEvent = (msg: string, type: SystemEvent['type'] = 'INFO') => {
    setSystemEvents(prev => [{ id: `${Date.now()}-${Math.random()}`, time: new Date().toLocaleTimeString().split(' ')[0], msg, type }, ...prev].slice(0, 100));
  };

  const refreshMarkets = useCallback(async (autoSelectNext = false) => {
    setIsRefreshingMarkets(true);
    try {
      const { markets: data } = await fetchBTCSeriesMarkets();
      if (data?.length > 0) {
        setMarkets(data);
        if (autoSelectNext || !selectedMarketRef.current) {
          let nextMarket = data[0];
          if (selectedMarketRef.current && autoSelectNext) {
             const currentEnd = new Date(selectedMarketRef.current.endDate).getTime();
             const next = data.find(m => new Date(m.endDate).getTime() > currentEnd + 60000);
             if (next) nextMarket = next;
          }
          setSelectedMarket(nextMarket);
        }
      }
    } catch (e) { addEvent("Market refresh failed", "ERROR"); } 
    finally { setIsRefreshingMarkets(false); }
  }, []);

  const syncWallet = useCallback(async () => {
    const s = botStatusRef.current?.secrets;
    const proxyAddr = s?.proxyAddress;
    if (!proxyAddr) return;
    let nativeBal = botStatusRef.current?.nativeBalance || 0;
    // Use the signer (if available) to fetch the EOA’s native balance
    if (signer) {
      try {
        const eoa = await signer.getAddress();
        const provider = signer.provider;
        if (provider) {
          const balanceWei = await provider.getBalance(eoa);
          nativeBal = parseFloat(ethers.formatEther(balanceWei));
        }
      } catch (err) {
        console.warn('Native balance fetch error');
      }
    }
    try {
      const stats = await fetchWalletStats(s, proxyAddr || '');
      setBotStatus(prev => ({
        ...prev,
        balance: stats.balance,
        allowance: stats.allowance,
        nativeBalance: nativeBal
      }));
    } catch (e) {
      // swallow errors silently
    }
  }, [signer]);

  const handleScanProxy = useCallback(async () => {
    // Use the signer’s address to locate the proxy wallet. For legacy users without
    // a signer (no Privy), fall back to the stored private key.
    let eoa: string | null = null;
    if (signer) {
      try {
        eoa = await signer.getAddress();
      } catch (e) {
        eoa = null;
      }
    }
    const s = botStatusRef.current?.secrets;
    if (!eoa && s?.privateKey) {
      try {
        eoa = new ethers.Wallet(s.privateKey).address;
      } catch (e) {
        eoa = null;
      }
    }
    if (!eoa) return;
    try {
      setIsScanningProxy(true);
      addEvent('Scanning Polygon Network for Proxy Wallet...', 'INFO');
      const resolvedProxy = await fetchProxyAddress(eoa);
      setIsScanningProxy(false);
      if (resolvedProxy) {
        setBotStatus(prev => ({
          ...prev,
          secrets: { ...prev.secrets, proxyAddress: resolvedProxy, isConfigured: true }
        }));
        addEvent(
          `Proxy Wallet Found: ${resolvedProxy.substring(0, 6)}...${resolvedProxy.substring(resolvedProxy.length - 4)}`,
          'SUCCESS'
        );
        // schedule wallet sync after updating proxy
        setTimeout(() => {
          syncWallet();
        }, 200);
      } else {
        addEvent('No Proxy found. Please create one on Polymarket.', 'WARN');
      }
    } catch (e) {
      setIsScanningProxy(false);
      addEvent('Proxy auto-detect failed', 'ERROR');
    }
  }, [signer, syncWallet]);

  useEffect(() => {
    // If a proxy address is missing and either a signer or a legacy private key exists,
    // attempt to auto-detect the proxy. Otherwise, synchronise balances when a proxy is available.
    if (!botStatus.secrets.proxyAddress) {
      if (signer || botStatus.secrets.privateKey) {
        const timer = setTimeout(() => {
          handleScanProxy();
        }, 800);
        return () => clearTimeout(timer);
      }
    } else {
      syncWallet();
    }
  }, [botStatus.secrets.proxyAddress, signer, botStatus.secrets.privateKey, handleScanProxy, syncWallet]);

  useEffect(() => { const i = setInterval(syncWallet, 15000); return () => clearInterval(i); }, [syncWallet]);
  useEffect(() => { refreshMarkets(false); const i = setInterval(() => refreshMarkets(false), 30000); return () => clearInterval(i); }, [refreshMarkets]);
  
  // BTC Subscription with Connection Logging
  useEffect(() => { 
    addEvent("Initializing Data Feed Subsystems...", "INFO");
    let isConnected = false;
    return subscribeToBTC((data) => { 
        if (!isConnected && data.price > 0) {
            isConnected = true;
            addEvent(`Coinbase WebSocket Connected: BTC @ $${data.price.toLocaleString()}`, "SUCCESS");
        }
        setBtcPrice(data.price); 
        setBtcVol(data.volatility); 
        setBtc15mAgo(data.price15mAgo);
    }); 
  }, []);

  useEffect(() => {
    if (selectedMarket) {
      const timer = setInterval(() => {
        const remaining = new Date(selectedMarket.endDate).getTime() - Date.now();
        if (remaining <= 0) {
           setTimeLeftStr("00:00");
           if (!isRefreshingMarkets) refreshMarkets(true);
        } else {
          const totalSecs = Math.floor(remaining / 1000);
          setTimeLeftStr(`${Math.floor(totalSecs / 60)}:${(totalSecs % 60).toString().padStart(2, '0')}`);
          setIsExpiring(remaining < 60000);
        }
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [selectedMarket?.id, isRefreshingMarkets, refreshMarkets]);

  useEffect(() => {
    const syncProbs = async () => {
        if (!selectedMarket) return;
        const match = selectedMarket.question.match(/\$([0-9,.]+)/);
        let strike = btcPrice; 
        if (match) strike = parseFloat(match[1].replace(/,/g, ''));
        const remainingMs = new Date(selectedMarket.endDate).getTime() - Date.now();
        const trendProb = calculateProbability(btcPrice, strike, Math.max(0, remainingMs / 60000), btcVol, btc15mAgo);
        setModelProb(trendProb);

        try {
            const [yesBook, noBook] = await Promise.all([
                fetchOrderBook(selectedMarket.clobTokenIds[0]),
                fetchOrderBook(selectedMarket.clobTokenIds[1])
            ]);
            const bestYesBid = yesBook.bids[0]?.price || 0.5;
            const bestNoBid = noBook.bids[0]?.price || 0.5;
            setMarketProbYes(Math.round(bestYesBid * 100));
            setMarketProbNo(Math.round(bestNoBid * 100));
        } catch(e) {}
    };

    const i = setInterval(syncProbs, 4000);
    syncProbs();
    return () => clearInterval(i);
  }, [selectedMarket, btcPrice, btc15mAgo]);

  // --- ENGINE LOGIC ---
  useEffect(() => {
    const runEngine = async () => {
      if (!botStatusRef.current?.isActive || !selectedMarketRef.current) return;
      const market = selectedMarketRef.current;
      const secrets = botStatusRef.current.secrets;
      const risk = riskRef.current!;

      // Ensure Privy wallet and API credentials are available. If not, halt the engine.
      if (!secrets.proxyAddress || !secrets.isConfigured || !apiCreds || !signer) {
        setBotStatus(p => ({ ...p, isActive: false }));
        addEvent('Engine halted: Wallet or credentials not configured.', 'ERROR');
        return;
      }
      
      if (processingTradeRef.current) {
          addEvent("Skipping tick: Trade execution in progress.", "WARN");
          return;
      }

      try {
         // Log Cycle Start
         addEvent(`[TICK] Analyzing Market: ${market.id.substring(0,8)}...`, "INFO");

         // --- 1. EXIT LOGIC (TAKE PROFIT) ---
         const openTrades = botStatusRef.current.logs.filter(l => l.status === 'OPEN' && l.marketId === market.id);
         
         addEvent("Fetching CLOB OrderBooks...", "INFO");
         const [yesBook, noBook] = await Promise.all([
             fetchOrderBook(market.clobTokenIds[0]),
             fetchOrderBook(market.clobTokenIds[1])
         ]);
         
         const bestYesAsk = yesBook.asks[0]?.price || 1;
         const bestNoAsk = noBook.asks[0]?.price || 1;
         const bestYesBid = yesBook.bids[0]?.price || 0;
         const bestNoBid = noBook.bids[0]?.price || 0;

         addEvent(`CLOB Depth: YES Ask ${bestYesAsk.toFixed(2)} | NO Ask ${bestNoAsk.toFixed(2)}`, "INFO");

         if (openTrades.length > 0) {
             addEvent(`Checking ${openTrades.length} active positions for Take Profit...`, "INFO");
             for (const trade of openTrades) {
                 const currentBid = trade.outcome === 'YES' ? bestYesBid : bestNoBid;

                 if (currentBid > 0) {
                     const pnlPct = ((currentBid - trade.entryPrice) / trade.entryPrice) * 100;
                     if (pnlPct >= risk.takeProfitPct) {
                         processingTradeRef.current = true;
                         setIsExecuting(true);
                         try {
                             const sellSize = trade.size * (risk.sellAmountPct / 100);
                             addEvent(`TP TRIGGERED: +${pnlPct.toFixed(1)}% Gain. Selling ${risk.sellAmountPct}% position.`, "SUCCESS");
                             
                             // Determine the tokenId for the outcome
                             const sellTokenId = trade.outcome === 'YES' ? market.clobTokenIds[0] : market.clobTokenIds[1];
                             await placeOrderWithClient(
                               signer,
                               apiCreds,
                               secrets.proxyAddress,
                               sellTokenId,
                               currentBid - 0.01,
                               sellSize,
                               'SELL'
                             );
                             
                             setBotStatus(prev => ({
                                 ...prev,
                                 logs: prev.logs.map(l => l.id === trade.id ? { ...l, status: risk.sellAmountPct === 100 ? 'CLOSED' : 'PARTIAL' } : l)
                             }));
                             syncWallet();
                             addEvent("Take Profit Order Executed Successfully.", "SUCCESS");
                         } catch(e: any) {
                             addEvent(`TP Execution Failed: ${e.message}`, "ERROR");
                         } finally {
                             processingTradeRef.current = false;
                             setIsExecuting(false);
                         }
                     }
                 }
             }
         }

         // --- 2. ENTRY LOGIC ---
         if (Date.now() - lastTradeTimeRef.current < COOLDOWN_MS) {
            // addEvent("Cooldown active. Skipping entry check.", "INFO");
            return;
         }

         const yesEdge = ((modelProb / 100) - bestYesAsk) * 100;
         const noEdge = ((100 - modelProb) / 100 - bestNoAsk) * 100;

         addEvent(`Alpha Analysis: Model=${modelProb}% | YES Edge=${yesEdge.toFixed(2)}% | NO Edge=${noEdge.toFixed(2)}%`, "INFO");

         let executeOutcome: 'YES' | 'NO' | null = null;
         let executePrice = 0;

         if ((risk.directionBias === 'BOTH' || risk.directionBias === 'YES_ONLY') &&
             modelProb >= risk.minProbThreshold &&
             yesEdge >= risk.edgeThreshold) {
             executeOutcome = 'YES';
             executePrice = bestYesAsk;
         }
         else if ((risk.directionBias === 'BOTH' || risk.directionBias === 'NO_ONLY') &&
             (100 - modelProb) >= risk.minProbThreshold &&
             noEdge >= risk.edgeThreshold) {
             executeOutcome = 'NO';
             executePrice = bestNoAsk;
         }

         if (executeOutcome) {
             // Check Trade Count Limit
             const currentBuys = botStatusRef.current.logs.filter(l => l.marketId === market.id && l.side === 'BUY').length;
             if (currentBuys >= risk.maxBuyCountPerMarket) {
                 addEvent(`Entry Skipped: Buy Limit Reached (${currentBuys}/${risk.maxBuyCountPerMarket})`, "WARN");
                 return;
             }

             processingTradeRef.current = true;
             setIsExecuting(true);
             try {
                const unitsToBuy = risk.maxPositionSize / executePrice;
                addEvent(`OPPORTUNITY FOUND: Buying ${executeOutcome} @ ${executePrice} (Size: $${risk.maxPositionSize})`, "SUCCESS");
                
                const buyTokenId = executeOutcome === 'YES' ? market.clobTokenIds[0] : market.clobTokenIds[1];
                await placeOrderWithClient(
                  signer,
                  apiCreds,
                  secrets.proxyAddress,
                  buyTokenId,
                  executePrice + 0.01,
                  unitsToBuy,
                  'BUY'
                );
                
                const log: TradeLog = {
                    id: Math.random().toString(36).substring(7), 
                    timestamp: Date.now(), 
                    marketId: market.id, 
                    question: market.question,
                    outcome: executeOutcome, 
                    side: 'BUY',
                    entryPrice: executePrice, 
                    size: unitsToBuy, 
                    btcPriceAtEntry: btcPrice,
                    modelProb: modelProb, 
                    marketProb: executePrice * 100, 
                    volatilityAtEntry: btcVol, 
                    status: 'OPEN'
                };
                
                setBotStatus(prev => ({ ...prev, tradesCount: prev.tradesCount + 1, logs: [...prev.logs, log] }));
                addEvent("Order Confirmed on Polygon Network.", "SUCCESS");
                lastTradeTimeRef.current = Date.now();
                syncWallet(); 
             } catch (err: any) { 
                 const eMsg = err.message || "";
                 if (eMsg.toLowerCase().includes("unauthorized") || eMsg.includes("401") || eMsg.toLowerCase().includes("invalid api key")) {
                    addEvent("AUTH ERROR: API Key Rejected by Polymarket.", "ERROR");
                    addEvent("FIX: 1. Go to 'Vault Keys' tab.", "ERROR");
                    addEvent("FIX: 2. Verify API Key, Secret, and Passphrase match your Polymarket settings exactly.", "ERROR");
                    addEvent("FIX: 3. Ensure you are using the Proxy Wallet address if using the Relayer.", "ERROR");
                 } else {
                    addEvent(`Entry Execution Failed: ${eMsg}`, "ERROR"); 
                 }
             } 
             finally { 
                 processingTradeRef.current = false; 
                 setIsExecuting(false);
             }
         } else {
             // addEvent("No valid edge found > threshold.", "INFO");
         }
      } catch (e) {
          console.error(e);
          addEvent(`Critical Engine Error: ${(e as Error).message}`, "ERROR");
      }
    };
    const interval = setInterval(runEngine, 5000); 
    return () => clearInterval(interval);
  }, [botStatus.isActive, modelProb, marketProbYes, marketProbNo, apiCreds, signer]);

  const toggleBot = useCallback(() => {
    if (!botStatus.isActive && (!botStatus.secrets.isConfigured || !apiCreds || !signer)) {
        setActiveView('SECRETS');
        addEvent('Startup Aborted: Wallet or Vault not configured', 'ERROR');
        return;
    }
    
    const nextState = !botStatus.isActive;
    setBotStatus(prev => ({ ...prev, isActive: nextState }));
    
    if (nextState) {
        addEvent(">>> INITIALIZING HFT ALPHA ENGINE <<<", "SUCCESS");
        addEvent(`Loading Strategy Config: MaxSize=$${risk.maxPositionSize} | EdgeThreshold=${risk.edgeThreshold}%`, "INFO");
        addEvent("Connecting to Polygon RPC Nodes & CLOB Relayer...", "INFO");
    } else {
        addEvent(">>> SYSTEM SHUTDOWN SEQUENCE INITIATED <<<", "WARN");
        addEvent("Terminating event loops and cancelling subscriptions...", "INFO");
    }
  }, [botStatus.isActive, botStatus.secrets, risk, apiCreds, signer]);

  // Determine grid layout based on active view
  const gridClass = activeView === 'DASHBOARD' 
    ? "grid-cols-1 md:grid-cols-[1fr_400px]" 
    : "grid-cols-1";

  const renderNavButton = (view: typeof activeView, icon: React.ElementType, label: string) => (
    <button 
      onClick={() => setActiveView(view)} 
      className={`group side-icon-btn p-3 rounded-xl transition-all relative ${activeView === view ? 'bg-white/10 text-white active' : 'text-gray-500 hover:text-white'}`}
    >
      <div className="relative z-10">
        {React.createElement(icon, { size: 20 })}
      </div>
      <span className="hidden md:block absolute left-full top-1/2 -translate-y-1/2 ml-4 px-3 py-1 bg-black/90 border border-white/10 rounded text-[9px] font-mono uppercase tracking-widest text-mercury opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50 backdrop-blur-md">
        {label}
      </span>
    </button>
  );

  return (
    <div className="w-full h-full flex flex-col md:flex-row items-center justify-center relative overflow-x-hidden">
      <div className="cursor-follower hidden md:block" ref={followerRef}></div>
      <div className="stage">
        <div className="blob blob-1"></div>
        <div className="blob blob-2"></div>
        <div className="blob blob-3"></div>
      </div>
      <nav className="fixed bottom-0 md:bottom-auto md:left-0 md:top-0 w-full h-16 md:w-20 md:h-full flex flex-row md:flex-col items-center justify-around md:justify-start md:py-8 md:gap-8 z-50 border-t md:border-t-0 md:border-r border-white/5 backdrop-blur-xl bg-black/20">
        <div className="text-mercury mb-0 md:mb-4 opacity-50 hidden md:block"><Terminal size={24} /></div>
        {renderNavButton('DASHBOARD', Layers, 'Dashboard')}
        {renderNavButton('LEDGER', List, 'Ledger')}
        {renderNavButton('CONTROLS', SlidersHorizontal, 'Bot Controls')}
        {renderNavButton('SECRETS', Key, 'Vault Keys')}
        
        <div className="flex flex-row md:flex-col gap-4 items-center md:mt-auto md:mb-4">
           <button onClick={syncWallet} className="group p-2 text-gray-500 hover:text-cyan transition-colors relative">
             <RefreshCw size={16} />
             <span className="hidden md:block absolute left-full top-1/2 -translate-y-1/2 ml-4 px-3 py-1 bg-black/90 border border-white/10 rounded text-[9px] font-mono uppercase tracking-widest text-mercury opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50 backdrop-blur-md">
               SYNC
             </span>
           </button>
           <div className="hidden md:block h-px w-8 bg-white/10"></div>
           <button onClick={toggleBot} className={`group p-2 transition-all relative ${botStatus.isActive ? 'text-green-500 animate-pulse' : 'text-gray-600 hover:text-white'}`}>
              {botStatus.isActive ? <Square size={16} /> : <Play size={16} />}
              <span className="hidden md:block absolute left-full top-1/2 -translate-y-1/2 ml-4 px-3 py-1 bg-black/90 border border-white/10 rounded text-[9px] font-mono uppercase tracking-widest text-mercury opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50 backdrop-blur-md">
                {botStatus.isActive ? 'STOP' : 'RUN'}
              </span>
           </button>
           <div className="hidden md:block h-px w-8 bg-white/10"></div>
           {/* Login/Logout button for Privy authentication */}
           <button
             onClick={() => {
               if (authenticated) {
                 logout();
               } else {
                 login();
               }
             }}
             className="group p-2 text-gray-500 hover:text-cyan transition-colors relative"
           >
             {authenticated ? <LogOut size={16} /> : <LogIn size={16} />}
             <span className="hidden md:block absolute left-full top-1/2 -translate-y-1/2 ml-4 px-3 py-1 bg-black/90 border border-white/10 rounded text-[9px] font-mono uppercase tracking-widest text-mercury opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50 backdrop-blur-md">
               {authenticated ? 'LOGOUT' : 'LOGIN'}
             </span>
           </button>
        </div>
      </nav>
      
      <div className={`interface relative z-10 w-[95%] max-w-[1400px] h-auto md:h-[90vh] grid ${gridClass} gap-6 md:gap-8 md:ml-20 mt-4 md:mt-0 pb-24 md:pb-0 overflow-y-auto md:overflow-hidden custom-scrollbar`}>
        
        <section className="relative flex flex-col gap-6 h-full min-h-[500px]">
          {activeView === 'DASHBOARD' && (
            <>
              <div ref={anchorRef} className="price-anchor flex-1 p-6 md:p-12 flex flex-col relative rounded-sm">
                <div className="flex justify-between items-start mb-6">
                    <div className="flex flex-col gap-1">
                        <div className="text-[9px] md:text-[10px] font-mono tracking-[0.2em] md:tracking-[0.3em] uppercase opacity-50 flex items-center gap-2">
                           <Zap size={10} /> POLYBOT_TERMINAL
                        </div>
                        <div className="text-[9px] md:text-[10px] font-mono opacity-40">
                           USDC: {botStatus.balance.toFixed(2)} | GAS: {botStatus.nativeBalance.toFixed(3)}
                        </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                        {isScanningProxy && <div className="text-[9px] text-yellow-500 animate-pulse">SCANNING_NET</div>}
                        {isExecuting && <div className="text-[9px] text-cyan-400 animate-pulse flex items-center gap-1"><Cpu size={10}/> EXEC_ORDER_ROUTING</div>}
                    </div>
                </div>

                {selectedMarket ? (
                    <>
                        <div className="font-host font-light text-sm md:text-lg uppercase tracking-widest mb-2 flex items-center gap-2 md:gap-3 text-mercury opacity-80">
                           <span className={isExpiring ? "text-red-500 font-bold" : "text-yellow-500"}>
                             {timeLeftStr}
                           </span>
                           <span className="w-1 h-1 bg-white rounded-full opacity-30"></span> 
                           {selectedMarket.category}
                        </div>
                        <a href={selectedMarket.polymarketUrl} target="_blank" rel="noreferrer" className="group flex items-start gap-4 mb-6">
                           {selectedMarket.image && (
                               <img src={selectedMarket.image} alt="Market" className="w-12 h-12 md:w-16 md:h-16 rounded-full object-cover border border-white/10 shrink-0" />
                           )}
                           <h1 className="main-ticker text-[1.5rem] md:text-[clamp(2rem,4vw,3.5rem)] leading-tight md:leading-none group-hover:text-cyan transition-colors">
                             {selectedMarket.question}
                             <Globe size={20} className="inline ml-2 md:ml-4 opacity-0 group-hover:opacity-100 transition-opacity -translate-y-1" />
                           </h1>
                        </a>
                        
                        <div className="flex flex-wrap items-start gap-6 md:gap-12 pb-6 border-b border-white/5">
                            <div className="flex-1 min-w-[100px]">
                                <div className="font-mono text-[10px] md:text-xs uppercase opacity-40 mb-1 md:mb-2">Market Volatility</div>
                                <div className="font-mono text-lg md:text-2xl">{btcVol.toFixed(2)}%</div>
                            </div>
                            <div className="flex-2 min-w-[200px]">
                                <div className="font-mono text-[10px] md:text-xs uppercase opacity-40 mb-1 md:mb-2">Market Probability (Bids)</div>
                                <div className="flex items-center gap-4">
                                    <div className="font-mono text-2xl md:text-4xl text-green-400">YES {marketProbYes}%</div>
                                    <div className="h-8 w-px bg-white/10"></div>
                                    <div className="font-mono text-2xl md:text-4xl text-red-400">NO {marketProbNo}%</div>
                                </div>
                            </div>
                            <div className="flex-1 min-w-[150px]">
                                <div className="font-mono text-[10px] md:text-xs uppercase opacity-40 mb-1 md:mb-2">BTC Index</div>
                                <div className="font-mono text-lg md:text-2xl flex items-center gap-2">
                                   ${btcPrice.toLocaleString()}
                                </div>
                            </div>
                        </div>
                        <div className="flex-1"></div> 
                    </>
                ) : (
                    <div className="flex-1 flex items-center justify-center opacity-30 font-mono text-xs">INITIALIZING DATA STREAM...</div>
                )}
              </div>
              
              <div className="h-40 md:h-32 stat-card p-4 overflow-y-auto custom-scrollbar shrink-0">
                 <div className="font-mono text-[10px] opacity-40 mb-2 tracking-widest uppercase sticky top-0 bg-[#030303]/90 backdrop-blur-sm">Bot Logs</div>
                 <div className="flex flex-col gap-1 font-mono text-[10px]">
                    {systemEvents.map(e => (
                        <div key={e.id} className="flex gap-4 opacity-70">
                            <span className="opacity-30 whitespace-nowrap">{e.time}</span>
                            <span className={e.type === 'ERROR' ? 'text-red-500' : e.type === 'SUCCESS' ? 'text-green-400' : 'text-mercury'}>
                                {e.msg}
                            </span>
                        </div>
                    ))}
                 </div>
              </div>
              <div className="hidden md:block mt-auto py-2 text-center text-[10px] opacity-40 font-mono hover:opacity-100 transition-opacity shrink-0">
                <a href="https://x.com/kasperwtrcolor" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 hover:text-cyan transition-colors">
                   <ExternalLink size={10} /> Follow us on X @kasperwtrcolor
                </a>
              </div>
            </>
          )}
          {activeView === 'LEDGER' && (
            <div className="h-full stat-card p-4 md:p-8 flex flex-col overflow-hidden">
                <h2 className="text-xl md:text-3xl font-host font-bold mb-4 md:mb-8 border-b border-white/10 pb-4">Transaction Ledger</h2>
                <div className="flex-1 overflow-auto custom-scrollbar">
                    <table className="w-full text-left border-collapse min-w-[600px]">
                        <thead className="sticky top-0 bg-[#030303] z-10 font-mono text-xs uppercase tracking-widest opacity-50">
                            <tr>
                                <th className="pb-4">Time</th>
                                <th className="pb-4">Outcome</th>
                                <th className="pb-4">Action</th>
                                <th className="pb-4">Price</th>
                                <th className="pb-4">Status</th>
                            </tr>
                        </thead>
                        <tbody className="font-mono text-xs md:text-sm">
                            {[...botStatus.logs].reverse().map(log => (
                                <tr key={log.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                                    <td className="py-3 opacity-60">{new Date(log.timestamp).toLocaleTimeString()}</td>
                                    <td className={`py-3 font-bold ${log.outcome === 'YES' ? 'text-green-400' : 'text-red-400'}`}>{log.outcome}</td>
                                    <td className={`py-3 ${log.side === 'BUY' ? 'text-cyan-400' : 'text-yellow-400'}`}>{log.side}</td>
                                    <td className="py-3">${log.entryPrice.toFixed(2)}</td>
                                    <td className="py-3 opacity-50">{log.status}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
          )}
          {activeView === 'SECRETS' && (
             <div className="h-full flex items-center justify-center p-4">
                 <div className="w-full max-w-[500px] stat-card p-6 md:p-8">
                     <h2 className="text-xl md:text-2xl font-host font-bold mb-6">Vault Configuration</h2>
                     <BotControl
                        status={botStatus}
                        risk={risk}
                        selectedMarket={selectedMarket}
                        modelProb={modelProb}
                        btcPrice={btcPrice}
                        timeLeftSeconds={0}
                        onToggle={toggleBot}
                        onUpdateRisk={setRisk}
                        onUpdateSecrets={(s) => setBotStatus(p => ({ ...p, secrets: s }))}
                        onExecuteTrade={() => {}}
                        onRetryProxy={handleScanProxy}
                        activeView="SECRETS"
                        isPrivyUser={authenticated}
                        walletAddress={wallets && wallets.length > 0 ? wallets[0].address : undefined}
                     />
                 </div>
             </div>
          )}
          {activeView === 'CONTROLS' && (
             <div className="h-full flex items-center justify-center p-4">
                 <div className="w-full max-w-[800px] stat-card flex flex-col max-h-[85vh] md:max-h-[800px]">
                     <div className="p-6 md:p-8 border-b border-white/10 shrink-0">
                         <h2 className="text-xl md:text-2xl font-host font-bold">Bot Configuration</h2>
                     </div>
                     <div className="p-6 md:p-8 overflow-y-auto custom-scrollbar min-h-0">
                         <BotControl
                            status={botStatus}
                            risk={risk}
                            selectedMarket={selectedMarket}
                            modelProb={modelProb}
                            btcPrice={btcPrice}
                            timeLeftSeconds={0}
                            onToggle={toggleBot}
                            onUpdateRisk={setRisk}
                            onUpdateSecrets={(s) => setBotStatus(p => ({ ...p, secrets: s }))}
                            onExecuteTrade={() => {}}
                            onRetryProxy={handleScanProxy}
                            activeView="DASHBOARD"
                            isPrivyUser={authenticated}
                            walletAddress={wallets && wallets.length > 0 ? wallets[0].address : undefined}
                         />
                     </div>
                 </div>
             </div>
          )}
        </section>
        
        {activeView === 'DASHBOARD' && (
          <aside className="flex flex-col gap-4 h-full">
              <div className="h-full stat-card flex flex-col p-6">
                  <div className="font-mono text-[10px] tracking-widest uppercase opacity-40 mb-4 flex justify-between">
                      <span>Order Book Depth</span>
                      {isRefreshingMarkets && <RefreshCw size={10} className="animate-spin" />}
                  </div>
                  <div className="flex-1 overflow-hidden">
                      <OrderBookView 
                          market={selectedMarket} btcPrice={btcPrice} modelProb={modelProb}
                          balance={botStatus.balance} nativeBalance={botStatus.nativeBalance}
                          allowance={botStatus.allowance} secrets={botStatus.secrets} onExecuteTrade={() => {}} onRefresh={syncWallet}
                      />
                  </div>
              </div>
          </aside>
        )}
      </div>
    </div>
  );
};

export default TradingTerminal;