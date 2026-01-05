import { Market, OrderBook, TradingSecrets } from '../types';
import { ethers } from 'ethers';
// When integrating Privy with Polymarket, we rely on the official CLOB client
// to derive user API credentials and place orders. We conditionally import
// these modules here so that the rest of the code can remain unchanged even
// when the client isn't installed. If @polymarket/clob-client is not
// available, these imports will silently fail at runtime (until the user
// installs the package) and the legacy REST-based functions will be used.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { ClobClient, Side } from '@polymarket/clob-client';

const CLOB_API_BASE = 'https://clob.polymarket.com';
const GAMMA_API_BASE = 'https://gamma-api.polymarket.com';
const DISCOVERY_BASE_URL = 'https://694fa74342b7f1ccd14a8ad9-api.poof.new/markets/btc';
const RELAYER_API_BASE = 'https://relayer-v2.polymarket.com';

const USDC_ASSET_ID = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'; 
const CTF_EXCHANGE = '0x4bfb41d5b3570defd29cdad383c448539611f139'; 
const POLYGON_RPC = 'https://polygon.drpc.org'; 

export const fetchProxyAddress = async (eoa: string): Promise<string | null> => {
  if (!eoa || !ethers.isAddress(eoa)) return null;
  const address = eoa.toLowerCase();
  
  try {
    const res = await fetch(`${GAMMA_API_BASE}/profiles/${address}`, {
        headers: { 'Accept': 'application/json' }
    });
    if (res.ok) {
      const data = await res.json();
      const candidate = data.funder || data.proxyWallet;
      if (candidate && ethers.isAddress(candidate)) {
        return ethers.getAddress(candidate);
      }
    }
  } catch (e) { }

  try {
    const res = await fetch(`${GAMMA_API_BASE}/users/${address}`, {
        headers: { 'Accept': 'application/json' }
    });
    if (res.ok) {
      const data = await res.json();
      const candidate = data.funder || data.wallet || data.proxyWallet || data.scwAddress;
      if (candidate && ethers.isAddress(candidate)) {
        return ethers.getAddress(candidate);
      }
    }
  } catch (e) { }

  try {
    const url = `${RELAYER_API_BASE}/wallets?chainId=137&owner=${address}`;
    const res = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
    });
    if (res.ok) {
        const data = await res.json();
        const candidate = data.address || data.proxyAddress;
        if (candidate && ethers.isAddress(candidate)) {
            return ethers.getAddress(candidate);
        }
    }
  } catch (e) { }

  try {
    const url = `${CLOB_API_BASE}/proxy?address=${address}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    
    if (res.ok) {
      const data = await res.json();
      if (data.proxy && ethers.isAddress(data.proxy)) {
        return ethers.getAddress(data.proxy);
      }
    }
  } catch (error) {
    console.warn("Proxy lookup failed on all attempts.");
  }
  return null;
};

/**
 * Derive or retrieve Polymarket API credentials for the given signer using
 * the official CLOB client. This function wraps the client’s L1 method
 * `createOrDeriveApiKey()`, which uses the signer to authenticate and derive
 * the user’s API key, secret and passphrase. These credentials are used for
 * L2 authenticated requests to the Polymarket CLOB REST API. If the
 * @polymarket/clob-client package is unavailable, this function will throw
 * at runtime and the caller should handle the error accordingly.
 *
 * @param signer An ethers.js Signer from the user’s wallet (e.g. Privy embedded wallet)
 * @returns A promise resolving to an object containing apiKey, apiSecret, apiPassphrase and subaccount
 */
export async function deriveApiCredentialsFromSigner(signer: ethers.Signer): Promise<{
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string;
  subaccount?: string;
}> {
  if (!ClobClient) {
    throw new Error('Polymarket client library not found. Please install @polymarket/clob-client.');
  }
  // Initialize a temporary CLOB client with only L1 authentication
  const tempClient = new ClobClient(CLOB_API_BASE, 137, signer);
  const creds = await tempClient.createOrDeriveApiKey();
  // Normalise field names for consistency with our TradingSecrets type
  return {
    apiKey: creds.apiKey,
    apiSecret: (creds.secret as string) ?? creds.apiSecret ?? '',
    apiPassphrase: (creds.passphrase as string) ?? creds.apiPassphrase ?? '',
    subaccount: creds.subaccount
  };
}

/**
 * Submit a limit order to the Polymarket CLOB using the official client.
 * The client handles EIP-712 signing internally via the provided signer and
 * includes the necessary L2 authentication headers. This helper is used
 * instead of the legacy `placeClobOrder` when trading with a Privy wallet.
 *
 * @param signer The ethers.js Signer connected to the user’s wallet
 * @param apiCreds The API credentials derived with deriveApiCredentialsFromSigner()
 * @param funder The proxy wallet address (funder) for Polymarket trades
 * @param tokenId The token ID for the desired market outcome
 * @param price The limit price to post the order at (0–1 range)
 * @param size The number of shares to trade
 * @param side The trade direction: 'BUY' or 'SELL'
 * @returns The API response from the Polymarket CLOB
 */
export async function placeOrderWithClient(
  signer: ethers.Signer,
  apiCreds: { apiKey: string; apiSecret: string; apiPassphrase: string },
  funder: string,
  tokenId: string,
  price: number,
  size: number,
  side: 'BUY' | 'SELL'
): Promise<any> {
  if (!ClobClient) {
    throw new Error('Polymarket client library not found. Please install @polymarket/clob-client.');
  }
  // For embedded wallets (Privy, Gnosis Safe), signatureType is 2 per Polymarket docs
  const signatureType = 2;
  // Ensure we pass the correct field names for API credentials; the client
  // expects keys: apiKey, secret, passphrase. Some versions use different names.
  const credsObj: any = {
    apiKey: apiCreds.apiKey,
    secret: apiCreds.apiSecret,
    passphrase: apiCreds.apiPassphrase
  };
  const client = new ClobClient(CLOB_API_BASE, 137, signer, credsObj, signatureType, funder);
  const clobSide = side === 'BUY' ? Side.BUY : Side.SELL;
  const result = await client.createAndPostOrder({
    tokenID: tokenId,
    price: price,
    size: size,
    side: clobSide
  });
  return result;
}

const getClobHeaders = async (
  method: string,
  path: string, 
  body: string,
  secrets: TradingSecrets
) => {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const sigString = timestamp + method.toUpperCase() + path + (body || "");
  
  try {
    let normalizedSecret = secrets.apiSecret
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    
    while (normalizedSecret.length % 4 !== 0) {
      normalizedSecret += '=';
    }

    const secretBytes = ethers.decodeBase64(normalizedSecret);
    const hmacHex = ethers.computeHmac('sha256', secretBytes, ethers.toUtf8Bytes(sigString));
    const signature = ethers.encodeBase64(ethers.getBytes(hmacHex));

    const headers: Record<string, string> = {
      'POLY-API-KEY': secrets.apiKey,
      'POLY-SIGNATURE': signature, 
      'POLY-TIMESTAMP': timestamp, 
      'POLY-PASSPHRASE': secrets.apiPassphrase,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    return headers;
  } catch (err: any) {
    console.error("HMAC Signature Generation Error:", err);
    throw new Error(`Signature Error: ${err.message}`);
  }
};

export const fetchWalletStats = async (
  secrets: Partial<TradingSecrets> | undefined,
  proxyAddress: string
): Promise<{ balance: number; allowance: number; native: number }> => {
  // Even without a private key, we can still fetch the native and token balances via the proxy address.
  const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
  let nativeBal = 0;
  let tokenBal = 0;
  let tokenAllowance = 0;

  try {
    // If a private key is available, fetch the user’s EOA balance. Otherwise, skip.
    const pk = secrets?.privateKey;
    if (pk) {
      try {
        const ownerWallet = new ethers.Wallet(pk);
        const ownerAddress = ownerWallet.address;
        const nativeWei = await provider.getBalance(ownerAddress);
        nativeBal = parseFloat(ethers.formatEther(nativeWei));
      } catch (err) {
        console.warn('Native balance fetch error');
      }
    }

    // If a proxyAddress is provided, fetch the USDC balance and allowance for that proxy wallet.
    if (proxyAddress && ethers.isAddress(proxyAddress)) {
      const usdcContract = new ethers.Contract(
        USDC_ASSET_ID,
        [
          'function balanceOf(address) view returns (uint256)',
          'function allowance(address, address) view returns (uint256)'
        ],
        provider
      );
      try {
        const balanceWei = await usdcContract.balanceOf(proxyAddress);
        tokenBal = parseFloat(ethers.formatUnits(balanceWei, 6));
        const allowanceWei = await usdcContract.allowance(proxyAddress, CTF_EXCHANGE);
        tokenAllowance = parseFloat(ethers.formatUnits(allowanceWei, 6));
      } catch (err) {
        console.warn('USDC balance fetch error');
      }
    }
  } catch (e: any) {
    console.warn('Chain-level sync failed:', e.message);
  }

  return {
    balance: tokenBal,
    allowance: tokenAllowance,
    native: nativeBal
  };
};

export const fetchBTCSeriesMarkets = async (): Promise<{ markets: Market[], timing?: any }> => {
  try {
    const freshTimestamp = Date.now();
    const innerUrl = `${DISCOVERY_BASE_URL}?t=${freshTimestamp}`;
    const finalUrl = `https://corsproxy.io/?${encodeURIComponent(innerUrl)}`;
    
    const response = await fetch(finalUrl);
    if (!response.ok) throw new Error(`Status ${response.status}`);
    const result = await response.json();
    if (!result.success || !result.data) return { markets: [] };

    const { event, markets, timing } = result.data;
    return {
      markets: markets.map((m: any) => ({
        id: m.conditionId || m.questionId,
        question: m.question,
        description: m.description || event.description || '',
        slug: event.slug || '',
        outcomes: m.outcomes || [],
        outcomePrices: m.outcomePrices || [],
        clobTokenIds: m.clobTokenIds || [],
        volume: m.volume || '0',
        liquidity: '0',
        category: 'Crypto',
        startDate: event.startDate,
        endDate: timing?.eventEndTimeMs 
          ? new Date(timing.eventEndTimeMs).toISOString() 
          : (event.endDate || m.endDate),
        image: event.image,
        polymarketUrl: event.slug ? `https://polymarket.com/event/${event.slug}` : undefined
      })),
      timing
    };
  } catch (error) {
    console.error("Market fetch failed:", error);
    return { markets: [] };
  }
};

export const fetchOrderBook = async (tokenId: string): Promise<OrderBook> => {
  if (!tokenId) return { bids: [], asks: [] };
  try {
    const targetUrl = `${CLOB_API_BASE}/book?token_id=${tokenId}`;
    const response = await fetch(targetUrl);
    if (!response.ok) return { bids: [], asks: [] };
    const data = await response.json();
    const transform = (levels: any[]) => (levels || []).map((l: any) => ({
      price: parseFloat(l.price),
      size: parseFloat(l.size)
    }));
    return {
      bids: transform(data.bids).sort((a, b) => b.price - a.price),
      asks: transform(data.asks).sort((a, b) => a.price - b.price),
    };
  } catch (error) {
    return { bids: [], asks: [] };
  }
};

export const placeClobOrder = async (
  secrets: TradingSecrets,
  market: Market,
  outcome: 'YES' | 'NO',
  price: number,
  size: number,
  side: 'BUY' | 'SELL' = 'BUY'
): Promise<any> => {
  if (!secrets.isConfigured || !secrets.privateKey) throw new Error("Signer not configured.");

  const wallet = new ethers.Wallet(secrets.privateKey);
  
  // Outcome Mapping: YES -> index 0, NO -> index 1
  const tokenId = outcome === 'YES' ? market.clobTokenIds[0] : market.clobTokenIds[1];
  if (!tokenId) throw new Error("Market token ID invalid.");

  const timestamp = Math.floor(Date.now() / 1000);
  const expiration = (timestamp + 300).toString(); 
  const salt = Math.floor(Math.random() * 1e15).toString();
  
  const domain = {
    name: "Polymarket CTF Exchange",
    version: "1",
    chainId: 137,
    verifyingContract: CTF_EXCHANGE
  };

  const types = {
    Order: [
      { name: "salt", type: "uint256" },
      { name: "maker", type: "address" },
      { name: "signer", type: "address" },
      { name: "taker", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "makerAmount", type: "uint256" },
      { name: "takerAmount", type: "uint256" },
      { name: "expiration", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "feeRateBps", type: "uint256" },
      { name: "side", type: "uint8" }
    ]
  };

  const makerAmount = Math.floor(size * price * 1e6).toString();
  const takerAmount = Math.floor(size * 1e6).toString();
  const proxyAddress = ethers.getAddress(secrets.proxyAddress);
  const eoaAddress = ethers.getAddress(wallet.address);

  // CLOB Side: 0 = BUY, 1 = SELL
  const sideInt = side === 'BUY' ? 0 : 1;

  const orderForSigning = {
    salt,
    maker: proxyAddress,
    signer: eoaAddress,
    taker: ethers.ZeroAddress,
    tokenId,
    makerAmount,
    takerAmount,
    expiration,
    nonce: "0",
    feeRateBps: "0",
    side: sideInt
  };

  const signature = await wallet.signTypedData(domain, types, orderForSigning);
  
  const payload = {
    ...orderForSigning,
    signature,
    funder: proxyAddress, 
    orderType: "GTC",
    signatureType: 1 
  };

  const bodyString = JSON.stringify(payload);
  const path = '/order';
  const headers = await getClobHeaders('POST', path, bodyString, secrets);

  const response = await fetch(`${CLOB_API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: bodyString
  });

  if (!response.ok) {
    const errText = await response.text();
    let errorMsg = `API Error ${response.status}`;
    try {
      const errJson = JSON.parse(errText);
      errorMsg = errJson.error || errJson.message || errorMsg;
    } catch(e) {}
    throw new Error(errorMsg);
  }

  return await response.json();
}