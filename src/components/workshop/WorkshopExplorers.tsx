"use client";

import { useState } from 'react';
import { ArrowRight, Check, Network, Store, Wallet } from 'lucide-react';
import { illustrateSplit, settlementTokens } from './content';
import styles from './workshop.module.css';

export function SplitExplorer() {
  const [account, setAccount] = useState(0);
  const [accounts, setAccounts] = useState([{ partnerBps: 150, agentBps: 50 }, { partnerBps: 100, agentBps: 25 }, { partnerBps: 200, agentBps: 75 }]);
  const selected = accounts[account];
  const allocation = illustrateSplit(selected.partnerBps, selected.agentBps);
  function update(field: 'partnerBps' | 'agentBps', value: number) {
    setAccounts(current => current.map((item, index) => index === account ? { ...item, [field]: value } : item));
  }
  return <div className={styles.splitExplorer}>
    <div className={styles.explorerHeading}><div><span className={styles.microLabel}>INTERACTIVE EXAMPLE / 1,000 USDC PAYMENT</span><h3>Different accounts. Different economics.</h3></div><span className={styles.demoBadge}>Illustration only</span></div>
    <div className={styles.accountChoices} role="group" aria-label="Example merchant account">{accounts.map((_, index) => <button key={index} type="button" aria-pressed={account === index} onClick={() => setAccount(index)}>Merchant {String.fromCharCode(65 + index)}<span>Own split configuration</span></button>)}</div>
    <div className={styles.splitInputs}>
      <label htmlFor="workshop-partner-share"><span>Your ISO / provider share <strong>{(selected.partnerBps / 100).toFixed(2)}%</strong></span><input id="workshop-partner-share" aria-label="Your ISO / provider share" aria-valuetext={`${(selected.partnerBps / 100).toFixed(2)} percent`} type="range" min="0" max="500" step="25" value={selected.partnerBps} onChange={event => update('partnerBps', Number(event.target.value))} /></label>
      <label htmlFor="workshop-agent-share"><span>Your agent’s share <strong>{(selected.agentBps / 100).toFixed(2)}%</strong></span><input id="workshop-agent-share" aria-label="Your agent’s share" aria-valuetext={`${(selected.agentBps / 100).toFixed(2)} percent`} type="range" min="0" max="300" step="25" value={selected.agentBps} onChange={event => update('agentBps', Number(event.target.value))} /></label>
    </div>
    <div className={styles.splitOutputs} aria-live="polite" aria-atomic="true">{allocation.map(item => <article key={item.label}><span>{item.label}</span><strong>{item.amount.toFixed(2)} <small>USDC</small></strong><p>{(item.bps / 100).toFixed(2)}% of this payment</p></article>)}</div>
    <div className={styles.splitTotal}><Check size={16} /> 100% allocated · 1,000.00 USDC total<span>Switch accounts: each keeps its own example settings.</span></div>
    <p className={styles.paymentNote}>Example rates, including a 0.50% platform share, are illustrative and exclude funding, bridge and network fees. Live terms and permitted changes depend on your agreement and deployed split configuration. This demo does not change any account.</p>
  </div>;
}

export function CryptoExplorer() {
  const [token, setToken] = useState<(typeof settlementTokens)[number]>('USDC');
  const [source, setSource] = useState('ETH on Ethereum');
  return <div className={styles.cryptoExplorer}>
    <div className={styles.cryptoSelectors}><label htmlFor="workshop-source">Your customer holds<select id="workshop-source" aria-label="Your customer holds" value={source} onChange={event => setSource(event.target.value)}>{['ETH on Ethereum', 'USDC on Arbitrum', 'POL on Polygon'].map(item => <option key={item}>{item}</option>)}</select></label><div><span id="workshop-destination-label">You choose to receive on Base</span><div className={styles.tokenChoices} role="group" aria-labelledby="workshop-destination-label">{settlementTokens.map(item => <button type="button" key={item} aria-pressed={token === item} onClick={() => setToken(item)}>{item}</button>)}</div></div></div>
    <div className={styles.cryptoRoute} aria-live="polite" aria-atomic="true"><article><Wallet /><span>CUSTOMER’S ASSET</span><h3>{source}</h3><p>Your customer pays with an asset they already hold.</p></article><ArrowRight aria-hidden="true" /><article><Network /><span>CROSS-CHAIN ROUTING</span><h3>Bridge + convert</h3><p>The supported route moves value across chains and into your selected asset.</p></article><ArrowRight aria-hidden="true" /><article><Store /><span>YOUR SETTLEMENT ASSET</span><h3>{token} on Base</h3><p>Your payment arrives in your chosen supported asset, ready for the configured split.</p></article></div>
    <p className={styles.paymentNote}>Illustrative route, not a live quote. Availability depends on supported token pairs, liquidity and network conditions. Amounts, fees and timing are shown in the checkout quote. Assets such as SOL use their supported representation on Base.</p>
  </div>;
}
