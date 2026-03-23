# perovskite_chain

Skoltech BCEI 2026 project: battery voltage sensor → local server → Pinata IPFS (authenticated) → Chainlink Functions → ERC721 low-voltage alert.

## Overview

1. **ESP12F** reads battery voltage from ADC (voltage divider R1=330kΩ, R2=100kΩ), sends a **signed payload** every **N minutes** (interval configurable and strictly within min/max in code).
2. **Node.js server** verifies the sensor's **Ed25519 signature**, then pins the payload to **Pinata IPFS**. Only data signed by the sensor's private key is pinned, so authenticity can be verified by anyone with the public key.
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
- В репозитории: Hardhat, контракт `VoltageAlertNFT` в `contracts/VoltageAlertNFT.sol`.
- Контракт:
  - Подписан на **Chainlink Functions** (subscription на [functions.chain.link](https://functions.chain.link)).
  - По вызову `requestVoltageCheck(ipfsGatewayUrl)` отправляет в DON запрос: загрузить JSON по URL (например `https://gateway.pinata.cloud/ipfs/<CID>`), вернуть строку `sensorId|voltageScaled` (voltage * 1000).
  - В колбэке: если `voltageScaled < voltageThreshold`, минтует **ERC721** и связывает токен с сенсором (`tokenSensor[tokenId] = sensorId`). Порог задаётся при деплое и через `setVoltageThreshold` (в единицах 0.001 V, например 3000 = 3.0 V).

Сборка и деплой (Sepolia):

```bash
npm install
npm run compile
# Set SEPOLIA_RPC_URL and PRIVATE_KEY, then:
npm run deploy
```

Если `npm run compile` выдаёт ошибку импорта Chainlink (путь в пакете может отличаться), можно собрать и задеплоить контракт через [Remix](https://remix.ethereum.org), используя пример из [Chainlink Functions Getting Started](https://docs.chain.link/chainlink-functions/getting-started) и заменив контракт на `VoltageAlertNFT.sol` (импорты в Remix подхватятся по ссылке на контракты Chainlink).

После деплоя:

1. Создать/пополнить подписку Chainlink Functions и добавить адрес контракта как consumer.
2. Вызвать `setSubscriptionId(subscriptionId)` у контракта.
3. Когда на сервере появится новый IPFS hash (после очередного POST с сенсора), вызвать `requestVoltageCheck("https://gateway.pinata.cloud/ipfs/<CID>")`. После выполнения запроса, если напряжение ниже порога, контракт сам минтует NFT владельцу контракта. Можно вызвать вручную из Remix или скриптом: `CONTRACT_ADDRESS=0x... IPFS_CID=Qm... npm run request-voltage-check`.

ERC721 «привязан» к сенсору: в контракте хранится `tokenSensor[tokenId]` = `sensorId`; при желании в `tokenURI` можно указывать IPFS-метадату с публичным ключом сенсора.

## ToDo (из оригинального README)

Планировалось: пин показаний на IPFS (Pinata) и на аппаратной части — амперметр и работа с реальной солнечной панелью. Сейчас реализованы: интервал отправки N минут в заданных границах, подписанные данные, пин на Pinata с проверкой подлинности, получение данных из IPFS через Chainlink и выпуск ERC721 при падении напряжения ниже порога.

---

## 4. Web Dashboard

Красивый, современный веб-интерфейс для мониторинга напряжения батареи в реальном времени.

### Возможности

- **Интерактивный график** напряжения за последние 7 дней
- **Статистика**: текущее значение, среднее, минимум/максимум, количество записей
- **Автообновление** каждые 5 секунд
- **Управление**: кнопки вкл/выкл автообновления, ручное обновление
- **Адаптивный дизайн**: работает на мобильных, планшетах, десктопах

### Быстрый старт

```bash
npm install
npm start
# Откройте http://localhost:3000 в браузере
```

### Использование синтетических данных (для тестирования)

Запустите дашборд:

```bash
npm start
```

В отдельном терминале запустите генератор тестовых данных:

```bash
node test-data.js
```

На дашборде вы увидите:
- График заполняется линией тренда напряжения
- Статистика обновляется в реальном времени (текущее V, среднее, мин/макс)
- Количество записей растет
- Данные обновляются каждые 5 секунд

### Использование реальных данных (от ESP12F)

#### Шаг 1: Конфигурируйте ESP12F

Отредактируйте `esp_code.ino`:

```cpp
const char* ssid = "YOUR_WIFI_NAME";
const char* password = "YOUR_PASSWORD";
const char* server = "http://YOUR_SERVER_IP:3000/update";

const unsigned int SEND_INTERVAL_MINUTES = 1;  // Отправка каждую минуту
const char* SENSOR_ID = "perovskite_sensor_01";
```

#### Шаг 2: Сгенерируйте Ed25519 ключ

```bash
openssl genpkey -algorithm ed25519 -outform DER | tail -c 32 | xxd -p -c 32
# Вставьте 64 hex-символа в PRIVATE_KEY_HEX в esp_code.ino
```

#### Шаг 3: Загрузите прошивку

1. Откройте Arduino IDE
2. Загрузите библиотеку "Arduino Cryptography Library" by rweather
3. Выберите плату ESP12F/NodeMCU
4. Нажмите Upload (→)

#### Шаг 4: Запустите сервер

```bash
npm start
```

#### Шаг 5: Подключите питание к ESP12F

ESP12F будет:
1. Подключаться к Wi-Fi
2. Читать напряжение батареи с ADC (пин A0)
3. Подписывать данные приватным ключом
4. Отправлять на сервер каждые N минут

На дашборде вы увидите реальное напряжение батареи с криптографической подписью.

### API эндпоинты дашборда

- **GET /api/stats** — текущая статистика (count, current, min, max, avg, sensorId, lastUpdate)
- **GET /api/data** — все данные за последние 7 дней (массив с timestamp, voltage, verified, ipfsHash и т.д.)
- **GET /** — веб-дашборд (HTML страница)

### Структура хранилища

- История хранится в памяти сервера (dataHistory)
- Максимум 10,000 последних записей
- При перезагрузке сервера история теряется
- Для продакшена добавьте БД (SQLite, PostgreSQL, MongoDB)

### Переключение между тестовыми и реальными данными

**Тестовые данные:**
```bash
# Терминал 1: сервер
npm start

# Терминал 2: генератор синтетических данных
node test-data.js
```

**Реальные данные:**
```bash
# Терминал 1: сервер
npm start

# Включите ESP12F с питанием
# Данные будут приходить от реального сенсора
```

### Файлы дашборда

- **server.js** — Node.js сервер с API эндпоинтами
- **public/index.html** — веб-интерфейс (HTML/CSS/JavaScript)
- **test-data.js** — генератор синтетических данных для тестирования
