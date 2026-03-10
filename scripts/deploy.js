const hre = require("hardhat");

// Chainlink Functions on Sepolia
// https://docs.chain.link/chainlink-functions/supported-networks
const SEPOLIA_ROUTER = "0xb83E47C2bC239B3bf370bc41e1459A34b41238D0";
const SEPOLIA_DON_ID = "0x66756e2d657468657265756d2d7365706f6c69612d3100000000000000000000";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  // Voltage threshold: 3.0 V => 3000 (scaled)
  const voltageThresholdScaled = 3000;

  const VoltageAlertNFT = await hre.ethers.getContractFactory("VoltageAlertNFT");
  const contract = await VoltageAlertNFT.deploy(
    SEPOLIA_ROUTER,
    SEPOLIA_DON_ID,
    voltageThresholdScaled
  );
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log("VoltageAlertNFT deployed to:", addr);
  console.log("Set subscriptionId via setSubscriptionId(subId) and fund the subscription at https://functions.chain.link");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
