# Step-by-step: Sepolia testnet and Chainlink Functions

This guide walks you through everything you need to run the **VoltageAlertNFT** contract on **Ethereum Sepolia** and use **Chainlink Functions** to fetch sensor data from IPFS and mint an ERC721 when voltage is below threshold.

---

## Table of contents

1. [What you need](#1-what-you-need)
2. [Add Sepolia to your wallet](#2-add-sepolia-to-your-wallet)
3. [Get Sepolia ETH and LINK](#3-get-sepolia-eth-and-link)
4. [Understand Chainlink Functions](#4-understand-chainlink-functions)
5. [Create and fund a Functions subscription](#5-create-and-fund-a-functions-subscription)
6. [Deploy the VoltageAlertNFT contract](#6-deploy-the-voltagealertnft-contract)
7. [Connect the contract to your subscription](#7-connect-the-contract-to-your-subscription)
8. [Trigger a voltage check and mint an NFT](#8-trigger-a-voltage-check-and-mint-an-nft)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. What you need

- **A Web3 wallet** (e.g. [MetaMask](https://metamask.io/)) with a wallet address you control.
- **Sepolia testnet ETH** – to pay for gas (deploying the contract and calling `requestVoltageCheck`, `setSubscriptionId`, etc.).
- **Sepolia testnet LINK** – to pay the Chainlink Functions DON for each request (the subscription is funded with LINK).
- **An IPFS URL** – your server pins sensor data to Pinata; you will pass the Pinata gateway URL (e.g. `https://gateway.pinata.cloud/ipfs/Qm...`) to the contract.

No mainnet funds are used; everything in this guide is on **testnet**.

---

## 2. Add Sepolia to your wallet

Sepolia is a separate network. Your wallet must be switched to it.

### MetaMask

1. Open MetaMask.
2. Click the network dropdown at the top (e.g. “Ethereum Mainnet”).
3. Click **“Add network”** or **“Add a network manually”**.
4. Enter:

   | Field        | Value        |
   |-------------|--------------|
   | Network name | Sepolia      |
   | RPC URL      | `https://rpc.sepolia.org` (or `https://ethereum-sepolia.publicnode.com`) |
   | Chain ID     | `11155111`   |
   | Currency symbol | ETH      |
   | Block explorer | `https://sepolia.etherscan.io` |

5. Save. Then select **Sepolia** from the network list.

You can also use “Search networks” and pick “Sepolia” if it appears as a preset.

---

## 3. Get Sepolia ETH and LINK

You need both to use Chainlink Functions on Sepolia.

### Option A: Chainlink faucet (recommended)

1. Go to **[faucets.chain.link/sepolia](https://faucets.chain.link/sepolia)**.
2. Ensure your wallet is on **Sepolia** and copy your **wallet address**.
3. Paste the address in the faucet page.
4. Request **testnet ETH** and **testnet LINK** (use the buttons on the page). You may need to complete a short verification.
5. Wait for the transactions to confirm. Check your balance in MetaMask (switch to Sepolia and look at ETH and LINK).

**Recommended minimum:** about **0.1 ETH** and **2 LINK** so you can deploy, set the subscription, and run several Functions requests.

### Option B: Other Sepolia faucets

- For **ETH only**: search for “Sepolia faucet” (e.g. sepoliafaucet.com, Alchemy/Infura faucets if you use them). Then get LINK from the Chainlink faucet above.
- LINK on Sepolia is only available from the Chainlink faucet (or bridges); use [faucets.chain.link/sepolia](https://faucets.chain.link/sepolia).

### Verify

- **ETH**: MetaMask should show a balance in “ETH” when Sepolia is selected.
- **LINK**: In MetaMask, click “Import tokens” (bottom of the token list), then add:
  - **Contract address (Sepolia LINK):** `0x779877A7B0D9E8603169DdbD7836e478b4624789`
  - Symbol: **LINK**, Decimals: **18**  
  Then you should see your LINK balance.

---

## 4. Understand Chainlink Functions

In this project:

- Your **smart contract** (VoltageAlertNFT) does not call the internet directly. It sends a **request** to Chainlink’s Decentralized Oracle Network (DON).
- The DON runs **JavaScript** that you define (in our case: HTTP GET to an IPFS gateway URL, read JSON, return `sensorId|voltageScaled`).
- The DON calls back your contract with the result; your contract’s **fulfillRequest** logic runs (e.g. if voltage &lt; threshold → mint ERC721).

You pay for this with **LINK**, from a **subscription** that you create and fund. You add your contract as a **consumer** of that subscription; when the contract sends a request, LINK is deducted from the subscription.

**Sepolia (Ethereum) values you’ll use:**

| Item            | Value |
|-----------------|--------|
| Network         | Ethereum Sepolia |
| Chain ID        | 11155111 |
| Functions router| `0xb83E47C2bC239B3bf370bc41e1459A34b41238D0` |
| DON ID          | `fun-ethereum-sepolia-1` (used internally in the contract) |
| LINK (Sepolia)  | `0x779877A7B0D9E8603169DdbD7836e478b4624789` |

Official reference: [Supported Networks](https://docs.chain.link/chainlink-functions/supported-networks) and [LINK Token Contracts – Sepolia](https://docs.chain.link/resources/link-token-contracts#sepolia-testnet).

---

## 5. Create and fund a Functions subscription

The subscription holds LINK and pays for each Chainlink Functions request made by your consumer contract.

### Step 5.1 – Open the Functions app

1. Go to **[functions.chain.link](https://functions.chain.link)**.
2. Connect your wallet (e.g. MetaMask).
3. In the UI, switch the network to **Sepolia** (top-right or network selector). If you don’t see Sepolia, check the docs for “Supported Networks” and ensure you’re on the right URL.

### Step 5.2 – Accept terms (first time only)

- If prompted, read and accept the **Chainlink Foundation Terms of Service**.
- You may need to sign a message in your wallet (no gas, just a signature).

### Step 5.3 – Create a subscription

1. Click **“Create subscription”** (or “New subscription”).
2. Enter:
   - **Email** – used for notifications and linking the subscription.
   - **Subscription name** (optional) – e.g. “Perovskite voltage alerts”.
3. Confirm in MetaMask when asked (e.g. transaction to create the subscription).
4. If asked, **sign the message** that links the subscription name/email to your subscription.
5. After the transaction confirms, you’ll see your new subscription and its **Subscription ID** (a number, e.g. `12345`). **Copy and save this ID**; you’ll need it when configuring the contract.

### Step 5.4 – Fund the subscription with LINK

1. On the subscription page, find **“Add funds”** or **“Fund”**.
2. Choose to add **LINK** (Sepolia LINK).
3. Enter an amount (e.g. **2 LINK** for testing). Each request costs a small amount of LINK (order of ~0.1–0.5 LINK on testnet; the UI may show an estimate).
4. Approve the transaction in MetaMask. Wait for confirmation.
5. The subscription balance should update and show the LINK you added.

You do **not** add the consumer contract here yet; that’s the next section after you deploy the contract.

---

## 6. Deploy the VoltageAlertNFT contract

You can deploy with **Hardhat** (from this repo) or with **Remix**. The contract needs the Sepolia Functions router and DON ID (already set in the repo for Sepolia).

### Option A – Deploy with Hardhat

1. **Install dependencies** (from the project root):

   ```bash
   cd d:\perovskite_chain
   npm install
   ```

2. **Compile**:

   ```bash
   npx hardhat compile
   ```

   If you get errors about `@chainlink/contracts` imports, see [Troubleshooting](#9-troubleshooting) or use Remix (Option B).

3. **Set your deployer key and RPC** (for Sepolia):

   - Create a `.env` in the project root (do not commit it). Add:
     ```env
     SEPOLIA_RPC_URL=https://rpc.sepolia.org
     PRIVATE_KEY=your_private_key_hex_without_0x
     ```
   - `PRIVATE_KEY`: the private key of the wallet that will own the contract (the same one you use in MetaMask for Sepolia). Export from MetaMask: Account menu → Account details → Export Private Key. **Never share or commit this key.**

4. **Deploy**:

   ```bash
   npx hardhat run scripts/deploy.js --network sepolia
   ```

5. The script will print something like:
   ```text
   VoltageAlertNFT deployed to: 0x...
   ```
   **Copy this contract address**; you need it for the next steps.

### Option B – Deploy with Remix

1. Open **[remix.ethereum.org](https://remix.ethereum.org)**.
2. Create a file (e.g. `VoltageAlertNFT.sol`) and paste the contract code from `contracts/VoltageAlertNFT.sol`. Remix can often resolve Chainlink imports via GitHub; if not, copy the import paths from the [Chainlink Getting Started](https://docs.chain.link/chainlink-functions/getting-started) example and adjust, or use the “Load from” feature for the Chainlink contracts.
3. In the **Compile** tab, select compiler **0.8.19** and compile.
4. In the **Deploy** tab:
   - Environment: **Injected Provider – MetaMask**.
   - Set network to **Sepolia** in MetaMask.
   - For the constructor, use:
     - **router:** `0xb83E47C2bC239B3bf370bc41e1459A34b41238D0`
     - **donID:** `0x66756e2d657468657265756d2d7365706f6c69612d3100000000000000000000`
     - **voltageThresholdScaled:** `3000` (for 3.0 V)
5. Click **Deploy**, confirm in MetaMask, and wait for the transaction. Copy the **deployed contract address**.

---

## 7. Connect the contract to your subscription

Your contract can only use Chainlink Functions if it is a **consumer** of your subscription and if the contract **knows** the subscription ID.

### Step 7.1 – Add the contract as a consumer

1. Go back to **[functions.chain.link](https://functions.chain.link)** and open your **Sepolia** subscription.
2. Find **“Add consumer”** (or “Add consumer contract”).
3. Paste the **VoltageAlertNFT contract address** you deployed.
4. Confirm the transaction in MetaMask. This allows the subscription to pay for requests from this contract.

### Step 7.2 – Tell the contract the subscription ID

1. Open your contract in Remix (Deploy tab → “At address”) or use Hardhat/etherscan:
   - **Contract address:** the one you deployed.
   - If using Remix: paste the address and click “At address” so the contract’s functions appear.
2. Call **`setSubscriptionId`**:
   - **subscriptionId:** the numeric Subscription ID from [Step 5.3](#step-53--create-a-subscription) (e.g. `12345`).
3. Send the transaction and wait for confirmation.

After this, the contract is allowed to send requests and the subscription will be charged in LINK.

---

## 8. Trigger a voltage check and mint an NFT

The contract has a function **`requestVoltageCheck(ipfsGatewayUrl)`**. It passes that URL to Chainlink Functions; the DON fetches the JSON from IPFS, parses `voltage` and `sensorId`, and returns them. If the reported voltage is below the threshold, the contract mints an ERC721 to the contract owner and ties it to the sensor.

### Step 8.1 – Get an IPFS URL

- Your **Node.js server** pins sensor payloads to Pinata and can expose the last CID (e.g. via GET `/ipfs` → `lastIpfsHash`).
- Build the **full URL** the DON can fetch, e.g.:
  ```text
  https://gateway.pinata.cloud/ipfs/QmXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
  ```
  The JSON at that URL must include at least `voltage` (number) and `sensorId` (string), as produced by your server/ESP flow.

### Step 8.2 – Call `requestVoltageCheck`

1. In Remix (or any interface to your contract):
   - Open the **VoltageAlertNFT** contract at its address.
   - Find **`requestVoltageCheck`**.
   - **ipfsGatewayUrl:** paste the full URL from Step 8.1 (as a string).
2. Click **transact** and confirm in MetaMask. This sends the request to Chainlink Functions and costs some gas.

### Step 8.3 – Wait for fulfillment

- The DON will:
  - Fetch the URL.
  - Run the JavaScript (parse JSON, build `sensorId|voltageScaled`).
  - Call back your contract’s **fulfillRequest**.
- This usually takes **1–2 minutes** (sometimes a bit more on testnet).
- You can:
  - **Watch on [functions.chain.link](https://functions.chain.link)** – your subscription’s request history will show the request and its status (e.g. “Success” or “Failed”).
  - **Check Sepolia Etherscan** – look at your contract’s “Internal Txns” or “Events” for the callback and any **LowVoltageAlert** or mint event.

### Step 8.4 – Check the result

- If the fetched voltage was **below** the threshold (e.g. &lt; 3.0 V for threshold 3000):
  - The contract mints an ERC721 to the **contract owner**.
  - You can call **`ownerOf(tokenId)`** (tokenId starts at 0) and **`tokenURI(tokenId)`**, and **`tokenSensor(tokenId)`** to see the linked sensorId.
- If the voltage was **above** the threshold, no NFT is minted; the request still completes and the subscription is charged.

### Optional – Trigger from a script

From the project root you can use:

```bash
# Windows (PowerShell)
$env:CONTRACT_ADDRESS = "0xYourContractAddress"
$env:IPFS_CID = "QmXXXXXXXX..."
npm run request-voltage-check
```

Or set `IPFS_GATEWAY_URL` to the full URL instead of `IPFS_CID`. The script calls `requestVoltageCheck` with that URL.

---

## 9. Troubleshooting

### “Insufficient funds” or transaction fails

- Ensure you’re on **Sepolia** and have enough **ETH** for gas.
- For “LINK” errors during the request, ensure your **subscription** has enough LINK (add funds in the Functions UI).

### Contract not in the list of consumers / “Unauthorized” or request fails

- You must **add the contract as a consumer** in [functions.chain.link](https://functions.chain.link) (Step 7.1).
- You must have called **`setSubscriptionId`** with the correct ID (Step 7.2).

### Request stays “Pending” or “Failed” on functions.chain.link

- Check that the **IPFS URL** is publicly reachable (open it in a browser; it should return JSON with `voltage` and `sensorId`).
- Ensure the URL is the **full** URL (e.g. `https://gateway.pinata.cloud/ipfs/...`), not just the CID.
- Look at the error message in the request details; it often indicates timeout or invalid response.

### Hardhat compile fails on Chainlink imports

- Ensure **Node.js** is recent (e.g. 18+) and run `npm install` again.
- If the path to `FunctionsClient.sol` or other Chainlink files is wrong, check the [Chainlink contracts npm](https://www.npmjs.com/package/@chainlink/contracts) structure for your version, or deploy with **Remix** and use the contract from the repo (Option B in Section 6).

### Wrong network in MetaMask

- Always double-check the network dropdown: it must say **Sepolia** when you get funds, deploy, add consumer, and call `requestVoltageCheck`.

### Need the exact Sepolia parameters again

| What            | Value |
|----------------|--------|
| Chain ID       | 11155111 |
| LINK (Sepolia) | `0x779877A7B0D9E8603169DdbD7836e478b4624789` |
| Functions router | `0xb83E47C2bC239B3bf370bc41e1459A34b41238D0` |
| Faucet         | [faucets.chain.link/sepolia](https://faucets.chain.link/sepolia) |
| Functions UI   | [functions.chain.link](https://functions.chain.link) (switch to Sepolia) |

---

## Quick checklist

- [ ] Wallet on Sepolia, with some ETH and LINK.
- [ ] Subscription created and funded on [functions.chain.link](https://functions.chain.link) (Sepolia).
- [ ] VoltageAlertNFT deployed on Sepolia; address saved.
- [ ] Contract added as consumer of the subscription.
- [ ] `setSubscriptionId(subscriptionId)` called on the contract.
- [ ] At least one IPFS URL with valid sensor JSON available.
- [ ] `requestVoltageCheck(fullIpfsGatewayUrl)` called; fulfillment checked on functions.chain.link or Etherscan.

Once all steps are done, you can trigger voltage checks whenever you have a new Pinata IPFS URL (e.g. after each sensor POST to your server) and the contract will mint an ERC721 when the voltage is below the set threshold.
