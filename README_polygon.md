# Polygon Amoy testnet: deploy, Chainlink Functions, and Dashboard + MetaMask

This guide walks through the **full path** for this repo on **Polygon Amoy** (Polygon’s testnet): wallet setup, POL + LINK, Chainlink Functions subscription, deploy **`VoltageAlertNFT`**, wire the subscription, run the Node server with the right env vars, and trigger **`requestVoltageCheck`** from the **Dashboard** using **MetaMask**.

> **Note:** Polygon’s public testnet is **Amoy** (chain ID **80002**). Older “Mumbai” guides are obsolete.

For the same flow on **Ethereum Sepolia**, see [`docs/SEPOLIA_AND_CHAINLINK_FUNCTIONS.md`](docs/SEPOLIA_AND_CHAINLINK_FUNCTIONS.md).

---

## Table of contents

1. [What you need](#1-what-you-need)
2. [Install project dependencies](#2-install-project-dependencies)
3. [Add Polygon Amoy to MetaMask](#3-add-polygon-amoy-to-metamask)
4. [Get Amoy POL and test LINK](#4-get-amoy-pol-and-test-link)
5. [Chainlink Functions (concepts)](#5-chainlink-functions-concepts)
6. [Create and fund a Functions subscription](#6-create-and-fund-a-functions-subscription)
7. [Deploy the contract on Amoy](#7-deploy-the-contract-on-amoy)
8. [Connect contract ↔ subscription](#8-connect-contract--subscription)
9. [Configure the Node server + dashboard](#9-configure-the-node-server--dashboard)
10. [End-to-end: IPFS URL → Dashboard → MetaMask](#10-end-to-end-ipfs-url--dashboard--metamask)
11. [Reference values (Amoy)](#11-reference-values-amoy)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. What you need

- **Node.js** (LTS) and **npm**
- **MetaMask** (or compatible injected wallet)
- **Amoy POL** — gas for deploy and transactions
- **Amoy testnet LINK** — pays Chainlink Functions via your subscription
- **A funded Pinata account** (optional but typical) so the server can pin sensor JSON and produce gateway URLs
- **Same wallet as contract owner** for dashboard calls: `requestVoltageCheck` is **`onlyOwner`**

---

## 2. Install project dependencies

```bash
cd perovskite_chain
npm install
npm run compile
```

`compile` must succeed (Hardhat + Chainlink + OpenZeppelin).

---

## 3. Add Polygon Amoy to MetaMask

1. Open MetaMask → network dropdown → **Add network** → **Add a network manually**.
2. Enter:

   | Field | Value |
   |--------|--------|
   | Network name | `Polygon Amoy` |
   | RPC URL | `https://rpc-amoy.polygon.technology` (or your Alchemy/Infura Amoy URL) |
   | Chain ID | `80002` |
   | Currency symbol | `POL` |
   | Block explorer | `https://amoy.polygonscan.com` |

3. Save and select **Polygon Amoy**.

---

## 4. Get Amoy POL and test LINK

1. Open **[faucets.chain.link/polygon-amoy](https://faucets.chain.link/polygon-amoy)**.
2. Connect the wallet; ensure MetaMask is on **Polygon Amoy**.
3. Request **POL** and **LINK** per the page (you may need to sign in / verify).

**Rough minimums:**

- Enough **POL** for several transactions (deploy + `setSubscriptionId` + a few `requestVoltageCheck` calls).
- At least **~2 LINK** on the subscription for testnet Functions (see Chainlink UI for current minimums; [supported networks](https://docs.chain.link/chainlink-functions/supported-networks) lists billing notes).

**Show LINK in MetaMask**

- Import token → contract: `0x0Fd9e8d3aF1aaee056EB9e802c3A762a667b1904` (Amoy LINK — [LINK token contracts](https://docs.chain.link/resources/link-token-contracts)).

---

## 5. Chainlink Functions (concepts)

- Your contract sends a **request** to the Chainlink **Functions router** on Amoy.
- The DON runs the **inline JavaScript** stored in `VoltageAlertNFT` (HTTP GET to your IPFS gateway URL, parse JSON, return `sensorId|voltageScaled`).
- The DON fulfills the request on-chain; if voltage (×1000) is below **`voltageThreshold`**, the contract can **mint** an ERC721.

Costs are paid from a **subscription** in **LINK**. You must **add your deployed contract address as a consumer** of that subscription.

**Amoy router & DON** (see [Supported Networks](https://docs.chain.link/chainlink-functions/supported-networks) — Polygon Amoy):

| Item | Value |
|------|--------|
| Functions router | `0xC22a79eBA640940ABB6dF0f7982cc119578E11De` |
| DON ID (string) | `fun-polygon-amoy-1` |
| Chain ID | `80002` |

The deploy script uses the router above and the standard `bytes32` DON id for `fun-polygon-amoy-1` (already encoded in `scripts/deploy-polygon-amoy.js`).

---

## 6. Create and fund a Functions subscription

1. Go to **[functions.chain.link](https://functions.chain.link)**.
2. Connect MetaMask.
3. Switch the app network to **Polygon Amoy** (not Sepolia / not mainnet).
4. Create a **new subscription** (if prompted, accept terms).
5. Fund the subscription with **Amoy LINK** (the UI will guide you; approve + transfer if needed).
6. **Copy the subscription ID** (uint64, e.g. `123` or shown as “Subscription ID”).

You will use this ID in **`setSubscriptionId`** after deploy.

---

## 7. Deploy the contract on Amoy

### 7.1 Environment

Create a `.env` in the project root (see `.env.example`). **Never commit a real private key.**

```env
PRIVATE_KEY=0xYOUR_DEPLOYER_PRIVATE_KEY
# optional
# POLYGON_AMOY_RPC_URL=https://rpc-amoy.polygon.technology
# VOLTAGE_THRESHOLD_SCALED=2000
```

`VOLTAGE_THRESHOLD_SCALED` is **volts × 1000** (e.g. `2000` = 2.0 V). Default in the script is `3000` if unset.

### 7.2 Deploy

```bash
npm run deploy:polygon-amoy
```

Note the printed **contract address**.

### 7.3 (Optional) Verify on Amoy Polygonscan

If you use Hardhat verify + Etherscan API key for Amoy, verify the contract for easier debugging. This is optional for the demo path.

---

## 8. Connect contract ↔ subscription

### 8.1 Add consumer in Chainlink UI

1. On **[functions.chain.link](https://functions.chain.link)** with **Polygon Amoy** selected, open your subscription.
2. **Add consumer** → paste your **`VoltageAlertNFT`** address → confirm the wallet transaction.

### 8.2 Set subscription ID on the contract

The contract stores `subscriptionId` via **`setSubscriptionId(uint64)`** (owner-only).

**Option A — Hardhat console**

```bash
npx hardhat console --network polygonAmoy
```

```js
const c = await ethers.getContractAt("VoltageAlertNFT", "0xYourContractAddress");
await c.setSubscriptionId(123n); // replace with your subscription id
```

**Option B — MetaMask**

Use “Write contract” on [Amoy Polygonscan](https://amoy.polygonscan.com) (if verified) or any ABI-capable tool; connect owner wallet and call `setSubscriptionId`.

### 8.3 Threshold tweaks (optional)

Owner can call **`setVoltageThreshold(uint256)`** with volts×1000 to match your panels (e.g. small perovskite demos ~0–2 V → try `50` for 0.05 V, `2000` for 2.0 V).

---

## 9. Configure the Node server + dashboard

The dashboard loads **`/api/config`** and uses **`CONTRACT_ADDRESS`**, chain metadata, and the IPFS gateway base. For Amoy, set:

```env
CONTRACT_ADDRESS=0xYourVoltageAlertNFT
IPFS_GATEWAY_BASE=https://gateway.pinata.cloud/ipfs/

WEB3_CHAIN_ID=80002
WEB3_CHAIN_ID_HEX=0x13882
WEB3_CHAIN_NAME=Polygon Amoy
```

Then start the server:

```bash
npm start
```

Open the app URL (default `http://localhost:3000`). The **New Panel Status** / MetaMask section will prompt for **Polygon Amoy** when you connect.

**Important**

- The wallet you use in MetaMask must be the **contract owner** (the deployer, unless you transferred ownership).
- Ensure **`CONTRACT_ADDRESS`** matches the Amoy deployment, not a Sepolia address.

---

## 10. End-to-end: IPFS URL → Dashboard → MetaMask

1. **Produce an IPFS JSON** the Functions script can read: the server pins payloads that include at least **`voltage`** and **`sensorId`** (see `VoltageAlertNFT` source and your `server.js` / ESP payload).
2. In the dashboard, confirm **Latest IPFS** / CID (or paste a full gateway URL if your UI allows — the flow uses the gateway base + hash from the server stats).
3. Click **Connect wallet** → approve **Polygon Amoy** if MetaMask asks.
4. Click **Run Panel Check** (or the action that calls **`requestVoltageCheck`** with the constructed gateway URL).
5. Approve the transaction. Wait for confirmation on Amoy.
6. Watch **Chainlink Functions** subscription page for the request; on success, check **`fulfill`** / NFT mint on Polygonscan (contract **Read/Write** and token transfers).

If voltage in the JSON (as interpreted ×1000) is **below** `voltageThreshold`, the contract mints an alert NFT (see contract events).

---

## 11. Reference values (Amoy)

| Item | Value |
|------|--------|
| Chain ID (decimal) | `80002` |
| Chain ID (hex) | `0x13882` |
| Functions router | `0xC22a79eBA640940ABB6dF0f7982cc119578E11De` |
| DON | `fun-polygon-amoy-1` |
| LINK token | `0x0Fd9e8d3aF1aaee056EB9e802c3A762a667b1904` |
| Faucet | [faucets.chain.link/polygon-amoy](https://faucets.chain.link/polygon-amoy) |

---

## 12. Troubleshooting

| Symptom | What to check |
|--------|----------------|
| MetaMask “wrong network” | `WEB3_*` env vars match Amoy; restart server after `.env` changes. |
| Transaction reverts on `requestVoltageCheck` | Owner wallet? `subscriptionId` set? Consumer added? Subscription has LINK? |
| Functions request stuck / fails | Gateway URL must be publicly reachable; JSON must include numeric `voltage`. |
| No mint after fulfill | Compare on-chain `voltageThreshold` to `voltage * 1000` from your JSON. |
| `onlyOwner` revert | Deployer (or current owner) must be the connected MetaMask account. |

---

## Scripts summary

| Command | Network |
|---------|---------|
| `npm run deploy` | Sepolia |
| `npm run deploy:polygon-amoy` | Polygon Amoy |

---

**Security:** Never share `PRIVATE_KEY` or commit `.env`. Use a dedicated test wallet on testnets only.
