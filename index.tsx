import React from 'react';
import ReactDOM from 'react-dom/client';
import { PrivyProvider } from '@privy-io/react-auth';
import App from './App';

/**
 * Entry point for the Polybot Trading Terminal.
 *
 * This file is responsible for bootstrapping the React application and
 * wrapping it with PrivyProvider.  The PrivyProvider manages user
 * authentication and the creation of embedded wallets.  In Phase 1
 * of the migration the embedded wallet is automatically created when
 * a user logs in, and all external Ethereum injectors are disabled to
 * avoid conflicts with MetaMask or other browser wallets.  The
 * application itself is rendered inside the PrivyProvider and
 * protected by the authentication gate defined in App.tsx.
 */

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <PrivyProvider
      appId="cmjubzyoh007vl10caa6b6avs"
      config={{
        embeddedWallets: {
          createOnLogin: 'users-without-wallets',
          noPromptOnSignature: true
        },
        walletConnectors: {
          injected: false
        }
      }}
    >
      <App />
    </PrivyProvider>
  </React.StrictMode>
);