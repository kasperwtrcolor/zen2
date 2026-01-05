import { usePrivy } from '@privy-io/react-auth';
import TradingTerminal from './TradingTerminal';

/**
 * App component
 *
 * Phase 1 of the migration introduces an authentication gate around the
 * existing trading terminal.  Users must log in via Privy before the
 * main interface is rendered.  The Privy authentication state is
 * managed through the usePrivy hook.  If the user is not logged in
 * or the Privy provider has not finished initialising, a simple
 * placeholder is shown.  Once authenticated, the TradingTerminal
 * component — which contains the original trading UI — is rendered.
 */
export default function App() {
  const { ready, authenticated, login, logout, user } = usePrivy();

  // While the PrivyProvider is initialising, display a loading state.
  if (!ready) {
    return <div style={{ padding: 40 }}>Loading…</div>;
  }

  // If the user is not authenticated, prompt them to log in.  The
  // login function will open the Privy modal configured in
  // index.tsx.  Once logged in, the authentication state will
  // update and the TradingTerminal will be rendered.
  if (!authenticated) {
    return (
      <div style={{ padding: 40 }}>
        <h2>Polybot Trading Terminal</h2>
        <p>Login to continue</p>
        <button onClick={login}>Login</button>
      </div>
    );
  }

  // When authenticated, show a simple header with the user ID and a
  // logout button.  Then render the TradingTerminal component which
  // contains the rest of the application.  In later phases this
  // header can be expanded with more user details or navigation.
  return (
    <div>
      <header style={{ padding: 12, borderBottom: '1px solid #333' }}>
        <span>Logged in as {user?.id}</span>
        <button style={{ marginLeft: 12 }} onClick={logout}>
          Logout
        </button>
      </header>
      <TradingTerminal />
    </div>
  );
}