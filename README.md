# perovskite_chain

Skoltech BCEI 2026 project: battery voltage sensor → local server → Pinata IPFS (authenticated) → Chainlink Functions → ERC721 low-voltage alert.

## Overview

1. **ESP12F** reads battery voltage from ADC (voltage divider R1=330kΩ, R2=100kΩ), sends a **signed payload** every **N minutes** (interval configurable and strictly within min/max in code).
2. **Node.js server** verifies the sensor’s **Ed25519 signature**, then pins the payload to **Pinata IPFS**. Only data signed by the sensor’s private key is pinned, so authenticity can be verified by anyone with the public key.
3. A **smart contract** uses **Chainlink Functions** to fetch the latest sensor data from IPFS. When the reported voltage drops **below a fixed threshold**, the contract mints an **ERC721** token paired with the sensor (sensorId and keys).

## Guide (Russian)

1. **esp_code.ino** — прошивка для ESP12F. Загружается через Arduino IDE. Читает ADC (A0), считает напряжение батареи и отправляет подписанный JSON на сервер.
2. Компьютер с сервером и плата должны быть в одной Wi‑Fi сети. Общественный Wi‑Fi с порталом авторизации не подходит (ESP12F не умеет проходить капчу).
3. **server.js** — Node.js сервер: принимает POST `/update`, проверяет подпись, пинет данные в Pinata IPFS, отдаёт последние данные на GET `/`.

## 1. ESP12F firmware

### Interval (send every N minutes)

- In `esp_code.ino`:
  - `SEND_INTERVAL_MINUTES` — отправка раз в N минут (например, `5`).
  - `MIN_SEND_INTERVAL_MINUTES` и `MAX_SEND_INTERVAL_MINUTES` — допустимый диапазон; интервал обязан быть внутри этого диапазона.
- Перед первой отправкой интервал приводится к этому диапазону.

### Authenticity (Ed25519)

- Каждый запрос подписывается **Ed25519** (приватный ключ только на сенсоре). В запросе передаются `signature` и `publicKey`. Сервер проверяет подпись и только после этого пинет в IPFS — подделать данные сенсора без приватного ключа нельзя.
- Нужна библиотека **Arduino Cryptography Library** (rweather): в Arduino IDE → Sketch → Include Library → Manage Libraries → поиск «Arduino Cryptography Library» или [arduinolibs](https://github.com/rweather/arduinolibs). На ESP8266 при длительных операциях может понадобиться `crypto_feed_watchdog()` (см. [crypto_esp](https://rweather.github.io/arduinolibs/crypto_esp.html)).
- Сгенерировать ключ (один раз), вставить приватный ключ в код:
  ```bash
  openssl genpkey -algorithm ed25519 -outform DER | tail -c 32 | xxd -p -c 32
  ```
  Полученные 64 hex-символа вставить в `PRIVATE_KEY_HEX` в `esp_code.ino`. Публичный ключ можно не хранить в коде — он вычисляется из приватного.
- Уникальный идентификатор сенсора задаётся в `SENSOR_ID`.

### WiFi and server

- Заполнить `WIFI_NAME`, `PASSWORD`, `http://YOUR_SERVER_IP:3000/update` в `esp_code.ino`.

## 2. Node.js server

- **Деплой в интернет для ESP32 (Render / Fly / туннели, HTTPS, переменные окружения):** см. **[docs/DEPLOY_SERVER_FOR_ESP.md](docs/DEPLOY_SERVER_FOR_ESP.md)**.
- Установка: `npm install`
- Запуск: `npm start` (или `node server.js`).
- Переменные окружения (можно через `.env` или экспорт):
  - `PORT` — порт (по умолчанию 3000).
  - `PINATA_JWT` — JWT из [Pinata](https://pinata.cloud) (API Keys). Без него пин в IPFS не выполняется.

Эндпоинты:

- **POST /update** — тело JSON от ESP (включая `signature` и `publicKey`). Сервер проверяет Ed25519, при успехе пинет объект в Pinata и возвращает `{ ok, verified, ipfsHash, pinError }`.
- **GET /** — последние данные и последний IPFS hash (ссылка на Pinata gateway).
- **GET /ipfs** — JSON: `lastIpfsHash`, `lastPinError`, `lastData`.

Проверка подлинности: в IPFS попадает тот же JSON (включая `signature` и `publicKey`). Любой может проверить подпись по публичному ключу и убедиться, что данные созданы владельцем приватного ключа сенсора.

## 3. Smart contract (Chainlink + ERC721)

- **Пошаговая инструкция по Sepolia и Chainlink Functions:** см. **[docs/SEPOLIA_AND_CHAINLINK_FUNCTIONS.md](docs/SEPOLIA_AND_CHAINLINK_FUNCTIONS.md)** (полный гайд: кошелёк, краны, подписка, деплой, вызов).
- **Polygon Amoy testnet** (MetaMask на дашборде, Chainlink Functions, деплой): см. **[README_polygon.md](README_polygon.md)**.
- В репозитории: Hardhat, контракт `VoltageAlertNFT` в `contracts/VoltageAlertNFT.sol`.
- Контракт:
  - Подписан на **Chainlink Functions** (subscription на [functions.chain.link](https://functions.chain.link)).
  - По вызову `requestVoltageCheck(ipfsGatewayUrl)` отправляет в DON запрос: загрузить JSON по URL (например `https://gateway.pinata.cloud/ipfs/<CID>`), вернуть строку `sensorId|voltageScaled` (voltage * 1000).
  - В колбэке: если `voltageScaled < voltageThreshold`, минтует **ERC721** и связывает токен с сенсором (`tokenSensor[tokenId] = sensorId`). Порог задаётся при деплое и через `setVoltageThreshold` (в единицах 0.001 V, например 3000 = 3.0 V).

Сборка и деплой:

```bash
npm install
npm run compile
# Sepolia: set SEPOLIA_RPC_URL and PRIVATE_KEY, then:
npm run deploy
# Polygon Amoy: set PRIVATE_KEY (and optional POLYGON_AMOY_RPC_URL), then:
npm run deploy:polygon-amoy
```

Для Amoy после деплоя задайте в `.env` **`WEB3_CHAIN_ID=80002`**, **`WEB3_CHAIN_ID_HEX=0x13882`**, **`WEB3_CHAIN_NAME=Polygon Amoy`** и **`CONTRACT_ADDRESS`**, чтобы дашборд переключал MetaMask на нужную сеть (см. **README_polygon.md**).

Если `npm run compile` выдаёт ошибку импорта Chainlink (путь в пакете может отличаться), можно собрать и задеплоить контракт через [Remix](https://remix.ethereum.org), используя пример из [Chainlink Functions Getting Started](https://docs.chain.link/chainlink-functions/getting-started) и заменив контракт на `VoltageAlertNFT.sol` (импорты в Remix подхватятся по ссылке на контракты Chainlink).

После деплоя:

1. Создать/пополнить подписку Chainlink Functions и добавить адрес контракта как consumer.
2. Вызвать `setSubscriptionId(subscriptionId)` у контракта.
3. Когда на сервере появится новый IPFS hash (после очередного POST с сенсора), вызвать `requestVoltageCheck("https://gateway.pinata.cloud/ipfs/<CID>")`. После выполнения запроса, если напряжение ниже порога, контракт сам минтует NFT владельцу контракта. Можно вызвать вручную из Remix или скриптом: `CONTRACT_ADDRESS=0x... IPFS_CID=Qm... npm run request-voltage-check`.

ERC721 «привязан» к сенсору: в контракте хранится `tokenSensor[tokenId]` = `sensorId`; при желании в `tokenURI` можно указывать IPFS-метадату с публичным ключом сенсора.

## ToDo (из оригинального README)

Планировалось: пин показаний на IPFS (Pinata) и на аппаратной части — амперметр и работа с реальной солнечной панелью. Сейчас реализованы: интервал отправки N минут в заданных границах, подписанные данные, пин на Pinata с проверкой подлинности, получение данных из IPFS через Chainlink и выпуск ERC721 при падении напряжения ниже порога.
