// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FunctionsClient} from "@chainlink/contracts/src/v0.8/functions/v1_0_0/FunctionsClient.sol";
import {FunctionsRequest} from "@chainlink/contracts/src/v0.8/functions/v1_0_0/libraries/FunctionsRequest.sol";
import {ConfirmedOwner} from "@chainlink/contracts/src/v0.8/shared/access/ConfirmedOwner.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";

/**
 * @title VoltageAlertNFT
 * @notice When Chainlink Functions reports voltage from IPFS below threshold, mints an ERC721
 *         paired with the sensor (sensorId and publicKey in metadata / token URI).
 */
contract VoltageAlertNFT is FunctionsClient, ConfirmedOwner, ERC721, ERC721URIStorage {
    using FunctionsRequest for FunctionsRequest.Request;

    // Voltage threshold: stored as integer (voltage * 1000), e.g. 3000 = 3.0 V
    uint256 public voltageThreshold;
    // Chainlink Functions
    address public router;
    bytes32 public donID;
    uint64 public subscriptionId;
    uint32 public gasLimit;
    string public functionsSource;

    bytes32 public s_lastRequestId;
    bytes public s_lastResponse;
    bytes public s_lastError;

    // sensorId => whether we already minted an alert for this sensor (optional: one per sensor)
    mapping(string => bool) public hasMintedForSensor;
    // tokenId => sensorId (pairing)
    mapping(uint256 => string) public tokenSensor;
    uint256 private _nextTokenId;

    event LowVoltageAlert(string indexed sensorId, uint256 voltageScaled, uint256 tokenId);
    error UnexpectedRequestID(bytes32 requestId);
    error InvalidResponse();

    constructor(
        address _router,
        bytes32 _donID,
        uint256 _voltageThresholdScaled
    ) FunctionsClient(_router) ConfirmedOwner(msg.sender) ERC721("VoltageAlert", "VALRT") {
        router = _router;
        donID = _donID;
        voltageThreshold = _voltageThresholdScaled; // e.g. 3000 for 3.0 V
        gasLimit = 300_000;
        // JS: fetch IPFS JSON from args[0], return "sensorId|voltageScaled" (voltage * 1000)
        functionsSource = "const url = args[0];"
            "const res = await Functions.makeHttpRequest({ url });"
            "if (res.error || !res.data) throw new Error('IPFS fetch failed');"
            "const d = res.data;"
            "const sensorId = typeof d.sensorId === 'string' ? d.sensorId : '';"
            "const v = Number(d.voltage);"
            "const scaled = Math.round((isNaN(v) ? 0 : v) * 1000);"
            "return Functions.encodeString(sensorId + '|' + String(scaled));";
    }

    function setSubscriptionId(uint64 _subscriptionId) external onlyOwner {
        subscriptionId = _subscriptionId;
    }

    function setVoltageThreshold(uint256 _voltageThresholdScaled) external onlyOwner {
        voltageThreshold = _voltageThresholdScaled;
    }

    /**
     * @notice Request voltage check from IPFS via Chainlink Functions.
     * @param ipfsGatewayUrl Full URL to fetch JSON, e.g. https://gateway.pinata.cloud/ipfs/Qm...
     */
    function requestVoltageCheck(string calldata ipfsGatewayUrl) external onlyOwner returns (bytes32 requestId) {
        string[] memory args = new string[](1);
        args[0] = ipfsGatewayUrl;

        FunctionsRequest.Request memory req;
        req.initializeRequestForInlineJavaScript(functionsSource);
        req.setArgs(args);

        requestId = _sendRequest(req.encodeCBOR(), subscriptionId, gasLimit, donID);
        s_lastRequestId = requestId;
        emit RequestSent(requestId);
        return requestId;
    }

    function fulfillRequest(
        bytes32 requestId,
        bytes memory response,
        bytes memory err
    ) internal override {
        if (s_lastRequestId != requestId) revert UnexpectedRequestID(requestId);
        s_lastResponse = response;
        s_lastError = err;

        if (response.length == 0) return;

        // response is "sensorId|voltageScaled" as string
        string memory data = string(response);
        (string memory sensorId, uint256 voltageScaled) = _parseResponse(data);

        if (voltageScaled < voltageThreshold) {
            _mintAlert(sensorId, voltageScaled);
        }
    }

    function _parseResponse(string memory data) internal pure returns (string memory sensorId, uint256 voltageScaled) {
        bytes memory b = bytes(data);
        uint256 sep;
        for (uint256 i = 0; i < b.length; i++) {
            if (b[i] == "|") {
                sep = i;
                break;
            }
        }
        if (sep == 0) return ("", 0);
        bytes memory idBytes = new bytes(sep);
        for (uint256 i = 0; i < sep; i++) idBytes[i] = b[i];
        sensorId = string(idBytes);
        bytes memory numBytes = new bytes(b.length - sep - 1);
        for (uint256 i = sep + 1; i < b.length; i++) numBytes[i - sep - 1] = b[i];
        voltageScaled = _bytesToUint(numBytes);
    }

    function _bytesToUint(bytes memory b) internal pure returns (uint256) {
        uint256 r = 0;
        for (uint256 i = 0; i < b.length; i++) {
            if (b[i] >= 0x30 && b[i] <= 0x39) r = r * 10 + uint8(b[i]) - 48;
        }
        return r;
    }

    function _mintAlert(string memory sensorId, uint256 voltageScaled) internal {
        uint256 tokenId = _nextTokenId++;
        _safeMint(owner(), tokenId);
        tokenSensor[tokenId] = sensorId;
        hasMintedForSensor[sensorId] = true;
        // Token URI can point to the same IPFS payload or a metadata JSON; here we use a generic URI
        _setTokenURI(tokenId, _formatTokenURI(sensorId, voltageScaled));
        emit LowVoltageAlert(sensorId, voltageScaled, tokenId);
    }

    function _formatTokenURI(string memory sensorId, uint256 voltageScaled) internal pure returns (string memory) {
        // In production, point to IPFS metadata that includes sensorId and publicKey
        return string.concat(
            "ipfs://sensor-alert/",
            _escape(sensorId),
            "/",
            _uint2str(voltageScaled)
        );
    }

    function _escape(string memory s) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        bytes memory r = new bytes(b.length);
        for (uint256 i = 0; i < b.length; i++) {
            if (b[i] == "|" || b[i] == "/") r[i] = "_";
            else r[i] = b[i];
        }
        return string(r);
    }

    function _uint2str(uint256 n) internal pure returns (string memory) {
        if (n == 0) return "0";
        uint256 j = n;
        uint256 len;
        while (j != 0) { len++; j /= 10; }
        bytes memory b = new bytes(len);
        uint256 k = len;
        while (n != 0) {
            k = k - 1;
            uint8 t = uint8(n % 10);
            b[k] = bytes1(t + 48);
            n /= 10;
        }
        return string(b);
    }

    function tokenURI(uint256 tokenId) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        return ERC721URIStorage.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC721URIStorage) returns (bool) {
        return ERC721.supportsInterface(interfaceId) || ERC721URIStorage.supportsInterface(interfaceId);
    }
}
